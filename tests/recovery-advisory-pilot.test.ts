import { expect, test } from "bun:test";
import {
	bindAdvisoryPilot,
	checkAdvisoryPilot,
	prepareAdvisoryPilot,
} from "../evals/recovery-decisions/advisory-pilot.js";
import development from "../evals/recovery-decisions/development.json" with {
	type: "json",
};
import { datasetDigest } from "../evals/recovery-decisions/schema.js";

type Decision =
	| { kind: "filtered" | "abstain" }
	| { kind: "selection"; candidateId: string }
	| { kind: "unavailable"; reason: string };
function initialDecision(filtered: boolean): Decision {
	return { kind: filtered ? "filtered" : "abstain" };
}

async function fixture() {
	const prepared = await prepareAdvisoryPilot(development, 1234);
	const treatment = await bindAdvisoryPilot(prepared, []);
	const base = {
		schemaVersion: 1,
		qualification: "inconclusive",
		origin: "simulation",
		model: "openai/gpt-6.1-sol",
		preparationDigest: datasetDigest(prepared),
	};
	const observations = prepared.rows.map((row) => ({
		caseId: row.caseId,
		packetDigest: row.packetDigest,
		promptDigest: row.baselinePromptDigest,
		result: initialDecision(row.packetDigest === null),
		latencyMs: null,
		reservedUsd: null,
		responseUsage: null,
	}));
	const baseline = { ...base, arm: "baseline", observations };
	const advice = {
		...base,
		arm: "advice",
		treatmentDigest: datasetDigest(treatment),
		observations: observations.map((row, index) => ({
			...row,
			promptDigest: treatment.rows[index]?.promptDigest,
		})),
	};
	return { prepared, treatment, baseline, advice };
}

test("advisory preparation retains eight synthetic controls and six identical read-only packets", async () => {
	const { prepared, treatment, baseline, advice } = await fixture();
	expect(prepared.corpus.purpose).toBe("synthetic-development");
	expect(prepared.corpus.labelStatus).toBe("author-proposed-unreviewed");
	expect(prepared.rows).toHaveLength(8);
	expect(prepared.rows.filter((row) => row.packet !== null)).toHaveLength(6);
	expect(prepared.order).toHaveLength(12);
	expect(await prepareAdvisoryPilot(development, 1234)).toEqual(prepared);
	expect((await prepareAdvisoryPilot(development, 4321)).order).not.toEqual(
		prepared.order,
	);
	for (const [index, row] of prepared.rows.entries()) {
		const bound = treatment.rows[index];
		if (!bound) throw new Error("Missing treatment.");
		if (row.baselinePrompt === null || bound.prompt === null) continue;
		const baselinePayload = JSON.parse(
			row.baselinePrompt.split("\n").slice(1).join("\n"),
		);
		const treatmentPayload = JSON.parse(
			bound.prompt.split("\n").slice(1).join("\n"),
		);
		expect(Object.keys(baselinePayload)).toEqual(["packet"]);
		expect(Object.keys(treatmentPayload)).toEqual(["packet", "advice"]);
		expect(treatmentPayload.packet).toEqual(baselinePayload.packet);
		expect(row.baselinePrompt).not.toContain("acceptableSelections");
		expect(row.baselinePrompt).not.toContain("synthetic-development");
	}
	const report = await checkAdvisoryPilot(
		prepared,
		treatment,
		baseline,
		advice,
	);
	expect(report.qualification).toBe("inconclusive");
	expect(report.unsafeRate).toBeNull();
	expect(report.workflowRecoveryRate).toBeNull();
	expect(report.origin).toBe("simulation");
});

test("pilot keeps missing, unavailable, filtered and forbidden decisions separate", async () => {
	const { prepared, treatment, baseline, advice } = await fixture();
	const eligible = baseline.observations.find(
		(row) => row.packetDigest !== null,
	);
	if (!eligible) throw new Error("Missing packet.");
	eligible.result = { kind: "selection", candidateId: "not-permitted" };
	baseline.observations.splice(1, 1);
	const treatmentEligible = advice.observations.find(
		(row) => row.packetDigest !== null,
	);
	if (!treatmentEligible) throw new Error("Missing advice row.");
	treatmentEligible.result = { kind: "unavailable", reason: "offline fixture" };
	const report = await checkAdvisoryPilot(
		prepared,
		treatment,
		baseline,
		advice,
	);
	expect(report.rows[0]?.baseline.kind).toBe("forbidden");
	expect(report.rows[0]?.baseline.labelMatch).toBe(false);
	expect(report.rows[0]?.advice.kind).toBe("unavailable");
	expect(report.rows[1]?.baseline.kind).toBe("missing");
	expect(
		report.rows.filter((row) => row.baseline.kind === "filtered"),
	).toHaveLength(2);
});

