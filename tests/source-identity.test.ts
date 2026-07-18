import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
	lstat,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	SourceIdentityGitError,
	SourceIdentityUnreadableError,
	SourceIdentityUnsafeSymlinkError,
} from "../src/application/ports/source-identity.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import { createFileSourceIdentityProvider } from "../src/infrastructure/fs/source-identity.js";

const execFileAsync = promisify(execFile);
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
