import { operationInputDigest } from "../domain/operation.js";
import type {
	RequestAuthority,
	RequestEvidenceAnchor,
} from "../domain/request-evidence.js";
import type { FeatureRun, Session } from "../domain/session.js";
import { featureKind } from "../domain/session.js";
import { activeRun } from "../domain/session-queries.js";
import {
	anchorRequest,
	approvePlan,
	completeFeature,
	resetFeature,
	savePlan,
	startReview,
	startRun,
	type TransitionEnvironment,
} from "../domain/transitions.js";
import { UnreadableFlowSessionError } from "./errors.js";
import {
	errorResponse,
	type FlowResponse,
	type OperationResult,
	ok,
	operationResult,
} from "./flow-response.js";
import type {
	SessionRepository,
	SessionTransaction,
} from "./ports/session-repository.js";
import {
	FeatureCompleteInputSchema,
	type FeatureCompleteRequest,
	FeatureResetInputSchema,
	PlanApproveInputSchema,
	PlanSaveInputSchema,
	ReviewStartInputSchema,
	RunStartInputSchema,
	SessionCloseInputSchema,
	StatusInputSchema,
	type StatusRequest,
} from "./schema.js";
import {
	type ArchiveCollisionStatusResponse,
	type CloseSessionResponse,
	closedArchiveCollisionStatus,
	closeSessionTransaction,
} from "./session-close.js";
import {
	type ActiveSessionProjection,
	activePendingReview,
	type CompactProjection,
	compactProjection,
	type ExecutionProjection,
	executionProjection,
	idleProjection,
	project,
	type ReviewerProjection,
	reviewerProjection,
	type StatusProjection,
} from "./session-projection.js";

export type { FlowResponse } from "./flow-response.js";

type StatusWorkflowData = Readonly<{ projection: StatusProjection }>;
type StatusResponse =
	| FlowResponse<StatusWorkflowData>
	| ArchiveCollisionStatusResponse;
type MutationWorkflowData<P extends ActiveSessionProjection> = Readonly<{
	operation: OperationResult;
	projection: P;
}>;

type CompactMutationResponse = FlowResponse<
	MutationWorkflowData<CompactProjection>
>;

export type FlowService = Readonly<{
	status(input: unknown): Promise<StatusResponse>;
	requestAnchor(input: {
		goal: string;
		evidence: RequestEvidenceAnchor;
	}): Promise<void>;
	planSave(
		input: unknown,
		authority?: RequestAuthority,
	): Promise<CompactMutationResponse>;
	planApprove(
		input: unknown,
		authority?: RequestAuthority,
	): Promise<CompactMutationResponse>;
	runStart(
		input: unknown,
	): Promise<FlowResponse<MutationWorkflowData<ExecutionProjection>>>;
	reviewStart(
		input: unknown,
	): Promise<
		FlowResponse<MutationWorkflowData<ReviewerProjection | CompactProjection>>
	>;
	featureComplete(input: unknown): Promise<CompactMutationResponse>;
	featureCompleteReplay(input: unknown): Promise<CompactMutationResponse>;
	featureReset(input: unknown): Promise<CompactMutationResponse>;
	sessionClose(input: unknown): Promise<CloseSessionResponse>;
}>;

function featureCompleteResponse(
	session: Session,
	request: FeatureCompleteRequest,
	run: FeatureRun,
	replayed: boolean,
): CompactMutationResponse {
	const feature = session.plan?.features.find(
		(item) => item.id === run.featureId,
	);
	const summary =
		run.state === "completed"
			? featureKind(feature) === "inspect"
				? request.result.verdict === "failed"
					? "Inspection completed with blocking findings."
					: "Inspection completed."
				: "Feature completed."
			: "Feature blocked by review.";
	return ok(summary, {
		operation: operationResult(session, request.operationId, replayed, run),
		projection: compactProjection(session),
	});
}

function exactFeatureCompleteReplay(
	session: Session,
	request: FeatureCompleteRequest,
): Readonly<{ session: Session; run: FeatureRun }> | null {
	const priorOperation = session.operations.find(
		(operation) => operation.id === request.operationId,
	);
	if (
		priorOperation?.kind !== "feature-complete" ||
		priorOperation.inputDigest !== operationInputDigest(request)
	) {
		return null;
	}
	const result = completeFeature(session, request);
	if (!result.replayed) {
		throw new Error("Expected an exact feature-completion replay.");
	}
	return { session: result.session, run: result.value };
}

