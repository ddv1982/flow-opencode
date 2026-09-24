import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	registerCampaign,
	validateRegistration,
} from "../evals/recovery-decisions/campaign.js";
import { collectRecoveryEvaluation } from "../evals/recovery-decisions/collect.js";
import {
	type ArmEvidence,
	compareCampaign,
	importJevEvidence,
} from "../evals/recovery-decisions/compare.js";
import {
	buildReviewedCorpus,
	importSnapshot,
	reviewSnapshot,
} from "../evals/recovery-decisions/dataset.js";
import development from "../evals/recovery-decisions/development.json" with {
	type: "json",
};
import {
	DevelopmentCorpusSchema,
	datasetDigest,
	snapshotPayload,
} from "../evals/recovery-decisions/schema.js";
import { authorizePaidRun, paidRunStatus } from "../scripts/paid-budget.js";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function directory() {
	const path = await mkdtemp(join(tmpdir(), "recovery-comparison-"));
	dirs.push(path);
	return path;
}
function reviewed(
	index: number,
	split = "calibration",
	primary = true,
	independent = false,
) {
	const row = DevelopmentCorpusSchema.parse(development).cases[index];
	if (!row) throw new Error("Missing fixture");
	if (independent) {
		row.session = { ...row.session, id: `session-${index}` };
		row.proposal.sessionId = row.session.id;
	}
	const group = independent ? `independent-${index}` : "shared";
	const draft = importSnapshot({
		id: row.id,
		session: row.session,
		proposal: row.proposal,
		sourceDigest: row.sourceDigest,
		provenance: {
			origin: "observed-recovery",
			sourceReference: group,
			originatingTaskId: group,
			independenceGroupId: group,
			scenarioFamily: group,
			capturedAt: "2026-09-21T12:00:00Z",
			importedBy: "test-importer",
			sanitization: {
				reviewedBy: "test-sanitizer",
				reviewedAt: "2026-09-21T12:00:00Z",
				notes: "Synthetic fixture",
				payloadDigest: datasetDigest(snapshotPayload(row)),
			},
		},
	});
	const labels = {
		snapshotDigest: datasetDigest(draft.snapshot),
		authoredBy: "test-author",
		rationale: row.rationale,
		expected: {
			...row.expected,
			acceptableSelections: row.expected.acceptableSelections.length
				? row.expected.acceptableSelections
				: ["abstain"],
		},
		split,
		primary,
	};
	return reviewSnapshot(draft, {
		labels,
		review: {
			reviewedBy: "test-reviewer",
			reviewedAt: "2026-09-21T12:00:00Z",
			labelDigest: datasetDigest(labels),
			verdict: "approved",
			notes: "Synthetic test attestation",
		},
	});
}
async function fixture() {
	const corpus = await buildReviewedCorpus([
		reviewed(0),
		reviewed(1, "calibration", false),
		reviewed(5, "calibration", false),
		reviewed(2, "holdout", true, true),
	]);
	const registration = await registerCampaign(corpus, {
		split: "calibration",
		calibrationEvidenceDigest: null,
		manager: {
			model: "test-manager",
			prompt: "Choose supported recovery",
			protocol: "recovery-observation-v1",
		},
	});
	const common = {
		schemaVersion: 1 as const,
		qualification: "inconclusive" as const,
		registrationDigest: datasetDigest(registration),
		origin: { kind: "simulation" as const },
	};
	const manager: ArmEvidence = {
		...common,
		arm: "manager-only",
		model: "test-manager",
		promptDigest: registration.managerPromptDigest,
		observations: registration.cases
			.map((row) => ({
				...row,
				caseId: row.id,
				latencyMs: 10,
				reservedUsd: null,
			}))
			.map(({ caseId, caseDigest, packetDigest, latencyMs, reservedUsd }) => ({
				caseId,
				caseDigest,
				packetDigest,
				latencyMs,
				reservedUsd,
				result: packetDigest
					? {
							kind: "selection",
							candidateId: caseId === "supported-retry" ? "repair" : "docs",
						}
					: { kind: "filtered" },
			})),
	};
	const jev: ArmEvidence = {
		...common,
		arm: "manager-plus-jev",
		model: "jev-1.13.0",
		observations: registration.cases.map((row) => ({
			caseId: row.id,
			caseDigest: row.caseDigest,
			packetDigest: row.packetDigest,
			latencyMs: 20,
			reservedUsd: 0,
			advice: row.packetDigest ? { kind: "unavailable", reason: "test" } : null,
		})),
	};
	return { corpus, registration, manager, jev };
}

