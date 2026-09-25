import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import manifest from "../evals/blocker-decisions/development-manifest.json" with {
	type: "json",
};
import {
	evaluateCampaign,
	evaluateDeterministicPolicy,
	unsafeUpperBound,
} from "../evals/blocker-decisions/evaluate.js";
import {
	blockerQuestions,
	collectSimulatedJevEvidence,
} from "../evals/blocker-decisions/jev.js";
import { runBlockerCli } from "../evals/blocker-decisions/run.js";
import {
	digest,
	importLiveEvidence,
	mergeEvidence,
	observationBase,
	packetFor,
	parseCampaign,
	parseEvidence,
	type ValidatedCampaign,
} from "../evals/blocker-decisions/schema.js";
import corpus from "../evals/blocker-decisions/v1.json" with { type: "json" };

const campaign = parseCampaign(manifest, corpus);
function payload() {
	return {
		model: "jev-1.13.0",
		answers: {
			choice: {
				type: "choice",
				choice: "remedy",
				probabilities: { remedy: 0.95, abstain: 0.05 },
				confidence: 0.8,
			},
			goal_0: { type: "noul", noul: 0.99 },
			fit_0: { type: "noul", noul: 0.99 },
		},
		usage: { input_tokens: 200, output_tokens: 20 },
	};
}
function observation(
	c: ValidatedCampaign,
	index = 0,
	arm: "manager-policy" | "manager-policy-jev" = "manager-policy-jev",
) {
	const episode = c.corpus.episodes[index];
	if (!episode) throw new Error("fixture");
	return {
		...observationBase(c, episode, arm),
		origin: "live",
		metrics: {
			requestedModel:
				arm === "manager-policy"
					? c.manifest.managerModel
					: c.manifest.requestedModel,
			resolvedModel:
				arm === "manager-policy"
					? c.manifest.managerModel
					: c.manifest.requestedModel,
			latencyMs: 20,
			attempts: 1,
			inputTokens: 200,
			outputTokens: 20,
			reservedUsd: 0.002688,
			estimatedUsd: 0.0000084,
		},
		result: {
			kind: "decision",
			candidateId: "remedy",
			advice:
				arm === "manager-policy"
					? null
					: {
							choice: "remedy",
							confidence: 0.8,
							probabilities: { remedy: 0.95, abstain: 0.05 },
							assessments: { remedy: { goal: 0.99, suitability: 0.99 } },
						},
		},
	};
}
function bundle(c: ValidatedCampaign, observations: unknown[]) {
	return { schemaVersion: 1, campaignDigest: digest(c.manifest), observations };
}
function liveImport(c: ValidatedCampaign, observations: unknown[]) {
	const input = bundle(c, observations);
	return importLiveEvidence(c, input, {
		artifactDigest: digest(input),
		producer: "controlled-study-v1",
		reviewedBy: "operator",
	});
}

