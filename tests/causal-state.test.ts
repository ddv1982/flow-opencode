import { describe, expect, test } from "bun:test";
import {
	type EvidenceRecord,
	type ReviewExecutionInput,
	toFeatureId,
	toSessionId,
	type WorkerResult,
} from "../src/domain/session.js";
import {
	applyPlan,
	approvePlan,
	canonicalEvidenceId,
	canonicalSessionSnapshotId,
	causalDeltaProjection,
	closeSession,
	compactSessionProjection,
	completeFeature,
	createSession,
	detailSessionProjection,
	executionSessionProjection,
	MAX_EXECUTION_PROJECTION_BYTES,
	mutationReceiptProjection,
	recordEvidence,
	recordReviewExecutions,
	resetFeature,
	reviewerSessionProjection,
	serializedUtf8JsonBytes,
	startRun,
	type TransitionEnvironment,
	validateCausalChain,
} from "../src/domain/transitions.js";
import { validationCommandClass } from "../src/domain/validation-command.js";

const environment: TransitionEnvironment = {
	now: () => "2026-07-18T12:00:00.000Z",
	newSessionId: () => toSessionId("causal-session"),
	newOperationId: (revision) => `operation-${revision}`,
};

const featureId = toFeatureId("causal-state");
const SOURCE_DIGEST = `sha256:${"1".repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${"2".repeat(64)}`;
const ARTIFACT_DIGEST = `sha256:${"3".repeat(64)}` as const;
const FEATURE_PACKET_DIGEST = `sha256:${"4".repeat(64)}`;
const FINAL_PACKET_DIGEST = `sha256:${"5".repeat(64)}`;

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("Expected a successful transition.");
	return result.value;
}

function runningSession(featureCount = 1) {
	const created = createSession("Build causal Flow state", environment);
	const features = Array.from({ length: featureCount }, (_, index) => ({
		id: index === 0 ? featureId : toFeatureId(`feature-${index + 1}`),
		title: `Feature ${index + 1}`,
		summary: "A bounded feature summary. ".repeat(10),
		reviewDepth: "standard" as const,
		targets: Array.from(
			{ length: 30 },
			(_, targetIndex) =>
				`src/feature-${index + 1}/very-long-assigned-target-${targetIndex}.ts`,
		),
		dependsOn: [],
	}));
	const planned = unwrap(
		applyPlan(
			created,
			{
				summary: "Causal state",
				overview: "Use immutable identities and bounded projections.",
				finalReviewPolicy: "detailed",
				features,
			},
			environment,
		),
	);
	const approved = unwrap(approvePlan(planned, environment));
	return unwrap(startRun(approved, environment, featureId)).session;
}

function withCanonicalId<T extends EvidenceRecord>(evidence: T): T {
	return { ...evidence, evidenceId: canonicalEvidenceId(evidence) };
}

function completionEvidence(snapshotId: string): EvidenceRecord[] {
	return [
		withCanonicalId({
			kind: "validation",
			evidenceId: "",
			snapshotId,
			sourceDigest: SOURCE_DIGEST,
			commandClass: "test",
			startedAt: "2026-07-18T11:50:00.000Z",
			completedAt: "2026-07-18T11:51:00.000Z",
			exitCode: 0,
			outputDigest: OUTPUT_DIGEST,
			artifactRef: {
				kind: "restricted_evidence_v1",
				digest: ARTIFACT_DIGEST,
				byteLength: 512,
			},
			environmentKeys: ["CI"],
		}),
		withCanonicalId({
			kind: "review",
			evidenceId: "",
			snapshotId,
			sourceDigest: SOURCE_DIGEST,
			attemptId: "feature-review-attempt",
			packetDigest: FEATURE_PACKET_DIGEST,
			startedAt: "2026-07-18T11:52:00.000Z",
			completedAt: "2026-07-18T11:53:00.000Z",
		}),
		withCanonicalId({
			kind: "review",
			evidenceId: "",
			snapshotId,
			sourceDigest: SOURCE_DIGEST,
			attemptId: "final-review-attempt",
			packetDigest: FINAL_PACKET_DIGEST,
			startedAt: "2026-07-18T11:54:00.000Z",
			completedAt: "2026-07-18T11:55:00.000Z",
		}),
	];
}

function reviewExecutions(): ReviewExecutionInput[] {
	return [
		{
			attemptId: "feature-review-attempt",
			logicalPassId: "feature-review-pass",
			featureId,
			reviewKind: "feature",
			reviewSnapshotId: FEATURE_PACKET_DIGEST,
			verdict: "passed",
			findings: [],
			startedAt: "2026-07-18T11:52:00.000Z",
			completedAt: "2026-07-18T11:53:00.000Z",
			terminalDisposition: "submitted",
		},
		{
			attemptId: "final-review-attempt",
			logicalPassId: "final-review-pass",
			featureId,
			reviewKind: "final",
			reviewSnapshotId: FINAL_PACKET_DIGEST,
			verdict: "passed",
			findings: [],
			startedAt: "2026-07-18T11:54:00.000Z",
			completedAt: "2026-07-18T11:55:00.000Z",
			terminalDisposition: "submitted",
		},
	];
}

