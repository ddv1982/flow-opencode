import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { relativeRef } from "./stack-standards-profile-helpers";
import { CACHE_FINGERPRINT_FILES } from "./stack-standards-signals";
import { candidateWorkspaceDirectories } from "./workspace-boundaries";

const CACHE_FINGERPRINT_ALGORITHM = "sha256";

export type StackStandardsFingerprint = {
	algorithm: typeof CACHE_FINGERPRINT_ALGORITHM;
	hash: string;
	files: string[];
};

export async function buildProfileFingerprint(
	workspaceRoot: string,
	startDirectory?: string,
): Promise<StackStandardsFingerprint> {
	const files = await collectFingerprintFiles(workspaceRoot, startDirectory);
	const hash = createHash(CACHE_FINGERPRINT_ALGORITHM);
	for (const file of files) {
		hash.update(file.reference);
		hash.update("\0");
		hash.update(
			createHash(CACHE_FINGERPRINT_ALGORITHM)
				.update(file.contents)
				.digest("hex"),
		);
		hash.update("\0");
	}
	return {
		algorithm: CACHE_FINGERPRINT_ALGORITHM,
		hash: hash.digest("hex"),
		files: files.map((file) => file.reference),
	};
}

async function collectFingerprintFiles(
	workspaceRoot: string,
	startDirectory?: string,
): Promise<Array<{ reference: string; contents: Buffer }>> {
	const paths = new Set<string>();
	for (const root of candidateWorkspaceDirectories(
		workspaceRoot,
		startDirectory,
	)) {
		for (const file of CACHE_FINGERPRINT_FILES) {
			paths.add(join(root, file));
		}
		for (const file of await collectDirectoryFiles(root, (entry) =>
			entry.endsWith(".csproj"),
		)) {
			paths.add(file);
		}
		for (const file of await collectDirectoryFiles(
			join(root, ".github", "workflows"),
			(entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"),
		)) {
			paths.add(file);
		}
	}

	const files: Array<{ reference: string; contents: Buffer }> = [];
	for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
		try {
			files.push({
				reference: relativeRef(workspaceRoot, path),
				contents: await readFile(path),
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}
	return files;
}

async function collectDirectoryFiles(
	root: string,
	include: (entry: string) => boolean,
): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && include(entry.name))
			.map((entry) => join(root, entry.name));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}
