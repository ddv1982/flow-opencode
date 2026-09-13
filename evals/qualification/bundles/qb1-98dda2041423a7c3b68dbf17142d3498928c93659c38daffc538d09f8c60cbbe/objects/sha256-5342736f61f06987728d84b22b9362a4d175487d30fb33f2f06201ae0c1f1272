import {
	MAX_SESSION_BYTES,
	MAX_SESSION_OPERATIONS,
	SESSION_CLOSE_RESERVE_BYTES,
} from "./limits.js";
import type { Session } from "./session.js";
import { FlowTransitionError } from "./transition-error.js";

export function assertTerminalHeadroom(session: Session): void {
	if (
		session.operations.length >= MAX_SESSION_OPERATIONS ||
		Buffer.byteLength(JSON.stringify(session)) >
			MAX_SESSION_BYTES - SESSION_CLOSE_RESERVE_BYTES ||
		session.revision >= Number.MAX_SAFE_INTEGER
	) {
		throw new FlowTransitionError(
			"Session capacity is reserved for closure. Close deferred or abandoned before starting more work.",
		);
	}
}

export function persistedCapacityIssues(session: Session): string[] {
	const bytes = Buffer.byteLength(JSON.stringify(session));
	if (
		session.operations.length <= MAX_SESSION_OPERATIONS &&
		bytes <= MAX_SESSION_BYTES
	)
		return [];
	if (session.closure) {
		const terminal = session.operations.at(-1);
		const body = {
			...session,
			revision: session.revision - 1,
			closure: null,
			operations: session.operations.slice(0, -1),
		};
		if (
			terminal?.kind === "session-close" &&
			terminal.id === session.closure.operationId &&
			terminal.committedRevision === session.revision &&
			session.closure.recordedRevision === session.revision &&
			body.operations.length <= MAX_SESSION_OPERATIONS &&
			Buffer.byteLength(JSON.stringify(body)) <= MAX_SESSION_BYTES + 4 &&
			bytes <= MAX_SESSION_BYTES + SESSION_CLOSE_RESERVE_BYTES
		)
			return [];
	}
	return [
		`Session cannot exceed ${MAX_SESSION_BYTES} UTF-8 bytes or ${MAX_SESSION_OPERATIONS} operations except for one bounded terminal close.`,
	];
}
