import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
	appendFile,
	lstat,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	SourceIdentityGitError,
	SourceIdentityOverflowError,
	SourceIdentityRaceError,
	SourceIdentityUnreadableError,
	SourceIdentityUnsafeSymlinkError,
} from "../src/application/ports/source-identity.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import {
	createFileSourceIdentityProvider,
	MAX_SOURCE_FILE_BYTES,
} from "../src/infrastructure/fs/source-identity.js";

const execFileAsync = promisify(execFile);
const ancestorRaceProbe = fileURLToPath(
	new URL("./support/ancestor-directory-race-probe.ts", import.meta.url),
);
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "flow-source-identity-"));
	temporaryRoots.push(root);
	return root;
}

async function git(root: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
		encoding: "utf8",
	});
	return stdout;
}

async function initializeRepository(
	root: string,
	commit = false,
): Promise<void> {
	await git(root, "init", "--initial-branch=main");
	await git(root, "config", "user.email", "source-identity@example.invalid");
	await git(root, "config", "user.name", "Source Identity Test");
	if (commit) {
		await writeFile(join(root, "tracked.txt"), "tracked\n", "utf8");
		await git(root, "add", "tracked.txt");
		await git(root, "commit", "-m", "initial");
	}
}

async function createEmptyDirectories(
	root: string,
	count: number,
): Promise<void> {
	const batchSize = 250;
	for (let offset = 0; offset < count; offset += batchSize) {
		await Promise.all(
			Array.from({ length: Math.min(batchSize, count - offset) }, (_, index) =>
				mkdir(join(root, `empty-${String(offset + index).padStart(5, "0")}`)),
			),
		);
	}
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("source identity", () => {
	test("uses the source-v2 domain for a non-Git workspace", async () => {
		const root = await temporaryRoot();

		const identity =
			await createFileSourceIdentityProvider(root).computeSourceIdentity();

		expect(identity).toEqual({
			digest:
				"sha256:6bc5397aaea2996a110712ce56606ff3f56d78211c767a62da586be4dd5c4906",
			mode: "non-git",
			entryCount: 0,
		});
	});

	test("measures an ordinary populated non-Git tree deterministically", async () => {
		const root = await temporaryRoot();
		await mkdir(join(root, "src"));
		await writeFile(join(root, "README.md"), "alpha\n", "utf8");
		await writeFile(join(root, "src", "index.ts"), "export {};\n", "utf8");
		const provider = createFileSourceIdentityProvider(root);

		const populated = await provider.computeSourceIdentity();
		await mkdir(join(root, "empty"));
		const withEmptyDirectory = await provider.computeSourceIdentity();

		expect(populated).toEqual(withEmptyDirectory);
		expect(populated).toEqual({
			digest:
				"sha256:4ed393d303547518f485616e2a525135317fbd98509750c7e01c95c0d8500911",
			mode: "non-git",
			entryCount: 2,
		});
	});

	test("accepts the per-file byte limit and rejects limit plus one", async () => {
		const root = await temporaryRoot();
		const source = join(root, "bounded.bin");
		await writeFile(source, "");
		await truncate(source, MAX_SOURCE_FILE_BYTES);

		const identity =
			await createFileSourceIdentityProvider(root).computeSourceIdentity();

		expect(identity.entryCount).toBe(1);
		await truncate(source, MAX_SOURCE_FILE_BYTES + 1);
		await expect(
			createFileSourceIdentityProvider(root).computeSourceIdentity(),
		).rejects.toBeInstanceOf(SourceIdentityOverflowError);
	});

	test("counts empty directories toward the traversal limit", async () => {
		const root = await temporaryRoot();
		const maxEntries = 64;
		await createEmptyDirectories(root, maxEntries);
		const provider = createFileSourceIdentityProvider(root, { maxEntries });

		const identity = await provider.computeSourceIdentity();

		expect(identity.entryCount).toBe(0);
		await mkdir(join(root, "overflow"));
		await expect(provider.computeSourceIdentity()).rejects.toBeInstanceOf(
			SourceIdentityOverflowError,
		);
	});

	test("records safe symlinks without following their targets", async () => {
		if (process.platform === "win32") return;
		const root = await temporaryRoot();
		await mkdir(join(root, ".flow"));
		await writeFile(join(root, ".flow", "ignored.bin"), "");
		await truncate(
			join(root, ".flow", "ignored.bin"),
			MAX_SOURCE_FILE_BYTES + 1,
		);
		await symlink(".flow/ignored.bin", join(root, "source-link"));

		const identity =
			await createFileSourceIdentityProvider(root).computeSourceIdentity();

		expect(identity.mode).toBe("non-git");
		expect(identity.entryCount).toBe(1);
	});

	test("fails closed while a source file grows during measurement", async () => {
		const root = await temporaryRoot();
		const source = join(root, "changing.bin");
		await writeFile(source, Buffer.alloc(1024 * 1024));
		let keepGrowing = true;
		let signalFirstAppend: (() => void) | undefined;
		const firstAppend = new Promise<void>((resolve) => {
			signalFirstAppend = resolve;
		});
		const mutator = (async () => {
			let appendCount = 0;
			while (keepGrowing) {
				await appendFile(source, Buffer.from([appendCount % 256]));
				appendCount += 1;
				if (appendCount === 1) signalFirstAppend?.();
			}
		})();
		await firstAppend;

		try {
			await expect(
				createFileSourceIdentityProvider(root).computeSourceIdentity(),
			).rejects.toBeInstanceOf(SourceIdentityRaceError);
		} finally {
			keepGrowing = false;
			await mutator;
		}
	});

	test("fails closed when a validated source ancestor is substituted", async () => {
		if (process.platform === "win32") return;
		await execFileAsync(process.execPath, [ancestorRaceProbe, "source"]);
	});

	test("accepts an ordinary Git directory and an unborn HEAD", async () => {
		const root = await temporaryRoot();
		await initializeRepository(root);

		const identity =
			await createFileSourceIdentityProvider(root).computeSourceIdentity();

		expect(identity.mode).toBe("git");
		expect(identity.entryCount).toBe(0);
	});

	test("does not treat a malformed symbolic HEAD as unborn", async () => {
		const root = await temporaryRoot();
		await initializeRepository(root);
		await writeFile(
			join(root, ".git", "refs", "heads", "main"),
			"not-an-object-id\n",
			"utf8",
		);

		await expect(
			createFileSourceIdentityProvider(root).computeSourceIdentity(),
		).rejects.toBeInstanceOf(SourceIdentityGitError);
	});

	test("accepts a linked-worktree gitfile", async () => {
		const parent = await temporaryRoot();
		const primary = join(parent, "primary");
		const linked = join(parent, "linked");
		await mkdir(primary);
		await initializeRepository(primary, true);
		await git(primary, "worktree", "add", "-b", "linked-test", linked);

		const dotGit = await lstat(join(linked, ".git"));
		expect(dotGit.isFile()).toBe(true);
		expect(dotGit.isSymbolicLink()).toBe(false);
		const identity =
			await createFileSourceIdentityProvider(linked).computeSourceIdentity();

		expect(identity.mode).toBe("git");
		expect(identity.entryCount).toBe(1);
	});

	test("rejects a symlinked .git entry without following it", async () => {
		if (process.platform === "win32") return;
		const parent = await temporaryRoot();
		const primary = join(parent, "primary");
		const workspace = join(parent, "workspace");
		await mkdir(primary);
		await mkdir(workspace);
		await initializeRepository(primary, true);
		await symlink(join(primary, ".git"), join(workspace, ".git"), "dir");

		await expect(
			createFileSourceIdentityProvider(workspace).computeSourceIdentity(),
		).rejects.toBeInstanceOf(SourceIdentityUnsafeSymlinkError);
	});

	test("rejects invalid and mismatched-worktree Git candidates", async () => {
		const parent = await temporaryRoot();
		const invalid = join(parent, "invalid");
		const primary = join(parent, "primary");
		const wrongRoot = join(parent, "wrong-root");
		await mkdir(invalid);
		await mkdir(primary);
		await mkdir(wrongRoot);
		await writeFile(join(invalid, ".git"), "gitdir: ../missing\n", "utf8");
		await initializeRepository(primary, true);
		await initializeRepository(wrongRoot);
		await git(wrongRoot, "config", "core.worktree", primary);

		await expect(
			createFileSourceIdentityProvider(invalid).computeSourceIdentity(),
		).rejects.toBeInstanceOf(SourceIdentityGitError);
		await expect(
			createFileSourceIdentityProvider(wrongRoot).computeSourceIdentity(),
		).rejects.toBeInstanceOf(SourceIdentityGitError);
	});

	test("rejects a non-file, non-directory .git entry", async () => {
		if (process.platform === "win32") return;
		const root = await temporaryRoot();
		await execFileAsync("mkfifo", [join(root, ".git")]);

		await expect(
			createFileSourceIdentityProvider(root).computeSourceIdentity(),
		).rejects.toBeInstanceOf(SourceIdentityUnreadableError);
	});

	test("uses index-only state for sparse absence and distinguishes materialization", async () => {
		const root = await temporaryRoot();
		await initializeRepository(root);
		await mkdir(join(root, "included"));
		await mkdir(join(root, "excluded"));
		await writeFile(join(root, "included", "present.txt"), "present\n", "utf8");
		await writeFile(join(root, "excluded", "sparse.txt"), "sparse\n", "utf8");
		await git(root, "add", ".");
		await git(root, "commit", "-m", "sparse fixture");
		const provider = createFileSourceIdentityProvider(root);
		const dense = await provider.computeSourceIdentity();

		await git(root, "sparse-checkout", "init", "--cone", "--sparse-index");
		await git(root, "sparse-checkout", "set", "included");
		await expect(
			lstat(join(root, "excluded", "sparse.txt")),
		).rejects.toMatchObject({
			code: "ENOENT",
		});
		const sparse = await provider.computeSourceIdentity();

		expect(sparse.mode).toBe("git");
		expect(sparse.entryCount).toBe(2);
		expect(sparse.digest).not.toBe(dense.digest);

		await rm(join(root, "included", "present.txt"));
		const deleted = await provider.computeSourceIdentity();
		expect(deleted.digest).not.toBe(sparse.digest);
	});

	test("exposes source identity only inside the repository transaction", async () => {
		const root = await temporaryRoot();
		const repository = createFileSessionRepository(root);

		expect("computeSourceIdentity" in repository).toBe(false);
		const identity = await repository.transact((transaction) =>
			transaction.computeSourceIdentity(),
		);
		expect(identity.mode).toBe("non-git");
	});
});