describe("blocker campaign", () => {
	test("offline report preserves missing arms and never promotes synthetic data", () => {
		const report = evaluateCampaign(
			campaign,
			evaluateDeterministicPolicy(campaign),
		);
		expect(report.verdict).toBe("inconclusive");
		expect(
			report.arms.find((r) => r.arm === "deterministic-policy")?.accepted,
		).toBe(1);
		expect(report.arms.find((r) => r.arm === "manager-policy")?.missing).toBe(
			8,
		);
		expect(report.paired.usefulCoverageGain).toBeNull();
		expect(report.qualification.map((q) => q.independentAccepted)).toEqual([
			0, 0,
		]);
		expect(Object.isFrozen(campaign.corpus.episodes[0]?.facts)).toBe(true);
	});
	test("rejects stale corpus, origin split leakage and duplicate observations", () => {
		expect(() =>
			parseCampaign({ ...manifest, corpusDigest: "0".repeat(64) }, corpus),
		).toThrow("corpus-digest");
		const changed = structuredClone(corpus);
		const first = changed.episodes[0];
		if (!first) throw new Error("fixture");
		changed.episodes.push({ ...first, id: "paraphrase", primary: false });
		expect(() =>
			parseCampaign(
				{
					...manifest,
					corpusDigest: digest(changed),
					splits: [
						...manifest.splits,
						{ episodeId: "paraphrase", split: "holdout" },
					],
				},
				changed,
			),
		).toThrow("origin-split");
		const row = observation(campaign);
		expect(() => parseEvidence(campaign, bundle(campaign, [row, row]))).toThrow(
			"duplicate-observation",
		);
	});
	test("labels never enter outgoing state or its digest", () => {
		const changed = structuredClone(corpus);
		const label = changed.episodes[0]?.labels[0];
		if (!label) throw new Error("fixture");
		label.rationale = "DO-NOT-SEND";
		label.useful = false;
		const other = parseCampaign(
			{ ...manifest, corpusDigest: digest(changed) },
			changed,
		);
		const a = campaign.corpus.episodes[0],
			b = other.corpus.episodes[0];
		if (!a || !b) throw new Error("fixture");
		expect(blockerQuestions(campaign, a)).toEqual(blockerQuestions(other, b));
		expect(digest(packetFor(campaign, a))).toBe(digest(packetFor(other, b)));
		expect(JSON.stringify(blockerQuestions(other, b))).not.toContain(
			"DO-NOT-SEND",
		);
	});
	test("imports require an explicit matching receipt and default to simulation", () => {
		const input = bundle(campaign, [observation(campaign)]);
		expect(parseEvidence(campaign, input).observations[0]?.origin).toBe(
			"simulation",
		);
		expect(() =>
			importLiveEvidence(campaign, input, {
				artifactDigest: "0".repeat(64),
				producer: "study",
				reviewedBy: "operator",
			}),
		).toThrow("import-receipt");
		const live = liveImport(campaign, [observation(campaign)]);
		expect(live.receipts[0]?.producer).toBe("controlled-study-v1");
		expect(live.observations[0]?.origin).toBe("imported-live");
		expect(() =>
			liveImport(campaign, [
				{ ...observation(campaign), policyVersion: "other" },
			]),
		).toThrow("comparator-identity");
		expect(() =>
			mergeEvidence(campaign, live, parseEvidence(campaign, input)),
		).toThrow("conflicting-evidence");
	});
	test("advice cannot admit forbidden scope and low absolute suitability abstains", () => {
		const rows = [observation(campaign, 1), observation(campaign, 0)];
		const row = rows[1];
		if (!row?.result.advice) throw new Error("fixture");
		row.result.advice.assessments.remedy.suitability = 0.1;
		const report = evaluateCampaign(campaign, liveImport(campaign, rows));
		expect(
			report.cases.filter(
				(r) => r.arm === "manager-policy-jev" && r.status === "accepted",
			),
		).toHaveLength(0);
		expect(
			report.arms.find((r) => r.arm === "manager-policy-jev")
				?.forbiddenProposals,
		).toBe(1);
	});
	test("malformed advice rejects exact options, probabilities, NaN and missing assessments", () => {
		for (const change of [
			{ probabilities: { remedy: 1 } },
			{ probabilities: { remedy: 0.8, abstain: 0.3 } },
			{ probabilities: { remedy: 0.1, abstain: 0.9 } },
			{ confidence: Number.NaN },
			{ assessments: {} },
		]) {
			const base = observation(campaign);
			const row = {
				...base,
				result: {
					...base.result,
					advice: { ...base.result.advice, ...change },
				},
			};
			expect(() => parseEvidence(campaign, bundle(campaign, [row]))).toThrow();
		}
	});
	test("simulation and unknown resolved models cannot qualify or admit", () => {
		const row = {
			...observation(campaign),
			metrics: { ...observation(campaign).metrics, resolvedModel: "other" },
		};
		const report = evaluateCampaign(campaign, liveImport(campaign, [row]));
		expect(
			report.cases.find((r) => r.arm === "manager-policy-jev")?.status,
		).toBe("abstain");
		expect(report.verdict).toBe("inconclusive");
		const noCall = {
			...observation(campaign),
			metrics: { ...observation(campaign).metrics, attempts: 0 },
		};
		const noCallReport = evaluateCampaign(
			campaign,
			liveImport(campaign, [noCall]),
		);
		expect(
			noCallReport.cases.find((entry) => entry.arm === "manager-policy-jev")
				?.actualLive,
		).toBe(false);
		expect(
			noCallReport.qualification.map((entry) => entry.independentAccepted),
		).toEqual([0, 0]);
	});
	test("299 retry plus one independent action never qualifies either class", () => {
		const first = corpus.episodes[0];
		if (!first) throw new Error("fixture");
		const episodes = Array.from({ length: 300 }, (_, i) => ({
			...structuredClone(first),
			id: `case-${i}`,
			originatingTaskId: `task-${i}`,
			independenceGroupId: `task-${i}`,
			facts: {
				...first.facts,
				candidates: first.facts.candidates.map((candidate) => ({
					...candidate,
					action: i === 299 ? "independent-feature" : "retry",
				})),
			},
		}));
		const data = { ...corpus, synthetic: false, episodes };
		const c = parseCampaign(
			{
				...manifest,
				corpusDigest: digest(data),
				registration: {
					status: "registered-holdout",
					developmentEvidenceDigest: "a".repeat(64),
					registeredAt: "2026-09-21T00:00:00Z",
				},
				splits: episodes.map((e) => ({ episodeId: e.id, split: "holdout" })),
			},
			data,
		);
		const evidence = liveImport(
			c,
			episodes.flatMap((_, i) => [
				observation(c, i),
				observation(c, i, "manager-policy"),
			]),
		);
		const report = evaluateCampaign(c, evidence);
		expect(report.qualification.map((q) => q.independentAccepted)).toEqual([
			299, 1,
		]);
		expect(report.verdict).toBe("no-go");
		const aheadEvidence = liveImport(
			c,
			episodes.flatMap((_, i) => [
				observation(c, i),
				{
					...observation(c, i, "manager-policy"),
					result: { kind: "abstain", advice: null },
				},
			]),
		);
		expect(evaluateCampaign(c, aheadEvidence).verdict).toBe("inconclusive");
		const losingEvidence = liveImport(
			c,
			episodes.flatMap((_, i) => [
				{
					...observation(c, i),
					result: {
						kind: "abstain",
						advice: {
							choice: "abstain",
							confidence: 0.8,
							probabilities: { remedy: 0.05, abstain: 0.95 },
							assessments: { remedy: { goal: 0.99, suitability: 0.99 } },
						},
					},
				},
				observation(c, i, "manager-policy"),
			]),
		);
		const losingReport = evaluateCampaign(c, losingEvidence);
		expect(
			losingReport.qualification.map((q) => q.independentAccepted),
		).toEqual([0, 0]);
		expect(losingReport.paired.usefulCoverageGain).toBe(-1);
		expect(losingReport.verdict).toBe("no-go");
		expect(unsafeUpperBound(300)).toBeCloseTo(0.009936, 5);
		expect(unsafeUpperBound(0)).toBeNull();
	});
	test("timeout rate excludes observations with no provider attempt", () => {
		const timedOut = {
			...observation(campaign),
			result: { kind: "unavailable", reason: "timeout" },
		};
		const noAttempt = {
			...observation(campaign, 1),
			metrics: {
				...observation(campaign, 1).metrics,
				attempts: 0,
				latencyMs: 0,
				inputTokens: null,
				estimatedUsd: null,
				reservedUsd: 0,
			},
			result: { kind: "unavailable", reason: "budget" },
		};
		const report = evaluateCampaign(
			campaign,
			parseEvidence(campaign, bundle(campaign, [timedOut, noAttempt])),
		);
		expect(
			report.arms.find((arm) => arm.arm === "manager-policy-jev")?.timeoutRate,
		).toBe(1);
		expect(
			report.arms.find((arm) => arm.arm === "manager-policy-jev")?.latencyP50Ms,
		).toBe(20);
		expect(
			report.arms.find((arm) => arm.arm === "manager-policy-jev")?.latencyP95Ms,
		).toBe(20);
		expect(
			report.arms.find((arm) => arm.arm === "manager-policy-jev")?.inputTokens,
		).toBe(200);
		expect(
			report.arms.find((arm) => arm.arm === "manager-policy-jev")?.estimatedUsd,
		).toBe(0.0000084);
		const noCalls = evaluateCampaign(
			campaign,
			parseEvidence(campaign, bundle(campaign, [noAttempt])),
		);
		expect(
			noCalls.arms.find((arm) => arm.arm === "manager-policy-jev")?.timeoutRate,
		).toBeNull();
		expect(
			noCalls.arms.find((arm) => arm.arm === "manager-policy-jev")
				?.latencyP50Ms,
		).toBeNull();
		expect(
			noCalls.arms.find((arm) => arm.arm === "manager-policy-jev")?.inputTokens,
		).toBeNull();
		expect(
			noCalls.arms.find((arm) => arm.arm === "manager-policy-jev")
				?.estimatedUsd,
		).toBeNull();
	});
	test("cross-campaign evidence is rejected at evaluation", () => {
		const other = parseCampaign({ ...manifest, id: "other" }, corpus);
		expect(() =>
			evaluateCampaign(other, evaluateDeterministicPolicy(campaign)),
		).toThrow("campaign-digest");
	});
	test("CLI writes an inspectable offline report and refuses overwrites", async () => {
		const dir = await mkdtemp(join(tmpdir(), "blocker-cli-"));
		const out = join(dir, "report.json");
		try {
			expect(await runBlockerCli(["report", "--out", out], {})).toBe(0);
			expect(JSON.parse(await readFile(out, "utf8")).verdict).toBe(
				"inconclusive",
			);
			await expect(
				runBlockerCli(["report", "--out", out], {}),
			).rejects.toThrow();
			await expect(
				runBlockerCli(["collect-jev", "--out", join(dir, "live.json")], {}),
			).rejects.toThrow("Explicit");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
describe("blocker collector", () => {
	test("missing key makes zero calls and preserves unavailable outcomes", async () => {
		let calls = 0;
		const result = await collectSimulatedJevEvidence(
			campaign,
			{ maxCalls: 1, maxUsd: 0.01 },
			async () => {
				calls++;
				return Response.json(payload());
			},
		);
		expect(calls).toBe(0);
		expect(result.observations.map((r) => r.result)).toEqual(
			Array.from({ length: 8 }, () => ({
				kind: "unavailable",
				reason: "missing-key",
			})),
		);
	});
	test("bounded collector saves complete metadata and cannot claim live provenance", async () => {
		const result = await collectSimulatedJevEvidence(
			campaign,
			{ apiKey: "test-credential", maxCalls: 1, maxUsd: 0.01 },
			async (url, init) => {
				expect(url).toBe("https://api.typesafe.ai/v1/systemone");
				expect(init.redirect).toBe("error");
				expect(String(init.body)).not.toContain('"labels"');
				return Response.json({ ...payload(), origin: "live" });
			},
		);
		expect(result.observations[0]?.origin).toBe("simulation");
		expect(result.observations[0]?.metrics?.resolvedModel).toBe("jev-1.13.0");
		expect(result.observations[0]?.result.kind).toBe("decision");
		expect(result.observations[1]?.result).toEqual({
			kind: "unavailable",
			reason: "budget",
		});
		expect(JSON.stringify(result)).not.toContain("test-credential");
	});
	test("unknown models, missing answers and malformed distributions are unavailable", async () => {
		for (const body of [
			{ ...payload(), model: "jev-latest" },
			{ ...payload(), answers: {} },
			{
				...payload(),
				answers: {
					...payload().answers,
					choice: {
						...payload().answers.choice,
						probabilities: { remedy: 0.1, abstain: 0.1 },
					},
				},
			},
		]) {
			const result = await collectSimulatedJevEvidence(
				campaign,
				{ apiKey: "test-credential", maxCalls: 1, maxUsd: 0.01 },
				async () => Response.json(body),
			);
			expect(result.observations[0]?.result.kind).toBe("unavailable");
		}
	});
});

test("qualification is reachable only with complete independent safe live evidence", () => {
	const first = corpus.episodes[0];
	if (!first) throw new Error("fixture");
	const episodes = Array.from({ length: 600 }, (_, i) => ({
		...structuredClone(first),
		id: `qualified-${i}`,
		originatingTaskId: `origin-${i}`,
		independenceGroupId: `origin-${i}`,
		facts: {
			...first.facts,
			candidates: first.facts.candidates.map((candidate) => ({
				...candidate,
				action: i < 300 ? "retry" : "independent-feature",
			})),
		},
	}));
	const data = { ...corpus, synthetic: false, episodes };
	const run = (input: typeof data, missing = false) => {
		const c = parseCampaign(
			{
				...manifest,
				corpusDigest: digest(input),
				registration: {
					status: "registered-holdout",
					developmentEvidenceDigest: "a".repeat(64),
					registeredAt: "2026-09-21T00:00:00Z",
				},
				splits: input.episodes.map((e) => ({
					episodeId: e.id,
					split: "holdout",
				})),
			},
			input,
		);
		const rows: unknown[] = input.episodes.flatMap((_, index) => [
			observation(c, index),
			{
				...observation(c, index, "manager-policy"),
				result: { kind: "abstain", advice: null },
			},
		]);
		if (missing) rows.pop();
		return evaluateCampaign(c, liveImport(c, rows));
	};
	const complete = run(data);
	expect(complete.verdict).toBe("promote");
	expect(complete.qualification.map((q) => q.independentAccepted)).toEqual([
		300, 300,
	]);
	expect(complete.paired.oneSided95GainLowerBound).toBeGreaterThan(0.8);
	expect(run(data, true).verdict).toBe("inconclusive");
	const unsafe = structuredClone(data);
	const label = unsafe.episodes[0]?.labels[0];
	if (!label) throw new Error("fixture");
	label.unsafe = true;
	expect(run(unsafe).verdict).toBe("no-go");
});

test("origin variants contribute only the canonical sample", () => {
	const first = corpus.episodes[0];
	if (!first) throw new Error("fixture");
	const episodes = Array.from({ length: 300 }, (_, i) => ({
		...structuredClone(first),
		id: `variant-${i}`,
		primary: i === 0,
	}));
	const data = { ...corpus, synthetic: false, episodes };
	const c = parseCampaign(
		{
			...manifest,
			corpusDigest: digest(data),
			splits: episodes.map((e) => ({ episodeId: e.id, split: "holdout" })),
		},
		data,
	);
	expect(
		evaluateCampaign(
			c,
			liveImport(
				c,
				episodes.map((_, i) => observation(c, i)),
			),
		).qualification[0]?.independentAccepted,
	).toBe(1);
});

test("three-way choice uses the selected candidate's atomic assessment", async () => {
	const result = await collectSimulatedJevEvidence(
		campaign,
		{ apiKey: "test-credential", maxCalls: 8, maxUsd: 0.1 },
		async (_url, init) => {
			const body = JSON.parse(String(init.body));
			const candidates = body.state.facts.candidates as { id: string }[];
			const choice = candidates.length === 3 ? "unrelated" : "remedy";
			const probabilities = Object.fromEntries([
				...candidates.map((c) => [c.id, c.id === choice ? 0.97 : 0.01]),
				["abstain", candidates.length === 3 ? 0.01 : 0.03],
			]);
			const answers: Record<string, unknown> = {
				choice: { type: "choice", choice, confidence: 0.9, probabilities },
			};
			for (const [i, c] of candidates.entries()) {
				answers[`goal_${i}`] = { type: "noul", noul: 0.99 };
				answers[`fit_${i}`] = {
					type: "noul",
					noul: c.id === "unrelated" ? 0.1 : 0.99,
				};
			}
			return Response.json({
				model: "jev-1.13.0",
				answers,
				usage: { input_tokens: 100, output_tokens: 20 },
			});
		},
	);
	const report = evaluateCampaign(campaign, result);
	expect(
		report.cases.find(
			(r) => r.episodeId === "independent" && r.arm === "manager-policy-jev",
		)?.status,
	).toBe("abstain");
	const selected = result.observations.find(
		(r) => r.episodeId === "independent",
	);
	expect(selected?.result.kind).toBe("decision");
});

test("existing or unwritable output prevents every paid attempt", async () => {
	const directory = await mkdtemp(join(tmpdir(), "blocker-reservation-"));
	const output = join(directory, "report.json");
	const spy = spyOn(globalThis, "fetch").mockRejectedValue(
		new Error("must not call provider"),
	);
	try {
		await runBlockerCli(["report", "--out", output], {});
		for (const path of [output, join(output, "nested.json")]) {
			await expect(
				runBlockerCli(
					[
						"collect-jev",
						"--max-calls",
						"1",
						"--max-usd",
						"0.01",
						"--out",
						path,
					],
					{ TYPESAFE_API_KEY: "test-credential" },
				),
			).rejects.toThrow();
		}
		expect(spy).toHaveBeenCalledTimes(0);
	} finally {
		spy.mockRestore();
		await rm(directory, { recursive: true, force: true });
	}
});
