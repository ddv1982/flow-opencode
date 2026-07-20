import { describe, expect, test } from "bun:test";
import { UnreadableFlowSessionError } from "../src/application/errors.js";
import {
	createFlowService,
	type FlowResponse,
	type FlowService,
} from "../src/application/flow-service.js";
import type {
	SessionRepository,
	SessionTransaction,
} from "../src/application/ports/session-repository.js";
import {
	persistObservedValidation,
	prepareValidation,
} from "../src/application/prepare-validation.js";
import type {
	Plan,
	ReviewAssignment,
	Session,
	SourceDigest,
} from "../src/domain/session.js";
import type { TransitionEnvironment } from "../src/domain/transitions.js";

const FEATURE = "runtime-kernel";
const SOURCE_A = `sha256:${"a".repeat(64)}` as SourceDigest;
const SOURCE_B = `sha256:${"b".repeat(64)}` as SourceDigest;
const OUTPUT = `sha256:${"c".repeat(64)}` as SourceDigest;

const plan: Plan = {
	summary: "Implement the runtime kernel.",
	overview: "Exercise the public application boundary.",
	requirements: ["Persist validation directly in Session v5."],
	decisions: ["Use a single final review for the final feature."],
	features: [
		{
			id: FEATURE,
			title: "Runtime kernel",
			summary: "Implement and verify the kernel.",
			targets: ["src"],
			validation: ["bun test"],
			dependsOn: [],
		},
	],
};

class MemorySessionRepository implements SessionRepository {
	session: Session | null = null;
	sourceDigest = SOURCE_A;
	archiveFailure: Error | null = null;
	readFailure: Error | null = null;
	quarantineCount = 0;
	readonly archives = new Map<string, Session>();

	readonly transaction: SessionTransaction = {
		load: () => Promise.resolve(this.session),
		loadArchive: (sessionId) =>
			Promise.resolve(this.archives.get(sessionId) ?? null),
		save: (session) => {
			this.session = session;
			return Promise.resolve(session);
		},
		archiveAndClear: (session) => {
			if (this.archiveFailure) return Promise.reject(this.archiveFailure);
			this.archives.set(session.id, session);
			this.session = null;
			return Promise.resolve();
		},
		quarantineUnreadable: () => {
			this.quarantineCount += 1;
			this.session = null;
			return Promise.resolve("memory://quarantined-session");
		},
		computeSourceDigest: () => Promise.resolve(this.sourceDigest),
	};

	read(): Promise<Session | null> {
		if (this.readFailure) return Promise.reject(this.readFailure);
		return Promise.resolve(this.session);
	}

	transact<T>(
		task: (transaction: SessionTransaction) => Promise<T>,
	): Promise<T> {
		return task(this.transaction);
	}
}

function deterministicEnvironment(): TransitionEnvironment {
	const sequences = new Map<string, number>();
	return {
		newId(kind) {
			const next = (sequences.get(kind) ?? 0) + 1;
			sequences.set(kind, next);
			return `${kind}-${next}`;
		},
	};
}

function revision(repository: MemorySessionRepository): number {
	if (!repository.session) throw new Error("Expected an active session.");
	return repository.session.revision;
}

function activeReview(repository: MemorySessionRepository): ReviewAssignment {
	const review = repository.session?.runs
		.find((run) => run.state === "active")
		?.reviews.at(-1);
	if (!review) throw new Error("Expected a review assignment.");
	return review;
}

function expectOk(response: FlowResponse): void {
	expect(response.status).toBe("ok");
	if (response.status !== "ok") throw new Error(response.summary);
}

async function startSession(
	repository: MemorySessionRepository,
	environment: TransitionEnvironment,
): Promise<FlowService> {
	const flow = createFlowService(repository, environment);
	const saved = await flow.planSave({
		request: {
			operationId: "plan-save-runtime",
			expectedRevision: 0,
			goal: "Ship the runtime",
			plan,
		},
	});
	expectOk(saved);
	const approved = await flow.planApprove({
		request: {
			operationId: "plan-approve-runtime",
			expectedRevision: revision(repository),
		},
	});
	expectOk(approved);
	const started = await flow.runStart({
		request: {
			operationId: "run-start-runtime",
			expectedRevision: revision(repository),
			featureId: FEATURE,
		},
	});
	expectOk(started);
	return flow;
}

describe("Flow application runtime gates", () => {
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

		expect(status.status).toBe("error");
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
		expect(conflict.status).toBe("error");
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
		expect(stale.status).toBe("error");
		expect(stale.summary).toContain("Stale revision 0");
		expect(repository.session?.revision).toBe(1);
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
		const observation = await persistObservedValidation(
			repository,
			observedInput,
		);
		expect(observation).toMatchObject({
			id: "capture-1",
			runId: "run-1",
			recordedRevision: 4,
		});
		expect(repository.session?.runs[0]?.validations).toEqual([observation]);
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
		expect(prematureClose.status).toBe("error");
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
		expect(changedSource.status).toBe("error");
		expect(changedSource.summary).toContain(
			"Workspace content changed after review started",
		);
		expect(repository.session?.revision).toBe(5);
		expect(activeReview(repository).result).toBeNull();

		repository.sourceDigest = SOURCE_A;
		const completed = await flow.featureComplete(completeRequest);
		expectOk(completed);
		expect(repository.session?.runs[0]?.state).toBe("completed");
		const staleReviewer = await flow.status({
			request: { view: "reviewer", assignmentId: assignment.id },
		});
		expect(staleReviewer.status).toBe("error");
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
		const replayedCompletion = await flow.featureComplete(completeRequest);
		expectOk(replayedCompletion);
		expect(replayedCompletion.workflowData.operation).toMatchObject({
			operationId: "complete-runtime",
			replayed: true,
		});

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
		expect(interruptedClose.status).toBe("error");
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
		const projectedRetry = (
			retryStatus.workflowData.projection as {
				archiveRetry: { request: typeof closeRequest.request };
			}
		).archiveRetry;
		const closed = await flow.sessionClose(projectedRetry);
		expectOk(closed);
		expect(closed.workflowData.projection).toMatchObject({
			archived: true,
			nextAction: null,
			archiveRetry: null,
		});
		expect(repository.session).toBeNull();
		expect(repository.archives.get(sessionId)?.closure?.kind).toBe("completed");

		const replayedClose = await flow.sessionClose(closeRequest);
		expectOk(replayedClose);
		expect(replayedClose.workflowData.operation).toMatchObject({
			operationId: "close-runtime",
			replayed: true,
		});
		expect(replayedClose.workflowData.projection).toMatchObject({
			archived: true,
			nextAction: null,
			archiveRetry: null,
		});
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
		expect(malformedCloseStatus.status).toBe("error");
		expect(malformedCloseStatus.summary).toContain(
			"not bound to a valid close operation",
		);
		repository.session = null;

		const nextPlan = await flow.planSave({
			request: {
				operationId: "plan-save-next-session",
				expectedRevision: 0,
				goal: "Ship the next runtime",
				plan,
			},
		});
		expectOk(nextPlan);
		const nextSession = await repository.read();
		if (!nextSession) throw new Error("Expected the next active session.");
		expect(nextSession.id).not.toBe(sessionId);

		const delayedCloseReplay = await flow.sessionClose(closeRequest);
		expectOk(delayedCloseReplay);
		expect(delayedCloseReplay.workflowData.operation).toMatchObject({
			operationId: "close-runtime",
			replayed: true,
		});
		expect(await repository.read()).toBe(nextSession);
	});
});
