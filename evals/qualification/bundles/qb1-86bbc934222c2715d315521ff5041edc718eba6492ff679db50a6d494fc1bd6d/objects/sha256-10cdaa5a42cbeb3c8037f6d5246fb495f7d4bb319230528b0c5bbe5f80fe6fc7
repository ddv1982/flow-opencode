import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { UnreadableFlowSessionError } from "../../application/errors.js";
import {
	MAX_SESSION_BYTES,
	SESSION_CLOSE_RESERVE_BYTES,
} from "../../domain/limits.js";
import { flowDir, historyDir } from "./workspace-paths.js";

export class UnsafeFlowWorkspaceLayoutError extends Error {
	readonly code = "UNSAFE_FLOW_WORKSPACE_LAYOUT";
}

export async function pathKind(
	path: string,
	expected: "file" | "directory",
	description: string,
): Promise<"missing" | "present"> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow refuses a symbolic link for ${description}: ${path}.`,
			);
		}
		if (
			(expected === "file" && !info.isFile()) ||
			(expected === "directory" && !info.isDirectory())
		) {
			throw new UnsafeFlowWorkspaceLayoutError(
				`Flow requires ${description} to be a ${expected}: ${path}.`,
			);
		}
		return "present";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
		throw error;
	}
}

async function ensureDirectory(
	path: string,
	description: string,
): Promise<void> {
	if ((await pathKind(path, "directory", description)) === "present") return;
	try {
		await mkdir(path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	await pathKind(path, "directory", description);
}

export async function ensureFlowDirectory(workspace: string): Promise<void> {
	const root = flowDir(workspace);
	await ensureDirectory(root, "the Flow state directory");
	const ignore = join(root, ".gitignore");
	if ((await pathKind(ignore, "file", "the Flow ignore file")) === "missing") {
		try {
			await writeFile(ignore, "*\n", {
				encoding: "utf8",
				flag: "wx",
				mode: 0o600,
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
}

export async function ensureHistoryDirectory(workspace: string): Promise<void> {
	await ensureFlowDirectory(workspace);
	await ensureDirectory(historyDir(workspace), "the Flow history directory");
}

export async function readManaged(
	path: string,
	description: string,
	synchronizeFile = false,
): Promise<string> {
	await pathKind(path, "file", description);
	const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
	const access = synchronizeFile ? constants.O_RDWR : constants.O_RDONLY;
	const handle = await open(path, access | noFollow);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.size > MAX_SESSION_BYTES + SESSION_CLOSE_RESERVE_BYTES
		) {
			throw new UnreadableFlowSessionError(
				`${description} is not a bounded regular file.`,
				"state exceeds the supported session size",
			);
		}
		const contents = await handle.readFile("utf8");
		if (synchronizeFile) await handle.sync();
		return contents;
	} finally {
		await handle.close();
	}
}

export async function syncDirectory(path: string): Promise<void> {
	if (process.platform === "win32") return;
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function renameReplacing(temporary: string, path: string): Promise<void> {
	let retry = 0;
	while (true) {
		try {
			await rename(temporary, path);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			const transientWindowsError =
				process.platform === "win32" &&
				(code === "EACCES" || code === "EBUSY" || code === "EPERM");
			if (!transientWindowsError || retry >= 20) throw error;
			retry += 1;
			// Preserve atomic replacement: wait for short-lived readers instead of
			// unlinking the destination and exposing missing or partial state.
			await sleep(retry * 5);
		}
	}
}

export async function writeAtomically(
	path: string,
	contents: string,
): Promise<void> {
	const temporary = join(
		dirname(path),
		`.flow-write-${process.pid}-${randomUUID()}.tmp`,
	);
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} catch (error) {
		await handle.close();
		await rm(temporary, { force: true });
		throw error;
	}
	await handle.close();
	try {
		await renameReplacing(temporary, path);
		await syncDirectory(dirname(path));
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
