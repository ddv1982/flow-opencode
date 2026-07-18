import { describe, expect, test } from "bun:test";
import {
	type EvidenceRecord,
	type ReviewExecutionFindingInput,
	type ReviewExecutionInput,
	toFeatureId,
	toSessionId,
	type WorkerResult,
} from "../src/domain/session.js";
import {
	applyPlan,
	approvePlan,
	canonicalEvidenceId,
	completeFeature,
	createSession,
	projectLogicalReviewPasses,
	recordReviewExecutions,
	stableReviewFindingFingerprint,
	startRun,
	type TransitionEnvironment,
} from "../src/domain/transitions.js";

const environment: TransitionEnvironment = {
	now: () => "2026-07-18T10:00:00.000Z",
	newSessionId: () => toSessionId("review-lifecycle-session"),
};

const featureId = toFeatureId("review-lifecycle");
const snapshotOne = `sha256:${"a".repeat(64)}`;
const snapshotTwo = `sha256:${"b".repeat(64)}`;

const finding: ReviewExecutionFindingInput = {
	taxonomy: "implementation_defect",
	subject: "src/domain/transitions.ts",
	requirementOrRisk: "completion must fail closed",
	evidenceLocator: "src/domain/transitions.ts:808",
	summary: "Completion can bypass a failed review.",
	severity: "blocking",
};

function execution(
	overrides: Partial<ReviewExecutionInput> = {},
): ReviewExecutionInput {
	return {
		attemptId: "attempt-1",
		logicalPassId: "feature-pass",
		featureId,
		reviewKind: "feature",
		reviewSnapshotId: snapshotOne,
		verdict: "failed",
		findings: [finding],
		startedAt: "2026-07-18T09:58:00.000Z",
		completedAt: "2026-07-18T09:59:00.000Z",
		terminalDisposition: "submitted",
		...overrides,
	};
}

function finalExecution(
	overrides: Partial<ReviewExecutionInput> = {},
): ReviewExecutionInput {
	return execution({
		attemptId: "final-attempt-1",
		logicalPassId: "final-pass",
		reviewKind: "final",
		reviewSnapshotId: snapshotTwo,
		verdict: "passed",
		findings: [],
		startedAt: "2026-07-18T09:59:30.000Z",
		completedAt: "2026-07-18T09:59:45.000Z",
		...overrides,
	});
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("Expected a successful transition.");
	return result.value;
}

function runningSession() {
	const created = createSession("Exercise the review lifecycle", environment);
	const planned = unwrap(
		applyPlan(
			created,
			{
				summary: "Review lifecycle",
				overview: "Persist review attempts before completion gates.",
				finalReviewPolicy: "detailed",
				features: [
					{
						id: featureId,
						title: "Review lifecycle",
						summary: "Add truthful retry semantics.",
						reviewDepth: "standard",
					},
				],
			},
			environment,
		),
	);
	const approved = unwrap(approvePlan(planned, environment));
	return unwrap(startRun(approved, environment, featureId)).session;
}

function worker(
	reviewExecutions: ReviewExecutionInput[],
	reviewStatus: "passed" | "failed",
	validationRun: WorkerResult["validationRun"] = [
		{
			command: "bun test tests/review-lifecycle.test.ts",
			status: "passed",
			summary: "Focused checks passed.",
		},
	],
	session = runningSession(),
): WorkerResult {
	const sourceDigest = `sha256:${"c".repeat(64)}`;
	const evidence: EvidenceRecord[] = [
		...validationRun.map((run, index) => {
			const record: EvidenceRecord = {
				kind: "validation",
				evidenceId: "",
				snapshotId: session.causal.snapshotId,
				sourceDigest,
				commandClass: "test",
				startedAt: "2026-07-18T09:56:00.000Z",
				completedAt: "2026-07-18T09:57:00.000Z",
				exitCode: run.status === "passed" ? 0 : 1,
				outputDigest: `sha256:${(index + 1).toString(16).repeat(64)}`,
				environmentKeys: ["CI"],
			};
			return { ...record, evidenceId: canonicalEvidenceId(record) };
		}),
		...reviewExecutions.map((reviewExecution) => {
			const record: EvidenceRecord = {
				kind: "review",
				evidenceId: "",
				snapshotId: session.causal.snapshotId,
				sourceDigest,
				attemptId: reviewExecution.attemptId,
				packetDigest: reviewExecution.reviewSnapshotId,
				startedAt: reviewExecution.startedAt,
				completedAt: reviewExecution.completedAt,
			};
			return { ...record, evidenceId: canonicalEvidenceId(record) };
		}),
	];
	return {
		status: "ok",
		operationId: `review-completion-${session.causal.revision}-${reviewExecutions.map((item) => item.attemptId).join("-") || "none"}`,
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId,
		summary: "Review lifecycle checked.",
		artifactsChanged: [],
		validationRun,
		validationScope: "broad",
		featureReviewDepth: "standard",
		featureReview: {
			status: reviewStatus,
			summary: `Feature review ${reviewStatus}.`,
			blockingFindings:
				reviewStatus === "failed"
					? [{ summary: finding.summary, severity: "blocking" }]
					: [],
		},
		finalReview:
			reviewStatus === "passed"
				? {
						status: "passed",
						summary: "Final review passed.",
						blockingFindings: [],
						reviewDepth: "detailed",
					}
				: undefined,
		reviewExecutions,
		evidence,
		orchestrationPasses: [],
	};
}

