import { randomUUID } from "node:crypto";
import { link, open, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	ArchiveCollisionError,
	UnreadableFlowSessionError,
	UnsupportedFlowSessionVersionError,
} from "../../application/errors.js";
import { SessionSchema } from "../../application/schema.js";
import {
	MAX_SESSION_BYTES,
	SESSION_CLOSE_RESERVE_BYTES,
} from "../../domain/limits.js";
import { sameSession } from "../../domain/operation.js";
import type { Session } from "../../domain/session.js";
import {
	ensureFlowDirectory,
	ensureHistoryDirectory,
	pathKind,
	readManaged,
	syncDirectory,
	UnsafeFlowWorkspaceLayoutError,
	writeAtomically,
} from "./managed-fs.js";
import { parseStrictJsonObject } from "./strict-json-object.js";
import {
	archivedSessionPath,
	assertMutableWorkspaceRoot,
	flowDir,
	historyDir,
	sessionPath,
} from "./workspace-paths.js";

export { ArchiveCollisionError } from "../../application/errors.js";

function provesManagedStateCollision(error: unknown): boolean {
	return (
		error instanceof ArchiveCollisionError ||
		error instanceof UnreadableFlowSessionError ||
		error instanceof UnsupportedFlowSessionVersionError ||
		error instanceof UnsafeFlowWorkspaceLayoutError
	);
}

type WorkspacePersistenceOptions = Readonly<{
	synchronizeDirectory?: (path: string) => Promise<void>;
}>;

function parseSession(raw: string, description: string): Session {
	const parsed = parseStrictJsonObject(raw, description);
	if (!parsed.ok) {
		throw new UnreadableFlowSessionError(parsed.error, parsed.error);
	}
	if (Object.hasOwn(parsed.value, "version") && parsed.value.version !== 5) {
		throw new UnsupportedFlowSessionVersionError(parsed.value.version);
	}
	const result = SessionSchema.safeParse(parsed.value);
	if (!result.success) {
		const reason = result.error.issues.map((issue) => issue.message).join("; ");
		throw new UnreadableFlowSessionError(
			`${description} does not match Session v5: ${reason}`,
			reason,
		);
	}
	const rawLimit =
		MAX_SESSION_BYTES + (result.data.closure ? SESSION_CLOSE_RESERVE_BYTES : 0);
	if (Buffer.byteLength(raw) > rawLimit) {
		throw new UnreadableFlowSessionError(
			`${description} exceeds the supported session size.`,
			"state exceeds the supported session size",
		);
	}
	return result.data;
}

export async function loadSession(workspace: string): Promise<Session | null> {
	const root = assertMutableWorkspaceRoot(workspace);
	if (
		(await pathKind(flowDir(root), "directory", "the Flow state directory")) ===
		"missing"
	) {
		return null;
	}
	const path = sessionPath(root);
	if ((await pathKind(path, "file", "the Flow session file")) === "missing") {
		return null;
	}
	return parseSession(
		await readManaged(path, "the Flow session file"),
		"Flow session file",
	);
}

async function loadArchivedSessionDocument(
	workspace: string,
	sessionId: string,
	synchronizeFile: boolean,
): Promise<Session | null> {
	try {
		const root = assertMutableWorkspaceRoot(workspace);
		if (
			(await pathKind(
				flowDir(root),
				"directory",
				"the Flow state directory",
			)) === "missing"
		) {
			return null;
		}
		if (
			(await pathKind(
				historyDir(root),
				"directory",
				"the Flow history directory",
			)) === "missing"
		) {
			return null;
		}
		const path = archivedSessionPath(root, sessionId);
		if (
			(await pathKind(path, "file", "the Flow archived session")) === "missing"
		) {
			return null;
		}
		const session = parseSession(
			await readManaged(path, "the Flow archived session", synchronizeFile),
			"Flow archived session",
		);
		if (session.id !== sessionId || !session.closure) {
			throw new ArchiveCollisionError(
				"Archived session identity or closure is invalid.",
			);
		}
		return session;
	} catch (error) {
		if (!provesManagedStateCollision(error)) throw error;
		if (error instanceof ArchiveCollisionError) throw error;
		throw new ArchiveCollisionError(
			"Flow could not verify the existing archive as canonical closed state.",
		);
	}
}

export async function loadArchivedSession(
	workspace: string,
	sessionId: string,
): Promise<Session | null> {
	return loadArchivedSessionDocument(workspace, sessionId, false);
}