test("invalid and unavailable Jev advice survive without becoming validated treatment answers", async () => {
	const { prepared } = await fixture();
	const row = prepared.rows.find((value) => value.packet !== null);
	if (!row) throw new Error("Missing packet.");
	const raw = {
		kind: "answered",
		model: "jev-1.13.0",
		choice: "not-permitted",
		probabilities: { "not-permitted": 1 },
		confidence: 1,
		assessments: {},
		inputTokens: 1,
		outputTokens: 1,
		latencyMs: 1,
	};
	const bound = await bindAdvisoryPilot(prepared, [
		{ caseId: row.caseId, packetDigest: row.packetDigest, advice: raw },
	]);
	expect(bound.rows[0]?.adviceStatus).toBe("invalid");
	expect(bound.rows[0]?.advice).toEqual(raw);
	expect(bound.rows[0]?.prompt).toContain('"reason":"invalid"');
	expect(bound.rows[0]?.prompt).not.toContain('"choice":"not-permitted"');
	const unavailable = await bindAdvisoryPilot(prepared, [
		{
			caseId: row.caseId,
			packetDigest: row.packetDigest,
			advice: { kind: "unavailable", reason: "missing-key" },
		},
	]);
	expect(unavailable.rows[0]?.adviceStatus).toBe("unavailable");
});

test("pilot refuses changed prompts, advice, packet/source bindings, duplicate observations and wrong model", async () => {
	const { prepared, treatment, baseline, advice } = await fixture();
	for (const changed of [
		{ ...prepared, instructions: "Choose another goal" },
		{ ...prepared, sourceDigests: {} },
		{
			...prepared,
			rows: prepared.rows.map((row, index) =>
				index === 0 ? { ...row, packet: {} } : row,
			),
		},
	])
		await expect(
			checkAdvisoryPilot(changed, treatment, baseline, advice),
		).rejects.toThrow("binding");
	for (const changed of [
		{
			...treatment,
			rows: treatment.rows.map((row, index) =>
				index === 0 ? { ...row, prompt: "tampered" } : row,
			),
		},
		{
			...treatment,
			rows: treatment.rows.map((row, index) =>
				index === 0 ? { ...row, adviceDigest: "0".repeat(64) } : row,
			),
		},
	])
		await expect(
			checkAdvisoryPilot(prepared, changed, baseline, advice),
		).rejects.toThrow("binding");
	for (const changed of [
		{ ...baseline, model: "openai/gpt-6-sol" },
		{
			...baseline,
			observations: [...baseline.observations, baseline.observations[0]],
		},
		{
			...baseline,
			observations: baseline.observations.map((row, index) =>
				index === 0 ? { ...row, promptDigest: "0".repeat(64) } : row,
			),
		},
	])
		await expect(
			checkAdvisoryPilot(prepared, treatment, changed, advice),
		).rejects.toThrow();
});

