import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowService } from "../src/application/flow-service.js";
import { SessionSchema } from "../src/application/schema.js";
import {
	type ReviewAssignment,
	type Session,
	toSessionId,
} from "../src/domain/session.js";
import { validateSessionInvariants } from "../src/domain/session-invariants.js";
import {
	canonicalReviewAssignmentResultDigest,
	canonicalReviewPacketDigest,
	closeSession,
	type TransitionEnvironment,
} from "../src/domain/transitions.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import { loadSession } from "../src/infrastructure/fs/workspace.js";
import {
	flowFeatureComplete as executeFlowFeatureComplete,
	flowReviewStart as executeFlowReviewStart,
	flowStatus as executeFlowStatus,
	flowFeatureReset,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
} from "../src/infrastructure/fs/workspace-flow-service.js";

const OUTPUT_DIGEST = `sha256:${"c".repeat(64)}`;

function monotonicEnvironment(): TransitionEnvironment {
	let tick = 0;
	let runtimeId = 0;
	const baseline = Date.parse("2026-07-19T12:00:00.000Z");
	return {
		now: () => new Date(baseline + tick++ * 1_000).toISOString(),
		newSessionId: () => toSessionId("chronology-session"),
		newOperationId: (revision) => `chronology-operation-${revision}`,
		newRuntimeId: (kind) => `${kind}:chronology-${++runtimeId}`,
	};
}

function flowStatus(workspace: string, request: unknown) {
	return executeFlowStatus(workspace, { request });
}

function flowReviewStart(workspace: string, request: unknown) {
	return executeFlowReviewStart(workspace, { request });
}

function flowFeatureComplete(workspace: string, request: unknown) {
	return executeFlowFeatureComplete(workspace, { request });
}

function activeRun(session: Session) {
	const run = session.featureRuns.find(
		(candidate) => candidate.id === session.activeFeatureRunId,
	);
	if (!run) throw new Error("Expected an active feature run.");
	return run;
}

function assignment(session: Session, assignmentId: string): ReviewAssignment {
	const found = session.reviewAssignments.find(
		(candidate) => candidate.id === assignmentId,
	);
	if (!found) throw new Error(`Expected assignment '${assignmentId}'.`);
	return found;
}

async function runningWorkspace() {
	const workspace = await mkdtemp(join(tmpdir(), "flow-assignment-lifecycle-"));
	await writeFile(join(workspace, "source.ts"), "export const value = 1;\n");
	expect(
		(
			await flowPlanSave(workspace, {
				goal: "Exercise assignment lifecycle",
				plan: {
					summary: "Assignment lifecycle",
					overview: "Keep source, run, and review identity separate.",
					features: [
						{
							id: "first-feature",
							title: "First feature",
							summary: "Complete one non-final feature.",
							targets: ["source.ts"],
						},
						{
							id: "final-feature",
							title: "Final feature",
							summary: "Keep the session open.",
							dependsOn: ["first-feature"],
						},
					],
				},
			})
		).status,
	).toBe("ok");
	expect((await flowPlanApprove(workspace)).status).toBe("ok");
	expect((await flowRunStart(workspace, {})).status).toBe("ok");
	return workspace;
}

function validation(
	timestamp: string,
	command = "bun test tests/review-assignment-lifecycle.test.ts",
) {
	return {
		command,
		summary: "Focused lifecycle checks passed.",
		startedAt: timestamp,
		completedAt: timestamp,
		exitCode: 0,
		outputDigest: OUTPUT_DIGEST,
		environmentKeys: [],
	};
}

async function startFeatureReview(
	workspace: string,
	operationId: string,
	featureId = "first-feature",
) {
	const session = await loadSession(workspace);
	if (!session) throw new Error("Expected a running session.");
	const response = await flowReviewStart(workspace, {
		operationId,
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId,
		reviewKind: "feature",
		validationScope: "targeted",
		packet: {
			summary: "Review the source change and lifecycle invariants.",
			riskLenses: ["stale source", "reset applicability"],
		},
		validations: [validation(activeRun(session).startedAt)],
	});
	expect(response.status).toBe("ok");
	const projection = response.workflowData?.projection as
		| { assignmentId?: string }
		| undefined;
	if (!projection?.assignmentId) throw new Error("Expected an assignment id.");
	return projection.assignmentId;
}

async function prepareFinalFeature(workspace: string, operationPrefix: string) {
	const firstAssignmentId = await startFeatureReview(
		workspace,
		`${operationPrefix}-first-feature-review`,
	);
	const beforeFirstCompletion = await loadSession(workspace);
	if (!beforeFirstCompletion) {
		throw new Error("Expected first-feature review state.");
	}
	expect(
		(
			await flowFeatureComplete(workspace, {
				operationId: `${operationPrefix}-complete-first-feature`,
				expectedRevision: beforeFirstCompletion.causal.revision,
				expectedSnapshotId: beforeFirstCompletion.causal.snapshotId,
				featureId: "first-feature",
				result: {
					kind: "completed",
					summary: "First feature completed before final-review coverage.",
					artifactsChanged: [],
					validationScope: "targeted",
					featureReview: passingResult(
						assignment(beforeFirstCompletion, firstAssignmentId),
					),
				},
			})
		).status,
	).toBe("ok");
	expect(
		(await flowRunStart(workspace, { featureId: "final-feature" })).status,
	).toBe("ok");
	const featureAssignmentId = await startFeatureReview(
		workspace,
		`${operationPrefix}-final-feature-review`,
		"final-feature",
	);
	const session = await loadSession(workspace);
	if (!session) throw new Error("Expected final-feature review state.");
	return {
		session,
		featureAssignment: assignment(session, featureAssignmentId),
	};
}

const passingResult = (reviewAssignment: ReviewAssignment) => ({
	assignmentId: reviewAssignment.id,
	verdict: "passed" as const,
	findings: [],
	completedAt: reviewAssignment.startedAt,
	terminalDisposition: "submitted" as const,
});

const failedResult = (reviewAssignment: ReviewAssignment) => ({
	assignmentId: reviewAssignment.id,
	verdict: "failed" as const,
	findings: [
		{
			taxonomy: "implementation_defect" as const,
			subject: "source.ts",
			requirementOrRisk: "source state must remain correct",
			evidenceLocator: "source.ts:1",
			summary: "The implementation is still incorrect.",
			severity: "blocking" as const,
		},
	],
	completedAt: reviewAssignment.startedAt,
	terminalDisposition: "submitted" as const,
});

