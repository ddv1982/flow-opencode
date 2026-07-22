import { describe, expect, test } from "bun:test";
import { UnreadableFlowSessionError } from "../src/application/errors.js";
import { createFlowService } from "../src/application/flow-service.js";
import type { SessionTransaction } from "../src/application/ports/session-repository.js";
import {
	persistObservedValidation,
	prepareValidation,
} from "../src/application/prepare-validation.js";
import type { Plan, Session } from "../src/domain/session.js";
import {
	activeReview,
	approveSession,
	deterministicEnvironment,
	expectError,
	expectOk,
	FEATURE,
	MemorySessionRepository,
	OUTPUT,
	plan,
	recordObservedValidation,
	resetFeatureRun,
	revision,
	SOURCE_A,
	SOURCE_B,
	startFeatureRun,
	startReviewedRun,
	startSession,
	submitReview,
} from "./runtime-test-support.js";

class CompletionRaceRepository extends MemorySessionRepository {
	private completionReadReleases: Array<() => void> | null = null;
	private transactionTail: Promise<void> = Promise.resolve();
	completionOuterReadCount = 0;

	holdCompletionReadsUntilBothArrive(): void {
		this.completionReadReleases = [];
	}

	override read(): Promise<Session | null> {
		const releases = this.completionReadReleases;
		if (!releases) return super.read();
		const snapshot = this.session;
		this.completionOuterReadCount += 1;
		return new Promise((resolve) => {
			releases.push(() => resolve(snapshot));
			if (releases.length !== 2) return;
			this.completionReadReleases = null;
			for (const release of releases) release();
		});
	}