test("answered advice validates the complete packet distribution and retains scoped telemetry", async () => {
	const { prepared, baseline } = await fixture();
	const payload = JSON.parse(
		prepared.rows[0]?.baselinePrompt?.split("\n").slice(1).join("\n") ?? "null",
	);
	const ids: string[] = payload.packet.candidates.map(
		(row: { id: string }) => row.id,
	);
	const choice = ids[0];
	if (!choice) throw new Error("Missing choice.");
	const answer = {
		kind: "answered",
		model: "jev-1.13.0",
		choice,
		confidence: 1,
		probabilities: Object.fromEntries([
			...ids.map((id) => [id, id === choice ? 1 : 0]),
			["abstain", 0],
		]),
		assessments: Object.fromEntries(
			ids.map((id) => [id, { goal: 1, suitability: 1 }]),
		),
		inputTokens: 11,
		outputTokens: 4,
		latencyMs: 3,
		telemetry: {
			transportLatencyMs: 3,
			transportAttempts: 1,
			transportReservedUsd: 0.002688,
			responseUsage: { inputTokens: 11, outputTokens: 4 },
		},
	};
	const row = prepared.rows[0];
	if (!row) throw new Error("Missing row.");
	const bind = (advice: unknown) =>
		bindAdvisoryPilot(prepared, [
			{ caseId: row.caseId, packetDigest: row.packetDigest, advice },
		]);
	const treatment = await bind(answer);
	expect(treatment.rows[0]?.adviceStatus).toBe("answered");
	const advice = {
		...baseline,
		arm: "advice",
		treatmentDigest: datasetDigest(treatment),
		observations: baseline.observations.map((value, index) => ({
			...value,
			promptDigest: treatment.rows[index]?.promptDigest,
		})),
	};
	const report = await checkAdvisoryPilot(
		prepared,
		treatment,
		baseline,
		advice,
	);
	expect(report.rows[0]?.jevTelemetry).toEqual(answer.telemetry);
	expect(report.jevTotals.transportReservedUsd).toBeNull();
	expect(report.adviceCoverage).toEqual({
		answered: 1,
		missing: 5,
		unavailable: 0,
		invalid: 0,
		filtered: 2,
	});
	expect(report.returnedSolDecisionPairs).toBe(6);
	expect(report.pairedDecisionDiagnostics.answeredAdviceOnly.pairs).toBe(1);
	expect(report.allAttemptedAdviceContexts).toBe(6);
	expect(report.inferenceProvenance).toBe("unverified");
	const firstBaseline = baseline.observations[0],
		firstAdvice = advice.observations[0];
	if (!firstBaseline || !firstAdvice) throw new Error("Missing pair.");
	firstBaseline.result = { kind: "selection", candidateId: "repair" };
	firstAdvice.result = { kind: "selection", candidateId: "not-permitted" };
	const forbidden = await checkAdvisoryPilot(
		prepared,
		treatment,
		baseline,
		advice,
	);
	expect(forbidden.rows[0]?.advice.kind).toBe("forbidden");
	expect(forbidden.rows[0]?.advice.labelMatch).toBe(false);
	expect(forbidden.returnedSolDecisionPairs).toBe(6);
	expect(forbidden.pairedDecisionDiagnostics.answeredAdviceOnly).toEqual({
		pairs: 1,
		baselineLabelMatches: 1,
		adviceLabelMatches: 0,
		labelMatchDelta: -1,
	});
	const { telemetry, ...legacy } = answer;
	const legacyTreatment = await bind(legacy);
	const legacyArm = {
		...advice,
		treatmentDigest: datasetDigest(legacyTreatment),
		observations: advice.observations.map((value, index) => ({
			...value,
			promptDigest: legacyTreatment.rows[index]?.promptDigest,
		})),
	};
	const legacyReport = await checkAdvisoryPilot(
		prepared,
		legacyTreatment,
		baseline,
		legacyArm,
	);
	expect(legacyReport.rows[0]?.jevTelemetry).toEqual({
		transportLatencyMs: telemetry.transportLatencyMs,
		transportAttempts: null,
		transportReservedUsd: null,
		responseUsage: telemetry.responseUsage,
	});
	expect(legacyReport.rows[0]?.jevTelemetrySource).toBe(
		"legacy-answered-fields",
	);
	for (const mutation of [
		{ probabilities: { ...answer.probabilities, extra: 0 } },
		{ probabilities: { [choice]: 0.5, abstain: 0.2 } },
		{ choice: "abstain" },
		{ confidence: 1.1 },
		{ assessments: {} },
		{ model: "jev-1.14.0" },
	])
		expect((await bind({ ...answer, ...mutation })).rows[0]?.adviceStatus).toBe(
			"invalid",
		);
});