export async function saveSession(
	workspace: string,
	session: Session,
): Promise<Session> {
	const root = assertMutableWorkspaceRoot(workspace);
	const parsed = SessionSchema.parse(session);
	await ensureFlowDirectory(root);
	await pathKind(sessionPath(root), "file", "the Flow session file");
	await writeAtomically(sessionPath(root), JSON.stringify(parsed));
	await syncDirectory(root);
	return parsed;
}

export async function confirmActiveSessionDurability(
	workspace: string,
	session: Session,
	options: WorkspacePersistenceOptions = {},
): Promise<void> {
	const root = assertMutableWorkspaceRoot(workspace);
	const canonical = SessionSchema.parse(session);
	const path = sessionPath(root);
	let active: Session;
	try {
		if ((await pathKind(path, "file", "the Flow session file")) === "missing") {
			throw new ArchiveCollisionError(
				"Active state disappeared before durability confirmation.",
			);
		}
		active = parseSession(
			await readManaged(path, "the Flow session file", true),
			"Flow session file",
		);
	} catch (error) {
		if (!provesManagedStateCollision(error)) throw error;
		if (error instanceof ArchiveCollisionError) throw error;
		throw new ArchiveCollisionError(
			"Flow could not verify canonical active state before durability confirmation.",
		);
	}
	if (!sameSession(active, canonical)) {
		throw new ArchiveCollisionError(
			"Active state changed before durability confirmation; Flow left it untouched.",
		);
	}
	const synchronizeDirectory = options.synchronizeDirectory ?? syncDirectory;
	await synchronizeDirectory(flowDir(root));
	await synchronizeDirectory(root);
}

export async function archiveAndClearSession(
	workspace: string,
	session: Session,
	options: WorkspacePersistenceOptions = {},
): Promise<void> {
	const root = assertMutableWorkspaceRoot(workspace);
	const synchronizeDirectory = options.synchronizeDirectory ?? syncDirectory;
	if (!session.closure)
		throw new Error("Flow archives only explicitly closed sessions.");
	const canonical = SessionSchema.parse(session);
	const canonicalBytes = JSON.stringify(canonical);
	try {
		await ensureHistoryDirectory(root);
	} catch (error) {
		if (!provesManagedStateCollision(error)) throw error;
		throw new ArchiveCollisionError(
			"Flow could not verify a safe archive directory; it left active state untouched.",
		);
	}
	const target = archivedSessionPath(root, canonical.id);
	const temporary = join(
		historyDir(root),
		`.flow-archive-${process.pid}-${randomUUID()}.tmp`,
	);
	try {
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(canonicalBytes, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		try {
			await link(temporary, target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			let existing: Session | null;
			try {
				existing = await loadArchivedSessionDocument(root, canonical.id, true);
			} catch (error) {
				if (!provesManagedStateCollision(error)) throw error;
				throw new ArchiveCollisionError(
					"Flow could not verify that the existing archive is identical; it left both documents untouched.",
				);
			}
			if (!existing || !sameSession(existing, canonical)) {
				throw new ArchiveCollisionError(
					"Flow refused to overwrite a different archived session.",
				);
			}
		}
		await rm(temporary, { force: true });
		await synchronizeDirectory(historyDir(root));
		await synchronizeDirectory(flowDir(root));
		await synchronizeDirectory(root);
	} finally {
		await rm(temporary, { force: true });
	}
	let active: Session | null;
	try {
		active = await loadSession(root);
	} catch (error) {
		if (!provesManagedStateCollision(error)) throw error;
		throw new ArchiveCollisionError(
			"Flow could not verify that active state is identical; it left both documents untouched.",
		);
	}
	if (!active) {
		await synchronizeDirectory(flowDir(root));
		return;
	}
	if (!sameSession(active, canonical)) {
		throw new ArchiveCollisionError(
			"Active state changed before archive cleanup; Flow left it untouched.",
		);
	}
	await unlink(sessionPath(root));
	await synchronizeDirectory(flowDir(root));
}

export async function quarantineUnreadableSession(
	workspace: string,
): Promise<string | null> {
	const root = assertMutableWorkspaceRoot(workspace);
	if (
		(await pathKind(flowDir(root), "directory", "the Flow state directory")) ===
		"missing"
	) {
		return null;
	}
	const source = sessionPath(root);
	if ((await pathKind(source, "file", "the Flow session file")) === "missing") {
		return null;
	}
	await ensureHistoryDirectory(root);
	const target = join(historyDir(root), `quarantine-${randomUUID()}.json`);
	await rename(source, target);
	await syncDirectory(historyDir(root));
	return target;
}