	override transact<T>(
		task: (transaction: SessionTransaction) => Promise<T>,
	): Promise<T> {
		this.transactionCount += 1;
		const result = this.transactionTail.then(() => task(this.transaction));
		this.transactionTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

describe("Flow application runtime gates", () => {
	test("keeps the active goal visible in the compact projection", async () => {
		const repository = new MemorySessionRepository();
		const flow = await startSession(repository, deterministicEnvironment());

		const status = await flow.status({ request: { view: "compact" } });

		expectOk(status);
		expect(status.workflowData.projection).toMatchObject({
			goal: "Ship the runtime",
		});
	});

	test("projects idle and planning entry actions without status mutation", async () => {
		const repository = new MemorySessionRepository();
		const flow = createFlowService(repository, deterministicEnvironment());

		const idle = await flow.status({ request: { view: "compact" } });
		expectOk(idle);
		expect(idle.workflowData.projection).toEqual({
			view: "compact",
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		});
		expect(repository.saveCount).toBe(0);

		expectOk(
			await flow.planSave({
				request: {
					operationId: "plan-save-entry-routing",
					expectedRevision: 0,
					goal: "Route a draft plan",
					plan,
				},
			}),
		);
		const savesAfterPlan = repository.saveCount;
		const planning = await flow.status({ request: { view: "compact" } });
		expectOk(planning);
		expect(planning.workflowData.projection).toMatchObject({
			view: "compact",
			status: "planning",
			approval: "pending",
			nextAction: "flow_plan_approve",
		});
		expect(repository.saveCount).toBe(savesAfterPlan);
		expect(repository.session?.revision).toBe(1);
	});

	test("requires the exact planned command again after a failed attempt", async () => {
		const repository = new MemorySessionRepository();
		const flow = await startSession(repository, deterministicEnvironment());
		await recordObservedValidation(repository, {
			captureId: "capture-planned-failure",
			exitCode: 1,
		});
		expectOk(
			await flow.featureReset({
				request: {
					operationId: "reset-planned-failure",
					expectedRevision: revision(repository),
					featureId: FEATURE,
				},
			}),
		);
		expectOk(
			await flow.runStart({
				request: {
					operationId: "run-start-after-planned-failure",
					expectedRevision: revision(repository),
					featureId: FEATURE,
				},
			}),
		);
		await recordObservedValidation(repository, {
			captureId: "capture-broad-substitute",
			command: "bun test tests/runtime-gates.test.ts",
		});

		const substituteStatus = await flow.status({
			request: { view: "compact" },
		});
		expectOk(substituteStatus);
		expect(substituteStatus.workflowData.projection).toMatchObject({
			nextAction: "flow_validation_start",
		});

		await recordObservedValidation(repository, {
			captureId: "capture-planned-retry",
		});
		const plannedStatus = await flow.status({
			request: { view: "compact" },
		});
		expectOk(plannedStatus);
		expect(plannedStatus.workflowData.projection).toMatchObject({
			nextAction: "flow_review_start",
		});
	});

	test("projects only actual failed reviews in the blocked convergence summary", async () => {
		const repository = new MemorySessionRepository();
		const flow = await startSession(repository, deterministicEnvironment());
		await resetFeatureRun(flow, repository, FEATURE, "before-review");
		await startReviewedRun(flow, repository, {
			suffix: "failed-review-2",
			artifacts: ["src/failed-review-2.ts"],
		});
		await submitReview(flow, repository, {
			suffix: "failed-review-2",
			summary: "Attempt 2 remains blocked.",
			verdict: "failed",
			findings: [
				{
					severity: "blocking",
					summary: "Shared contract is still incomplete.",
					evidence: "src/failed-review-2.ts:1",
				},
				{
					severity: "blocking",
					summary: "Legacy branch still returns stale data.",
					evidence: "src/failed-review-2.ts:2",
				},
			],
		});
		const firstFailure = await flow.status({ request: { view: "compact" } });
		expectOk(firstFailure);
		expect(firstFailure.workflowData.projection).toMatchObject({
			status: "blocked",
			nextAction: "flow_feature_reset",
			blockedFeature: {
				featureId: FEATURE,
				attempt: 2,
				failedReviewCount: 1,
			},
		});

		await resetFeatureRun(flow, repository, FEATURE, "failed-review-2");
		await startReviewedRun(flow, repository, {
			suffix: "failed-review-3",
			artifacts: ["src/failed-review-3.ts"],
		});
		await submitReview(flow, repository, {
			suffix: "failed-review-3",
			summary: "Attempt 3 remains blocked.",
			verdict: "failed",
			findings: [
				{
					severity: "blocking",
					summary: "Shared contract is still incomplete.",
					evidence: "src/failed-review-3.ts:1",
				},
				{
					severity: "blocking",
					summary: "New edge case drops recovery evidence.",
					evidence: "src/failed-review-3.ts:2",
				},
			],
			terminalDisposition: "observed_unsubmitted",
		});
		const secondFailure = await flow.status({ request: { view: "compact" } });
		expectOk(secondFailure);
		expect(secondFailure.workflowData.projection).toMatchObject({
			status: "blocked",
			nextAction: "await-user-direction",
			blockedFeature: {
				featureId: FEATURE,
				attempt: 3,
				failedReviewCount: 2,
			},
		});

		const revisionBeforeDetail = repository.session?.revision;
		const savesBeforeDetail = repository.saveCount;
		const detail = await flow.status({ request: { view: "detail" } });
		expectOk(detail);
		const projection = detail.workflowData.projection;
		if (!("runs" in projection)) {
			throw new Error("Expected a detail projection.");
		}
		expect(projection).toMatchObject({
			view: "detail",
			nextAction: "await-user-direction",
			blockedFeature: {
				featureId: FEATURE,
				attempt: 3,
				failedReviewCount: 2,
			},
		});
		expect(projection.runs.slice(-2)).toMatchObject([
			{
				attempt: 2,
				artifactsChanged: [{ path: "src/failed-review-2.ts" }],
				validations: [{ id: "capture-failed-review-2" }],
				reviews: [
					{
						result: {
							findings: [
								{ summary: "Shared contract is still incomplete." },
								{ summary: "Legacy branch still returns stale data." },
							],
						},
					},
				],
			},
			{
				attempt: 3,
				artifactsChanged: [{ path: "src/failed-review-3.ts" }],
				validations: [{ id: "capture-failed-review-3" }],
				reviews: [
					{
						result: {
							findings: [
								{ summary: "Shared contract is still incomplete." },
								{ summary: "New edge case drops recovery evidence." },
							],
						},
					},
				],
			},
		]);
		expect(repository.session?.revision).toBe(revisionBeforeDetail);
		expect(repository.saveCount).toBe(savesBeforeDetail);
	});

	test("does not quarantine state repaired before the transaction lock", async () => {
		const repository = new MemorySessionRepository();
		const flow = createFlowService(repository, deterministicEnvironment());
		const saved = await flow.planSave({
			request: {
				operationId: "plan-save-before-repair",
				expectedRevision: 0,
				goal: "Preserve repaired state",
				plan,
			},
		});
		expectOk(saved);
		const repaired = repository.session;
		repository.readFailure = new UnreadableFlowSessionError(
			"Initial state was malformed.",
			"invalid JSON",
		);

		const status = await flow.status({ request: { view: "compact" } });

		expectError(status);
		expect(status.workflowData.failure).toMatchObject({
			recovery: expect.stringContaining("current state was left untouched"),
		});
		expect(repository.quarantineCount).toBe(0);
		expect(repository.session).toBe(repaired);
	});

	test("returns exact operation replays while rejecting conflicts and stale revisions", async () => {
		const repository = new MemorySessionRepository();
		const flow = createFlowService(repository, deterministicEnvironment());
		const input = {
			request: {
				operationId: "plan-save-exact",
				expectedRevision: 0,
				goal: "Ship the runtime",
				plan,
			},
		} as const;

		const first = await flow.planSave(input);
		const replay = await flow.planSave(input);
		expectOk(first);
		expectOk(replay);
		expect(replay.workflowData.operation).toMatchObject({
			operationId: "plan-save-exact",
			revision: 1,
			replayed: true,
		});
		expect(repository.session?.operations).toHaveLength(1);

		const conflict = await flow.planSave({
			request: { ...input.request, goal: "Different work" },
		});
		expectError(conflict);
		expect(conflict.summary).toContain(
			"operationId was already used for different work",
		);
		expect(conflict).not.toHaveProperty("operationAccepted");
		expect(conflict).not.toHaveProperty("operationIdConsumed");
		const status = await flow.status({ request: { view: "compact" } });
		expect(status).not.toHaveProperty("operationAccepted");
		expect(status).not.toHaveProperty("operationIdConsumed");

		const stale = await flow.planApprove({
			request: {
				operationId: "stale-approval",
				expectedRevision: 0,
			},
		});
		expectError(stale);
		expect(stale.summary).toContain("Stale revision 0");
		expect(repository.session?.revision).toBe(1);
	});

	test("replays an exact feature completion that loses the serialized transaction race", async () => {
		const repository = new CompletionRaceRepository();
		const flow = await startSession(repository, deterministicEnvironment());
		const prepared = await prepareValidation(repository, {
			expectedRevision: revision(repository),
			featureId: FEATURE,
			command: "bun test",
			scope: "broad",
		});
		await persistObservedValidation(repository, {
			...prepared,
			captureId: "capture-completion-race",
			exitCode: 0,
			outputDigest: OUTPUT,
			outputComplete: true,
		});
		expectOk(
			await flow.reviewStart({
				request: {
					operationId: "review-start-completion-race",
					expectedRevision: revision(repository),
					featureId: FEATURE,
					artifactsChanged: [{ path: "src/application/flow-service.ts" }],
					packet: {
						summary: "Review concurrent completion replay.",
						riskLenses: ["transaction serialization"],
					},
				},
			}),
		);
		const assignment = activeReview(repository);
		const completeRequest = {
			request: {
				operationId: "complete-runtime-concurrently",
				expectedRevision: revision(repository),
				featureId: FEATURE,
				assignmentId: assignment.id,
				summary: "Runtime completed exactly once.",
				result: {
					verdict: "passed",
					findings: [],
					terminalDisposition: "submitted",
				},
			},
		} as const;
		const revisionBeforeCompletion = revision(repository);
		const setupSaveCount = repository.saveCount;
		expect(setupSaveCount).toBe(5);
		repository.holdCompletionReadsUntilBothArrive();

		const firstCompletion = flow.featureComplete(completeRequest);
		const secondCompletion = flow.featureComplete(completeRequest);
		const responses = await Promise.all([firstCompletion, secondCompletion]);

		const replayFlags = responses
			.map((response) => {
				expectOk(response);
				return response.workflowData.operation.replayed;
			})
			.sort((left, right) => Number(left) - Number(right));
		expect(replayFlags).toEqual([false, true]);
		expect(repository.completionOuterReadCount).toBe(2);
		expect(revision(repository)).toBe(revisionBeforeCompletion + 1);
		expect(repository.saveCount).toBe(setupSaveCount + 1);
		expect(
			repository.session?.operations.filter(
				(operation) => operation.kind === "feature-complete",
			),
		).toEqual([
			expect.objectContaining({ id: "complete-runtime-concurrently" }),
		]);
	});

	test("projects the full approved plan and all applicable validation to a final reviewer", async () => {
		const foundation = "runtime-foundation";
		const runtimeFeature = plan.features[0];
		if (!runtimeFeature)
			throw new Error("Expected the runtime feature fixture.");
		const multiFeaturePlan: Plan = {
			...plan,
			summary: "Build the runtime in two features.",
			features: [
				{
					id: foundation,
					title: "Runtime foundation",
					summary: "Prepare the runtime foundation.",
					targets: ["src/domain"],
					validation: ["bun test tests/domain-transitions.test.ts"],
					dependsOn: [],
				},
				{
					...runtimeFeature,
					dependsOn: [foundation],
				},
			],
		};
		const repository = new MemorySessionRepository();
		const flow = await approveSession(repository, deterministicEnvironment(), {
			goal: "Ship the multi-feature runtime",
			plan: multiFeaturePlan,
			suffix: "multi-feature",
		});
		await startReviewedRun(flow, repository, {
			featureId: foundation,
			suffix: "foundation",
			command: "bun test capture-foundation",
			artifacts: ["src/domain/foundation.ts"],
		});
		await submitReview(flow, repository, {
			featureId: foundation,
			suffix: "foundation",
			summary: "Runtime foundation completed.",
			verdict: "passed",
		});

		await startFeatureRun(flow, repository, FEATURE, "final-runtime");
		const assignedFocused = await recordObservedValidation(repository, {
			captureId: "capture-final-focused",
			command: "bun test capture-final-focused",
			scope: "focused",
		});
		const assignedBroad = await recordObservedValidation(repository, {
			captureId: "capture-final-broad",
			command: "bun test capture-final-broad",
			scope: "broad",
		});
		const review = await flow.reviewStart({
			request: {
				operationId: "review-start-final-runtime",
				expectedRevision: revision(repository),
				featureId: FEATURE,
				artifactsChanged: [{ path: "src/application/flow-service.ts" }],
				packet: {
					summary: "Review the full runtime delivery.",
					riskLenses: ["projection completeness"],
				},
			},
		});
		expectOk(review);
		expect(review.workflowData.projection).toMatchObject({
			planContext: {
				summary: multiFeaturePlan.summary,
				overview: multiFeaturePlan.overview,
				requirements: multiFeaturePlan.requirements,
				decisions: multiFeaturePlan.decisions,
				features: multiFeaturePlan.features,
			},
			feature: multiFeaturePlan.features[1],
			assignment: {
				kind: "final",
				validationIds: [assignedFocused.id, assignedBroad.id],
			},
			validations: [assignedFocused, assignedBroad],
			completedFeatureIds: [foundation],
		});
	});

	test("persists validation in the active run and binds completion to reviewed workspace content", async () => {
		const repository = new MemorySessionRepository();
		const environment = deterministicEnvironment();
		const flow = await startSession(repository, environment);
		const prepared = await prepareValidation(repository, {
			expectedRevision: revision(repository),
			featureId: FEATURE,
			command: "bun test",
			scope: "broad",
		});

		expect(prepared).toEqual({
			featureId: FEATURE,
			runId: "run-1",
			command: "bun test",
			scope: "broad",
			sourceDigest: SOURCE_A,
		});
		const observedInput = {
			...prepared,
			captureId: "capture-1",
			exitCode: 0,
			outputDigest: OUTPUT,
			outputComplete: true,
		} as const;
		const failedObservation = await persistObservedValidation(repository, {
			...observedInput,
			captureId: "capture-failed",
			exitCode: 1,
		});
		const observation = await persistObservedValidation(
			repository,
			observedInput,
		);
		expect(observation).toMatchObject({
			id: "capture-1",
			runId: "run-1",
			recordedRevision: 5,
		});
		expect(repository.session?.runs[0]?.validations).toEqual([
			failedObservation,
			observation,
		]);
		expect(await persistObservedValidation(repository, observedInput)).toEqual(
			observation,
		);
		await expect(
			persistObservedValidation(repository, {
				...observedInput,
				exitCode: 1,
			}),
		).rejects.toThrow(
			"Validation capture id was already used for a different observation",
		);

		const reviewRequest = {
			request: {
				operationId: "review-start-runtime",
				expectedRevision: revision(repository),
				featureId: FEATURE,
				artifactsChanged: [{ path: "src/domain/transitions.ts" }],
				packet: {
					summary: "Review the complete runtime.",
					riskLenses: ["state integrity"],
				},
			},
		} as const;
		const reviewResponse = await flow.reviewStart(reviewRequest);
		expectOk(reviewResponse);
		expect(reviewResponse.workflowData.projection).toMatchObject({
			planContext: {
				summary: plan.summary,
				overview: plan.overview,
				requirements: plan.requirements,
				decisions: plan.decisions,
				features: [
					{
						id: FEATURE,
						title: plan.features[0]?.title,
						summary: plan.features[0]?.summary,
						targets: ["src"],
						validation: ["bun test"],
						dependsOn: [],
					},
				],
			},
			feature: plan.features[0],
			artifactsChanged: [{ path: "src/domain/transitions.ts" }],
			validations: [observation],
			completedFeatureIds: [],
		});
		expect(reviewResponse.workflowData.projection).not.toHaveProperty("plan");
		expect(reviewResponse.workflowData.projection).not.toHaveProperty(
			"completedOutcomes",
		);
		const assignment = activeReview(repository);
		expect(assignment).toMatchObject({
			id: "review-1",
			kind: "final",
			sourceDigest: SOURCE_A,
			validationIds: ["capture-1"],
		});
		await expect(
			prepareValidation(repository, {
				expectedRevision: revision(repository),
				featureId: FEATURE,
				command: "bun test",
				scope: "broad",
			}),
		).rejects.toThrow("after review has begun");
		await expect(
			persistObservedValidation(repository, {
				...observedInput,
				captureId: "capture-after-review",
			}),
		).rejects.toThrow("after review has begun");

		const prematureClose = await flow.sessionClose({
			request: {
				operationId: "close-premature",
				expectedRevision: revision(repository),
				sessionId: repository.session?.id,
				kind: "completed",
				summary: "Not complete yet.",
			},
		});
		expectError(prematureClose);
		expect(prematureClose.summary).toContain(
			"requires every planned feature to pass review",
		);

		repository.sourceDigest = SOURCE_B;
		const replayedReview = await flow.reviewStart(reviewRequest);
		expectOk(replayedReview);
		expect(replayedReview.workflowData.operation).toMatchObject({
			operationId: "review-start-runtime",
			replayed: true,
		});

		const completeRequest = {
			request: {
				operationId: "complete-runtime",
				expectedRevision: revision(repository),
				featureId: FEATURE,
				assignmentId: assignment.id,
				summary: "Runtime complete.",
				result: {
					verdict: "passed",
					findings: [],
					terminalDisposition: "submitted",
				},
			},
		} as const;
		const changedSource = await flow.featureComplete(completeRequest);
		expectError(changedSource);
		expect(changedSource.summary).toContain(
			"Workspace content changed after review started",
		);
		expect(changedSource.workflowData.failure).toMatchObject({
			recovery: expect.stringMatching(
				/flow_feature_reset[\s\S]+Do not redispatch/i,
			),
		});
		expect(repository.session?.revision).toBe(6);
		expect(activeReview(repository).result).toBeNull();
		const pendingRunId = assignment.runId;
		const pendingRevision = repository.session?.revision;
		const savesBeforeRecoveryStatus = repository.saveCount;
		repository.sourceDigestFailure = new Error(
			"Workspace fingerprint is unavailable.",
		);
		const unavailablePendingStatus = await flow.status({
			request: { view: "compact" },
		});
		expectError(unavailablePendingStatus);
		expect(unavailablePendingStatus.workflowData.failure).toMatchObject({
			recovery: expect.stringMatching(
				/Repair workspace fingerprinting[\s\S]+Do not redispatch/i,
			),
		});
		repository.sourceDigestFailure = null;
		const stalePendingStatus = await flow.status({
			request: { view: "compact" },
		});
		expectOk(stalePendingStatus);
		expect(stalePendingStatus.workflowData.projection).toMatchObject({
			status: "running",
			activeRunId: pendingRunId,
			nextAction: "flow_feature_reset",
		});
		expect(repository.session?.revision).toBe(pendingRevision);
		expect(repository.saveCount).toBe(savesBeforeRecoveryStatus);

		repository.sourceDigest = SOURCE_A;
		const currentPendingStatus = await flow.status({
			request: { view: "compact" },
		});
		expectOk(currentPendingStatus);
		expect(currentPendingStatus.workflowData.projection).toMatchObject({
			status: "running",
			activeRunId: pendingRunId,
			nextAction: "dispatch-flow-reviewer",
		});
		expect(repository.session?.revision).toBe(pendingRevision);
		expect(repository.saveCount).toBe(savesBeforeRecoveryStatus);
		const executionStatus = await flow.status({
			request: { view: "execution" },
		});
		expectOk(executionStatus);
		const executionProjection = executionStatus.workflowData.projection;
		if (!("run" in executionProjection)) {
			throw new Error("Expected an execution projection.");
		}
		expect(executionProjection.run).toMatchObject({
			id: pendingRunId,
			reviews: [{ id: assignment.id, result: null }],
		});
		expect(repository.session?.revision).toBe(pendingRevision);
		expect(repository.saveCount).toBe(savesBeforeRecoveryStatus);
		const completed = await flow.featureComplete(completeRequest);
		expectOk(completed);
		expect(repository.session?.runs[0]?.state).toBe("completed");
		const staleReviewer = await flow.status({
			request: { view: "reviewer", assignmentId: assignment.id },
		});
		expectError(staleReviewer);
		expect(staleReviewer.summary).toContain("no longer pending");
		const replayedRun = await flow.runStart({
			request: {
				operationId: "run-start-runtime",
				expectedRevision: 2,
				featureId: FEATURE,
			},
		});
		expectOk(replayedRun);
		expect(replayedRun.workflowData.operation).toMatchObject({
			replayed: true,
			entity: { id: "run-1", state: "completed" },
		});
		repository.sourceDigest = SOURCE_B;
		const savesBeforeReplay = repository.saveCount;
		const transactionsBeforeReplay = repository.transactionCount;
		const replayedCompletion = await flow.featureComplete(completeRequest);
		expectOk(replayedCompletion);
		expect(replayedCompletion.workflowData.operation).toMatchObject({
			operationId: "complete-runtime",
			replayed: true,
		});
		expect(repository.saveCount).toBe(savesBeforeReplay);
		expect(repository.transactionCount).toBe(transactionsBeforeReplay);
		const readOnlyReplay = await flow.featureCompleteReplay(completeRequest);
		expectOk(readOnlyReplay);
		expect(readOnlyReplay.workflowData.operation).toMatchObject({
			operationId: "complete-runtime",
			replayed: true,
		});
		expect(repository.saveCount).toBe(savesBeforeReplay);
		expect(repository.transactionCount).toBe(transactionsBeforeReplay);

		const sessionId = repository.session?.id;
		if (!sessionId) throw new Error("Expected a session id.");
		const closeRequest = {
			request: {
				operationId: "close-runtime",
				expectedRevision: revision(repository),
				sessionId,
				kind: "completed" as const,
				summary: "Runtime shipped.",
			},
		};
		repository.archiveFailure = new Error("injected archive interruption");
		const interruptedClose = await flow.sessionClose(closeRequest);
		expectError(interruptedClose);
		expect(interruptedClose.summary).toContain("durably accepted");
		expect(interruptedClose.workflowData).toMatchObject({
			operation: { operationId: "close-runtime", replayed: false },
			closeState: {
				durableAccepted: true,
				archiveConfirmed: false,
				retryExactRequest: true,
				retryRequest: closeRequest.request,
			},
			failure: {
				summary: "injected archive interruption",
				recovery: expect.stringContaining("same operation ID and payload"),
			},
		});
		expect(repository.session?.closure?.kind).toBe("completed");
		expect(
			repository.session?.operations.some(
				(operation) => operation.id === "close-runtime",
			),
		).toBe(true);

		const retryStatus = await flow.status({ request: { view: "compact" } });
		expectOk(retryStatus);
		expect(retryStatus.workflowData.projection).toMatchObject({
			status: "closed",
			nextAction: "flow_session_close",
			archiveRetry: closeRequest,
		});

		repository.archiveFailure = null;
		const retryProjection = retryStatus.workflowData.projection;
		if (!("archiveRetry" in retryProjection) || !retryProjection.archiveRetry) {
			throw new Error("Expected an exact projected archive retry.");
		}
		const projectedRetry = retryProjection.archiveRetry;
		const closed = await flow.sessionClose(projectedRetry);
		expectOk(closed);
		expect(closed.workflowData.projection).toMatchObject({
			archived: true,
			nextAction: null,
			archiveRetry: null,
		});
		expect(repository.session).toBeNull();
		expect(repository.archives.get(sessionId)?.closure?.kind).toBe("completed");

		const archivedSession = repository.archives.get(sessionId);
		if (!archivedSession?.closure)
			throw new Error("Expected archived closure.");
		repository.session = {
			...archivedSession,
			closure: {
				...archivedSession.closure,
				operationId: archivedSession.operations[0]?.id ?? "missing-operation",
			},
		};
		const malformedCloseStatus = await flow.status({
			request: { view: "compact" },
		});
		expectError(malformedCloseStatus);
		expect(malformedCloseStatus.summary).toContain(
			"not bound to a valid close operation",
		);
		repository.session = null;
	});
});