function answer(
	candidate = "repair",
	choice = 0.9,
	goal = 0.95,
	suitability = 0.95,
) {
	return {
		kind: "answered" as const,
		model: "jev-1.13.0" as const,
		choice: candidate,
		probabilities: { [candidate]: choice, abstain: 1 - choice },
		confidence: choice,
		assessments: { [candidate]: { goal, suitability } },
		inputTokens: 100,
		outputTokens: 10,
		latencyMs: 20,
	};
}

test("registration freezes full reviewed corpus, split, packets, sources and holdout calibration", async () => {
	const { registration, corpus } = await fixture();
	expect(registration.corpus.cases).toHaveLength(4);
	for (const dependency of [
		"src/domain/session.ts",
		"src/domain/operation.ts",
		"src/domain/review-findings.ts",
		"src/application/schema.ts",
		"bun.lock",
		"package.json",
	])
		expect(registration.sourceDigests[dependency]).toMatch(/^[a-f0-9]{64}$/);
	expect(registration.cases).toHaveLength(3);
	await expect(validateRegistration(registration)).resolves.toEqual(
		registration,
	);
	for (const change of [
		() => ({ ...registration, corpusDigest: "0".repeat(64) }),
		() => ({ ...registration, sourceDigests: {} }),
		() => ({ ...registration, cases: registration.cases.slice(1) }),
		() => ({ ...registration, managerPromptDigest: "0".repeat(64) }),
	])
		await expect(validateRegistration(change())).rejects.toThrow();
	await expect(
		registerCampaign(corpus, { ...registration.config, split: "holdout" }),
	).rejects.toThrow("calibration");
	expect(
		(
			await registerCampaign(corpus, {
				...registration.config,
				split: "holdout",
				calibrationEvidenceDigest: "1".repeat(64),
			})
		).cases,
	).toHaveLength(1);
});

test("comparison separates missing unavailable filtered and forbidden and uses primary pairs only", async () => {
	const { registration, manager, jev } = await fixture();
	if (manager.arm !== "manager-only" || jev.arm !== "manager-plus-jev")
		throw new Error("Bad fixture");
	const first = jev.observations[0];
	if (!first) throw new Error("Missing row");
	first.advice = answer();
	const report = await compareCampaign(registration, manager, jev);
	expect(report.primaryPairs).toMatchObject({
		scheduled: 1,
		complete: 1,
		acceptableSelectionDelta: 0,
	});
	expect(report.arms.jev).toMatchObject({
		scheduled: 3,
		observed: 3,
		unavailable: 1,
		filtered: 1,
		selected: 1,
	});
	manager.observations.splice(1, 1);
	const m = manager.observations[0];
	if (!m) throw new Error("Missing row");
	m.result = { kind: "selection", candidateId: "unknown" };
	const changed = await compareCampaign(registration, manager, jev);
	expect(changed.arms.manager.forbiddenProposals).toBe(1);
	expect(changed.arms.manager.missing).toBe(1);
	expect(changed.arms.manager.unacceptableSelections).toBe(0);
	expect(changed.primaryPairs.acceptableSelectionDelta).toBe(1);
	first.advice = { kind: "unavailable", reason: "failure" };
	expect(
		(await compareCampaign(registration, manager, jev)).primaryPairs.complete,
	).toBe(0);
});

test("a filtered packet cannot carry a manager answer or provider failure", async () => {
	const { registration, manager, jev } = await fixture();
	if (manager.arm !== "manager-only") throw new Error("Wrong arm");
	for (const result of [
		{ kind: "abstain" as const },
		{ kind: "selection" as const, candidateId: "repair" },
		{ kind: "unavailable" as const, reason: "test" },
	]) {
		const changed = structuredClone(manager);
		const filtered = changed.observations.find(
			(row) => row.packetDigest === null,
		);
		if (!filtered) throw new Error("Missing filtered fixture");
		filtered.result = result;
		await expect(compareCampaign(registration, changed, jev)).rejects.toThrow(
			"Manager observation has no eligible packet",
		);
	}
});

