import { operationInputDigest } from "../domain/operation.js";
import type { Session } from "../domain/session.js";
import { closeSession } from "../domain/transitions.js";
import { type DeliveryProjection, deliveryProjection } from "./delivery.js";
import { ArchiveCollisionError } from "./errors.js";
import {
	dataNote,
	type FailureWorkflowData,
	type FlowErrorResponse,
	type FlowResponse,
	type OperationResult,
	ok,
	operationResult,
} from "./flow-response.js";
import type { SessionTransaction } from "./ports/session-repository.js";
import type { SessionCloseRequest, StatusRequest } from "./schema.js";
import {
	type ActiveSessionProjection,
	type ArchivedProjection,
	archivedProjection,
	type CompactProjection,
	compactProjection,
	project,
} from "./session-projection.js";

type CloseState = Readonly<
	| {
			durableAccepted: true;
			archiveConfirmed: false;
			retryExactRequest: true;
			retryRequest: SessionCloseRequest;
	  }
	| {
			durableAccepted: boolean;
			archiveConfirmed: false;
			retryExactRequest: false;
			manualRecoveryRequired: true;
	  }
>;

type SuccessfulCloseWorkflowData = Readonly<{
	operation: OperationResult;
	projection: ArchivedProjection;
	delivery: DeliveryProjection;
}>;

type CloseRecoveryWorkflowData = FailureWorkflowData &
	Readonly<{
		operation?: OperationResult;
		closeState: CloseState;
		projection:
			| CompactProjection
			| Readonly<
					CompactProjection & {
						nextAction: "await-user-direction";
						archiveRetry: null;
					}
			  >
			| Readonly<{
					view: "compact";
					sessionId: string;
					status: "unknown";
					nextAction: "await-user-direction";
					archiveRetry: null;
			  }>;
		delivery?: DeliveryProjection;
	}>;

type StatusRecoveryWorkflowData = FailureWorkflowData &
	Readonly<{
		operation?: never;
		closeState: Readonly<{
			durableAccepted: true;
			archiveConfirmed: false;
			retryExactRequest: false;
			manualRecoveryRequired: true;
		}>;
		projection: Readonly<
			ActiveSessionProjection & {
				nextAction: "await-user-direction";
				archiveRetry: null;
			}
		>;
		delivery: DeliveryProjection;
	}>;

export type ArchiveCollisionStatusResponse =
	FlowErrorResponse<StatusRecoveryWorkflowData>;

export type CloseSessionResponse =
	| FlowResponse<SuccessfulCloseWorkflowData>
	| FlowErrorResponse<CloseRecoveryWorkflowData>;

async function loadExactArchivedClose(
	transaction: SessionTransaction,
	request: SessionCloseRequest,
): Promise<Session | null> {
	const archived = await transaction.loadArchive(request.sessionId);
	const operation = archived?.operations.find(
		(item) => item.id === request.operationId,
	);
	if (
		!archived?.closure ||
		operation?.kind !== "session-close" ||
		operation.inputDigest !== operationInputDigest(request)
	) {
		return null;
	}
	return archived;
}

async function archivedStateCollision(
	transaction: SessionTransaction,
	session: Session,
): Promise<ArchiveCollisionError | null> {
	if (!session.closure) return null;
	let archived: Session | null;
	try {
		archived = await transaction.loadArchive(session.id);
	} catch (error) {
		if (error instanceof ArchiveCollisionError) return error;
		throw error;
	}
	if (!archived || JSON.stringify(archived) === JSON.stringify(session)) {
		return null;
	}
	return new ArchiveCollisionError(
		"Flow found a different archive for the closed active session.",
	);
}

function successfulCloseResponse(
	session: Session,
	request: SessionCloseRequest,
	replayed: boolean,
	summary: string,
): Extract<CloseSessionResponse, { status: "ok" }> {
	return ok(summary, {
		operation: operationResult(
			session,
			request.operationId,
			replayed,
			session.closure,
		),
		projection: archivedProjection(session),
		delivery: deliveryProjection(session),
	});
}

const MANUAL_RECOVERY =
	"Preserve both active and archived state, inspect the collision, and do not overwrite or delete either document automatically.";

function recoveryResponse(
	summary: string,
	data: CloseRecoveryWorkflowData,
): FlowErrorResponse<CloseRecoveryWorkflowData> {
	return {
		status: "error",
		summary,
		workflowData: { dataNote: dataNote(), ...data },
	};
}