describe("runtime-owned review assignment lifecycle", () => {
	test("captures validation once, recovers by assignment id, and completes atomically", async () => {
		const workspace = await runningWorkspace();
		const assignmentId = await startFeatureReview(
			workspace,
			"start-feature-review",
		);
		const afterAssignment = await loadSession(workspace);
		if (!afterAssignment) throw new Error("Expected assignment state.");
		expect(afterAssignment.causal.evidence).toHaveLength(1);
		expect(afterAssignment.reviewAssignments[0]).toMatchObject({
			id: assignmentId,
			status: "pending",
			featureRunId: afterAssignment.activeFeatureRunId,
		});
		for (const identityField of [
			"packetSummary",
			"attemptId",
			"logicalPassId",
		] as const) {
			const corrupted = structuredClone(afterAssignment);
			const pending = assignment(corrupted, assignmentId);
			pending[identityField] = `${identityField}:tampered`;
			expect(validateSessionInvariants(corrupted), identityField).toContain(
				"invalid canonical review identity",
			);
			expect(SessionSchema.safeParse(corrupted).success, identityField).toBe(
				false,
			);
		}

		const recovered = await flowStatus(workspace, {
			view: "reviewer",
			assignmentId,
		});
		expect(recovered.status).toBe("ok");
		expect(recovered.workflowData?.projection).toMatchObject({
			assignmentId,
			assignmentStatus: "pending",
			validationEvidenceCount: 1,
		});

		const completed = await flowFeatureComplete(workspace, {
			operationId: "complete-feature",
			expectedRevision: afterAssignment.causal.revision,
			expectedSnapshotId: afterAssignment.causal.snapshotId,
			featureId: "first-feature",
			result: {
				kind: "completed",
				summary: "First feature completed.",
				artifactsChanged: [{ path: "source.ts" }],
				validationScope: "targeted",
				featureReview: passingResult(assignment(afterAssignment, assignmentId)),
			},
		});
		expect(completed.status).toBe("ok");
		expect(completed.workflowData?.receipt).toMatchObject({
			operationAccepted: true,
			operationIdConsumed: true,
			operationId: "complete-feature",
			featureRunId: afterAssignment.activeFeatureRunId,
		});
		const persisted = await loadSession(workspace);
		expect(persisted?.status).toBe("ready");
		expect(persisted?.causal.evidence).toHaveLength(2);
		expect(persisted?.reviewAssignments[0]?.status).toBe("submitted");
		expect(persisted?.history[0]).toMatchObject({
			featureRunId: afterAssignment.activeFeatureRunId,
			validationScope: "targeted",
			validationEvidenceRefs: [afterAssignment.causal.evidence[0]?.evidenceId],
			reviewAssignmentIds: [assignmentId],
		});
		expect(persisted?.history[0]).not.toHaveProperty("validationRun");
		expect(persisted?.history[0]).not.toHaveProperty("featureReview");
	});

	test("rejects future actor time atomically and accepts equality with reused operation ids", async () => {
		const workspace = await runningWorkspace();
		const running = await loadSession(workspace);
		if (!running) throw new Error("Expected a running session.");
		const run = activeRun(running);
		const reviewRequest = {
			operationId: "chronology-review-start",
			expectedRevision: running.causal.revision,
			expectedSnapshotId: running.causal.snapshotId,
			featureId: "first-feature",
			reviewKind: "feature" as const,
			validationScope: "targeted" as const,
			packet: {
				summary: "Reject validation that postdates runtime acceptance.",
				riskLenses: ["chronology"],
			},
			validations: [validation("2100-01-01T00:00:00.000Z")],
		};

		const futureValidation = await flowReviewStart(workspace, reviewRequest);
		expect(futureValidation.status).toBe("error");
		expect(await loadSession(workspace)).toEqual(running);
		expect(
			running.causal.mutations.some(
				(mutation) => mutation.operationId === reviewRequest.operationId,
			),
		).toBe(false);

		const correctedReview = await flowReviewStart(workspace, {
			...reviewRequest,
			validations: [validation(run.startedAt)],
		});
		expect(correctedReview.status).toBe("ok");
		const assigned = await loadSession(workspace);
		if (!assigned) throw new Error("Expected corrected assignment state.");
		const reviewAssignment = assigned.reviewAssignments.find(
			(candidate) => candidate.operationId === reviewRequest.operationId,
		);
		if (!reviewAssignment) throw new Error("Expected corrected assignment.");

		const completionRequest = {
			operationId: "chronology-feature-complete",
			expectedRevision: assigned.causal.revision,
			expectedSnapshotId: assigned.causal.snapshotId,
			featureId: "first-feature",
			result: {
				kind: "completed" as const,
				summary: "Chronology boundaries accepted.",
				artifactsChanged: [],
				validationScope: "targeted" as const,
				featureReview: {
					...passingResult(reviewAssignment),
					completedAt: "2100-01-01T00:00:00.000Z",
				},
			},
		};
		const futureReview = await flowFeatureComplete(
			workspace,
			completionRequest,
		);
		expect(futureReview.status).toBe("error");
		expect(await loadSession(workspace)).toEqual(assigned);
		expect(
			assigned.causal.mutations.some(
				(mutation) => mutation.operationId === completionRequest.operationId,
			),
		).toBe(false);

		const correctedCompletion = await flowFeatureComplete(workspace, {
			...completionRequest,
			result: {
				...completionRequest.result,
				featureReview: passingResult(reviewAssignment),
			},
		});
		expect(correctedCompletion.status).toBe("ok");
	});

	test("reset invalidates pending assignments and exact replay cannot recover them as active work", async () => {
		const workspace = await runningWorkspace();
		const beforeAssignment = await loadSession(workspace);
		if (!beforeAssignment) throw new Error("Expected running state.");
		const request = {
			operationId: "review-invalidated-by-reset",
			expectedRevision: beforeAssignment.causal.revision,
			expectedSnapshotId: beforeAssignment.causal.snapshotId,
			featureId: "first-feature",
			reviewKind: "feature" as const,
			validationScope: "targeted" as const,
			packet: {
				summary: "Review work that will be reset before completion.",
				riskLenses: ["stale assignment recovery"],
			},
			validations: [validation(activeRun(beforeAssignment).startedAt)],
		};
		const started = await flowReviewStart(workspace, request);
		const assignmentId = (
			started.workflowData?.projection as { assignmentId?: string } | undefined
		)?.assignmentId;
		if (!assignmentId) throw new Error("Expected an assignment id.");
		const beforeReset = await loadSession(workspace);
		if (!beforeReset) throw new Error("Expected assignment state.");

		const reset = await flowFeatureReset(workspace, {
			operationId: "invalidate-pending-review",
			expectedRevision: beforeReset.causal.revision,
			expectedSnapshotId: beforeReset.causal.snapshotId,
			featureId: "first-feature",
		});
		expect(reset.status).toBe("ok");
		const invalidated = await loadSession(workspace);
		expect(invalidated?.reviewAssignments[0]).toMatchObject({
			id: assignmentId,
			status: "invalidated",
			completedAt: null,
		});
		expect(invalidated?.reviewAssignments[0]?.invalidatedAt).not.toBeNull();

		const recovery = await flowStatus(workspace, {
			view: "reviewer",
			assignmentId,
		});
		expect(recovery.status).toBe("error");
		expect(recovery.workflowData?.failure?.summary).toContain("invalidated");

		const replay = await flowReviewStart(workspace, request);
		expect(replay.status).toBe("error");
		expect(replay.summary).toBe("Review assignment is no longer actionable.");
		expect(replay.workflowData?.failure?.summary).toContain("invalidated");
		expect(replay.workflowData?.receipt).toMatchObject({
			operationAccepted: true,
			operationIdConsumed: true,
			operationId: request.operationId,
		});
	});

	test("deferred and abandoned close quiesce active runs and pending assignments", async () => {
		for (const kind of ["deferred", "abandoned"] as const) {
			const workspace = await runningWorkspace();
			const assignmentId = await startFeatureReview(
				workspace,
				`close-pending-${kind}`,
			);
			const before = await loadSession(workspace);
			if (!before) throw new Error("Expected pending assignment state.");
			const runId = before.activeFeatureRunId;
			const closeAt = new Date(
				Date.parse(before.timestamps.updatedAt) + 1_000,
			).toISOString();
			const environment: TransitionEnvironment = {
				now: () => closeAt,
				newSessionId: () => before.id,
			};
			const result = closeSession(
				before,
				kind,
				environment,
				`Close active review as ${kind}.`,
				{
					operationId: `quiescent-close-${kind}`,
					expectedRevision: before.causal.revision,
					expectedSnapshotId: before.causal.snapshotId,
				},
			);
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error("Expected accepted close transition.");
			const closed = result.value;
			expect(closed.activeFeatureId).toBeNull();
			expect(closed.activeFeatureRunId).toBeNull();
			expect(closed.featureRuns.find((run) => run.id === runId)).toMatchObject({
				status: kind,
				endedAt: closeAt,
			});
			expect(assignment(closed, assignmentId)).toMatchObject({
				status: "invalidated",
				invalidatedAt: closeAt,
				invalidationReason:
					kind === "deferred" ? "session_deferred" : "session_abandoned",
			});
			expect(closed.closure).toMatchObject({
				kind,
				retryOperationId: `quiescent-close-${kind}`,
			});
			expect(SessionSchema.safeParse(closed).success).toBe(true);
		}
	});

	test("invalid completion consumes nothing and the corrected exact operation id succeeds", async () => {
		const workspace = await runningWorkspace();
		const assignmentId = await startFeatureReview(workspace, "start-review");
		const before = await loadSession(workspace);
		if (!before) throw new Error("Expected assignment state.");
		const invalid = await flowFeatureComplete(workspace, {
			operationId: "retryable-completion",
			expectedRevision: before.causal.revision,
			expectedSnapshotId: before.causal.snapshotId,
			featureId: "first-feature",
			result: {
				kind: "completed",
				summary: "Missing feature review result.",
				validationScope: "targeted",
			},
		});
		expect(invalid.status).toBe("error");
		expect(invalid.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId: "retryable-completion",
			revision: null,
			snapshotId: null,
			featureRunId: null,
			changedFields: [],
		});
		expect((await loadSession(workspace))?.causal.revision).toBe(
			before.causal.revision,
		);

		const corrected = await flowFeatureComplete(workspace, {
			operationId: "retryable-completion",
			expectedRevision: before.causal.revision,
			expectedSnapshotId: before.causal.snapshotId,
			featureId: "first-feature",
			result: {
				kind: "completed",
				summary: "Corrected completion.",
				artifactsChanged: [],
				validationScope: "targeted",
				featureReview: passingResult(assignment(before, assignmentId)),
			},
		});
		expect(corrected.status).toBe("ok");
	});

	test("reset starts a fresh run whose review truth excludes the prior blocker", async () => {
		const workspace = await runningWorkspace();
		const firstAssignment = await startFeatureReview(workspace, "first-review");
		const beforeBlock = await loadSession(workspace);
		if (!beforeBlock) throw new Error("Expected assignment state.");
		const blocked = await flowFeatureComplete(workspace, {
			operationId: "record-first-blocker",
			expectedRevision: beforeBlock.causal.revision,
			expectedSnapshotId: beforeBlock.causal.snapshotId,
			featureId: "first-feature",
			result: {
				kind: "blocked",
				summary: "Reviewer found a blocker.",
				review: failedResult(assignment(beforeBlock, firstAssignment)),
			},
		});
		expect(blocked.status).toBe("ok");
		expect(blocked.workflowData?.receipt).toMatchObject({
			operationAccepted: true,
			operationIdConsumed: true,
			operationId: "record-first-blocker",
		});
		const afterFirstBlocker = await loadSession(workspace);
		if (!afterFirstBlocker) {
			throw new Error("Expected running state after the first blocker.");
		}
		const firstRunId = afterFirstBlocker.activeFeatureRunId;
		const retryAssignmentId = await startFeatureReview(
			workspace,
			"blocker-retry-review",
		);
		const beforeTerminalBlocker = await loadSession(workspace);
		if (!beforeTerminalBlocker) {
			throw new Error("Expected blocker retry assignment state.");
		}
		const terminalBlocker = await flowFeatureComplete(workspace, {
			operationId: "record-terminal-blocker",
			expectedRevision: beforeTerminalBlocker.causal.revision,
			expectedSnapshotId: beforeTerminalBlocker.causal.snapshotId,
			featureId: "first-feature",
			result: {
				kind: "blocked",
				summary: "Reviewer confirmed the blocker.",
				review: failedResult(
					assignment(beforeTerminalBlocker, retryAssignmentId),
				),
			},
		});
		expect(terminalBlocker.status).toBe("ok");
		const afterBlock = await loadSession(workspace);
		if (!afterBlock) throw new Error("Expected blocked review state.");
		expect(afterBlock.status).toBe("blocked");
		const unrelatedReset = await flowFeatureReset(workspace, {
			operationId: "reset-unrelated-feature",
			expectedRevision: afterBlock.causal.revision,
			expectedSnapshotId: afterBlock.causal.snapshotId,
			featureId: "final-feature",
		});
		expect(unrelatedReset.status).toBe("ok");
		const afterUnrelatedReset = await loadSession(workspace);
		if (!afterUnrelatedReset) {
			throw new Error("Expected blocked state after unrelated reset.");
		}
		expect(afterUnrelatedReset.status).toBe("blocked");
		expect(afterUnrelatedReset.lastError).toEqual(afterBlock.lastError);
		expect(
			afterUnrelatedReset.causal.mutations.at(-1)?.changedFields,
		).not.toContain("lastError");
		expect(validateSessionInvariants(afterUnrelatedReset)).toBeNull();
		expect(SessionSchema.safeParse(afterUnrelatedReset).success).toBe(true);

		expect(
			(
				await flowFeatureReset(workspace, {
					operationId: "reset-feature",
					expectedRevision: afterUnrelatedReset.causal.revision,
					expectedSnapshotId: afterUnrelatedReset.causal.snapshotId,
					featureId: "first-feature",
				})
			).status,
		).toBe("ok");
		const afterBlockerReset = await loadSession(workspace);
		expect(afterBlockerReset?.lastError).toBeNull();
		expect(afterBlockerReset?.causal.mutations.at(-1)?.changedFields).toContain(
			"lastError",
		);
		expect(
			(await flowRunStart(workspace, { featureId: "first-feature" })).status,
		).toBe("ok");
		const restarted = await loadSession(workspace);
		expect(restarted?.activeFeatureRunId).not.toBe(firstRunId);
		expect(restarted?.featureRuns).toHaveLength(2);

		const secondAssignment = await startFeatureReview(
			workspace,
			"second-review",
		);
		const beforeComplete = await loadSession(workspace);
		if (!beforeComplete)
			throw new Error("Expected restarted assignment state.");
		const completed = await flowFeatureComplete(workspace, {
			operationId: "complete-restarted-feature",
			expectedRevision: beforeComplete.causal.revision,
			expectedSnapshotId: beforeComplete.causal.snapshotId,
			featureId: "first-feature",
			result: {
				kind: "completed",
				summary: "Repaired feature completed.",
				artifactsChanged: [],
				validationScope: "targeted",
				featureReview: passingResult(
					assignment(beforeComplete, secondAssignment),
				),
			},
		});
		expect(completed.status).toBe("ok");
		expect((await loadSession(workspace))?.status).toBe("ready");
	});

	test("source changes invalidate stale assignments and allow replacement without reset", async () => {
		const workspace = await runningWorkspace();
		const assignmentId = await startFeatureReview(workspace, "source-review");
		const before = await loadSession(workspace);
		if (!before) throw new Error("Expected assignment state.");
		await writeFile(join(workspace, "source.ts"), "export const value = 2;\n");
		const completion = await flowFeatureComplete(workspace, {
			operationId: "stale-source-completion",
			expectedRevision: before.causal.revision,
			expectedSnapshotId: before.causal.snapshotId,
			featureId: "first-feature",
			result: {
				kind: "completed",
				summary: "Stale completion.",
				artifactsChanged: [],
				validationScope: "targeted",
				featureReview: passingResult(assignment(before, assignmentId)),
			},
		});
		expect(completion.status).toBe("error");
		expect(completion.workflowData?.failure?.summary).toContain("stale");
		expect(completion.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId: "stale-source-completion",
			revision: before.causal.revision,
			snapshotId: before.causal.snapshotId,
			featureRunId: before.activeFeatureRunId,
			changedFields: [],
		});
		expect((await loadSession(workspace))?.causal.revision).toBe(
			before.causal.revision,
		);

		const replacementId = await startFeatureReview(
			workspace,
			"replacement-source-review",
		);
		expect(replacementId).not.toBe(assignmentId);
		const replaced = await loadSession(workspace);
		expect(replaced?.reviewAssignments).toHaveLength(2);
		expect(replaced?.reviewAssignments[0]).toMatchObject({
			id: assignmentId,
			status: "invalidated",
			invalidationReason: "source_changed",
		});
		expect(replaced?.reviewAssignments[0]?.invalidatedAt).not.toBeNull();
		expect(replaced?.reviewAssignments[1]).toMatchObject({
			id: replacementId,
			status: "pending",
		});
		const staleRecovery = await flowStatus(workspace, {
			view: "reviewer",
			assignmentId,
		});
		expect(staleRecovery.status).toBe("error");
		expect(staleRecovery.workflowData?.failure?.summary).toContain(
			"source changed",
		);

		const current = await loadSession(workspace);
		if (!current) throw new Error("Expected replacement assignment state.");
		const corrected = await flowFeatureComplete(workspace, {
			operationId: "stale-source-completion",
			expectedRevision: current.causal.revision,
			expectedSnapshotId: current.causal.snapshotId,
			featureId: "first-feature",
			result: {
				kind: "completed",
				summary: "Current-source completion.",
				artifactsChanged: [{ path: "source.ts" }],
				validationScope: "targeted",
				featureReview: passingResult(assignment(current, replacementId)),
			},
		});
		expect(corrected.status).toBe("ok");
	});

	test("requires broad validation to start after the bound feature result and accepts equality", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "flow-final-chronology-"));
		const service = createFlowService(
			createFileSessionRepository(workspace),
			monotonicEnvironment(),
		);
		expect(
			(
				await service.planSave({
					goal: "Enforce final-review chronology",
					plan: {
						summary: "Chronological final review",
						overview: "Bind broad validation after feature review.",
						features: [
							{
								id: "only-feature",
								title: "Only feature",
								summary: "Exercise both review stages.",
							},
						],
					},
				})
			).status,
		).toBe("ok");
		expect((await service.planApprove()).status).toBe("ok");
		expect((await service.runStart({ featureId: "only-feature" })).status).toBe(
			"ok",
		);
		const running = await loadSession(workspace);
		if (!running) throw new Error("Expected deterministic running state.");
		const run = activeRun(running);
		const featureStarted = await service.reviewStart({
			request: {
				operationId: "chronology-feature-review",
				expectedRevision: running.causal.revision,
				expectedSnapshotId: running.causal.snapshotId,
				featureId: "only-feature",
				reviewKind: "feature",
				validationScope: "targeted",
				packet: { summary: "Review the feature.", riskLenses: [] },
				validations: [validation(run.startedAt)],
			},
		});
		expect(featureStarted.status).toBe("ok");
		const afterFeature = await loadSession(workspace);
		if (!afterFeature) throw new Error("Expected feature assignment state.");
		const featureAssignment = afterFeature.reviewAssignments.find(
			(candidate) => candidate.operationId === "chronology-feature-review",
		);
		if (!featureAssignment) throw new Error("Expected feature assignment.");
		expect(Date.parse(run.startedAt)).toBeLessThan(
			Date.parse(featureAssignment.startedAt),
		);
		const featureResult = passingResult(featureAssignment);
		const finalRequest = {
			operationId: "chronology-final-review",
			expectedRevision: afterFeature.causal.revision,
			expectedSnapshotId: afterFeature.causal.snapshotId,
			featureId: "only-feature",
			reviewKind: "final" as const,
			validationScope: "broad" as const,
			featureReview: featureResult,
			packet: { summary: "Review the final result.", riskLenses: [] },
			validations: [validation(run.startedAt)],
		};

		const outOfOrder = await service.reviewStart({ request: finalRequest });
		expect(outOfOrder.status).toBe("error");
		expect(outOfOrder.workflowData?.failure?.summary).toContain(
			"broad validation",
		);
		expect(await loadSession(workspace)).toEqual(afterFeature);

		const equalityBoundary = await service.reviewStart({
			request: {
				...finalRequest,
				validations: [validation(featureResult.completedAt)],
			},
		});
		expect(equalityBoundary.status).toBe("ok");
	});

	test("final review binds one passing feature result before dispatch", async () => {
		const workspace = await runningWorkspace();
		const firstAssignment = await startFeatureReview(
			workspace,
			"complete-first-review",
		);
		const beforeFirstCompletion = await loadSession(workspace);
		if (!beforeFirstCompletion)
			throw new Error("Expected first assignment state.");
		expect(
			(
				await flowFeatureComplete(workspace, {
					operationId: "complete-first-feature",
					expectedRevision: beforeFirstCompletion.causal.revision,
					expectedSnapshotId: beforeFirstCompletion.causal.snapshotId,
					featureId: "first-feature",
					result: {
						kind: "completed",
						summary: "First feature completed.",
						artifactsChanged: [],
						validationScope: "targeted",
						featureReview: passingResult(
							assignment(beforeFirstCompletion, firstAssignment),
						),
					},
				})
			).status,
		).toBe("ok");
		expect(
			(await flowRunStart(workspace, { featureId: "final-feature" })).status,
		).toBe("ok");

		const featureAssignmentId = await startFeatureReview(
			workspace,
			"final-feature-review",
			"final-feature",
		);
		const afterFeatureAssignment = await loadSession(workspace);
		const featureAssignment = afterFeatureAssignment?.reviewAssignments.find(
			(assignment) => assignment.id === featureAssignmentId,
		);
		if (!afterFeatureAssignment || !featureAssignment) {
			throw new Error("Expected final feature assignment state.");
		}
		const finalRequest = {
			operationId: "sequenced-final-review",
			expectedRevision: afterFeatureAssignment.causal.revision,
			expectedSnapshotId: afterFeatureAssignment.causal.snapshotId,
			featureId: "final-feature",
			reviewKind: "final" as const,
			validationScope: "broad" as const,
			packet: {
				summary: "Review the completed plan after feature review passed.",
				riskLenses: ["release sequencing"],
			},
			validations: [validation(featureAssignment.startedAt)],
		};
		const premature = await flowReviewStart(workspace, finalRequest);
		expect(premature.status).toBe("error");
		expect(premature.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId: finalRequest.operationId,
		});
		expect(await loadSession(workspace)).toEqual(afterFeatureAssignment);

		let featureResult: ReturnType<typeof passingResult> | null =
			passingResult(featureAssignment);
		const finalStarted = await flowReviewStart(workspace, {
			...finalRequest,
			featureReview: featureResult,
		});
		expect(finalStarted.status).toBe("ok");
		const finalAssignmentId = (
			finalStarted.workflowData?.projection as
				| { assignmentId?: string }
				| undefined
		)?.assignmentId;
		const beforeFinalCompletion = await loadSession(workspace);
		const finalAssignment = beforeFinalCompletion?.reviewAssignments.find(
			(assignment) => assignment.id === finalAssignmentId,
		);
		if (!beforeFinalCompletion || !finalAssignment) {
			throw new Error("Expected sequenced final assignment.");
		}
		expect(finalAssignment.prerequisite).toMatchObject({
			assignmentId: featureAssignment.id,
			result: featureResult,
		});
		expect(finalAssignment.prerequisite?.resultDigest).toMatch(
			/^sha256:[a-f0-9]{64}$/,
		);
		for (const tamper of ["result-id", "binding-id", "digest"] as const) {
			const corrupted = structuredClone(beforeFinalCompletion);
			const corruptedFinal = assignment(corrupted, finalAssignment.id);
			if (!corruptedFinal.prerequisite) {
				throw new Error("Expected a durable prerequisite to tamper.");
			}
			if (tamper === "result-id") {
				corruptedFinal.prerequisite.result.assignmentId =
					"review-assignment:tampered-result";
			} else if (tamper === "binding-id") {
				corruptedFinal.prerequisite.assignmentId =
					"review-assignment:tampered-binding";
			} else {
				corruptedFinal.prerequisite.resultDigest = `sha256:${"f".repeat(64)}`;
			}
			corruptedFinal.packetDigest = canonicalReviewPacketDigest(corruptedFinal);
			expect(validateSessionInvariants(corrupted), tamper).toContain(
				"tampered prerequisite result",
			);
			expect(SessionSchema.safeParse(corrupted).success, tamper).toBe(false);
		}
		expect(
			beforeFinalCompletion.budget.reviewExecutions.some(
				(execution) =>
					execution.assignmentId === featureAssignment.id ||
					execution.assignmentId === finalAssignment.id,
			),
		).toBe(false);

		// Simulate manager context loss: drop the only caller-owned copy, then use
		// a fresh workspace-service call and persisted Session v4 state.
		featureResult = null;
		const recoveredStatus = await flowStatus(workspace, { view: "detail" });
		expect(recoveredStatus.status).toBe("ok");
		const recoveredSession = await loadSession(workspace);
		if (!recoveredSession) throw new Error("Expected recovered final state.");
		const recoveredFinal = assignment(recoveredSession, finalAssignment.id);
		expect(recoveredFinal.prerequisite?.result.assignmentId).toBe(
			featureAssignment.id,
		);
		const executionCountBefore =
			recoveredSession.budget.reviewExecutions.length;
		const completionRequest = {
			operationId: "bound-final-completion",
			expectedRevision: recoveredSession.causal.revision,
			expectedSnapshotId: recoveredSession.causal.snapshotId,
			featureId: "final-feature",
			result: {
				kind: "completed" as const,
				summary: "Final feature completed.",
				artifactsChanged: [],
				validationScope: "broad" as const,
				finalReview: {
					assignmentId: recoveredFinal.id,
					verdict: "passed" as const,
					findings: [],
					completedAt: recoveredFinal.startedAt,
					terminalDisposition: "submitted" as const,
				},
			},
		};
		const redundant = await flowFeatureComplete(workspace, {
			...completionRequest,
			result: {
				...completionRequest.result,
				featureReview: recoveredFinal.prerequisite?.result,
			},
		});
		expect(redundant.status).toBe("error");
		expect(await loadSession(workspace)).toEqual(recoveredSession);

		const completed = await flowFeatureComplete(workspace, completionRequest);
		expect(completed.status).toBe("ok");
		const persisted = await loadSession(workspace);
		if (!persisted) throw new Error("Expected completed final state.");
		expect(persisted?.closure).toBeNull();
		expect(persisted.budget.reviewExecutions).toHaveLength(
			executionCountBefore + 2,
		);
		expect(assignment(persisted, featureAssignment.id).status).toBe(
			"submitted",
		);
		expect(assignment(persisted, recoveredFinal.id).status).toBe("submitted");
	});

	test("pins final-review retries to the first durable prerequisite and exhausts atomically", async () => {
		const workspace = await runningWorkspace();
		const firstAssignmentId = await startFeatureReview(
			workspace,
			"retry-binding-first-feature-review",
		);
		const beforeFirstCompletion = await loadSession(workspace);
		if (!beforeFirstCompletion) {
			throw new Error("Expected first-feature review state.");
		}
		expect(
			(
				await flowFeatureComplete(workspace, {
					operationId: "retry-binding-complete-first-feature",
					expectedRevision: beforeFirstCompletion.causal.revision,
					expectedSnapshotId: beforeFirstCompletion.causal.snapshotId,
					featureId: "first-feature",
					result: {
						kind: "completed",
						summary: "First feature completed before final retry coverage.",
						artifactsChanged: [],
						validationScope: "targeted",
						featureReview: passingResult(
							assignment(beforeFirstCompletion, firstAssignmentId),
						),
					},
				})
			).status,
		).toBe("ok");
		expect(
			(await flowRunStart(workspace, { featureId: "final-feature" })).status,
		).toBe("ok");

		const featureAssignmentId = await startFeatureReview(
			workspace,
			"retry-binding-feature-review",
			"final-feature",
		);
		const afterFeatureAssignment = await loadSession(workspace);
		if (!afterFeatureAssignment) {
			throw new Error("Expected final-feature review assignment.");
		}
		const featureAssignment = assignment(
			afterFeatureAssignment,
			featureAssignmentId,
		);
		const originalFeatureResult = {
			...passingResult(featureAssignment),
			findings: [
				{
					taxonomy: "advisory" as const,
					subject: "final-feature",
					requirementOrRisk: "preserve the first durable prerequisite",
					evidenceLocator: "review:original-binding",
					summary: "original-binding-recovery-marker",
					severity: "advisory" as const,
				},
			],
		};
		const firstFinalStarted = await flowReviewStart(workspace, {
			operationId: "retry-binding-first-final-review",
			expectedRevision: afterFeatureAssignment.causal.revision,
			expectedSnapshotId: afterFeatureAssignment.causal.snapshotId,
			featureId: "final-feature",
			reviewKind: "final",
			validationScope: "broad",
			featureReview: originalFeatureResult,
			packet: {
				summary: "Run the first final review attempt.",
				riskLenses: ["durable retry binding"],
			},
			validations: [validation(originalFeatureResult.completedAt)],
		});
		expect(firstFinalStarted.status).toBe("ok");
		const firstFinalAssignmentId = (
			firstFinalStarted.workflowData?.projection as
				| { assignmentId?: string }
				| undefined
		)?.assignmentId;
		if (!firstFinalAssignmentId) {
			throw new Error("Expected first final-review assignment id.");
		}
		const beforeFirstFailure = await loadSession(workspace);
		if (!beforeFirstFailure) {
			throw new Error("Expected first final-review assignment state.");
		}
		const firstFinalAssignment = assignment(
			beforeFirstFailure,
			firstFinalAssignmentId,
		);
		expect(
			(
				await flowFeatureComplete(workspace, {
					operationId: "retry-binding-first-final-failure",
					expectedRevision: beforeFirstFailure.causal.revision,
					expectedSnapshotId: beforeFirstFailure.causal.snapshotId,
					featureId: "final-feature",
					result: {
						kind: "blocked",
						summary: "First final review attempt found a blocker.",
						review: failedResult(firstFinalAssignment),
					},
				})
			).status,
		).toBe("ok");

		const afterFirstFailure = await loadSession(workspace);
		if (!afterFirstFailure) {
			throw new Error("Expected retryable final-review state.");
		}
		expect(afterFirstFailure.status).toBe("running");
		expect(assignment(afterFirstFailure, featureAssignmentId).status).toBe(
			"pending",
		);
		expect(assignment(afterFirstFailure, firstFinalAssignmentId).status).toBe(
			"submitted",
		);

		const detailResponse = await flowStatus(workspace, { view: "detail" });
		expect(detailResponse.status).toBe("ok");
		const detail = detailResponse.workflowData?.projection as
			| {
					compact?: { revision?: number; snapshotId?: string };
					finalReviewRetry?: {
						prerequisite?: {
							result?: typeof originalFeatureResult;
							resultDigest?: string;
						};
					} | null;
					reviewAssignments?: Array<{
						id?: string;
						prerequisite?: {
							assignmentId?: string;
							resultDigest?: string;
						} | null;
					}>;
			  }
			| undefined;
		const recoveredFeatureResult =
			detail?.finalReviewRetry?.prerequisite?.result;
		expect(recoveredFeatureResult).toEqual(originalFeatureResult);
		expect(detail?.finalReviewRetry?.prerequisite?.resultDigest).toBe(
			canonicalReviewAssignmentResultDigest(originalFeatureResult),
		);
		const detailFinalAssignment = detail?.reviewAssignments?.find(
			(candidate) => candidate.id === firstFinalAssignmentId,
		);
		expect(detailFinalAssignment?.prerequisite).toEqual({
			assignmentId: featureAssignmentId,
			resultDigest: canonicalReviewAssignmentResultDigest(
				originalFeatureResult,
			),
		});
		expect(detailFinalAssignment?.prerequisite).not.toHaveProperty("result");
		const compactResponse = await flowStatus(workspace, { view: "compact" });
		const reviewerResponse = await flowStatus(workspace, {
			view: "reviewer",
			assignmentId: firstFinalAssignmentId,
		});
		expect(JSON.stringify(compactResponse)).not.toContain(
			"original-binding-recovery-marker",
		);
		expect(JSON.stringify(reviewerResponse)).not.toContain(
			"original-binding-recovery-marker",
		);

		const divergentFeatureResult = {
			...originalFeatureResult,
			findings: originalFeatureResult.findings.map((finding) => ({
				...finding,
				summary: "divergent-reconstructed-binding",
			})),
		};
		const retryOperationId = "retry-binding-second-final-review";
		const divergentRetry = await flowReviewStart(workspace, {
			operationId: retryOperationId,
			expectedRevision: detail?.compact?.revision,
			expectedSnapshotId: detail?.compact?.snapshotId,
			featureId: "final-feature",
			reviewKind: "final",
			validationScope: "broad",
			featureReview: divergentFeatureResult,
			packet: {
				summary: "Reject a divergent reconstructed prerequisite.",
				riskLenses: ["context loss"],
			},
			validations: [validation(divergentFeatureResult.completedAt)],
		});
		expect(divergentRetry.status).toBe("error");
		expect(divergentRetry.workflowData?.failure?.summary).toContain(
			"exact durable feature-review prerequisite",
		);
		expect(divergentRetry.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId: retryOperationId,
		});
		expect(await loadSession(workspace)).toEqual(afterFirstFailure);

		if (
			!recoveredFeatureResult ||
			detail?.compact?.revision === undefined ||
			!detail.compact.snapshotId
		) {
			throw new Error("Expected a complete detail recovery projection.");
		}
		const exactRetry = await flowReviewStart(workspace, {
			operationId: retryOperationId,
			expectedRevision: detail.compact.revision,
			expectedSnapshotId: detail.compact.snapshotId,
			featureId: "final-feature",
			reviewKind: "final",
			validationScope: "broad",
			featureReview: recoveredFeatureResult,
			packet: {
				summary: "Retry with the exact projected prerequisite.",
				riskLenses: ["context loss"],
			},
			validations: [validation(recoveredFeatureResult.completedAt)],
		});
		expect(exactRetry.status).toBe("ok");
		const secondFinalAssignmentId = (
			exactRetry.workflowData?.projection as
				| { assignmentId?: string }
				| undefined
		)?.assignmentId;
		if (!secondFinalAssignmentId) {
			throw new Error("Expected retry final-review assignment id.");
		}
		const beforeExhaustion = await loadSession(workspace);
		if (!beforeExhaustion) {
			throw new Error("Expected state before final-review exhaustion.");
		}
		const secondFinalAssignment = assignment(
			beforeExhaustion,
			secondFinalAssignmentId,
		);
		expect(secondFinalAssignment.prerequisite?.result).toEqual(
			originalFeatureResult,
		);
		const divergentSession = structuredClone(beforeExhaustion);
		const divergentAssignment = assignment(
			divergentSession,
			secondFinalAssignmentId,
		);
		if (!divergentAssignment.prerequisite) {
			throw new Error("Expected a prerequisite on the final retry.");
		}
		divergentAssignment.prerequisite.result = divergentFeatureResult;
		divergentAssignment.prerequisite.resultDigest =
			canonicalReviewAssignmentResultDigest(divergentFeatureResult);
		divergentAssignment.packetDigest =
			canonicalReviewPacketDigest(divergentAssignment);
		expect(validateSessionInvariants(divergentSession)).toContain(
			"diverge from the first durable prerequisite binding",
		);
		expect(SessionSchema.safeParse(divergentSession).success).toBe(false);

		const exhausted = await flowFeatureComplete(workspace, {
			operationId: "retry-binding-exhaust-final-review",
			expectedRevision: beforeExhaustion.causal.revision,
			expectedSnapshotId: beforeExhaustion.causal.snapshotId,
			featureId: "final-feature",
			result: {
				kind: "blocked",
				summary: "Second final review attempt exhausted the retry budget.",
				review: failedResult(secondFinalAssignment),
			},
		});
		expect(exhausted.status).toBe("ok");
		const persisted = await loadSession(workspace);
		if (!persisted) throw new Error("Expected exhausted final-review state.");
		expect(persisted.status).toBe("blocked");
		expect(persisted.causal.revision).toBe(
			beforeExhaustion.causal.revision + 1,
		);
		expect(assignment(persisted, featureAssignmentId).status).toBe("submitted");
		expect(assignment(persisted, secondFinalAssignmentId).status).toBe(
			"submitted",
		);
		const recordedFeatureResult = persisted.budget.reviewExecutions.find(
			(execution) => execution.assignmentId === featureAssignmentId,
		);
		expect(recordedFeatureResult).toMatchObject({
			assignmentId: originalFeatureResult.assignmentId,
			verdict: originalFeatureResult.verdict,
			completedAt: originalFeatureResult.completedAt,
			terminalDisposition: originalFeatureResult.terminalDisposition,
		});
		expect(recordedFeatureResult?.findings[0]).toMatchObject(
			originalFeatureResult.findings[0] as object,
		);
		expect(persisted.history.at(-1)?.reviewAssignmentIds).toEqual([
			featureAssignmentId,
			secondFinalAssignmentId,
		]);
		expect(validateSessionInvariants(persisted)).toBeNull();
	});

	test("allows a fresh prerequisite assignment when source changes and reverts", async () => {
		const workspace = await runningWorkspace();
		const prepared = await prepareFinalFeature(workspace, "source-revert");
		const originalAssignment = prepared.featureAssignment;
		const originalResult = passingResult(originalAssignment);
		const firstFinalStarted = await flowReviewStart(workspace, {
			operationId: "source-revert-first-final-review",
			expectedRevision: prepared.session.causal.revision,
			expectedSnapshotId: prepared.session.causal.snapshotId,
			featureId: "final-feature",
			reviewKind: "final",
			validationScope: "broad",
			featureReview: originalResult,
			packet: {
				summary: "Bind the original source and feature assignment.",
				riskLenses: ["source reversion"],
			},
			validations: [validation(originalResult.completedAt)],
		});
		expect(firstFinalStarted.status).toBe("ok");
		const firstFinalAssignmentId = (
			firstFinalStarted.workflowData?.projection as
				| { assignmentId?: string }
				| undefined
		)?.assignmentId;
		if (!firstFinalAssignmentId) {
			throw new Error("Expected the original final-review assignment.");
		}
		const beforeFailure = await loadSession(workspace);
		if (!beforeFailure) throw new Error("Expected state before first failure.");
		expect(
			(
				await flowFeatureComplete(workspace, {
					operationId: "source-revert-first-final-failure",
					expectedRevision: beforeFailure.causal.revision,
					expectedSnapshotId: beforeFailure.causal.snapshotId,
					featureId: "final-feature",
					result: {
						kind: "blocked",
						summary: "Make the first final assignment historical.",
						review: failedResult(
							assignment(beforeFailure, firstFinalAssignmentId),
						),
					},
				})
			).status,
		).toBe("ok");

		await writeFile(join(workspace, "source.ts"), "export const value = 2;\n");
		const changedAssignmentId = await startFeatureReview(
			workspace,
			"source-revert-changed-feature-review",
			"final-feature",
		);
		const afterChange = await loadSession(workspace);
		if (!afterChange) throw new Error("Expected changed-source assignment.");
		expect(assignment(afterChange, originalAssignment.id)).toMatchObject({
			status: "invalidated",
			invalidationReason: "source_changed",
		});

		await writeFile(join(workspace, "source.ts"), "export const value = 1;\n");
		const revertedAssignmentId = await startFeatureReview(
			workspace,
			"source-revert-restored-feature-review",
			"final-feature",
		);
		const afterRevert = await loadSession(workspace);
		if (!afterRevert) throw new Error("Expected reverted-source assignment.");
		expect(assignment(afterRevert, changedAssignmentId)).toMatchObject({
			status: "invalidated",
			invalidationReason: "source_changed",
		});
		const revertedAssignment = assignment(afterRevert, revertedAssignmentId);
		const revertedResult = passingResult(revertedAssignment);
		const reboundFinal = await flowReviewStart(workspace, {
			operationId: "source-revert-rebound-final-review",
			expectedRevision: afterRevert.causal.revision,
			expectedSnapshotId: afterRevert.causal.snapshotId,
			featureId: "final-feature",
			reviewKind: "final",
			validationScope: "broad",
			featureReview: revertedResult,
			packet: {
				summary: "Bind the fresh assignment after source reversion.",
				riskLenses: ["source reversion"],
			},
			validations: [validation(revertedResult.completedAt)],
		});
		expect(reboundFinal.status).toBe("ok");
		const reboundFinalAssignmentId = (
			reboundFinal.workflowData?.projection as
				| { assignmentId?: string }
				| undefined
		)?.assignmentId;
		if (!reboundFinalAssignmentId) {
			throw new Error("Expected rebound final-review assignment.");
		}
		const persisted = await loadSession(workspace);
		if (!persisted) throw new Error("Expected rebound final-review state.");
		expect(
			assignment(persisted, firstFinalAssignmentId).prerequisite?.assignmentId,
		).toBe(originalAssignment.id);
		expect(
			assignment(persisted, reboundFinalAssignmentId).prerequisite
				?.assignmentId,
		).toBe(revertedAssignmentId);
		expect(validateSessionInvariants(persisted)).toBeNull();
		const detail = (await flowStatus(workspace, { view: "detail" }))
			.workflowData?.projection as
			| {
					finalReviewRetry?: {
						prerequisite?: { assignmentId?: string };
					};
			  }
			| undefined;
		expect(detail?.finalReviewRetry?.prerequisite?.assignmentId).toBe(
			revertedAssignmentId,
		);

		const completed = await flowFeatureComplete(workspace, {
			operationId: "source-revert-complete-rebound-final",
			expectedRevision: persisted.causal.revision,
			expectedSnapshotId: persisted.causal.snapshotId,
			featureId: "final-feature",
			result: {
				kind: "completed",
				summary: "Complete from the fresh source-bound prerequisite.",
				artifactsChanged: [{ path: "source.ts" }],
				validationScope: "broad",
				finalReview: passingResult(
					assignment(persisted, reboundFinalAssignmentId),
				),
			},
		});
		expect(completed.status).toBe("ok");
		const completedSession = await loadSession(workspace);
		if (!completedSession) throw new Error("Expected completed rebound state.");
		const completedRunId = assignment(
			completedSession,
			reboundFinalAssignmentId,
		).featureRunId;
		expect(
			completedSession.budget.reviewExecutions.filter(
				(execution) =>
					execution.featureRunId === completedRunId &&
					execution.verdict === "passed",
			).length,
		).toBe(2);
		expect(
			completedSession.budget.reviewExecutions.some(
				(execution) => execution.assignmentId === originalAssignment.id,
			),
		).toBe(false);
		expect(completedSession.budget.reviewCount).toBe(3);
		expect(completedSession.history.at(-1)?.reviewAssignmentIds).toEqual([
			revertedAssignmentId,
			reboundFinalAssignmentId,
		]);
		expect(validateSessionInvariants(completedSession)).toBeNull();
	});

	test("retains two silent same-class validations as distinct observations", async () => {
		const workspace = await runningWorkspace();
		const session = await loadSession(workspace);
		if (!session) throw new Error("Expected running state.");
		const response = await flowReviewStart(workspace, {
			operationId: "silent-validation-assignment",
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId: "first-feature",
			reviewKind: "feature",
			validationScope: "targeted",
			packet: {
				summary: "Review two silent validation observations.",
				riskLenses: [],
			},
			validations: [
				validation(
					activeRun(session).startedAt,
					"bun test tests/unit-a.test.ts",
				),
				validation(
					activeRun(session).startedAt,
					"bun test tests/unit-b.test.ts",
				),
			],
		});
		expect(response.status).toBe("ok");
		const persisted = await loadSession(workspace);
		const validations = persisted?.causal.evidence.filter(
			(evidence) => evidence.kind === "validation",
		);
		expect(validations).toHaveLength(2);
		expect(
			new Set(validations?.map((evidence) => evidence.evidenceId)).size,
		).toBe(2);
		expect(
			new Set(validations?.map((evidence) => evidence.commandDigest)).size,
		).toBe(2);
	});

	test("rejects a duplicate canonical validation observation atomically", async () => {
		const workspace = await runningWorkspace();
		const before = await loadSession(workspace);
		if (!before) throw new Error("Expected running state.");
		const repeated = validation(activeRun(before).startedAt);
		const operationId = "duplicate-validation-evidence";
		const response = await flowReviewStart(workspace, {
			operationId,
			expectedRevision: before.causal.revision,
			expectedSnapshotId: before.causal.snapshotId,
			featureId: "first-feature",
			reviewKind: "feature",
			validationScope: "targeted",
			packet: {
				summary: "Reject duplicated canonical validation evidence.",
				riskLenses: ["evidence identity"],
			},
			validations: [repeated, repeated],
		});
		expect(response.status).toBe("error");
		expect(response.workflowData?.failure?.summary).toContain("must be unique");
		expect(response.workflowData?.receipt).toMatchObject({
			operationAccepted: false,
			operationIdConsumed: false,
			operationId,
			revision: before.causal.revision,
			snapshotId: before.causal.snapshotId,
		});
		expect(await loadSession(workspace)).toEqual(before);
	});
});