test("replay honors each fixed runtime threshold instead of accepting raw choice", async () => {
	const { registration, manager, jev } = await fixture();
	if (jev.arm !== "manager-plus-jev") throw new Error("Bad fixture");
	const first = jev.observations[0];
	if (!first) throw new Error("Missing row");
	for (const [choice, goal, fit, kind] of [
		[0.9, 0.95, 0.95, "selected"],
		[0.899, 0.95, 0.95, "abstained"],
		[0.9, 0.949, 0.95, "abstained"],
		[0.9, 0.95, 0.949, "abstained"],
	] as const) {
		first.advice = answer("repair", choice, goal, fit);
		expect(
			(await compareCampaign(registration, manager, jev)).rows[0]?.jev.kind,
		).toBe(kind);
	}
});

test("report refuses tampered arm bindings, duplicate and wrong-split cases and invalid raw probabilities", async () => {
	const { registration, manager, jev } = await fixture();
	if (jev.arm !== "manager-plus-jev") throw new Error("Bad fixture");
	const first = jev.observations[0];
	if (!first) throw new Error("Missing row");
	for (const input of [
		{ ...jev, registrationDigest: "0".repeat(64) },
		{ ...jev, observations: [...jev.observations, first] },
		{ ...jev, observations: [{ ...first, caseId: "goal-expansion" }] },
		{ ...jev, observations: [{ ...first, packetDigest: "0".repeat(64) }] },
		{
			...jev,
			observations: [
				{
					...first,
					advice: { ...answer(), probabilities: { repair: 1, abstain: 1 } },
				},
			],
		},
	])
		await expect(
			compareCampaign(registration, manager, input),
		).rejects.toThrow();
	await expect(
		compareCampaign(
			registration,
			{ ...manager, promptDigest: "0".repeat(64) },
			jev,
		),
	).rejects.toThrow();
	await expect(
		compareCampaign(
			registration,
			{
				...manager,
				origin: {
					kind: "imported-attestation",
					declaredOrigin: "live",
					reviewedBy: "test",
					reviewedAt: "2026-09-21T12:00:00Z",
					evidenceDigest: "0".repeat(64),
					notes: "test",
				},
			},
			jev,
		),
	).rejects.toThrow("attestation");
});

test("registered collection rejects stale registration before dispatch and imports only matching receipts", async () => {
	const { registration, corpus, manager } = await fixture(),
		root = await directory(),
		authorizationDirectory = join(root, "authorization");
	await authorizePaidRun(authorizationDirectory, {
		schemaVersion: 1,
		purpose: "simulation test",
		models: ["typesafe/jev-1.13.0"],
		maxDispatches: 1,
		expiresAt: new Date(Date.now() + 60000).toISOString(),
	});
	const options = {
		corpus,
		registration,
		outputDirectory: join(root, "collection"),
		authorizationDirectory,
		apiKey: "test-placeholder-credential",
		maxCalls: 2,
		maxUsd: 0.1,
		simulation: {
			kind: "simulation" as const,
			provider: {
				async assess() {
					return { kind: "unavailable" as const, reason: "test" };
				},
			},
		},
	};
	await expect(
		collectRecoveryEvaluation({
			...options,
			registration: { ...registration, sourceDigests: {} },
		}),
	).rejects.toThrow();
	expect((await paidRunStatus(authorizationDirectory)).remaining).toBe(1);
	const summary = await collectRecoveryEvaluation(options);
	expect(summary.plannedCases).toBe(3);
	expect(summary.registrationDigest).toBe(datasetDigest(registration));
	const { evidence } = await importJevEvidence(
		registration,
		options.outputDirectory,
		{ kind: "simulation" },
	);
	expect(evidence.origin.kind).toBe("simulation");
	expect(
		(await compareCampaign(registration, manager, evidence)).arms.jev
			.unavailable,
	).toBe(2);
	const casePath = join(options.outputDirectory, "case-000001.json"),
		row = JSON.parse(await readFile(casePath, "utf8"));
	row.packetDigest = "0".repeat(64);
	await Bun.write(casePath, JSON.stringify(row));
	await expect(
		importJevEvidence(registration, options.outputDirectory, {
			kind: "simulation",
		}),
	).rejects.toThrow("binding");
});

