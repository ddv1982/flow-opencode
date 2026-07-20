import type { Session, SourceDigest } from "../../domain/session.js";

export type SessionTransaction = Readonly<{
	load(): Promise<Session | null>;
	loadArchive(sessionId: string): Promise<Session | null>;
	save(session: Session): Promise<Session>;
	archiveAndClear(session: Session): Promise<void>;
	quarantineUnreadable(): Promise<string | null>;
	computeSourceDigest(): Promise<SourceDigest>;
}>;

export interface SessionRepository {
	read(): Promise<Session | null>;
	transact<T>(
		task: (transaction: SessionTransaction) => Promise<T>,
	): Promise<T>;
}