function closeFailure(
	error: unknown,
	session: Session,
	request: SessionCloseRequest,
	replayed: boolean,
	durableAccepted = true,
): FlowErrorResponse<CloseRecoveryWorkflowData> {
	const operation = operationResult(
		session,
		request.operationId,
		replayed,
		session.closure,
	);
	const message = error instanceof Error ? error.message : String(error);
	if (!(error instanceof ArchiveCollisionError)) {
		return recoveryResponse(
			"Session close was durably accepted, but archive publication was not confirmed.",
			{
				operation,
				closeState: {
					durableAccepted: true,
					archiveConfirmed: false,
					retryExactRequest: true,
					retryRequest: request,
				},
				projection: compactProjection(session),
				delivery: deliveryProjection(session),
				failure: {
					summary: message,
					recovery:
						"Retry this exact flow_session_close request with the same operation ID and payload.",
				},
			},
		);
	}
	const projection = {
		...compactProjection(session),
		nextAction: "await-user-direction" as const,
		archiveRetry: null,
	};
	const closeState = {
		durableAccepted,
		archiveConfirmed: false as const,
		retryExactRequest: false as const,
		manualRecoveryRequired: true as const,
	};
	const failure = { summary: message, recovery: MANUAL_RECOVERY };
	return durableAccepted
		? recoveryResponse(
				"Session close was durably accepted, but conflicting Flow state requires manual recovery.",
				{
					operation,
					closeState,
					projection,
					delivery: deliveryProjection(session),
					failure,
				},
			)
		: recoveryResponse(
				"Session close replay could not confirm durable active state; manual recovery is required.",
				{ operation, closeState, projection, failure },
			);
}

function archiveLookupFailure(
	error: ArchiveCollisionError,
	request: SessionCloseRequest,
): FlowErrorResponse<CloseRecoveryWorkflowData> {
	return recoveryResponse(
		"Flow could not verify the archived close; manual recovery is required.",
		{
			closeState: {
				durableAccepted: false,
				archiveConfirmed: false,
				retryExactRequest: false,
				manualRecoveryRequired: true,
			},
			projection: {
				view: "compact",
				sessionId: request.sessionId,
				status: "unknown",
				nextAction: "await-user-direction",
				archiveRetry: null,
			},
			failure: {
				summary: error.message,
				recovery:
					"Preserve active and archived state, inspect the requested archive, and do not overwrite or delete either document automatically.",
			},
		},
	);
}

function archiveCollisionStatusResponse(
	error: ArchiveCollisionError,
	session: Session,
	request: StatusRequest,
): FlowErrorResponse<StatusRecoveryWorkflowData> {
	return {
		status: "error",
		summary:
			"The closed Flow session has conflicting archive state and requires manual recovery.",
		workflowData: {
			dataNote: dataNote(),
			closeState: {
				durableAccepted: true,
				archiveConfirmed: false,
				retryExactRequest: false,
				manualRecoveryRequired: true,
			},
			projection: {
				...project(session, request),
				nextAction: "await-user-direction",
				archiveRetry: null,
			},
			delivery: deliveryProjection(session),
			failure: {
				summary: error.message,
				recovery: MANUAL_RECOVERY,
			},
		},
	};
}

export async function closedArchiveCollisionStatus(
	transaction: SessionTransaction,
	session: Session,
	request: StatusRequest,
): Promise<ArchiveCollisionStatusResponse | null> {
	const collision = await archivedStateCollision(transaction, session);
	return collision
		? archiveCollisionStatusResponse(collision, session, request)
		: null;
}

export async function closeSessionTransaction(
	transaction: SessionTransaction,
	request: SessionCloseRequest,
): Promise<CloseSessionResponse> {
	const active = await transaction.load();
	if (!active || active.id !== request.sessionId) {
		let archived: Session | null;
		try {
			archived = await loadExactArchivedClose(transaction, request);
		} catch (error) {
			if (error instanceof ArchiveCollisionError) {
				return archiveLookupFailure(error, request);
			}
			throw error;
		}
		if (archived) {
			if (!active) {
				try {
					await transaction.archiveAndClear(archived);
				} catch (error) {
					return closeFailure(error, archived, request, true);
				}
			}
			return successfulCloseResponse(
				archived,
				request,
				true,
				"Session was already closed and archived.",
			);
		}
		if (!active) {
			throw new Error("No matching active or archived closure exists.");
		}
	}

	const result = closeSession(active, request);
	if (result.replayed) {
		try {
			await transaction.confirmActiveDurability(result.session);
		} catch (error) {
			if (error instanceof ArchiveCollisionError) {
				return closeFailure(error, result.session, request, true, false);
			}
			throw error;
		}
	} else {
		await transaction.save(result.session);
	}
	try {
		await transaction.archiveAndClear(result.session);
	} catch (error) {
		return closeFailure(error, result.session, request, result.replayed);
	}
	return successfulCloseResponse(
		result.session,
		request,
		result.replayed,
		"Session closed and archived.",
	);
}