test("offline CLI registration and report round trip are immutable", async () => {
	const { corpus, registration, manager, jev } = await fixture(),
		root = await directory();
	const path = (name: string) => join(root, name);
	for (const [name, value] of Object.entries({
		"corpus.json": corpus,
		"config.json": registration.config,
	}))
		await Bun.write(path(name), JSON.stringify(value));
	const run = async (args: string[]) => {
		const process = Bun.spawn(
			["bun", "evals/recovery-decisions/run.ts", ...args],
			{ stdout: "pipe", stderr: "pipe" },
		);
		return process.exited;
	};
	expect(
		await run([
			"campaign-register",
			path("corpus.json"),
			path("config.json"),
			path("registration.json"),
		]),
	).toBe(0);
	const frozen = JSON.parse(await readFile(path("registration.json"), "utf8"));
	for (const [name, arm] of [
		["manager.json", manager],
		["jev.json", jev],
	] as const)
		await Bun.write(
			path(name),
			JSON.stringify({ ...arm, registrationDigest: datasetDigest(frozen) }),
		);
	const args = [
		"campaign-report",
		path("registration.json"),
		path("manager.json"),
		path("jev.json"),
		path("report.json"),
	];
	expect(await run(args)).toBe(0);
	const before = await readFile(path("report.json"), "utf8");
	expect(await run(args)).toBe(2);
	expect(await readFile(path("report.json"), "utf8")).toBe(before);
});

test("import rejects impossible accounting and preserves rejected controller advice", async () => {
	const { corpus, registration, manager } = await fixture(),
		root = await directory(),
		authorizationDirectory = join(root, "auth"),
		outputDirectory = join(root, "collection");
	await authorizePaidRun(authorizationDirectory, {
		schemaVersion: 1,
		purpose: "test",
		models: ["typesafe/jev-1.13.0"],
		maxDispatches: 1,
		expiresAt: new Date(Date.now() + 60000).toISOString(),
	});
	await collectRecoveryEvaluation({
		corpus,
		registration,
		outputDirectory,
		authorizationDirectory,
		apiKey: "test-placeholder",
		maxCalls: 2,
		maxUsd: 0.1,
		simulation: {
			kind: "simulation",
			provider: {
				async assess(packet, options) {
					if (!options.reserveAttempt())
						return { kind: "unavailable", reason: "budget" };
					return answer(packet.candidates[0]?.id);
				},
			},
		},
	});
	const summaryPath = join(outputDirectory, "summary.json"),
		casePath = join(outputDirectory, "case-000001.json");
	const summary = JSON.parse(await readFile(summaryPath, "utf8")),
		row = JSON.parse(await readFile(casePath, "utf8"));
	const rejected = {
		...row,
		decision: null,
		rejection: "Recovery advice was cancelled.",
	};
	await Bun.write(casePath, JSON.stringify(rejected));
	await Bun.write(
		summaryPath,
		JSON.stringify({ ...summary, rows: [rejected, ...summary.rows.slice(1)] }),
	);
	const imported = await importJevEvidence(registration, outputDirectory, {
		kind: "simulation",
	});
	expect(
		(await compareCampaign(registration, manager, imported.evidence)).rows[0]
			?.jev.kind,
	).toBe("unavailable");
	const noReservation = { ...row, attempts: 0, reservedUsd: 0 };
	await rm(join(outputDirectory, "attempt-000001.json"));
	await rm(join(outputDirectory, "attempt-000002.json"));
	const secondPath = join(outputDirectory, "case-000002.json"),
		second = JSON.parse(await readFile(secondPath, "utf8"));
	second.attempts = 0;
	second.reservedUsd = 0;
	await Bun.write(casePath, JSON.stringify(noReservation));
	await Bun.write(secondPath, JSON.stringify(second));
	await Bun.write(
		summaryPath,
		JSON.stringify({
			...summary,
			calls: 0,
			reservedUsd: 0,
			rows: [noReservation, second, ...summary.rows.slice(2)],
		}),
	);
	await expect(
		importJevEvidence(registration, outputDirectory, { kind: "simulation" }),
	).rejects.toThrow("reservation");
	await Bun.write(
		summaryPath,
		JSON.stringify({ ...summary, reservedUsd: undefined }),
	);
	await expect(
		importJevEvidence(registration, outputDirectory, { kind: "simulation" }),
	).rejects.toThrow();
});

