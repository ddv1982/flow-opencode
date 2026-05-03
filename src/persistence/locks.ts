import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
	getPersistenceLocksDir,
	sanitizePathComponent,
} from "../runtime/paths";
import {
	assertMutableWorkspaceRoot,
	type MutableWorkspaceRoot,
} from "../runtime/workspace-root";

const PERSISTENCE_LOCK_RETRY_DELAY_MS = 25;
const PERSISTENCE_LOCK_TIMEOUT_MS = 30_000;
const persistenceLockQueues = new Map<string, Promise<void>>();

async function acquireFilesystemPersistenceLock(
	worktree: MutableWorkspaceRoot,
	lockName: string,
): Promise<() => Promise<void>> {
	const locksDir = getPersistenceLocksDir(worktree);
	const lockPath = join(
		locksDir,
		`${sanitizePathComponent("lock", lockName)}.lock`,
	);
	const startedAt = Date.now();

	while (true) {
		try {
			await mkdir(lockPath, { recursive: false });
			return async () => {
				await rm(lockPath, { recursive: true, force: true });
			};
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				await mkdir(locksDir, { recursive: true });
				continue;
			}
			if (code !== "EEXIST") {
				throw error;
			}
			if (Date.now() - startedAt >= PERSISTENCE_LOCK_TIMEOUT_MS) {
				throw new Error(
					`Timed out waiting for Flow persistence lock at ${lockPath}. If no Flow process is currently writing persistence state, remove this stale lock directory and retry.`,
				);
			}
			await sleep(PERSISTENCE_LOCK_RETRY_DELAY_MS);
		}
	}
}

export async function withPersistenceLock<T>(
	worktree: string,
	lockName: string,
	task: () => Promise<T>,
): Promise<T> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const queueKey = `${mutableWorktree}:${sanitizePathComponent("lock", lockName)}`;
	const previous = persistenceLockQueues.get(queueKey) ?? Promise.resolve();
	let release = () => {};
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const queued = previous.then(() => current);
	persistenceLockQueues.set(queueKey, queued);

	let releaseFilesystemLock: (() => Promise<void>) | undefined;
	try {
		await previous;
		releaseFilesystemLock = await acquireFilesystemPersistenceLock(
			mutableWorktree,
			lockName,
		);
		return await task();
	} finally {
		try {
			if (releaseFilesystemLock) {
				await releaseFilesystemLock();
			}
		} finally {
			release();
			if (persistenceLockQueues.get(queueKey) === queued) {
				persistenceLockQueues.delete(queueKey);
			}
		}
	}
}