type Loaded = Readonly<{ session: Session; transaction: SessionTransaction }>;

/**
 * The shared spine of every guarded mutation: parse, lock, load, transition,
 * save, project. Anything not on that path stays in the caller.
 */
async function mutate<
	Request,
	Value,
	Projection extends ActiveSessionProjection,
>(
	repository: SessionRepository,
	schema: { parse(input: unknown): { request: Request } },
	input: unknown,
	step: (
		loaded: Loaded,
		request: Request,
	) => Promise<Readonly<{ session: Session; value: Value; replayed: boolean }>>,
	respond: (
		result: Readonly<{ session: Session; value: Value; replayed: boolean }>,
		request: Request,
	) => Readonly<{ summary: string; projection: Projection }>,
	operationId: (request: Request) => string,
): Promise<FlowResponse<MutationWorkflowData<Projection>>> {
	try {
		const request = schema.parse(input).request;
		return await repository.transact(async (transaction) => {
			const session = await transaction.load();
			if (!session) throw new Error("No active Flow session exists.");
			const result = await step({ session, transaction }, request);
			await transaction.save(result.session);
			const shaped = respond(result, request);
			return ok(shaped.summary, {
				operation: operationResult(
					result.session,
					operationId(request),
					result.replayed,
					// `approvePlan` yields `null`; the old code passed nothing, and
					// `operationResult` only omits `entity` for `undefined`.
					result.value === null ? undefined : result.value,
				),
				projection: shaped.projection,
			});
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export function createFlowService(
	repository: SessionRepository,
	environment: TransitionEnvironment,
): FlowService {
	return {
		async requestAnchor(input) {
			await repository.transact(async (transaction) => {
				const current = await transaction.load();
				const anchored = anchorRequest(current, input, environment);
				if (anchored !== current) await transaction.save(anchored);
			});
		},
		async status(input) {
			let request: StatusRequest;
			try {
				request = StatusInputSchema.parse(input).request;
			} catch (error) {
				return errorResponse(error);
			}
			try {
				const session = await repository.read();
				if (!session) {
					return ok("No active Flow session.", {
						projection: idleProjection(request.view),
					});
				}
				if (
					request.view !== "reviewer" &&
					(activePendingReview(session) || session.closure)
				) {
					return await repository.transact(async (transaction) => {
						const current = await transaction.load();
						if (!current) {
							return ok("No active Flow session.", {
								projection: idleProjection(request.view),
							});
						}
						const collisionResponse = await closedArchiveCollisionStatus(
							transaction,
							current,
							request,
						);
						if (collisionResponse) return collisionResponse;
						const pending = activePendingReview(current);
						let pendingReviewSourceStale = false;
						if (pending) {
							try {
								pendingReviewSourceStale =
									(await transaction.computeSourceDigest()) !==
									pending.sourceDigest;
							} catch (error) {
								return errorResponse(
									error,
									"Repair workspace fingerprinting before recovering this pending review. Do not redispatch the assignment until its source can be checked.",
								);
							}
						}
						return ok("Flow status loaded.", {
							projection: project(current, request, pendingReviewSourceStale),
						});
					});
				}
				return ok("Flow status loaded.", {
					projection: project(session, request),
				});
			} catch (error) {
				if (error instanceof UnreadableFlowSessionError) {
					const quarantine = await repository.transact(async (transaction) => {
						try {
							await transaction.load();
							return { state: "changed" as const, path: null };
						} catch (currentError) {
							if (!(currentError instanceof UnreadableFlowSessionError)) {
								return { state: "changed" as const, path: null };
							}
							const path = await transaction.quarantineUnreadable();
							return { state: "quarantined" as const, path };
						}
					});
					return errorResponse(
						error,
						quarantine.state === "changed"
							? "Flow state changed before quarantine; the current state was left untouched."
							: quarantine.path
								? `Unreadable state was quarantined at ${quarantine.path}.`
								: "Unreadable state could not be quarantined.",
					);
				}
				return errorResponse(error);
			}
		},

		async planSave(input, authority) {
			try {
				const request = PlanSaveInputSchema.parse(input).request;
				return await repository.transact(async (transaction) => {
					const result = savePlan(
						await transaction.load(),
						request,
						environment,
						authority,
					);
					await transaction.save(result.session);
					return ok("Draft plan saved.", {
						operation: operationResult(
							result.session,
							request.operationId,
							result.replayed,
						),
						projection: compactProjection(result.session),
					});
				});
			} catch (error) {
				return errorResponse(error);
			}
		},

		planApprove(input, authority) {
			return mutate(
				repository,
				PlanApproveInputSchema,
				input,
				({ session }, request) =>
					Promise.resolve(approvePlan(session, request, authority)),
				(result) => ({
					summary: "Plan approved.",
					projection: compactProjection(result.session),
				}),
				(request) => request.operationId,
			);
		},

		runStart(input) {
			return mutate(
				repository,
				RunStartInputSchema,
				input,
				({ session }, request) =>
					Promise.resolve(startRun(session, request, environment)),
				(result) => ({
					summary: "Feature run ready.",
					projection: executionProjection(result.session),
				}),
				(request) => request.operationId,
			);
		},

		reviewStart(input) {
			return mutate(
				repository,
				ReviewStartInputSchema,
				input,
				async ({ session, transaction }, request) => {
					const priorOperation = session.operations.find(
						(operation) => operation.id === request.operationId,
					);
					const priorAssignment =
						priorOperation?.kind === "review-start"
							? session.runs
									.flatMap((run) => run.reviews)
									.find((review) => review.id === priorOperation.entityId)
							: undefined;
					return startReview(
						session,
						{
							...request,
							sourceDigest:
								priorAssignment?.sourceDigest ??
								(await transaction.computeSourceDigest()),
						},
						environment,
					);
				},
				(result) => {
					const actionable =
						activeRun(result.session)?.id === result.value.runId &&
						result.value.result === null;
					return {
						summary:
							result.replayed && !actionable
								? "Review assignment replayed; its current state is no longer actionable."
								: "Independent review assignment created.",
						projection: actionable
							? reviewerProjection(result.session, result.value.id)
							: compactProjection(result.session),
					};
				},
				(request) => request.operationId,
			);
		},

		async featureComplete(input) {
			try {
				const request = FeatureCompleteInputSchema.parse(input).request;
				return await repository.transact(async (transaction) => {
					const session = await transaction.load();
					if (!session) throw new Error("No active Flow session exists.");
					const replay = exactFeatureCompleteReplay(session, request);
					if (replay) {
						return featureCompleteResponse(
							replay.session,
							request,
							replay.run,
							true,
						);
					}
					const priorOperation = session.operations.find(
						(operation) => operation.id === request.operationId,
					);
					if (!priorOperation) {
						const assignment = session.runs
							.flatMap((run) => run.reviews)
							.find((review) => review.id === request.assignmentId);
						if (!assignment) throw new Error("Unknown review assignment.");
						if (
							(await transaction.computeSourceDigest()) !==
							assignment.sourceDigest
						) {
							return errorResponse(
								new Error("Workspace content changed after review started."),
								"Call flow_feature_reset, start a fresh run, and repeat full validation and review. Do not redispatch this source-stale assignment.",
							);
						}
					}
					const result = completeFeature(session, request);
					await transaction.save(result.session);
					return featureCompleteResponse(
						result.session,
						request,
						result.value,
						result.replayed,
					);
				});
			} catch (error) {
				return errorResponse(error);
			}
		},

		async featureCompleteReplay(input) {
			try {
				const request = FeatureCompleteInputSchema.parse(input).request;
				const session = await repository.read();
				if (!session) throw new Error("No active Flow session exists.");
				const replay = exactFeatureCompleteReplay(session, request);
				if (!replay) {
					throw new Error(
						"Only the Flow reviewer may submit a new feature completion; other agents may replay only an exact previously accepted request.",
					);
				}
				return featureCompleteResponse(
					replay.session,
					request,
					replay.run,
					true,
				);
			} catch (error) {
				return errorResponse(error);
			}
		},

		featureReset(input) {
			return mutate(
				repository,
				FeatureResetInputSchema,
				input,
				({ session }, request) =>
					Promise.resolve(resetFeature(session, request, environment)),
				(result) => ({
					summary: "Feature reset committed.",
					projection: compactProjection(result.session),
				}),
				(request) => request.operationId,
			);
		},

		async sessionClose(input) {
			try {
				const request = SessionCloseInputSchema.parse(input).request;
				return await repository.transact((transaction) =>
					closeSessionTransaction(transaction, request),
				);
			} catch (error) {
				return errorResponse(error);
			}
		},
	};
}