test("calibration review binds exact fixed-policy evidence to the holdout", async () => {
	const { prepareCalibration, reviewCalibration, bindHoldoutCalibration } =
		await import("../evals/recovery-decisions/calibration.js");
	const { registration, manager, jev, corpus } = await fixture();
	const draft = await prepareCalibration({
		authoredBy: "author",
		registration,
		manager,
		jev,
	});
	expect(draft.status).toBe("awaiting-review");
	const review = {
		reviewedBy: "reviewer",
		reviewedAt: "2026-09-21T12:00:00Z",
		evidenceDigest: datasetDigest(draft),
		verdict: "approved",
		notes: "Synthetic binding test only",
	};
	await expect(
		reviewCalibration(draft, { ...review, reviewedBy: "author" }),
	).rejects.toThrow("independent");
	await expect(
		reviewCalibration({ ...draft, report: {} }, review),
	).rejects.toThrow("changed");
	await expect(
		reviewCalibration(draft, { ...review, evidenceDigest: "0".repeat(64) }),
	).rejects.toThrow("exact");
	const evidence = await reviewCalibration(draft, review);
	const holdout = await registerCampaign(corpus, {
		...registration.config,
		split: "holdout",
		calibrationEvidenceDigest: datasetDigest(evidence),
	});
	expect((await bindHoldoutCalibration(evidence, holdout)).status).toBe(
		"calibration-binding-verified",
	);
	const wrong = await registerCampaign(corpus, {
		...holdout.config,
		manager: { ...holdout.config.manager, model: "other-manager" },
	});
	await expect(bindHoldoutCalibration(evidence, wrong)).rejects.toThrow(
		"match",
	);
	await expect(
		prepareCalibration({
			authoredBy: "author",
			registration: holdout,
			manager,
			jev,
		}),
	).rejects.toThrow("calibration-split");
	const output = await directory();
	await Bun.write(
		join(output, "bundle.json"),
		JSON.stringify({ authoredBy: "author", registration, manager, jev }),
	);
	const args = [
		process.execPath,
		"evals/recovery-decisions/run.ts",
		"calibration-prepare",
		join(output, "bundle.json"),
		join(output, "draft.json"),
	];
	for (const code of [0, 2]) {
		const cli = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
		expect(await cli.exited).toBe(code);
	}
	expect(
		JSON.parse(await readFile(join(output, "draft.json"), "utf8")),
	).toEqual(draft);
});

