import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export type AtomicPersistenceFs = {
	open: typeof open;
	rename: typeof rename;
};

const defaultPersistenceFs: AtomicPersistenceFs = { open, rename };
const persistenceFs: AtomicPersistenceFs = { ...defaultPersistenceFs };

export function setPersistenceFsForTests(
	nextFs: Partial<AtomicPersistenceFs>,
): void {
	if (nextFs.open) {
		persistenceFs.open = nextFs.open;
	}
	if (nextFs.rename) {
		persistenceFs.rename = nextFs.rename;
	}
}

export function resetPersistenceFsForTests(): void {
	persistenceFs.open = defaultPersistenceFs.open;
	persistenceFs.rename = defaultPersistenceFs.rename;
}

export async function writeFileAtomically(
	targetPath: string,
	contents: string,
): Promise<void> {
	const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
	const fileHandle = await persistenceFs.open(tempPath, "w");

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
		await persistenceFs.rename(tempPath, targetPath);
	} catch (error) {
		await rm(tempPath, { force: true });
		throw error;
	}

	const directoryHandle = await persistenceFs.open(dirname(targetPath), "r");
	try {
		await directoryHandle.sync();
	} finally {
		await directoryHandle.close();
	}
}
