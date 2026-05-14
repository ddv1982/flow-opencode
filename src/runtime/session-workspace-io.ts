import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { parseStrictJsonObject } from "./json/strict-object";
import { getSessionPathFromDir } from "./paths";
import { type Session, SessionSchema } from "./schema";

const preparedSessionDirs = new Set<string>();
const sessionReadCache = new Map<
	string,
	{
		key: string;
		session: Session;
	}
>();

type SessionWorkspaceFs = {
	open: typeof open;
	rename: typeof rename;
};

const sessionWorkspaceFs: SessionWorkspaceFs = {
	open,
	rename,
};

export async function syncSessionWorkspaceDirectory(
	directoryPath: string,
): Promise<void> {
	const directoryHandle = await sessionWorkspaceFs.open(directoryPath, "r");
	try {
		await directoryHandle.sync();
	} finally {
		await directoryHandle.close();
	}
}

export async function renameSessionWorkspacePath(
	from: string,
	to: string,
): Promise<void> {
	await sessionWorkspaceFs.rename(from, to);
}

async function writeFileAtomically(
	targetPath: string,
	contents: string,
): Promise<void> {
	const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
	const fileHandle = await sessionWorkspaceFs.open(tempPath, "w");

	try {
		await fileHandle.writeFile(contents, "utf8");
		await fileHandle.sync();
	} catch (error) {
		await fileHandle.close();
		await rm(tempPath, { force: true });
		throw error;
	}

	await fileHandle.close();

	try {
		await sessionWorkspaceFs.rename(tempPath, targetPath);
	} catch (error) {
		await rm(tempPath, { force: true });
		throw error;
	}

	try {
		await syncSessionWorkspaceDirectory(dirname(targetPath));
	} catch (error) {
		throw new Error(
			`Atomic session write renamed '${targetPath}' but directory sync failed: ${(error as Error).message}`,
		);
	}
}

export function setSessionWorkspaceFsForTests(
	nextFs: Partial<SessionWorkspaceFs>,
): void {
	if (nextFs.open) {
		sessionWorkspaceFs.open = nextFs.open;
	}
	if (nextFs.rename) {
		sessionWorkspaceFs.rename = nextFs.rename;
	}
}

export function resetSessionWorkspaceFsForTests(): void {
	sessionWorkspaceFs.open = open;
	sessionWorkspaceFs.rename = rename;
}

export async function readSessionFromPath(
	sessionPath: string,
): Promise<Session> {
	const raw = await readFile(sessionPath, "utf8");
	const cacheKey = createHash("sha256").update(raw).digest("hex");
	const cached = sessionReadCache.get(sessionPath);
	if (cached?.key === cacheKey) {
		return structuredClone(cached.session);
	}

	const object = parseStrictJsonObject(raw, "Session file");
	if (!object.ok) {
		throw new Error(object.error);
	}
	const parsed = SessionSchema.parse(object.value);
	sessionReadCache.set(sessionPath, {
		key: cacheKey,
		session: structuredClone(parsed),
	});
	return structuredClone(parsed);
}

export async function writeSessionFileAtDir(
	sessionDir: string,
	session: Session,
): Promise<void> {
	if (preparedSessionDirs.has(sessionDir)) {
		try {
			await stat(sessionDir);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				preparedSessionDirs.delete(sessionDir);
			} else {
				throw error;
			}
		}
	}

	if (!preparedSessionDirs.has(sessionDir)) {
		await mkdir(sessionDir, { recursive: true });
		preparedSessionDirs.add(sessionDir);
	}
	const sessionPath = getSessionPathFromDir(sessionDir);
	await writeFileAtomically(
		sessionPath,
		`${JSON.stringify(session, null, 2)}\n`,
	);
	sessionReadCache.delete(sessionPath);
}