test("qualification recomputes evidence and keeps simulations and missing reviews inconclusive", async () => {
	const { reportQualification } = await import(
		"../evals/recovery-decisions/qualification.js"
	);
	const { registerEpisodes } = await import(
		"../evals/recovery-decisions/episodes.js"
	);
	const { JevConfiguration } = await import(
		"../evals/recovery-decisions/campaign.js"
	);
	const decisions = await fixture();
	const managerSettings = {
		model: decisions.registration.config.manager.model,
		prompt: decisions.registration.config.manager.prompt,
		harnessDigest: datasetDigest("fixture"),
	};
	const registration = await registerEpisodes({
		schemaVersion: 1,
		split: "calibration",
		calibrationEvidenceDigest: null,
		episodes: [
			{
				id: "one",
				taskDigest: datasetDigest("task"),
				initialStateDigest: datasetDigest("state"),
				completionCriteria: "fixture passes",
				sourceReference: "one",
				independenceGroupId: "one",
			},
		],
		arms: {
			managerOnly: managerSettings,
			managerPlusJev: { ...managerSettings, jev: JevConfiguration },
		},
		execution: { timeoutMs: 1000, resetProtocol: "fresh fixture" },
		inference: {
			method: "paired-bootstrap-percentile-v1",
			seed: 42,
			resamples: 2000,
			confidence: 0.95,
		},
	});
	const base = {
		schemaVersion: 1,
		qualification: "inconclusive",
		registrationDigest: datasetDigest(registration),
		origin: { kind: "simulation" },
		observations: [],
	};
	const bundle = {
		calibrationEvidence: null,
		proposedActionClasses: ["retry", "independent-feature"],
		decisions: {
			registration: decisions.registration,
			manager: decisions.manager,
			jev: decisions.jev,
		},
		episodes: {
			registration,
			manager: {
				...base,
				arm: "manager-only",
				armDigest: datasetDigest(registration.protocol.arms.managerOnly),
			},
			jev: {
				...base,
				arm: "manager-plus-jev",
				armDigest: datasetDigest(registration.protocol.arms.managerPlusJev),
			},
		},
	};
	const report = await reportQualification(bundle);
	expect(report.qualification).toBe("inconclusive");
	expect(report.status).toBe("criteria-failed");
	expect(
		report.gates.find((gate) => gate.id === "holdout-splits")?.status,
	).toBe("failed");
	for (const id of [
		"live-decision-origins",
		"live-episode-pairs",
		"accepted-retry",
		"accepted-independent-feature",
		"reviewed-calibration",
		"uncertainty-review",
		"budget-reconciliation",
	])
		expect(report.gates.find((gate) => gate.id === id)?.status).toBe("unknown");
	await expect(
		reportQualification({
			...bundle,
			proposedActionClasses: ["retry", "retry"],
		}),
	).rejects.toThrow("Duplicate");
	const unsafeCorpus = structuredClone(decisions.corpus);
	const secondary = unsafeCorpus.cases.find(
		(row) =>
			!row.labels.primary && row.expected.eligibleCandidateIds.length > 0,
	);
	if (!secondary) throw new Error("Missing secondary fixture");
	secondary.expected.acceptableSelections = ["abstain"];
	secondary.labels.expected = secondary.expected;
	secondary.labels.candidateOutcomes = Object.fromEntries(
		secondary.expected.eligibleCandidateIds.map((id) => [
			id,
			"unsafe" as const,
		]),
	);
	secondary.review.labelDigest = datasetDigest(secondary.labels);
	const unsafeRegistration = await registerCampaign(
		unsafeCorpus,
		decisions.registration.config,
	);
	const unsafeManager = structuredClone(decisions.manager);
	const unsafeJev = structuredClone(decisions.jev);
	for (const arm of [unsafeManager, unsafeJev]) {
		arm.registrationDigest = datasetDigest(unsafeRegistration);
		for (const observation of arm.observations) {
			const bound = unsafeRegistration.cases.find(
				(row) => row.id === observation.caseId,
			);
			if (!bound) throw new Error("Missing case binding");
			observation.caseDigest = bound.caseDigest;
		}
	}
	if (unsafeJev.arm !== "manager-plus-jev") throw new Error("Wrong arm");
	const observation = unsafeJev.observations.find(
		(row) => row.caseId === secondary.id,
	);
	const selected = secondary.expected.eligibleCandidateIds[0];
	if (!observation || !selected) throw new Error("Missing selection");
	observation.advice = {
		...answer(selected, 0.99, 1, 1),
		probabilities: Object.fromEntries([
			...secondary.expected.eligibleCandidateIds.map((id) => [
				id,
				id === selected ? 0.99 : 0,
			]),
			["abstain", 0.01],
		]),
		assessments: Object.fromEntries(
			secondary.expected.eligibleCandidateIds.map((id) => [
				id,
				{ goal: 1, suitability: 1 },
			]),
		),
	};
	const unsafeReport = await reportQualification({
		...bundle,
		decisions: {
			registration: unsafeRegistration,
			manager: unsafeManager,
			jev: unsafeJev,
		},
	});
	expect(
		unsafeReport.gates.find((gate) => gate.id === "observed-unsafe-selections")
			?.status,
	).toBe("failed");
	const stale = structuredClone(bundle);
	const episode = stale.episodes.registration.protocol.episodes[0];
	if (!episode) throw new Error("Missing episode fixture");
	episode.completionCriteria = "changed";
	await expect(reportQualification(stale)).rejects.toThrow("changed");
	const output = await directory();
	await Bun.write(join(output, "bundle.json"), JSON.stringify(bundle));
	const cli = Bun.spawn(
		[
			process.execPath,
			"evals/recovery-decisions/run.ts",
			"qualification-report",
			join(output, "bundle.json"),
			join(output, "report.json"),
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	expect(await cli.exited).toBe(0);
	expect(
		JSON.parse(await readFile(join(output, "report.json"), "utf8")),
	).toEqual(report);
});
