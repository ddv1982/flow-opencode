import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFlowService,
	type FlowResponse,
	type FlowService,
} from "../../src/application/flow-service.js";
import type { SessionRepository } from "../../src/application/ports/session-repository.js";
import { SessionSchema } from "../../src/application/schema.js";
import {
	type ReviewAssignment,
	type ReviewAssignmentResultInput,
	type Session,
	toSessionId,
} from "../../src/domain/session.js";
import { validateSessionInvariants } from "../../src/domain/session-invariants.js";
import type { TransitionEnvironment } from "../../src/domain/transitions.js";
import { createFileSessionRepository } from "../../src/infrastructure/fs/session-repository.js";
import {
	archivedSessionPath,
	sessionPath,
} from "../../src/infrastructure/fs/workspace.js";
import { publishValidationReceiptForWorkspace } from "./validation-receipt.js";

export const REQUIRED_REPOSITORY_SEQUENCE_ACTIONS = [
	"plan",
	"approve",
	"start",
	"validate",
	"assign",
	"source-change",
	"block",
	"review-retry",
	"complete",
	"reset",
	"final-review",
	"final-retry-mismatch",
	"close",
	"archive-retry",
	"exact-replay",
	"explicit-close-replacement",
] as const;

export type RepositoryLifecycleSequenceResult = {
	seed: number;
	trace: string[];
	actionCoverage: string[];
	acceptedMutationCount: number;
	idempotentAcceptanceCount: number;
	atomicRejectionCount: number;
	repositoryReloadCount: number;
	archivedSession: Session;
};

type ActiveSnapshot = {
	session: Session;
	bytes: string;
};

function xorshift32(seed: number): () => number {
	let state = seed | 0;
	if (state === 0) state = 0x6d2b79f5;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	};
}

function deterministicEnvironment(seed: number): TransitionEnvironment {
	const epoch = Date.parse("2026-07-19T12:00:00.000Z") + seed * 1_000;
	let clockTick = 0;
	let runtimeId = 0;
	let sessionId = 0;
	return {
		now: () => new Date(epoch + clockTick++).toISOString(),
		newSessionId: () =>
			toSessionId(`repository-sequence-${seed}-${++sessionId}`),
		newOperationId: (revision) =>
			`repository-sequence-${seed}-implicit-${revision}`,
		newRuntimeId: (kind) =>
			`${kind}:repository-sequence-${seed}-${++runtimeId}`,
	};
}

function responseAssignmentId(response: FlowResponse): string {
	const projection = response.workflowData?.projection as
		| { assignmentId?: string }
		| undefined;
	assert.ok(projection?.assignmentId, "Expected a review assignment id.");
	return projection.assignmentId;
}

function assignment(session: Session, assignmentId: string): ReviewAssignment {
	const found = session.reviewAssignments.find(
		(candidate) => candidate.id === assignmentId,
	);
	assert.ok(found, `Missing review assignment '${assignmentId}'.`);
	return found;
}

function passingResult(
	assigned: ReviewAssignment,
): ReviewAssignmentResultInput {
	return {
		assignmentId: assigned.id,
		verdict: "passed",
		findings: [],
		completedAt: assigned.startedAt,
		terminalDisposition: "submitted",
	};
}

function failingResult(
	assigned: ReviewAssignment,
): ReviewAssignmentResultInput {
	return {
		assignmentId: assigned.id,
		verdict: "failed",
		findings: [
			{
				taxonomy: "implementation_defect",
				subject: "seeded lifecycle probe",
				requirementOrRisk: "A blocking review must remain explicit.",
				evidenceLocator: "source.ts:1",
				summary: "Seeded blocking review finding.",
				severity: "blocking",
			},
		],
		completedAt: assigned.startedAt,
		terminalDisposition: "submitted",
	};
}

async function activeSnapshot(
	workspace: string,
	repositoryReloaded: () => void,
): Promise<ActiveSnapshot> {
	const repository = createFileSessionRepository(workspace);
	const session = await repository.read();
	repositoryReloaded();
	assert.ok(session, "Expected an active persisted session.");
	const bytes = await readFile(sessionPath(workspace), "utf8");
	assert.deepEqual(SessionSchema.parse(JSON.parse(bytes)), session);
	assert.equal(validateSessionInvariants(session), null);
	return { session, bytes };
}

function assertResponseStatus(
	response: FlowResponse,
	expected: FlowResponse["status"],
	action: string,
): void {
	assert.equal(
		response.status,
		expected,
		`${action}: ${JSON.stringify(response)}`,
	);
}