function worker(session: ReturnType<typeof runningSession>): WorkerResult {
	return {
		status: "ok",
		operationId: "complete-causal-feature",
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId,
		summary: "Causal state complete.",
		artifactsChanged: [{ path: "src/domain/session.ts" }],
		validationRun: [
			{
				command: "bun test tests/causal-state.test.ts",
				status: "passed",
				summary: "Causal state tests passed.",
			},
		],
		validationScope: "broad",
		featureReviewDepth: "standard",
		featureReview: {
			status: "passed",
			summary: "Feature review passed.",
			blockingFindings: [],
		},
		finalReview: {
			status: "passed",
			summary: "Final review passed.",
			blockingFindings: [],
			reviewDepth: "detailed",
		},
		reviewExecutions: reviewExecutions(),
		evidence: completionEvidence(session.causal.snapshotId),
		orchestrationPasses: [],
	};
}

function nonFinalWorker(
	session: ReturnType<typeof runningSession>,
	operationId = "complete-non-final-feature",
): WorkerResult {
	const base = worker(session);
	const { finalReview: _finalReview, ...withoutFinalReview } = base;
	return {
		...withoutFinalReview,
		operationId,
		validationScope: "targeted",
		reviewExecutions: (base.reviewExecutions ?? []).filter(
			(execution) => execution.reviewKind === "feature",
		),
		evidence: (base.evidence ?? []).filter(
			(evidence) =>
				evidence.kind === "validation" ||
				evidence.attemptId === "feature-review-attempt",
		),
	};
}