test("filtered cases refuse advice and eligible cases cannot masquerade as prefiltered", async () => {
	const { prepared, treatment, baseline, advice } = await fixture();
	const filtered = prepared.rows.find((row) => row.packet === null);
	if (!filtered) throw new Error("Missing filtered case.");
	await expect(
		bindAdvisoryPilot(prepared, [
			{
				caseId: filtered.caseId,
				packetDigest: null,
				advice: { kind: "unavailable", reason: "fake" },
			},
		]),
	).rejects.toThrow("Filtered");
	const changed = structuredClone(baseline);
	const eligible = changed.observations.find(
		(row) => row.packetDigest !== null,
	);
	if (!eligible) throw new Error("Missing eligible case.");
	eligible.result = { kind: "filtered" };
	await expect(
		checkAdvisoryPilot(prepared, treatment, changed, advice),
	).rejects.toThrow("binding");
});

async function orderedFixture() {
	const value = await fixture();
	const observations = (arm: "baseline" | "advice") =>
		value[arm].observations.map((row) => ({
			...row,
			executionIndex:
				row.packetDigest === null
					? null
					: value.prepared.order.findIndex(
							(slot) => slot.caseId === row.caseId && slot.arm === arm,
						),
		}));
	return {
		...value,
		baseline: { ...value.baseline, observations: observations("baseline") },
		advice: { ...value.advice, observations: observations("advice") },
	};
}

test("pilot refuses unbound execution order rather than trusting the frozen seed alone", async () => {
	const { prepared, treatment, baseline, advice } = await fixture();
	await expect(
		checkAdvisoryPilot(prepared, treatment, baseline, advice),
	).rejects.toThrow("execution");
});

test("pilot accepts only complete internally bound declarations of seeded execution order", async () => {
	const { prepared, treatment, baseline, advice } = await orderedFixture();
	const report = await checkAdvisoryPilot(
		prepared,
		treatment,
		baseline,
		advice,
	);
	expect(report).toHaveProperty("executionOrder", {
		scope: "declared-unverified",
		status: "complete",
		planned: 12,
		recorded: 12,
		missingIndices: [],
	});
});

test("pilot rejects baseline-first and duplicate execution indices across arms", async () => {
	const { prepared, treatment, baseline, advice } = await orderedFixture();
	let index = 0;
	const baselineFirst = {
		...baseline,
		observations: baseline.observations.map((row) => ({
			...row,
			executionIndex: row.packetDigest === null ? null : index++,
		})),
	};
	const adviceLast = {
		...advice,
		observations: advice.observations.map((row) => ({
			...row,
			executionIndex: row.packetDigest === null ? null : index++,
		})),
	};
	await expect(
		checkAdvisoryPilot(prepared, treatment, baselineFirst, adviceLast),
	).rejects.toThrow("execution order");
	const first = baseline.observations.find(
		(row) => row.executionIndex !== null,
	);
	const second = advice.observations.find((row) => row.executionIndex !== null);
	if (!first || !second) throw new Error("Missing eligible observations.");
	second.executionIndex = first.executionIndex;
	await expect(
		checkAdvisoryPilot(prepared, treatment, baseline, advice),
	).rejects.toThrow("execution order");
});

test("pilot retains missing prefix and subsequence declarations as incomplete without compacting slots", async () => {
	const { prepared, treatment, baseline, advice } = await orderedFixture();
	for (const [keep, status, missing] of [
		[[0, 1, 2], "incomplete-prefix", [3, 4, 5, 6, 7, 8, 9, 10, 11]],
		[[0, 2, 4], "incomplete-subsequence", [1, 3, 5, 6, 7, 8, 9, 10, 11]],
	] as const) {
		const retained = new Set<number>(keep);
		const only = (rows: typeof baseline.observations) =>
			rows.filter(
				(row) =>
					row.executionIndex === null || retained.has(row.executionIndex),
			);
		const report = await checkAdvisoryPilot(
			prepared,
			treatment,
			{ ...baseline, observations: only(baseline.observations) },
			{ ...advice, observations: only(advice.observations) },
		);
		expect(report).toHaveProperty("executionOrder", {
			scope: "declared-unverified",
			status,
			planned: 12,
			recorded: 3,
			missingIndices: [...missing],
		});
		const baselineMissing = report.coverage.baseline.missing;
		const adviceMissing = report.coverage.advice.missing;
		if (baselineMissing === undefined || adviceMissing === undefined)
			throw new Error("Missing coverage count.");
		expect(baselineMissing + adviceMissing).toBe(9);
	}
});