describe("review execution lifecycle", () => {
	test("starts the observed worker ledger as explicitly unavailable and unreconciled", () => {
		const session = createSession("Check host capability", environment);

		expect(session.version).toBe(3);
		expect(session.budget.observedReviewWorkers).toEqual({
			source: "unavailable",
			reconciliationStatus: "unreconciled",
			observedExecutionCount: null,
		});
		expect(session.budget.orchestration.workerCount).toBe(0);
		expect(session.budget.reviewExecutions).toEqual([]);
	});

	test("fingerprints only normalized taxonomy, subject, risk, and evidence", () => {
		const baseline = stableReviewFindingFingerprint(finding);
		const presentationOnlyChange = stableReviewFindingFingerprint({
			...finding,
			subject: "  SRC/DOMAIN/TRANSITIONS.TS  ",
			requirementOrRisk: "completion   must fail closed",
			evidenceLocator: " SRC/DOMAIN/TRANSITIONS.TS:808 ",
			summary: "Different prose and attempt time are irrelevant.",
			severity: "advisory",
		});

		expect(presentationOnlyChange).toBe(baseline);
		expect(
			stableReviewFindingFingerprint({
				...finding,
				taxonomy: "evidence_gap",
			}),
		).not.toBe(baseline);
	});

	test("deduplicates exact attempt retries and rejects conflicting reuse", () => {
		const session = createSession("Record attempts", environment);
		const first = unwrap(
			recordReviewExecutions(session, [execution()], environment),
		);
		const duplicate = unwrap(
			recordReviewExecutions(first, [execution()], environment),
		);
		const conflicting = recordReviewExecutions(
			duplicate,
			[execution({ verdict: "passed", findings: [] })],
			environment,
		);

		expect(duplicate.budget.reviewExecutions).toHaveLength(1);
		expect(duplicate.budget.failedReviewCount).toBe(1);
		expect(conflicting.ok).toBe(false);
		if (conflicting.ok) throw new Error("Expected conflicting reuse to fail.");
		expect(conflicting.message).toContain("conflicting evidence");
		expect(conflicting.session?.budget.reviewExecutions).toHaveLength(1);
	});

	test("rejects passing summary reviews without observed executions", () => {
		const result = completeFeature(
			runningSession(),
			worker([], "passed"),
			environment,
		);

		expect(result.ok).toBe(false);
		if (result.ok || !result.session) {
			throw new Error("Expected missing review evidence to fail closed.");
		}
		expect(result.message).toContain("recorded feature review execution");
		expect(result.session.budget.reviewExecutions).toEqual([]);
		expect(result.session.plan?.features[0]?.status).toBe("in_progress");
	});

	test("rejects passing summaries when the latest feature execution failed", () => {
		const result = completeFeature(
			runningSession(),
			worker([execution()], "passed"),
			environment,
		);

		expect(result.ok).toBe(false);
		if (result.ok || !result.session) {
			throw new Error("Expected failed execution truth to win.");
		}
		expect(result.message).toContain("remains failed");
		expect(result.session.status).toBe("running");
	});

	test("requires a distinct final execution before final completion", () => {
		const result = completeFeature(
			runningSession(),
			worker([execution({ verdict: "passed", findings: [] })], "passed"),
			environment,
		);

		expect(result.ok).toBe(false);
		if (result.ok || !result.session) {
			throw new Error("Expected missing final execution to fail closed.");
		}
		expect(result.message).toContain("recorded final review execution");
	});

	test("requires final review to start after feature review completes", () => {
		const result = completeFeature(
			runningSession(),
			worker(
				[
					execution({ verdict: "passed", findings: [] }),
					finalExecution({
						startedAt: "2026-07-18T09:58:30.000Z",
						completedAt: "2026-07-18T09:59:45.000Z",
					}),
				],
				"passed",
			),
			environment,
		);

		expect(result.ok).toBe(false);
		if (result.ok || !result.session) {
			throw new Error("Expected reversed review chronology to fail.");
		}
		expect(result.message).toContain("started before feature review passed");
	});

	test("does not fabricate retry consumption from repeated failed summaries", () => {
		const first = completeFeature(
			runningSession(),
			worker([], "failed"),
			environment,
		);
		expect(first.ok).toBe(false);
		if (first.ok || !first.session) {
			throw new Error("Expected failed summary without evidence to reject.");
		}

		const second = completeFeature(
			first.session,
			worker([], "failed", undefined, first.session),
			environment,
		);
		expect(second.ok).toBe(false);
		if (second.ok || !second.session) {
			throw new Error("Expected repeated failed summary to reject.");
		}
		expect(second.session.status).toBe("running");
		expect(second.session.budget.failedReviewCount).toBe(0);
		expect(second.session.budget.reviewLifecycle.retryConsumedCount).toBe(0);
		expect(second.session.budget.failedReviewAttemptsByFeature).toEqual({});
	});

	test("persists review evidence before an ordinary completion gate rejects", () => {
		const result = completeFeature(
			runningSession(),
			worker(
				[
					execution({
						verdict: "passed",
						findings: [],
					}),
					finalExecution(),
				],
				"passed",
				[],
			),
			environment,
		);

		expect(result.ok).toBe(false);
		if (result.ok || !result.session) {
			throw new Error("Expected validation rejection with persisted state.");
		}
		expect(result.session.budget.reviewExecutions).toHaveLength(2);
		expect(result.session.budget.reviewLifecycle.passedVerdictCount).toBe(2);
		const mutation = result.session.causal.mutations.at(-1);
		expect(mutation?.changedFields).toEqual(
			expect.arrayContaining([
				"budget.reviewExecutions",
				"budget.reviewLifecycle",
				"causal.evidence",
				"lastError",
			]),
		);
		expect(mutation?.evidenceRefs).toEqual(
			result.session.causal.evidence.map((evidence) => evidence.evidenceId),
		);
		expect(result.message).toContain("validation evidence");
	});

	test("projects a failed-to-passed logical retry as passed without deleting attempts", () => {
		const session = createSession("Project retry truth", environment);
		const recorded = unwrap(
			recordReviewExecutions(
				session,
				[
					execution(),
					execution({
						attemptId: "attempt-2",
						reviewSnapshotId: snapshotTwo,
						verdict: "passed",
						findings: [],
						completedAt: "2026-07-18T10:00:00.000Z",
					}),
				],
				environment,
			),
		);

		expect(recorded.budget.reviewExecutions).toHaveLength(2);
		expect(
			projectLogicalReviewPasses(recorded.budget.reviewExecutions),
		).toEqual([
			{
				logicalPassId: "feature-pass",
				featureId,
				reviewKind: "feature",
				reviewSnapshotId: snapshotTwo,
				latestAttemptId: "attempt-2",
				verdict: "passed",
				attemptCount: 2,
			},
		]);
	});

	test("exhausts after two distinct failed attempts with identical findings", () => {
		const first = completeFeature(
			runningSession(),
			worker([execution()], "failed"),
			environment,
		);
		expect(first.ok).toBe(false);
		if (first.ok || !first.session) {
			throw new Error("Expected the first review failure.");
		}
		expect(first.session.status).toBe("running");
		expect(first.session.budget.failedReviewAttemptsByFeature[featureId]).toBe(
			1,
		);

		const second = completeFeature(
			first.session,
			worker(
				[
					execution({
						attemptId: "attempt-2",
						completedAt: "2026-07-18T10:00:00.000Z",
					}),
				],
				"failed",
				undefined,
				first.session,
			),
			environment,
		);

		expect(second.ok).toBe(false);
		if (second.ok || !second.session) {
			throw new Error("Expected retry exhaustion.");
		}
		expect(second.message).toContain("budget exhausted");
		expect(second.session.status).toBe("blocked");
		expect(second.session.budget.reviewExecutions).toHaveLength(2);
		expect(second.session.budget.failedReviewCount).toBe(2);
		expect(second.session.budget.reviewLifecycle.retryConsumedCount).toBe(2);
	});

	test("retains contradictory same-snapshot evidence but refuses completion", () => {
		const result = completeFeature(
			runningSession(),
			worker(
				[
					execution(),
					execution({
						attemptId: "attempt-final",
						logicalPassId: "final-pass",
						reviewKind: "final",
						verdict: "passed",
						findings: [],
					}),
				],
				"passed",
			),
			environment,
		);

		expect(result.ok).toBe(false);
		if (result.ok || !result.session) {
			throw new Error("Expected contradictory review rejection.");
		}
		expect(result.message).toContain("contradictory terminal verdicts");
		expect(result.session.status).toBe("running");
		expect(result.session.plan?.features[0]?.status).toBe("in_progress");
		expect(result.session.budget.reviewExecutions).toHaveLength(2);
	});

	test("keeps the active final feature in progress while reviews are pending", () => {
		const running = runningSession();

		expect(running.status).toBe("running");
		expect(running.activeFeatureId).toBe(featureId);
		expect(running.plan?.features[0]?.status).toBe("in_progress");
		expect(running.lastError).toBeNull();
	});
});
