import { operationInputDigest } from "../domain/operation.js";
import type { Session } from "../domain/session.js";
import { closeSession } from "../domain/transitions.js";
import { deliveryProjection } from "./delivery.js";
import { ArchiveCollisionError } from "./errors.js";
import {
	dataNote,
	type FlowResponse,
	ok,
	operationResult,
} from "./flow-response.js";
import type { SessionTransaction } from "./ports/session-repository.js";
import type { SessionCloseRequest, StatusRequest } from "./schema.js";
import {
	archivedProjection,
	compactProjection,
	project,
} from "./session-projection.js";

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
): FlowResponse {
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

function archivePendingResponse(
	error: unknown,
	session: Session,
	request: SessionCloseRequest,
	replayed: boolean,
): FlowResponse {
	const failure = error instanceof Error ? error.message : String(error);
	return {
		status: "error",
		summary:
			"Session close was durably accepted, but archive publication was not confirmed.",
		workflowData: {
			dataNote: dataNote(),
			operation: operationResult(
				session,
				request.operationId,
				replayed,
				session.closure,
			),
			closeState: {
				durableAccepted: true,
				archiveConfirmed: false,
				retryExactRequest: true,
				retryRequest: request,
			},
			projection: compactProjection(session),
			delivery: deliveryProjection(session),
			failure: {
				summary: failure,
				recovery:
					"Retry this exact flow_session_close request with the same operation ID and payload.",
			},
		},
	};
}

function manualRecoveryCloseState(durableAccepted: boolean) {
	return {
		durableAccepted,
		archiveConfirmed: false,
		retryExactRequest: false,
		manualRecoveryRequired: true,
	};
}

function manualRecoveryProjection(
	projection: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...projection,
		nextAction: "await-user-direction",
		archiveRetry: null,
	};
}

function archiveCollisionResponse(
	error: ArchiveCollisionError,
	session: Session,
	request: SessionCloseRequest,
	replayed: boolean,
	durableAccepted = true,
): FlowResponse {
	return {
		status: "error",
		summary: durableAccepted
			? "Session close was durably accepted, but conflicting Flow state requires manual recovery."
			: "Session close replay could not confirm durable active state; manual recovery is required.",
		workflowData: {
			dataNote: dataNote(),
			operation: operationResult(
				session,
				request.operationId,
				replayed,
				session.closure,
			),
			closeState: manualRecoveryCloseState(durableAccepted),
			projection: manualRecoveryProjection(compactProjection(session)),
			...(durableAccepted ? { delivery: deliveryProjection(session) } : {}),
			failure: {
				summary: error.message,
				recovery:
					"Preserve both active and archived state, inspect the collision, and do not overwrite or delete either document automatically.",
			},
		},
	};
}

function archiveCollisionStatusResponse(
	error: ArchiveCollisionError,
	session: Session,
	request: StatusRequest,
): FlowResponse {
	return {
		status: "error",
		summary:
			"The closed Flow session has conflicting archive state and requires manual recovery.",
		workflowData: {
			dataNote: dataNote(),
			closeState: manualRecoveryCloseState(true),
			projection: manualRecoveryProjection(project(session, request)),
			delivery: deliveryProjection(session),
			failure: {
				summary: error.message,
				recovery:
					"Preserve both active and archived state, inspect the collision, and do not overwrite or delete either document automatically.",
			},
		},
	};
}

function archiveLookupCollisionResponse(
	error: ArchiveCollisionError,
	request: SessionCloseRequest,
): FlowResponse {
	return {
		status: "error",
		summary:
			"Flow could not verify the archived close; manual recovery is required.",
		workflowData: {
			dataNote: dataNote(),
			closeState: manualRecoveryCloseState(false),
			projection: manualRecoveryProjection({
				view: "compact",
				sessionId: request.sessionId,
				status: "unknown",
			}),
			failure: {
				summary: error.message,
				recovery:
					"Preserve active and archived state, inspect the requested archive, and do not overwrite or delete either document automatically.",
			},
		},
	};
}

function archiveFailureResponse(
	error: unknown,
	session: Session,
	request: SessionCloseRequest,
	replayed: boolean,
): FlowResponse {
	return error instanceof ArchiveCollisionError
		? archiveCollisionResponse(error, session, request, replayed)
		: archivePendingResponse(error, session, request, replayed);
}

export async function closedArchiveCollisionStatus(
	transaction: SessionTransaction,
	session: Session,
	request: StatusRequest,
): Promise<FlowResponse | null> {
	const collision = await archivedStateCollision(transaction, session);
	return collision
		? archiveCollisionStatusResponse(collision, session, request)
		: null;
}

export async function closeSessionTransaction(
	transaction: SessionTransaction,
	request: SessionCloseRequest,
): Promise<FlowResponse> {
	const active = await transaction.load();
	if (!active || active.id !== request.sessionId) {
		let archived: Session | null;
		try {
			archived = await loadExactArchivedClose(transaction, request);
		} catch (error) {
			if (error instanceof ArchiveCollisionError) {
				return archiveLookupCollisionResponse(error, request);
			}
			throw error;
		}
		if (archived) {
			if (!active) {
				try {
					await transaction.archiveAndClear(archived);
				} catch (error) {
					return archiveFailureResponse(error, archived, request, true);
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
				return archiveCollisionResponse(
					error,
					result.session,
					request,
					true,
					false,
				);
			}
			throw error;
		}
	} else {
		await transaction.save(result.session);
	}
	try {
		await transaction.archiveAndClear(result.session);
	} catch (error) {
		return archiveFailureResponse(
			error,
			result.session,
			request,
			result.replayed,
		);
	}
	return successfulCloseResponse(
		result.session,
		request,
		result.replayed,
		"Session closed and archived.",
	);
}
