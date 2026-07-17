import type { Session } from "../../domain/session.js";

export type SessionTransaction = {
	load(): Promise<Session | null>;
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
