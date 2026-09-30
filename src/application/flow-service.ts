import { operationInputDigest } from "../domain/operation.js";
import type {
	RequestAuthority,
	RequestEvidenceAnchor,
} from "../domain/request-evidence.js";
import type {
	ExistingWork,
	FeatureRun,
	ReviewEvidenceReference,
	Session,
} from "../domain/session.js";
import { featureKind } from "../domain/session.js";
import { activeRun } from "../domain/session-queries.js";
import {
	amendPlan,
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
import type { ReviewEvidencePort } from "./ports/review-evidence.js";
import type {
	SessionRepository,
	SessionTransaction,
} from "./ports/session-repository.js";
import {
	isExactRecoveryReplay,
	type RecoveryGuard,
	type RecoveryMutation,
} from "./recovery-policy.js";
import {
	FeatureCompleteInputSchema,
	type FeatureCompleteRequest,
	FeatureResetInputSchema,
	PlanAmendInputSchema,
	PlanApproveInputSchema,
	PlanSaveInputSchema,
	ReviewStartInputSchema,
	RunStartInputSchema,
	SessionCloseInputSchema,
	SessionSchema,
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

type StatusWorkflowData = Readonly<{
	projection: StatusProjection;
	recovery?: unknown;
	reviewerPager?: Readonly<{
		assignmentId: string;
		contextPages: number;
		diffPages: number;
		chunkBytes: 8192;
		assurance: "host-evidence" | "legacy-no-baseline";
	}>;
}>;
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
	}): Promise<string | null>;
	planSave(
		input: unknown,
		authority?: RequestAuthority,
	): Promise<CompactMutationResponse>;
	planApprove(
		input: unknown,
		authority?: RequestAuthority,
	): Promise<CompactMutationResponse>;
	planAmend(input: unknown): Promise<CompactMutationResponse>;
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
	afterSave?: (session: Session, request: Request, replayed: boolean) => void,
): Promise<FlowResponse<MutationWorkflowData<Projection>>> {
	try {
		const request = schema.parse(input).request;
		return await repository.transact(async (transaction) => {
			const session = await transaction.load();
			if (!session) throw new Error("No active Flow session exists.");
			const result = await step({ session, transaction }, request);
			if (!result.replayed) await transaction.save(result.session);
			afterSave?.(result.session, request, result.replayed);
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
	recovery?: RecoveryGuard,
	reviewEvidence?: ReviewEvidencePort,
): FlowService {
	const referenceReserve: ReviewEvidenceReference = {
		version: 1,
		sha256: `sha256:${"0".repeat(64)}`,
	};
	async function bindNewRun(
		previous: Session,
		current: Session,
		transaction: SessionTransaction,
		replayed: boolean,
		existingWork?: ExistingWork,
	): Promise<Session> {
		if (!reviewEvidence || replayed) return current;
		const run = activeRun(current);
		if (!run || run.startedRevision !== current.revision) return current;
		SessionSchema.parse(current);
		const history = previous.runs.filter(
			(candidate) => candidate.featureId === run.featureId,
		);
		const original = history.find((candidate) => candidate.baseline)?.baseline;
		if (original && existingWork)
			throw new Error("A retry cannot replace the original feature baseline.");
		if (!original && history.length > 0 && !existingWork)
			throw new Error(
				"This legacy feature has no original baseline. Supply an immutable existingWork base and exact ownedPaths, or close the session. Current edits cannot become the original baseline.",
			);
		const bind = (baseline: ReviewEvidenceReference) => ({
			...current,
			runs: current.runs.map((candidate) =>
				candidate.id === run.id ? { ...candidate, baseline } : candidate,
			),
		});
		SessionSchema.parse(bind(original ?? referenceReserve));
		const baseline =
			original ??
			(await reviewEvidence.captureBaseline({
				sessionId: current.id,
				featureId: run.featureId,
				originRunId: run.id,
				sourceDigest: await transaction.computeSourceDigest(),
				...(existingWork ? { existingWork } : {}),
			}));
		const bound = bind(baseline);
		SessionSchema.parse(bound);
		return bound;
	}
	function pages(text: string): string[] {
		const output: string[] = [];
		for (let start = 0; start < text.length; ) {
			let end = Math.min(start + 2048, text.length);
			if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1)))
				end--;
			output.push(text.slice(start, end));
			start = end;
		}
		return output.length > 0 ? output : [""];
	}
	return {
		async requestAnchor(input) {
			return repository.transact(async (transaction) => {
				const current = await transaction.load();
				const anchored = anchorRequest(current, input, environment);
				if (anchored === current) return null;
				await transaction.save(anchored);
				return anchored.id;
			});
		},
		async status(input) {
			let request: StatusRequest;
			try {
				const parsed = StatusInputSchema.parse(input);
				request = parsed.request;
				if (parsed.recoveryProposal) {
					if (!recovery)
						throw new Error(
							"Recovery advice requires an explicitly configured host.",
						);
					const snapshot = await repository.transact(async (transaction) => {
						const session = await transaction.load();
						if (!session) throw new Error("No active session");
						return { session, source: await transaction.computeSourceDigest() };
					});
					const advice = await recovery.propose(
						snapshot.session,
						snapshot.source,
						parsed.recoveryProposal,
					);
					const fresh = await repository.transact(async (transaction) => ({
						session: await transaction.load(),
						source: await transaction.computeSourceDigest(),
					}));
					if (
						!fresh.session ||
						fresh.session.id !== snapshot.session.id ||
						fresh.session.revision !== snapshot.session.revision ||
						fresh.source !== snapshot.source
					) {
						recovery.invalidate();
						throw new Error(
							"Recovery advice is stale. No action is authorized.",
						);
					}
					return ok(
						"Recovery advice does not replace validation or user authority.",
						{ projection: compactProjection(fresh.session), recovery: advice },
					);
				}
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
					request.view === "reviewer" ||
					request.view === "reviewer-evidence"
				) {
					return await repository.transact(async (transaction) => {
						const current = await transaction.load();
						if (!current) throw new Error("The review session ended.");
						const projection = reviewerProjection(
							current,
							request.assignmentId,
						);
						const assignment = projection.assignment;
						const contextPages = pages(JSON.stringify(projection));
						const packet = assignment.evidence
							? await reviewEvidence?.read({
									reference: assignment.evidence,
									sessionId: current.id,
									featureId: assignment.featureId,
									runId: assignment.runId,
									sourceDigest: assignment.sourceDigest,
								})
							: undefined;
						if (assignment.evidence && !packet)
							throw new Error(
								"The assigned host evidence reader is unavailable.",
							);
						const diffPages = packet ? pages(JSON.stringify(packet)) : [];
						const reviewerPager = {
							assignmentId: assignment.id,
							contextPages: contextPages.length,
							diffPages: diffPages.length,
							chunkBytes: 8192 as const,
							assurance: packet
								? ("host-evidence" as const)
								: ("legacy-no-baseline" as const),
						};
						if (request.view === "reviewer") {
							const inline =
								Buffer.byteLength(JSON.stringify(projection)) <= 16 * 1024
									? projection
									: {
											view: "reviewer" as const,
											sessionId: current.id,
											revision: current.revision,
											inlineContext: "paged" as const,
											assignment: {
												id: assignment.id,
												featureId: assignment.featureId,
												runId: assignment.runId,
												kind: assignment.kind,
												sourceDigest: assignment.sourceDigest,
											},
										};
							return ok(
								"Reviewer context loaded. Use the bounded pages for complete context and evidence.",
								{ reviewerPager, projection: inline },
							);
						}
						const selected =
							request.part === "context" ? contextPages : diffPages;
						const text = selected[request.page];
						if (text === undefined)
							throw new Error(
								"The requested review evidence page is unavailable.",
							);
						return ok(
							"One chunk of immutable assignment evidence. Read all pages for this part.",
							{
								projection: {
									view: "reviewer-evidence" as const,
									sessionId: current.id,
									revision: current.revision,
									assignmentId: assignment.id,
									sourceDigest: assignment.sourceDigest,
									part: request.part,
									page: request.page,
									totalPages: selected.length,
									complete: true as const,
									assurance: reviewerPager.assurance,
									text,
								},
							},
						);
					});
				}
				if (activePendingReview(session) || session.closure) {
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

		planAmend(input) {
			return mutate(
				repository,
				PlanAmendInputSchema,
				input,
				async ({ session, transaction }, request) =>
					amendPlan(session, request, await transaction.computeSourceDigest()),
				(result) => ({
					summary:
						"Bounded prerequisite amendment recorded for independent review.",
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
				async ({ session, transaction }, request) => {
					const mutation: RecoveryMutation = { kind: "run-start", request };
					if (recovery && !isExactRecoveryReplay(session, mutation))
						recovery.check(
							session,
							recovery.requiresSource()
								? await transaction.computeSourceDigest()
								: null,
							mutation,
						);
					const result = startRun(session, request, environment);
					const bound = await bindNewRun(
						session,
						result.session,
						transaction,
						result.replayed,
						request.existingWork,
					);
					return {
						...result,
						session: bound,
						value:
							bound.runs.find((run) => run.id === result.value.id) ??
							result.value,
					};
				},
				(result) => ({
					summary: "Feature run ready.",
					projection: executionProjection(result.session),
				}),
				(request) => request.operationId,
				(session, request, replayed) =>
					recovery?.accepted(session, { kind: "run-start", request }, replayed),
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
					const result = startReview(
						session,
						{
							...request,
							sourceDigest:
								priorAssignment?.sourceDigest ??
								(await transaction.computeSourceDigest()),
						},
						environment,
					);
					if (!reviewEvidence || result.replayed) return result;
					const run = activeRun(session);
					if (!run?.baseline) {
						if (
							featureKind(
								session.plan?.features.find(
									(feature) => feature.id === run?.featureId,
								),
							) === "inspect"
						)
							return result;
						throw new Error(
							"Review evidence preparation needs the original feature baseline. This legacy run cannot capture current edits as its original baseline. Reset with an explicit immutable existingWork base and ownership inventory, or close the session.",
						);
					}
					SessionSchema.parse(result.session);
					const attach = (evidence: ReviewEvidenceReference) => ({
						...result.session,
						runs: result.session.runs.map((candidate) =>
							candidate.id === run.id
								? {
										...candidate,
										reviews: candidate.reviews.map((review) =>
											review.id === result.value.id
												? { ...review, evidence }
												: review,
										),
									}
								: candidate,
						),
					});
					SessionSchema.parse(attach(referenceReserve));
					const evidence = await reviewEvidence.prepare({
						sessionId: session.id,
						featureId: run.featureId,
						runId: run.id,
						baseline: run.baseline,
						sourceDigest: result.value.sourceDigest,
						declaredArtifacts: request.artifactsChanged,
						authorizedTargets: [
							...(session.plan?.features.find(
								(feature) => feature.id === run.featureId,
							)?.targets ?? []),
							...(session.amendments ?? [])
								.filter((amendment) => amendment.featureId === run.featureId)
								.flatMap((amendment) => amendment.targets),
						],
					});
					if (
						(await transaction.computeSourceDigest()) !==
						result.value.sourceDigest
					)
						throw new Error(
							"Workspace content changed while review evidence was prepared.",
						);
					const assignment = { ...result.value, evidence };
					const bound = attach(evidence);
					SessionSchema.parse(bound);
					return { ...result, value: assignment, session: bound };
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
						if (assignment.evidence) {
							if (!reviewEvidence)
								throw new Error(
									"The assigned host evidence reader is unavailable.",
								);
							await reviewEvidence.read({
								reference: assignment.evidence,
								sessionId: session.id,
								featureId: assignment.featureId,
								runId: assignment.runId,
								sourceDigest: assignment.sourceDigest,
							});
						}
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
				async ({ session, transaction }, request) => {
					const mutation: RecoveryMutation = { kind: "feature-reset", request };
					if (recovery && !isExactRecoveryReplay(session, mutation))
						recovery.check(
							session,
							recovery.requiresSource()
								? await transaction.computeSourceDigest()
								: null,
							mutation,
						);
					const result = resetFeature(session, request, environment);
					const bound = await bindNewRun(
						session,
						result.session,
						transaction,
						result.replayed,
						request.existingWork,
					);
					const resetValue = result.value;
					const value = Array.isArray(resetValue)
						? resetValue
						: (bound.runs.find((run) => run.id === resetValue.id) ??
							resetValue);
					return { ...result, session: bound, value };
				},
				(result) => ({
					summary: "Feature reset committed.",
					projection: compactProjection(result.session),
				}),
				(request) => request.operationId,
				(session, request, replayed) =>
					recovery?.accepted(
						session,
						{ kind: "feature-reset", request },
						replayed,
					),
			);
		},

		async sessionClose(input) {
			try {
				const request = SessionCloseInputSchema.parse(input).request;
				const result = await repository.transact((transaction) =>
					closeSessionTransaction(transaction, request, recovery?.checkClose),
				);
				if (result.status === "ok")
					recovery?.retireClosedSession(request.sessionId);
				return result;
			} catch (error) {
				return errorResponse(error);
			}
		},
	};
}
