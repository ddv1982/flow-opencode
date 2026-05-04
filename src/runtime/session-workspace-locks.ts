import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getFlowDir } from "./paths";
import type { MutableWorkspaceRoot } from "./workspace-root";

const sessionSaveQueues = new Map<string, Promise<void>>();
const SESSION_SAVE_LOCK_DIRECTORY_NAME = "session-save.lock";
const SESSION_SAVE_LOCK_RETRY_DELAY_MS = 25;
const SESSION_SAVE_LOCK_TIMEOUT_MS = 30_000;

async function acquireFilesystemSessionSaveLock(
	worktree: MutableWorkspaceRoot,
): Promise<() => Promise<void>> {
	const flowDir = getFlowDir(worktree);
	const lockDir = join(flowDir, SESSION_SAVE_LOCK_DIRECTORY_NAME);
	const startedAt = Date.now();
	while (true) {
		try {
			await mkdir(lockDir);
			return async () => {
				await rm(lockDir, { recursive: true, force: true });
			};
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				await mkdir(flowDir, { recursive: true });
				continue;
			}
			if (code !== "EEXIST") {
				throw error;
			}
			if (Date.now() - startedAt >= SESSION_SAVE_LOCK_TIMEOUT_MS) {
				throw new Error(
					`Timed out waiting for session save lock at ${lockDir}. If no Flow process is currently writing session state, remove this stale lock directory and retry.`,
				);
			}
			await sleep(SESSION_SAVE_LOCK_RETRY_DELAY_MS);
		}
	}
}

export async function withSessionSaveLock<T>(
	worktree: MutableWorkspaceRoot,
	task: () => Promise<T>,
): Promise<T> {
	const previous = sessionSaveQueues.get(worktree) ?? Promise.resolve();
	let release = () => {};
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const queued = previous.then(() => current);
	sessionSaveQueues.set(worktree, queued);

	let releaseFilesystemLock: (() => Promise<void>) | undefined;
	try {
		await previous;
		releaseFilesystemLock = await acquireFilesystemSessionSaveLock(worktree);
		return await task();
	} finally {
		try {
			if (releaseFilesystemLock) {
				await releaseFilesystemLock();
			}
		} finally {
			release();
			if (sessionSaveQueues.get(worktree) === queued) {
				sessionSaveQueues.delete(worktree);
			}
		}
	}
}
