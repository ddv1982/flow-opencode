import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureFlowDirectory, pathKind } from "./managed-fs.js";
import { assertMutableWorkspaceRoot, flowDir } from "./workspace-paths.js";

const inProcessLocks = new Map<string, Promise<void>>();
const LOCK_TIMEOUT_MS = 30_000;

async function orphanOwnerToken(lock: string): Promise<string | null> {
	try {
		const owner = JSON.parse(
			await readFile(join(lock, "owner.json"), "utf8"),
		) as {
			token?: unknown;
			pid?: unknown;
		};
		if (typeof owner.token !== "string" || owner.token.length === 0)
			return null;
		const pid = owner.pid;
		if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1)
			return null;
		try {
			process.kill(pid, 0);
			return null;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ESRCH"
				? owner.token
				: null;
		}
	} catch {
		return null;
	}
}

/**
 * wx-create `claim` inside the lock. That binds the claim to this directory
 * inode, so a live replacement is never moved off the canonical path.
 * Re-check the owner token before deleting; a mismatch drops the claim file.
 */
export async function reclaimOrphanedLock(lock: string): Promise<boolean> {
	const token = await orphanOwnerToken(lock);
	if (token === null) return false;
	const claim = join(lock, "claim");
	try {
		await writeFile(claim, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST" || code === "ENOENT") return false;
		throw error;
	}
	if ((await orphanOwnerToken(lock)) !== token) {
		try {
			await rm(claim);
		} catch {
			// Directory was replaced; the claim went with it.
		}
		return false;
	}
	await rm(lock, { recursive: true, force: true });
	return true;
}

async function acquireLock(workspace: string): Promise<() => Promise<void>> {
	await ensureFlowDirectory(workspace);
	const lock = join(flowDir(workspace), "session.lock");
	const started = Date.now();
	while (true) {
		try {
			await mkdir(lock, { mode: 0o700 });
			const token = randomUUID();
			try {
				await writeFile(
					join(lock, "owner.json"),
					JSON.stringify({ token, pid: process.pid }),
					{ encoding: "utf8", flag: "wx", mode: 0o600 },
				);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "EEXIST" && code !== "ENOENT") {
					await rm(lock, { recursive: true, force: true });
				}
				throw error;
			}
			return async () => {
				try {
					const owner = JSON.parse(
						await readFile(join(lock, "owner.json"), "utf8"),
					) as { token?: unknown };
					if (owner.token === token) await rm(lock, { recursive: true });
				} catch {
					// A replaced or damaged lock is not ours to remove.
				}
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			await pathKind(lock, "directory", "the Flow session lock");
			if (await reclaimOrphanedLock(lock)) continue;
			if (Date.now() - started >= LOCK_TIMEOUT_MS) {
				throw new Error(
					`Timed out waiting for Flow session lock at ${lock}; inspect it before manual removal.`,
				);
			}
			await sleep(25);
		}
	}
}

export async function withSessionLock<T>(
	workspace: string,
	task: () => Promise<T>,
): Promise<T> {
	const root = assertMutableWorkspaceRoot(workspace);
	const previous = inProcessLocks.get(root) ?? Promise.resolve();
	let releaseQueue = () => {};
	const current = new Promise<void>((resolveQueue) => {
		releaseQueue = resolveQueue;
	});
	const queued = previous.catch(() => undefined).then(() => current);
	inProcessLocks.set(root, queued);
	let releaseFile: (() => Promise<void>) | null = null;
	try {
		await previous.catch(() => undefined);
		releaseFile = await acquireLock(root);
		return await task();
	} finally {
		await releaseFile?.();
		releaseQueue();
		if (inProcessLocks.get(root) === queued) inProcessLocks.delete(root);
	}
}
