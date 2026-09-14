import { createHash } from "node:crypto";
import type { Session, SourceDigest } from "./session.js";

export type ClosureRetryRequest = Readonly<{
	operationId: string;
	expectedRevision: number;
	sessionId: string;
	kind: "completed" | "deferred" | "abandoned";
	summary: string;
}>;

function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
		.join(",")}}`;
}

export function operationInputDigest(value: unknown): SourceDigest {
	return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function reconstructedClosureRequest(session: Session): ClosureRetryRequest {
	const closure = session.closure;
	if (!closure) throw new Error("Session has no closure.");
	return {
		operationId: closure.operationId,
		expectedRevision: closure.recordedRevision - 1,
		sessionId: session.id,
		kind: closure.kind,
		summary: closure.summary,
	};
}

export function closureOperationIssue(session: Session): string | null {
	const closure = session.closure;
	if (!closure) return null;
	if (
		closure.recordedRevision < 1 ||
		closure.recordedRevision > session.revision
	) {
		return "Closure has an invalid recorded revision.";
	}
	const operation = session.operations.find(
		(candidate) => candidate.id === closure.operationId,
	);
	if (!operation)
		return "Closure operation is missing from the operation ledger.";
	if (operation.kind !== "session-close") {
		return "Closure operation must be a session-close operation.";
	}
	if (operation.committedRevision !== closure.recordedRevision) {
		return "Closure revision does not match its operation.";
	}
	if (
		operation.inputDigest !==
		operationInputDigest(reconstructedClosureRequest(session))
	) {
		return "Closure payload does not match its operation.";
	}
	return null;
}

export function closureRetryRequest(
	session: Session,
): ClosureRetryRequest | null {
	if (!session.closure || closureOperationIssue(session)) return null;
	return reconstructedClosureRequest(session);
}
