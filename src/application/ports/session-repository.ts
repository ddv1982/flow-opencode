import type { Session } from "../../domain/session.js";
import type { EvidenceArtifactStore } from "./evidence-artifact-store.js";
import type { SourceIdentityProvider } from "./source-identity.js";

export class ArchivedSessionLookupError extends Error {
	readonly code = "FLOW_ARCHIVE_LOOKUP_FAILED";
	readonly failureKind: "history-integrity" | "helper-runtime";
	constructor(
		message: string,
		options?: ErrorOptions & {
			failureKind?: "history-integrity" | "helper-runtime";
		},
	) {
		super(message, options);
		this.name = "ArchivedSessionLookupError";
		this.failureKind = options?.failureKind ?? "history-integrity";
	}
}

export type SessionTransaction = EvidenceArtifactStore &
	SourceIdentityProvider & {
		load(): Promise<Session | null>;
		findArchivedByCloseRetryOperationId(
			operationId: string,
		): Promise<Session | null>;
		findArchivedByOperationId(operationId: string): Promise<Session | null>;
		save(session: Session): Promise<Session>;
		archiveAndClear(session: Session): Promise<void>;
		quarantineUnreadable(): Promise<string | null>;
	};

export interface SessionRepository {
	read(): Promise<Session | null>;
	transact<T>(
		task: (transaction: SessionTransaction) => Promise<T>,
	): Promise<T>;
}