function utf8Bytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe("causal session state", () => {
	test("starts at a canonical revision-zero snapshot", () => {
		const session = createSession("Canonical creation", environment);

		expect(session.version).toBe(3);
		expect(session.causal.revision).toBe(0);
		expect(session.causal.mutations).toEqual([]);
		expect(session.causal.evidence).toEqual([]);
		expect(session.causal.snapshotId).toBe(canonicalSessionSnapshotId(session));
	});

	test("advances exactly once per committed transition and preserves the chain", () => {
		const created = createSession("Chain mutations", environment);
		const planned = unwrap(
			applyPlan(
				created,
				{
					summary: "One feature",
					overview: "Verify revision chaining.",
					features: [
						{
							id: featureId,
							title: "Causal feature",
							summary: "Track mutations.",
						},
					],
				},
				environment,
			),
		);
		const approved = unwrap(approvePlan(planned, environment));
		const running = unwrap(startRun(approved, environment, featureId)).session;

		expect(created.causal.revision).toBe(0);
		expect(planned.causal.revision).toBe(1);
		expect(approved.causal.revision).toBe(2);
		expect(running.causal.revision).toBe(3);
		expect(running.causal.mutations).toHaveLength(3);
		expect(
			running.causal.mutations.map((mutation) => [
				mutation.priorRevision,
				mutation.revision,
			]),
		).toEqual([
			[0, 1],
			[1, 2],
			[2, 3],
		]);
		for (const [index, mutation] of running.causal.mutations.entries()) {
			const priorSnapshot =
				index === 0
					? created.causal.snapshotId
					: running.causal.mutations[index - 1]?.currentSnapshotId;
			if (!priorSnapshot) throw new Error("Expected a prior snapshot.");
			expect(mutation.priorSnapshotId).toBe(priorSnapshot);
		}
		expect(created.plan).toBeNull();
	});

	test("commits review and evidence state with successful completion once", () => {
		const running = runningSession();
		const result = unwrap(
			completeFeature(running, worker(running), environment),
		);
		const mutation = result.causal.mutations.at(-1);

		expect(result.status).toBe("completed");
		expect(result.causal.revision).toBe(running.causal.revision + 1);
		expect(result.causal.mutations).toHaveLength(
			running.causal.mutations.length + 1,
		);
		expect(result.causal.evidence).toHaveLength(3);
		expect(result.budget.reviewExecutions).toHaveLength(2);
		expect(mutation?.operationId).toBe("complete-causal-feature");
		expect(mutation?.priorSnapshotId).toBe(running.causal.snapshotId);
		expect(mutation?.currentSnapshotId).toBe(result.causal.snapshotId);
		expect(mutation?.changedFields).toEqual(
			expect.arrayContaining([
				"budget.reviewExecutions",
				"budget.reviewLifecycle",
				"causal.evidence",
				"budget.reviewCount",
			]),
		);
		expect(mutation?.changedFields).not.toContain("budget");
		expect(mutation?.changedFields).not.toContain(
			"budget.failedReviewAttemptsByFeature",
		);
		expect(mutation?.changedFields).toEqual(
			expect.arrayContaining(["closure", "timestamps.completedAt"]),
		);
		expect(mutation?.evidenceRefs).toEqual(
			result.causal.evidence.map((evidence) => evidence.evidenceId),
		);
		expect(result.causal.snapshotId).toBe(canonicalSessionSnapshotId(result));
	});

	test("reports only durable fields for a non-final successful completion", () => {
		const running = runningSession(2);
		const result = unwrap(
			completeFeature(running, nonFinalWorker(running), environment),
		);
		const mutation = result.causal.mutations.at(-1);

		expect(result.status).toBe("ready");
		expect(result.closure).toBeNull();
		expect(result.timestamps.completedAt).toBeNull();
		expect(mutation?.changedFields).not.toContain("closure");
		expect(mutation?.changedFields).not.toContain("timestamps.completedAt");
		expect(mutation?.changedFields).not.toContain(
			"budget.failedReviewAttemptsByFeature",
		);
		expect(mutation?.blockerDelta).toEqual({ added: [], removed: [] });
	});

	test("reports clearing the exact prior completion error on a later success", () => {
		const running = runningSession(2);
		const invalidWorker = nonFinalWorker(
			running,
			"reject-mismatched-review-feature",
		);
		const featureReview = invalidWorker.reviewExecutions?.[0];
		if (!featureReview) throw new Error("Expected feature review execution.");
		const rejected = completeFeature(
			running,
			{
				...invalidWorker,
				reviewExecutions: [
					{ ...featureReview, featureId: toFeatureId("other-feature") },
				],
			},
			environment,
		);
		expect(rejected.ok).toBe(false);
		if (rejected.ok || !rejected.session?.lastError) {
			throw new Error("Expected a persisted rejected completion error.");
		}
		const priorError = rejected.session.lastError.summary;

		const succeeded = unwrap(
			completeFeature(
				rejected.session,
				nonFinalWorker(rejected.session, "succeed-after-rejection"),
				environment,
			),
		);
		const mutation = succeeded.causal.mutations.at(-1);
		expect(succeeded.lastError).toBeNull();
		expect(mutation?.changedFields).toContain("lastError");
		expect(mutation?.blockerDelta.removed).toEqual([priorError]);
	});

	test("reports failed-review counter removal only when the counter existed", () => {
		const running = runningSession(2);
		const passingAttempt = reviewExecutions()[0];
		if (!passingAttempt) throw new Error("Expected a feature review attempt.");
		const failedAttempt: ReviewExecutionInput = {
			...passingAttempt,
			attemptId: "feature-review-failed-attempt",
			verdict: "failed" as const,
			findings: [
				{
					taxonomy: "implementation_defect",
					subject: "causal completion",
					requirementOrRisk: "Receipt must reflect durable state.",
					evidenceLocator: "tests/causal-state.test.ts",
					summary: "The completion delta was imprecise.",
					severity: "blocking" as const,
				},
			],
		};
		const withFailedAttempt = unwrap(
			recordReviewExecutions(
				running,
				[failedAttempt],
				environment,
				"record-failed-review-attempt",
			),
		);
		expect(
			withFailedAttempt.budget.failedReviewAttemptsByFeature[featureId],
		).toBe(1);

		const result = unwrap(
			completeFeature(
				withFailedAttempt,
				nonFinalWorker(withFailedAttempt, "complete-after-review-retry"),
				environment,
			),
		);
		const mutation = result.causal.mutations.at(-1);

		expect(
			result.budget.failedReviewAttemptsByFeature[featureId],
		).toBeUndefined();
		expect(mutation?.changedFields).toContain(
			"budget.failedReviewAttemptsByFeature",
		);
	});

	test("references only newly appended evidence when historical evidence exists", () => {
		const running = runningSession(2);
		const historicalEvidence = completionEvidence(running.causal.snapshotId)[0];
		if (!historicalEvidence) throw new Error("Expected historical evidence.");
		const withHistory = unwrap(
			recordEvidence(
				running,
				[historicalEvidence],
				environment,
				"record-historical-evidence",
			),
		);
		const completion = nonFinalWorker(
			withHistory,
			"complete-with-historical-evidence",
		);
		const newEvidenceIds = (completion.evidence ?? []).map(
			(evidence) => evidence.evidenceId,
		);

		const result = unwrap(
			completeFeature(withHistory, completion, environment),
		);
		const mutation = result.causal.mutations.at(-1);

		expect(result.causal.evidence).toHaveLength(3);
		expect(mutation?.evidenceRefs).toEqual(newEvidenceIds);
		expect(mutation?.evidenceRefs).not.toContain(historicalEvidence.evidenceId);
	});

	test("copies receipt changed entities instead of aliasing causal history", () => {
		const session = runningSession();
		const mutation = session.causal.mutations.at(-1);
		const receipt = mutationReceiptProjection(session);
		if (!mutation || !receipt.changedEntity) {
			throw new Error("Expected a mutation receipt entity.");
		}

		receipt.changedEntity.id = "mutated-receipt";

		expect(mutation.changedEntity.id).not.toBe("mutated-receipt");
	});

	test("fails stale guards closed without mutating causal state", () => {
		const running = runningSession();
		const staleWorker = {
			...worker(running),
			expectedRevision: running.causal.revision - 1,
		};
		const result = completeFeature(running, staleWorker, environment);

		expect(result.ok).toBe(false);
		if (result.ok || !result.session)
			throw new Error("Expected stale failure.");
		expect(result.message).toContain("stale");
		expect(result.session.status).toBe("running");
		expect(result.session.budget.reviewExecutions).toEqual([]);
		expect(result.session.causal).toEqual(running.causal);
	});

	test("fails missing and digest-mismatched evidence closed", () => {
		const running = runningSession();
		const missing = completeFeature(
			running,
			{ ...worker(running), evidence: [] },
			environment,
		);
		expect(missing.ok).toBe(false);
		if (missing.ok) throw new Error("Expected missing evidence failure.");
		expect(missing.message).toContain("source-bound review evidence");

		const [validation, ...remainingEvidence] = completionEvidence(
			running.causal.snapshotId,
		);
		if (validation?.kind !== "validation") {
			throw new Error("Expected validation evidence.");
		}
		const mismatched = completeFeature(
			running,
			{
				...worker(running),
				evidence: [
					{ ...validation, outputDigest: `sha256:${"f".repeat(64)}` },
					...remainingEvidence,
				],
			},
			environment,
		);
		expect(mismatched.ok).toBe(false);
		if (mismatched.ok) throw new Error("Expected digest mismatch failure.");
		expect(mismatched.message).toContain("canonical digest");

		const [validValidation, ...reviewEvidence] = completionEvidence(
			running.causal.snapshotId,
		);
		if (validValidation?.kind !== "validation") {
			throw new Error("Expected validation evidence.");
		}
		const wrongClass = withCanonicalId({
			...validValidation,
			evidenceId: "",
			commandClass: "lint" as const,
		});
		const classMismatch = completeFeature(
			running,
			{
				...worker(running),
				operationId: "wrong-command-class",
				evidence: [wrongClass, ...reviewEvidence],
			},
			environment,
		);
		expect(classMismatch.ok).toBe(false);
		if (classMismatch.ok) throw new Error("Expected command-class mismatch.");
		expect(classMismatch.message).toContain("command classes");

		const invalidSource = withCanonicalId({
			...validValidation,
			evidenceId: "",
			sourceDigest: "not-a-digest",
		});
		const invalidDigest = completeFeature(
			running,
			{
				...worker(running),
				operationId: "invalid-source-digest",
				evidence: [invalidSource, ...reviewEvidence],
			},
			environment,
		);
		expect(invalidDigest.ok).toBe(false);
		if (invalidDigest.ok) throw new Error("Expected invalid source digest.");
		expect(invalidDigest.message).toContain("non-canonical digest");
	});

	test("returns complete execution context with derived finality and copied arrays", () => {
		const nonFinalSession = runningSession(2);
		const nonFinalPlan = nonFinalSession.plan;
		const activeFeature = nonFinalPlan?.features[0];
		if (!nonFinalPlan || !activeFeature) {
			throw new Error("Expected an approved active plan.");
		}
		const before = structuredClone(nonFinalSession);
		const nonFinal = unwrap(executionSessionProjection(nonFinalSession));

		expect(nonFinal).toEqual({
			view: "execution",
			goal: nonFinalSession.goal,
			plan: {
				summary: nonFinalPlan.summary,
				overview: nonFinalPlan.overview,
				requirements: nonFinalPlan.requirements,
				decisions: nonFinalPlan.decisions,
				finalReviewPolicy: nonFinalPlan.finalReviewPolicy,
			},
			feature: {
				id: featureId,
				title: "Feature 1",
				summary: "A bounded feature summary. ".repeat(10),
				targets: activeFeature.targets,
				validation: [],
				dependsOn: [],
				reviewDepth: "standard",
			},
			isFinalFeature: false,
			requiredValidationScope: "targeted",
			expectedRevision: nonFinalSession.causal.revision,
			expectedSnapshotId: nonFinalSession.causal.snapshotId,
		});
		nonFinal.plan.requirements.push("projection-owned");
		nonFinal.plan.decisions.push("projection-owned");
		nonFinal.feature.targets.push("projection-owned.ts");
		nonFinal.feature.validation.push("projection-owned validation");
		nonFinal.feature.dependsOn.push(featureId);
		expect(nonFinalSession).toEqual(before);
		expect(nonFinal).not.toHaveProperty("truncated");
		expect(nonFinal).not.toHaveProperty("hasMore");
		expect(nonFinal).not.toHaveProperty("nextCursor");

		const finalSession = runningSession();
		const final = unwrap(executionSessionProjection(finalSession));
		expect(final.isFinalFeature).toBe(true);
		expect(final.requiredValidationScope).toBe("broad");
	});

	test("rejects oversized legacy execution state without truncating it", () => {
		const session = runningSession();
		if (!session.plan) throw new Error("Expected an approved plan.");
		const legacyOversized = {
			...session,
			plan: {
				...session.plan,
				overview: "🔥".repeat(4_000),
			},
		};

		const result = executionSessionProjection(legacyOversized);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected runtime oversize rejection.");
		expect(result.message).toContain(`${MAX_EXECUTION_PROJECTION_BYTES}`);
		expect(result.recovery).toContain("never truncated");
	});

	test("rejects execution context without an approved active feature", () => {
		const created = createSession(
			"Execution requires active work",
			environment,
		);
		expect(executionSessionProjection(created).ok).toBe(false);
		const planned = unwrap(
			applyPlan(
				created,
				{
					summary: "Execution context",
					overview: "Start before execution.",
					features: [
						{
							id: featureId,
							title: "Inactive",
							summary: "Not started.",
						},
					],
				},
				environment,
			),
		);
		const approved = unwrap(approvePlan(planned, environment));
		const inactive = executionSessionProjection(approved);
		expect(inactive.ok).toBe(false);
		if (inactive.ok) throw new Error("Expected inactive execution rejection.");
		expect(inactive.message).toContain("active in-progress");
	});

	test("admits multibyte plans by serialized bytes and rejects oversized context", () => {
		const created = createSession(
			"Measure multibyte execution context",
			environment,
		);
		const accepted = applyPlan(
			created,
			{
				summary: "Within budget",
				overview: "🔥".repeat(1_000),
				features: [
					{
						id: featureId,
						title: "Multibyte",
						summary: "Admitted by UTF-8 JSON size.",
					},
				],
			},
			environment,
		);
		expect(accepted.ok).toBe(true);
		if (!accepted.ok) throw new Error("Expected within-budget plan.");
		const running = unwrap(
			startRun(unwrap(approvePlan(accepted.value, environment)), environment),
		).session;
		expect(
			serializedUtf8JsonBytes(unwrap(executionSessionProjection(running))),
		).toBeLessThanOrEqual(MAX_EXECUTION_PROJECTION_BYTES);

		const multibyte = "🔥".repeat(4_000);
		expect(multibyte.length).toBeLessThan(MAX_EXECUTION_PROJECTION_BYTES);
		const rejected = applyPlan(
			created,
			{
				summary: "Over budget",
				overview: multibyte,
				features: [
					{
						id: featureId,
						title: "Too large",
						summary: "Reject the entire plan.",
					},
				],
			},
			environment,
		);
		expect(rejected.ok).toBe(false);
		if (rejected.ok) throw new Error("Expected oversized plan rejection.");
		expect(rejected.message).toContain(`${MAX_EXECUTION_PROJECTION_BYTES}`);
		expect(created.causal.revision).toBe(0);
	});

	test("classifies scope references lexically before bounded projection", () => {
		const session = runningSession();
		const unsafeTargets = [
			"/Users/private/secret.ts",
			"\\root\\private.ts",
			"C:\\private\\secret.ts",
			"C:relative\\secret.ts",
			"\\\\server\\share\\secret.ts",
			"\\\\?\\C:\\private\\device.ts",
			"https://example.com/secret.ts",
			"file:private/secret.ts",
			"~",
			"~/private.ts",
			"~someone/private.ts",
			"src/../private.ts",
			"src\\..\\private.ts",
		];
		const safeTargets = [
			"  src\\feature.ts  ",
			"foo..bar",
			"...",
			".well-known",
		];
		const targets = [...unsafeTargets, ...safeTargets];
		const scoped = {
			...session,
			plan: session.plan
				? {
						...session.plan,
						features: session.plan.features.map((feature, index) =>
							index === 0 ? { ...feature, targets } : feature,
						),
					}
				: null,
		};
		const execution = unwrap(executionSessionProjection(scoped));
		const repeated = unwrap(executionSessionProjection(scoped));
		const detail = detailSessionProjection(scoped);
		const reviewer = unwrap(
			reviewerSessionProjection(scoped, {
				reviewKind: "feature",
				featureId,
				packetHash: FEATURE_PACKET_DIGEST,
				evidenceRefs: [],
				expectedRevision: scoped.causal.revision,
				expectedSnapshotId: scoped.causal.snapshotId,
			}),
		);
		const detailTargets = detail.plan?.features[0]?.targets ?? [];
		for (const index of unsafeTargets.keys()) {
			const transformed = execution.feature.targets[index];
			expect(transformed).toMatch(/^sha256:[a-f0-9]{64}$/);
			expect(transformed).toBe(repeated.feature.targets[index]);
			expect(detailTargets[index]).toBe(transformed);
			if (index < reviewer.assignedScope.length) {
				expect(reviewer.assignedScope[index]).toBe(transformed);
			}
		}
		expect(execution.feature.targets.slice(unsafeTargets.length)).toEqual([
			"src\\feature.ts",
			"foo..bar",
			"...",
			".well-known",
		]);
		for (const unsafe of unsafeTargets) {
			expect(execution.feature.targets).not.toContain(unsafe.trim());
		}
		const serialized = JSON.stringify({ execution, detail, reviewer });
		expect(serialized).not.toContain("/Users/private");
		expect(serialized).not.toContain("example.com/secret");
		expect(serialized).not.toContain("C:relative");
		expect(serialized).not.toContain("device.ts");
	});

	test("keeps compact, reviewer, and mutation receipt projections bounded", () => {
		const session = runningSession(6);
		const before = JSON.stringify(session);
		const compact = compactSessionProjection(session);
		const privateScopeSession = {
			...session,
			plan: session.plan
				? {
						...session.plan,
						features: session.plan.features.map((feature, index) =>
							index === 0
								? {
										...feature,
										targets: [`/Users/private/${"🔥".repeat(500)}.ts`],
									}
								: feature,
						),
					}
				: null,
		};
		const reviewer = unwrap(
			reviewerSessionProjection(privateScopeSession, {
				reviewKind: "feature",
				featureId,
				packetHash: FEATURE_PACKET_DIGEST,
				evidenceRefs: Array.from(
					{ length: 30 },
					(_, index) => `sha256:${index.toString(16).padStart(64, "0")}`,
				),
				expectedRevision: session.causal.revision,
				expectedSnapshotId: session.causal.snapshotId,
			}),
		);
		const receipt = mutationReceiptProjection(session, ["🔥".repeat(1000)]);
		const detail = detailSessionProjection(session);

		expect(utf8Bytes(compact)).toBeLessThanOrEqual(3000);
		expect(utf8Bytes(reviewer)).toBeLessThanOrEqual(3000);
		expect(utf8Bytes(receipt)).toBeLessThanOrEqual(2000);
		expect(JSON.stringify(reviewer)).not.toContain("/Users/private");
		expect(reviewer.reviewKind).toBe("feature");
		expect(reviewer.requiredDepth).toBe("standard");
		expect(detail.view).toBe("detail");
		expect(JSON.stringify(session)).toBe(before);
		expect(compact.feature?.id).toBe(featureId);
		expect(compact.feature).not.toHaveProperty("reviewDepth");
		expect(compact).not.toHaveProperty("evidenceRefs");
		expect(compact.closure).toBeNull();
		expect("nextFeature" in compact).toBe(false);
		const closed = unwrap(
			closeSession(
				session,
				"deferred",
				environment,
				"Pause with compact routing context.",
				{
					operationId: "close-for-compact-projection",
					expectedRevision: session.causal.revision,
					expectedSnapshotId: session.causal.snapshotId,
				},
			),
		);
		expect(compactSessionProjection(closed).closure).toEqual({
			kind: "deferred",
		});
	});

	test("returns unchanged metadata, bounded ordered deltas, and rejects future polls", () => {
		const session = runningSession();
		const unchanged = unwrap(
			causalDeltaProjection(session, session.causal.revision),
		);
		const delta = unwrap(causalDeltaProjection(session, 0));
		const future = causalDeltaProjection(session, session.causal.revision + 1);

		expect(unchanged).toMatchObject({ changed: false, mutations: [] });
		expect(delta.changed).toBe(true);
		expect(delta.mutations.map((mutation) => mutation.revision)).toEqual([
			1, 2, 3,
		]);
		expect(delta.hasMore).toBe(false);
		expect(future.ok).toBe(false);
	});

	test("paginates deltas without advertising records it did not return", () => {
		let session = runningSession();
		for (let index = 0; index < 25; index += 1) {
			session = unwrap(
				recordReviewExecutions(
					session,
					[
						{
							attemptId: `delta-attempt-${index}`,
							logicalPassId: `delta-pass-${index}`,
							featureId,
							reviewKind: "feature",
							reviewSnapshotId: FEATURE_PACKET_DIGEST,
							verdict: "passed",
							findings: [],
							startedAt: "2026-07-18T11:52:00.000Z",
							completedAt: "2026-07-18T11:53:00.000Z",
							terminalDisposition: "submitted",
						},
					],
					environment,
				),
			);
		}

		const first = unwrap(causalDeltaProjection(session, 0));
		expect(first.hasMore).toBe(true);
		const lastFirstRevision = first.mutations.at(-1)?.revision;
		if (lastFirstRevision === undefined) {
			throw new Error("Expected a bounded first delta page.");
		}
		expect(first.throughRevision).toBe(lastFirstRevision);
		expect(first.currentRevision).toBe(session.causal.revision);
		expect(first.nextSinceRevision).toBe(first.throughRevision);
		expect(utf8Bytes(first)).toBeLessThanOrEqual(3_000);
		const second = unwrap(
			causalDeltaProjection(session, first.nextSinceRevision ?? 0),
		);
		expect(second.mutations[0]?.revision).toBe(first.throughRevision + 1);
	});

	test("authenticates the causal chain and replays an operation idempotently", () => {
		const running = runningSession();
		const completed = unwrap(
			completeFeature(running, worker(running), environment),
		);
		const replayed = unwrap(
			completeFeature(completed, worker(running), environment),
		);

		expect(replayed).toEqual(completed);
		expect(validateCausalChain(completed)).toBeNull();
		const latest = completed.causal.mutations.at(-1);
		if (!latest) throw new Error("Expected a causal mutation.");
		const tampered = {
			...completed,
			causal: {
				...completed.causal,
				mutations: [
					...completed.causal.mutations.slice(0, -1),
					{ ...latest, operationId: "forged-operation" },
				],
			},
		};
		expect(validateCausalChain(tampered)).toContain("invalid digest");
	});

	test("rejects operation-id reuse across operation kinds and request payloads", () => {
		const running = runningSession();
		const firstOperationId = running.causal.mutations[0]?.operationId;
		const secondOperationId = running.causal.mutations[1]?.operationId;
		const thirdOperationId = running.causal.mutations[2]?.operationId;
		if (!firstOperationId || !secondOperationId || !thirdOperationId) {
			throw new Error("Expected three setup mutations.");
		}

		const completionCollision = completeFeature(
			running,
			{ ...worker(running), operationId: firstOperationId },
			environment,
		);
		expect(completionCollision.ok).toBe(false);
		if (completionCollision.ok) {
			throw new Error("Expected completion operation collision.");
		}
		expect(completionCollision.message).toContain("different request");

		const resetCollision = resetFeature(running, featureId, environment, {
			operationId: secondOperationId,
			expectedRevision: running.causal.revision,
			expectedSnapshotId: running.causal.snapshotId,
		});

		expect(resetCollision.ok).toBe(false);
		if (resetCollision.ok)
			throw new Error("Expected reset operation collision.");
		expect(resetCollision.message).toContain("different request");

		const closeCollision = closeSession(
			running,
			"deferred",
			environment,
			"Pause safely.",
			{
				operationId: thirdOperationId,
				expectedRevision: running.causal.revision,
				expectedSnapshotId: running.causal.snapshotId,
			},
		);
		expect(closeCollision.ok).toBe(false);
		if (closeCollision.ok)
			throw new Error("Expected close operation collision.");
		expect(closeCollision.message).toContain("different request");
		expect(running.causal.revision).toBe(3);
	});

	test("classifies validation commands through one domain-owned precedence", () => {
		const cases = [
			["bun test && tsc --noEmit", "typecheck"],
			["swiftc -typecheck Sources/App.swift", "typecheck"],
			["swift test", "test"],
			["bun run typecheck", "typecheck"],
			["biome check src", "lint"],
			["xcodebuild -scheme App", "build"],
			["biome format src", "format"],
			["smoke check", "smoke"],
			["healthcheck", "other"],
			["custom verifier", "other"],
		] as const;

		for (const [command, expected] of cases) {
			expect(validationCommandClass(command)).toBe(expected);
		}
	});

	test("derives feature and final reviewer policy from approved active state", () => {
		const session = runningSession();
		if (!session.plan) throw new Error("Expected an approved plan.");
		const plan = {
			...session.plan,
			finalReviewPolicy: "broad" as const,
			requirements: ["Preserve causal truth."],
			decisions: ["Use one immutable review packet."],
			features: session.plan.features.map((feature) => ({
				...feature,
				reviewDepth: "quick" as const,
				targets: ["src/domain", "tests"],
			})),
		};
		const approved = { ...session, plan };
		const common = {
			featureId,
			packetHash: FEATURE_PACKET_DIGEST,
			evidenceRefs: [],
			expectedRevision: approved.causal.revision,
			expectedSnapshotId: approved.causal.snapshotId,
		};

		const feature = unwrap(
			reviewerSessionProjection(approved, {
				...common,
				reviewKind: "feature",
			}),
		);
		const final = unwrap(
			reviewerSessionProjection(approved, {
				...common,
				reviewKind: "final",
			}),
		);

		expect(feature).toMatchObject({
			reviewKind: "feature",
			requiredDepth: "quick",
			assignedScope: ["src/domain", "tests"],
		});
		expect(final).toMatchObject({
			reviewKind: "final",
			requiredDepth: "broad",
			assignedScope: ["src/domain", "tests"],
			requirements: ["Preserve causal truth."],
			decisions: ["Use one immutable review packet."],
		});
	});

	test("rejects reviewer assignments without approved applicable active state", () => {
		const created = createSession("Reject premature review", environment);
		const planned = unwrap(
			applyPlan(
				created,
				{
					summary: "Review later",
					overview: "Review only approved active work.",
					features: [
						{
							id: featureId,
							title: "Pending",
							summary: "Not active yet.",
						},
					],
				},
				environment,
			),
		);
		const request = {
			reviewKind: "feature" as const,
			featureId,
			packetHash: FEATURE_PACKET_DIGEST,
			evidenceRefs: [],
			expectedRevision: planned.causal.revision,
			expectedSnapshotId: planned.causal.snapshotId,
		};
		const unapproved = reviewerSessionProjection(planned, request);
		expect(unapproved.ok).toBe(false);
		if (unapproved.ok) throw new Error("Expected unapproved review rejection.");
		expect(unapproved.message).toContain("approved");

		const approved = unwrap(approvePlan(planned, environment));
		const inactive = reviewerSessionProjection(approved, {
			...request,
			expectedRevision: approved.causal.revision,
			expectedSnapshotId: approved.causal.snapshotId,
		});
		expect(inactive.ok).toBe(false);
		if (inactive.ok) throw new Error("Expected inactive review rejection.");
		expect(inactive.message).toContain("active in-progress");

		const earlierFeature = runningSession(2);
		const inapplicableFinal = reviewerSessionProjection(earlierFeature, {
			reviewKind: "final",
			featureId,
			packetHash: FEATURE_PACKET_DIGEST,
			evidenceRefs: [],
			expectedRevision: earlierFeature.causal.revision,
			expectedSnapshotId: earlierFeature.causal.snapshotId,
		});
		expect(inapplicableFinal.ok).toBe(false);
		if (inapplicableFinal.ok) {
			throw new Error("Expected inapplicable final review rejection.");
		}
		expect(inapplicableFinal.message).toContain(
			"not eligible for final review",
		);
	});

	test("replays an exact guarded reset but rejects a changed reset request", () => {
		const running = runningSession(2);
		const guard = {
			operationId: "reset-causal-feature",
			expectedRevision: running.causal.revision,
			expectedSnapshotId: running.causal.snapshotId,
		};
		const reset = unwrap(resetFeature(running, featureId, environment, guard));
		const replayed = unwrap(resetFeature(reset, featureId, environment, guard));
		expect(replayed).toEqual(reset);
		const rerun = unwrap(startRun(reset, environment, featureId)).session;
		const changedAssignment = resetFeature(rerun, featureId, environment, {
			operationId: guard.operationId,
			expectedRevision: rerun.causal.revision,
			expectedSnapshotId: rerun.causal.snapshotId,
		});
		expect(changedAssignment.ok).toBe(false);
		if (changedAssignment.ok) {
			throw new Error("Expected changed causal assignment rejection.");
		}
		expect(changedAssignment.message).toContain("different request");

		const changedRequest = resetFeature(
			reset,
			toFeatureId("feature-2"),
			environment,
			guard,
		);
		expect(changedRequest.ok).toBe(false);
		if (changedRequest.ok) throw new Error("Expected changed reset rejection.");
		expect(changedRequest.message).toContain("different request");
	});

	test("fails preflight for a forged genesis and avoids duplicate generated ids", () => {
		const created = createSession("Protect the chain root", environment);
		const forgedGenesis = {
			...created,
			causal: {
				...created.causal,
				genesisSnapshotId: `sha256:${"9".repeat(64)}`,
			},
		};
		const rejected = applyPlan(
			forgedGenesis,
			{
				summary: "Must reject",
				overview: "Do not launder a forged causal root.",
				features: [
					{
						id: featureId,
						title: "Forged",
						summary: "Should never be applied.",
					},
				],
			},
			environment,
		);
		expect(rejected.ok).toBe(false);
		if (rejected.ok) throw new Error("Expected forged genesis rejection.");
		expect(rejected.message).toContain("invalid");

		const duplicateEnvironment: TransitionEnvironment = {
			...environment,
			newSessionId: () => toSessionId("s"),
			newOperationId: () => "s:operation:2",
		};
		const planned = unwrap(
			applyPlan(
				createSession("Avoid generated collisions", duplicateEnvironment),
				{
					summary: "Unique operations",
					overview: "Fall back deterministically when generated ids collide.",
					features: [
						{
							id: featureId,
							title: "Unique",
							summary: "Keep operation ids unique.",
						},
					],
				},
				duplicateEnvironment,
			),
		);
		const approved = unwrap(approvePlan(planned, duplicateEnvironment));
		const running = unwrap(
			startRun(approved, duplicateEnvironment, featureId),
		).session;
		expect(
			new Set(running.causal.mutations.map((item) => item.operationId)).size,
		).toBe(running.causal.mutations.length);
		expect(validateCausalChain(running)).toBeNull();
	});
});