function assertRejectedReceipt(
	response: FlowResponse,
	operationId: string | null,
	before: ActiveSnapshot,
): void {
	const receipt = response.workflowData?.receipt;
	assert.ok(receipt, "Expected a rejected mutation receipt.");
	assert.equal(receipt.operationAccepted, false);
	assert.equal(receipt.operationIdConsumed, false);
	assert.equal(receipt.operationId, operationId);
	assert.equal(receipt.revision, before.session.causal.revision);
	assert.equal(receipt.snapshotId, before.session.causal.snapshotId);
}

export async function runDeterministicRepositoryLifecycleSequence(
	seed: number,
	stepCount: number,
): Promise<RepositoryLifecycleSequenceResult> {
	const workspace = await mkdtemp(
		join(tmpdir(), `flow-repository-seed-${seed}-`),
	);
	const trace: string[] = [];
	const actionCoverage = new Set<string>();
	let acceptedMutationCount = 0;
	let idempotentAcceptanceCount = 0;
	let atomicRejectionCount = 0;
	let repositoryReloadCount = 0;
	const environment = deterministicEnvironment(seed);
	const random = xorshift32(seed);
	const sourcePath = join(workspace, "source.ts");
	const replacementPlanRequest = {
		goal: `Replacement goal for seed ${seed}`,
		plan: {
			summary: "Begin only after explicit closure.",
			overview: "Prove that a different goal cannot replace active Flow state.",
			features: [
				{
					id: "replacement",
					title: "Replacement",
					summary: "Start after the prior session is archived.",
					targets: ["source.ts"],
				},
			],
		},
	};
	const requiredActionNames = new Set<string>(
		REQUIRED_REPOSITORY_SEQUENCE_ACTIONS,
	);

	const repository = (): SessionRepository =>
		createFileSessionRepository(workspace);
	const service = (): FlowService =>
		createFlowService(repository(), environment);
	const reloaded = () => {
		repositoryReloadCount += 1;
	};
	const cover = (action: string) => {
		if (requiredActionNames.has(action)) actionCoverage.add(action);
	};

	let current: ActiveSnapshot;
	const acceptMutation = async (
		action: string,
		before: ActiveSnapshot,
		response: FlowResponse,
	): Promise<ActiveSnapshot> => {
		assertResponseStatus(response, "ok", action);
		const next = await activeSnapshot(workspace, reloaded);
		assert.equal(
			next.session.causal.revision,
			before.session.causal.revision + 1,
		);
		assert.equal(
			next.session.causal.mutations.length,
			before.session.causal.mutations.length + 1,
		);
		assert.notEqual(next.bytes, before.bytes);
		trace.push(
			`${action}:accepted:r${before.session.causal.revision}->r${next.session.causal.revision}`,
		);
		cover(action);
		acceptedMutationCount += 1;
		return next;
	};
	const acceptIdempotent = async (
		action: string,
		before: ActiveSnapshot,
		response: FlowResponse,
	): Promise<ActiveSnapshot> => {
		assertResponseStatus(response, "ok", action);
		const next = await activeSnapshot(workspace, reloaded);
		assert.equal(next.bytes, before.bytes);
		assert.equal(next.session.causal.revision, before.session.causal.revision);
		trace.push(`${action}:idempotent:r${next.session.causal.revision}`);
		idempotentAcceptanceCount += 1;
		return next;
	};
	const rejectAtomically = async (
		action: string,
		operationId: string,
		before: ActiveSnapshot,
		response: FlowResponse,
	): Promise<ActiveSnapshot> => {
		assertResponseStatus(response, "error", action);
		assertRejectedReceipt(response, operationId, before);
		const next = await activeSnapshot(workspace, reloaded);
		assert.equal(next.bytes, before.bytes);
		assert.equal(
			next.session.causal.mutations.some(
				(mutation) => mutation.operationId === operationId,
			),
			false,
		);
		trace.push(`${action}:rejected:r${next.session.causal.revision}`);
		atomicRejectionCount += 1;
		return next;
	};
	const rejectWithoutCallerIdentity = async (
		action: string,
		before: ActiveSnapshot,
		response: FlowResponse,
	): Promise<ActiveSnapshot> => {
		assertResponseStatus(response, "error", action);
		assertRejectedReceipt(response, null, before);
		const next = await activeSnapshot(workspace, reloaded);
		assert.equal(next.bytes, before.bytes);
		assert.equal(
			next.session.causal.mutations.length,
			before.session.causal.mutations.length,
		);
		trace.push(`${action}:rejected:r${next.session.causal.revision}`);
		atomicRejectionCount += 1;
		return next;
	};

	try {
		await writeFile(sourcePath, `export const seed = ${seed};\n`, "utf8");
		const planned = await service().planSave({
			goal: `Prove repository lifecycle seed ${seed}`,
			plan: {
				summary: "Exercise the complete Session v4 lifecycle.",
				overview:
					"Reload every accepted checkpoint and preserve rejected state exactly.",
				features: [
					{
						id: "implementation",
						title: "Implementation",
						summary: "Exercise source invalidation and review retry.",
						targets: ["source.ts"],
					},
					{
						id: "finalization",
						title: "Finalization",
						summary: "Exercise reset, final review, and closure.",
						targets: ["source.ts"],
						dependsOn: ["implementation"],
					},
				],
			},
		});
		assertResponseStatus(planned, "ok", "plan");
		current = await activeSnapshot(workspace, reloaded);
		trace.push(`plan:accepted:r${current.session.causal.revision}`);
		cover("plan");
		acceptedMutationCount += 1;

		current = await acceptMutation(
			"approve",
			current,
			await service().planApprove(),
		);
		current = await acceptMutation(
			"start",
			current,
			await service().runStart({ featureId: "implementation" }),
		);
		current = await rejectWithoutCallerIdentity(
			"different-goal-before-close",
			current,
			await service().planSave(replacementPlanRequest),
		);
		cover("explicit-close-replacement");

		const firstRun = current.session.featureRuns.find(
			(run) => run.id === current.session.activeFeatureRunId,
		);
		assert.ok(firstRun);
		cover("validate");
		trace.push("validate:prepared:targeted-equality");
		const firstValidationRef = await publishValidationReceiptForWorkspace(
			workspace,
			{
				startedAt: firstRun.startedAt,
				command: `seed-${seed}-initial-validation`,
			},
		);
		const firstReviewOperation = `seed-${seed}-review-initial`;
		const firstReviewResponse = await service().reviewStart({
			request: {
				operationId: firstReviewOperation,
				expectedRevision: current.session.causal.revision,
				expectedSnapshotId: current.session.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "feature",
				validationScope: "targeted",
				packet: {
					summary: "Review before the deterministic source change.",
					riskLenses: ["source binding"],
				},
				validationRefs: [firstValidationRef],
			},
		});
		const firstAssignmentId = responseAssignmentId(firstReviewResponse);
		current = await acceptMutation("assign", current, firstReviewResponse);

		const randomProbeCount = Math.max(0, stepCount - 20);
		for (let index = 0; index < randomProbeCount; index += 1) {
			const choice = random() % 4;
			if (choice === 0) {
				current = await acceptIdempotent(
					"probe-run-replay",
					current,
					await service().runStart({ featureId: "implementation" }),
				);
				continue;
			}
			const operationId = `seed-${seed}-probe-${index}`;
			if (choice === 1) {
				current = await rejectAtomically(
					"probe-stale-reset",
					operationId,
					current,
					await service().featureReset({
						operationId,
						expectedRevision: current.session.causal.revision + 1,
						expectedSnapshotId: current.session.causal.snapshotId,
						featureId: "implementation",
					}),
				);
				continue;
			}
			if (choice === 2) {
				const duplicateValidationRef =
					await publishValidationReceiptForWorkspace(workspace, {
						startedAt: firstRun.startedAt,
						command: `seed-${seed}-duplicate-${index}`,
					});
				current = await rejectAtomically(
					"probe-duplicate-assignment",
					operationId,
					current,
					await service().reviewStart({
						request: {
							operationId,
							expectedRevision: current.session.causal.revision,
							expectedSnapshotId: current.session.causal.snapshotId,
							featureId: "implementation",
							reviewKind: "feature",
							validationScope: "targeted",
							packet: {
								summary: "Reject a duplicate pending assignment.",
								riskLenses: [],
							},
							validationRefs: [duplicateValidationRef],
						},
					}),
				);
				continue;
			}
			current = await rejectAtomically(
				"probe-premature-close",
				operationId,
				current,
				await service().sessionClose({
					request: {
						mode: "start",
						operationId,
						expectedRevision: current.session.causal.revision,
						expectedSnapshotId: current.session.causal.snapshotId,
						kind: "completed",
					},
				}),
			);
		}

		await writeFile(
			sourcePath,
			`export const seed = ${seed};\nexport const changed = true;\n`,
			"utf8",
		);
		const beforeSourceChange = current.bytes;
		current = await activeSnapshot(workspace, reloaded);
		assert.equal(current.bytes, beforeSourceChange);
		cover("source-change");
		trace.push("source-change:external-state-only");

		const staleCompletionOperation = `seed-${seed}-stale-complete`;
		const staleAssignment = assignment(current.session, firstAssignmentId);
		current = await rejectAtomically(
			"source-change-stale-completion",
			staleCompletionOperation,
			current,
			await service().featureComplete({
				request: {
					operationId: staleCompletionOperation,
					expectedRevision: current.session.causal.revision,
					expectedSnapshotId: current.session.causal.snapshotId,
					featureId: "implementation",
					result: {
						kind: "completed",
						summary: "This stale completion must reject.",
						artifactsChanged: [],
						validationScope: "targeted",
						featureReview: passingResult(staleAssignment),
					},
				},
			}),
		);

		const replacementReviewOperation = `seed-${seed}-review-after-source`;
		const replacementValidationRef = await publishValidationReceiptForWorkspace(
			workspace,
			{
				startedAt: firstRun.startedAt,
				command: `seed-${seed}-updated-validation`,
			},
		);
		const replacementReviewResponse = await service().reviewStart({
			request: {
				operationId: replacementReviewOperation,
				expectedRevision: current.session.causal.revision,
				expectedSnapshotId: current.session.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "feature",
				validationScope: "targeted",
				packet: {
					summary: "Review the updated source.",
					riskLenses: ["source invalidation"],
				},
				validationRefs: [replacementValidationRef],
			},
		});
		const replacementAssignmentId = responseAssignmentId(
			replacementReviewResponse,
		);
		current = await acceptMutation(
			"assign-after-source-change",
			current,
			replacementReviewResponse,
		);
		assert.equal(
			assignment(current.session, firstAssignmentId).invalidationReason,
			"source_changed",
		);

		const blockingAssignment = assignment(
			current.session,
			replacementAssignmentId,
		);
		const blockResponse = await service().featureComplete({
			request: {
				operationId: `seed-${seed}-block`,
				expectedRevision: current.session.causal.revision,
				expectedSnapshotId: current.session.causal.snapshotId,
				featureId: "implementation",
				result: {
					kind: "blocked",
					summary: "Seeded review found one blocking defect.",
					review: failingResult(blockingAssignment),
					resolutionHint: "Correct the defect and request a fresh review.",
				},
			},
		});
		current = await acceptMutation("block", current, blockResponse);
		assert.equal(current.session.status, "running");

		const retryRun = current.session.featureRuns.find(
			(run) => run.id === current.session.activeFeatureRunId,
		);
		assert.ok(retryRun);
		const retryValidationRef = await publishValidationReceiptForWorkspace(
			workspace,
			{
				startedAt: retryRun.startedAt,
				command: `seed-${seed}-retry-validation`,
			},
		);
		const retryResponse = await service().reviewStart({
			request: {
				operationId: `seed-${seed}-review-retry`,
				expectedRevision: current.session.causal.revision,
				expectedSnapshotId: current.session.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "feature",
				validationScope: "targeted",
				packet: {
					summary: "Re-review after the seeded blocker.",
					riskLenses: ["review retry"],
				},
				validationRefs: [retryValidationRef],
			},
		});
		const retryAssignmentId = responseAssignmentId(retryResponse);
		current = await acceptMutation("review-retry", current, retryResponse);
		const retryAssignment = assignment(current.session, retryAssignmentId);
		current = await acceptMutation(
			"complete",
			current,
			await service().featureComplete({
				request: {
					operationId: `seed-${seed}-complete-implementation`,
					expectedRevision: current.session.causal.revision,
					expectedSnapshotId: current.session.causal.snapshotId,
					featureId: "implementation",
					result: {
						kind: "completed",
						summary: "Implementation completed after review retry.",
						artifactsChanged: [{ path: "source.ts" }],
						validationScope: "targeted",
						featureReview: passingResult(retryAssignment),
					},
				},
			}),
		);

		current = await acceptMutation(
			"start-finalization",
			current,
			await service().runStart({ featureId: "finalization" }),
		);
		const preResetRun = current.session.featureRuns.find(
			(run) => run.id === current.session.activeFeatureRunId,
		);
		assert.ok(preResetRun);
		const preResetValidationRef = await publishValidationReceiptForWorkspace(
			workspace,
			{
				startedAt: preResetRun.startedAt,
				command: `seed-${seed}-pre-reset`,
			},
		);
		const preResetReview = await service().reviewStart({
			request: {
				operationId: `seed-${seed}-pre-reset-review`,
				expectedRevision: current.session.causal.revision,
				expectedSnapshotId: current.session.causal.snapshotId,
				featureId: "finalization",
				reviewKind: "feature",
				validationScope: "targeted",
				packet: {
					summary: "Create work that reset must invalidate.",
					riskLenses: ["reset isolation"],
				},
				validationRefs: [preResetValidationRef],
			},
		});
		current = await acceptMutation(
			"assign-before-reset",
			current,
			preResetReview,
		);
		current = await acceptMutation(
			"reset",
			current,
			await service().featureReset({
				operationId: `seed-${seed}-reset-finalization`,
				expectedRevision: current.session.causal.revision,
				expectedSnapshotId: current.session.causal.snapshotId,
				featureId: "finalization",
			}),
		);
		current = await acceptMutation(
			"start-after-reset",
			current,
			await service().runStart({ featureId: "finalization" }),
		);
		const finalRun = current.session.featureRuns.find(
			(run) => run.id === current.session.activeFeatureRunId,
		);
		assert.ok(finalRun);
		const finalFeatureValidationRef =
			await publishValidationReceiptForWorkspace(workspace, {
				startedAt: finalRun.startedAt,
				command: `seed-${seed}-final-targeted`,
			});
		const finalFeatureReviewResponse = await service().reviewStart({
			request: {
				operationId: `seed-${seed}-final-feature-review`,
				expectedRevision: current.session.causal.revision,
				expectedSnapshotId: current.session.causal.snapshotId,
				featureId: "finalization",
				reviewKind: "feature",
				validationScope: "targeted",
				packet: {
					summary: "Review the final feature after reset.",
					riskLenses: ["fresh execution epoch"],
				},
				validationRefs: [finalFeatureValidationRef],
			},
		});
		const finalFeatureAssignmentId = responseAssignmentId(
			finalFeatureReviewResponse,
		);
		current = await acceptMutation(
			"assign-final-feature",
			current,
			finalFeatureReviewResponse,
		);
		const finalFeatureAssignment = assignment(
			current.session,
			finalFeatureAssignmentId,
		);
		const featureResult = passingResult(finalFeatureAssignment);
		cover("validate");
		trace.push("validate:prepared:broad-equality");
		const finalValidationRef = await publishValidationReceiptForWorkspace(
			workspace,
			{
				startedAt: featureResult.completedAt,
				command: `seed-${seed}-final-broad`,
				coverageScope: "broad",
			},
		);
		const finalReviewRequest = {
			operationId: `seed-${seed}-final-review`,
			expectedRevision: current.session.causal.revision,
			expectedSnapshotId: current.session.causal.snapshotId,
			featureId: "finalization",
			reviewKind: "final" as const,
			validationScope: "broad" as const,
			featureReview: featureResult,
			packet: {
				summary: "Run final review from the bound feature result.",
				riskLenses: ["durable prerequisite"],
			},
			validationRefs: [finalValidationRef],
		};
		const finalReviewResponse = await service().reviewStart({
			request: finalReviewRequest,
		});
		const finalAssignmentId = responseAssignmentId(finalReviewResponse);
		current = await acceptMutation(
			"final-review",
			current,
			finalReviewResponse,
		);
		const afterFinalReview = current;
		const divergentRetry = await service().reviewStart({
			request: {
				...finalReviewRequest,
				featureReview: {
					...featureResult,
					findings: [
						{
							taxonomy: "advisory",
							subject: "durable prerequisite",
							requirementOrRisk:
								"Exact retry must not replace the accepted bound result.",
							evidenceLocator: "tests/support/lifecycle-repository-sequence.ts",
							summary: "Divergent retry payload.",
							severity: "advisory",
						},
					],
				},
			},
		});
		assertResponseStatus(
			divergentRetry,
			"error",
			"final-review-divergent-retry",
		);
		assertRejectedReceipt(
			divergentRetry,
			finalReviewRequest.operationId,
			afterFinalReview,
		);
		current = await activeSnapshot(workspace, reloaded);
		assert.equal(current.bytes, afterFinalReview.bytes);
		assert.equal(
			current.session.causal.revision,
			afterFinalReview.session.causal.revision,
		);
		trace.push("final-review-divergent-retry:rejected:bytes-unchanged");
		cover("final-retry-mismatch");
		atomicRejectionCount += 1;
		current = await acceptIdempotent(
			"final-review-exact-replay",
			current,
			await service().reviewStart({ request: finalReviewRequest }),
		);
		const finalAssignment = assignment(current.session, finalAssignmentId);
		current = await acceptMutation(
			"complete-final",
			current,
			await service().featureComplete({
				request: {
					operationId: `seed-${seed}-complete-final`,
					expectedRevision: current.session.causal.revision,
					expectedSnapshotId: current.session.causal.snapshotId,
					featureId: "finalization",
					result: {
						kind: "completed",
						summary: "Final feature completed from durable review binding.",
						artifactsChanged: [{ path: "source.ts" }],
						validationScope: "broad",
						finalReview: passingResult(finalAssignment),
					},
				},
			}),
		);
		cover("complete");

		const closeOperationId = `seed-${seed}-close`;
		const beforeClose = current;
		const closeResponse = await service().sessionClose({
			request: {
				mode: "start",
				operationId: closeOperationId,
				expectedRevision: current.session.causal.revision,
				expectedSnapshotId: current.session.causal.snapshotId,
				kind: "completed",
				summary: "Repository lifecycle sequence completed.",
			},
		});
		assertResponseStatus(closeResponse, "ok", "close");
		assert.equal(await repository().read(), null);
		reloaded();
		const archivePath = archivedSessionPath(workspace, beforeClose.session.id);
		const archiveBytes = await readFile(archivePath, "utf8");
		const archivedSession = SessionSchema.parse(JSON.parse(archiveBytes));
		assert.equal(
			archivedSession.causal.revision,
			beforeClose.session.causal.revision + 1,
		);
		assert.equal(validateSessionInvariants(archivedSession), null);
		assert.equal(archivedSession.closure?.retryOperationId, closeOperationId);
		trace.push(
			`close:accepted:r${beforeClose.session.causal.revision}->r${archivedSession.causal.revision}`,
		);
		cover("close");
		acceptedMutationCount += 1;

		const wrongRetry = await service().sessionClose({
			request: {
				mode: "retry",
				operationId: `seed-${seed}-wrong-close-retry`,
			},
		});
		assertResponseStatus(wrongRetry, "missing_session", "wrong-archive-retry");
		assert.equal(await readFile(archivePath, "utf8"), archiveBytes);
		trace.push("wrong-archive-retry:rejected:archive-unchanged");
		atomicRejectionCount += 1;

		for (const action of ["archive-retry", "exact-replay"] as const) {
			const retried = await service().sessionClose({
				request: { mode: "retry", operationId: closeOperationId },
			});
			assertResponseStatus(retried, "ok", action);
			assert.equal(await repository().read(), null);
			reloaded();
			assert.equal(await readFile(archivePath, "utf8"), archiveBytes);
			trace.push(`${action}:idempotent:archive-unchanged`);
			cover(action);
			idempotentAcceptanceCount += 1;
		}

		const replacementResponse = await service().planSave(
			replacementPlanRequest,
		);
		assertResponseStatus(
			replacementResponse,
			"ok",
			"different-goal-after-close",
		);
		const replacement = await activeSnapshot(workspace, reloaded);
		assert.notEqual(replacement.session.id, archivedSession.id);
		assert.equal(replacement.session.goal, replacementPlanRequest.goal);
		trace.push("different-goal-after-close:accepted:new-session");
		cover("explicit-close-replacement");
		acceptedMutationCount += 1;

		for (const requiredAction of REQUIRED_REPOSITORY_SEQUENCE_ACTIONS) {
			assert.ok(
				actionCoverage.has(requiredAction),
				`Lifecycle sequence omitted '${requiredAction}'.`,
			);
		}
		return {
			seed,
			trace,
			actionCoverage: [...actionCoverage].sort(),
			acceptedMutationCount,
			idempotentAcceptanceCount,
			atomicRejectionCount,
			repositoryReloadCount,
			archivedSession,
		};
	} catch (error) {
		throw new Error(
			`Repository lifecycle sequence failed; seed=${seed}; trace=${trace.join(" -> ")}`,
			{ cause: error },
		);
	} finally {
		await rm(workspace, { force: true, recursive: true });
	}
}
