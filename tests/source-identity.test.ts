import { afterEach, describe, expect, test } from "bun:test";
import { execFile, spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	rm,
	symlink,
	truncate,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MAX_SOURCE_FILE_BYTES } from "../src/domain/limits.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import {
	createFileSourceIdentityProvider,
	SourceIdentityError,
} from "../src/infrastructure/fs/source-identity.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "flow-source-identity-"));
	temporaryRoots.push(root);
	return root;
}

async function repository(): Promise<string> {
	const root = await temporaryRoot();
	await execFileAsync("git", ["-C", root, "init", "--quiet"]);
	return root;
}

async function git(root: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", root, ...args]);
	return stdout;
}

async function digest(root: string): Promise<string> {
	return createFileSourceIdentityProvider(root).computeSourceDigest();
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("workspace content fingerprint", () => {
	test("hashes tracked and nonignored untracked files in deterministic path order", async () => {
		const first = await repository();
		const second = await repository();

		await writeFile(join(first, "untracked.txt"), "untracked\n");
		await writeFile(join(first, "tracked.txt"), "tracked\n");
		await git(first, "add", "tracked.txt");

		await writeFile(join(second, "tracked.txt"), "tracked\n");
		await git(second, "add", "tracked.txt");
		await writeFile(join(second, "untracked.txt"), "untracked\n");

		const firstDigest = await digest(first);
		expect(firstDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(await digest(first)).toBe(firstDigest);
		expect(await digest(second)).toBe(firstDigest);
	});

	test("changes when tracked or untracked content changes", async () => {
		const root = await repository();
		await writeFile(join(root, "tracked.txt"), "one\n");
		await writeFile(join(root, "untracked.txt"), "alpha\n");
		await git(root, "add", "tracked.txt");
		const initial = await digest(root);

		await writeFile(join(root, "tracked.txt"), "two\n");
		const trackedChange = await digest(root);
		expect(trackedChange).not.toBe(initial);

		await writeFile(join(root, "untracked.txt"), "beta\n");
		expect(await digest(root)).not.toBe(trackedChange);
	});

	test.skipIf(process.platform === "win32")(
		"hashes index-shaped untracked filenames literally, including fake gitlinks",
		async () => {
			const root = await repository();
			for (const mode of ["100644", "160000"]) {
				const name = `${mode} ${"a".repeat(40)} 0\tdecoy.txt`;
				await writeFile(join(root, name), "one\n");
				const before = await digest(root);
				await writeFile(join(root, name), "two\n");
				expect(await digest(root)).not.toBe(before);
				const untracked = await digest(root);
				await git(root, "add", "--", name);
				expect(await digest(root)).toBe(untracked);
			}
		},
	);

	test("preserves Unicode and whitespace paths before and after staging", async () => {
		const root = await repository();
		const names = ["space name.txt", "caf\u00e9.txt"];
		if (process.platform !== "win32") names.push("tab\tand\nnewline.txt");
		for (const name of names) {
			await writeFile(join(root, name), "one\n");
			const before = await digest(root);
			await writeFile(join(root, name), "two\n");
			expect(await digest(root)).not.toBe(before);
			const untracked = await digest(root);
			await git(root, "add", "--", name);
			expect(await digest(root)).toBe(untracked);
		}
	});

	test.each(["skip-worktree", "unmerged"])(
		"fingerprints effective content independently of %s index records",
		async (state) => {
			const root = await repository();
			await writeFile(join(root, "source.txt"), "one\n");
			await git(root, "add", "source.txt");
			const before = await digest(root);
			if (state === "skip-worktree") {
				await git(root, "update-index", "--skip-worktree", "source.txt");
			} else {
				const hash = (await git(root, "ls-files", "--stage")).split(" ")[1];
				const indexed = spawnSync(
					"git",
					["-C", root, "update-index", "--index-info"],
					{
						input: `0 ${"0".repeat(40)}\tsource.txt\n${[1, 2, 3].map((stage) => `100644 ${hash} ${stage}\tsource.txt\n`).join("")}`,
					},
				);
				expect(indexed.status).toBe(0);
			}
			const records = (
				await git(
					root,
					"ls-files",
					"-co",
					"--exclude-standard",
					"--stage",
					"-t",
					"-z",
				)
			)
				.split("\0")
				.filter(Boolean);
			expect(records).toHaveLength(state === "skip-worktree" ? 1 : 3);
			expect(
				records.every((record) =>
					record.startsWith(state === "skip-worktree" ? "S " : "M "),
				),
			).toBe(true);
			expect(await digest(root)).toBe(before);
			await writeFile(join(root, "source.txt"), "two\n");
			expect(await digest(root)).not.toBe(before);
		},
	);

	test("rejects non-UTF-8 index paths instead of hashing a missing replacement path", async () => {
		const root = await repository();
		const record = Buffer.concat([
			Buffer.from(`100644 ${"a".repeat(40)} 0\tinvalid-`),
			Buffer.from([0xff, 0]),
		]);
		const indexed = spawnSync(
			"git",
			["-C", root, "update-index", "-z", "--index-info"],
			{ input: record },
		);
		expect(indexed.status).toBe(0);
		await expect(digest(root)).rejects.toThrow("UTF-8 workspace filenames");
	});

	test("represents a missing tracked path and returns to the same digest when restored", async () => {
		const root = await repository();
		const source = join(root, "tracked.txt");
		await writeFile(source, "present\n");
		await git(root, "add", "tracked.txt");
		const present = await digest(root);

		await rm(source);
		expect(await digest(root)).not.toBe(present);

		await writeFile(source, "present\n");
		expect(await digest(root)).toBe(present);
	});

	test("hashes symlink targets without following them", async () => {
		if (process.platform === "win32") return;
		const root = await repository();
		await writeFile(join(root, ".gitignore"), "target-*.txt\n");
		await writeFile(join(root, "target-one.txt"), "one\n");
		await writeFile(join(root, "target-two.txt"), "two\n");
		const link = join(root, "source-link");
		await symlink("target-one.txt", link);
		const initial = await digest(root);

		await writeFile(join(root, "target-one.txt"), "changed but ignored\n");
		expect(await digest(root)).toBe(initial);

		await unlink(link);
		await symlink("target-two.txt", link);
		expect(await digest(root)).not.toBe(initial);
	});

	test("excludes ignored files and Flow runtime state", async () => {
		const root = await repository();
		await writeFile(join(root, ".gitignore"), "ignored.log\n");
		await writeFile(join(root, "source.ts"), "export {};\n");
		const beforeRuntimeState = await digest(root);

		await writeFile(join(root, "ignored.log"), "ignored\n");
		await mkdir(join(root, ".flow"));
		await writeFile(join(root, ".flow", "session.json"), "runtime state\n");
		expect(await digest(root)).toBe(beforeRuntimeState);

		await writeFile(join(root, ".flow", "session.json"), "new runtime state\n");
		expect(await digest(root)).toBe(beforeRuntimeState);
	});

	test("fails with one bounded error for unsupported workspaces and oversized files", async () => {
		const nonGit = await temporaryRoot();
		await expect(digest(nonGit)).rejects.toBeInstanceOf(SourceIdentityError);

		const root = await repository();
		const oversized = join(root, "oversized.bin");
		await writeFile(oversized, "");
		await truncate(oversized, MAX_SOURCE_FILE_BYTES + 1);
		await expect(digest(root)).rejects.toBeInstanceOf(SourceIdentityError);
	});

	test("rejects tracked gitlinks instead of partially fingerprinting submodules", async () => {
		const root = await repository();
		await writeFile(join(root, "seed.txt"), "seed\n");
		await git(root, "add", "seed.txt");
		await git(
			root,
			"-c",
			"user.name=Flow Test",
			"-c",
			"user.email=flow@example.invalid",
			"commit",
			"--quiet",
			"-m",
			"seed",
		);
		const commit = (await git(root, "rev-parse", "HEAD")).trim();
		await git(
			root,
			"update-index",
			"--add",
			"--cacheinfo",
			`160000,${commit},vendor/submodule`,
		);

		await expect(digest(root)).rejects.toThrow(
			"Flow does not support Git submodules in source fingerprints",
		);
	});

	test("makes fingerprinting available inside repository transactions", async () => {
		const root = await repository();
		await writeFile(join(root, "source.ts"), "export {};\n");
		const sessions = createFileSessionRepository(root);

		expect("computeSourceDigest" in sessions).toBe(false);
		const result = await sessions.transact((transaction) =>
			transaction.computeSourceDigest(),
		);
		expect(result).toMatch(/^sha256:[a-f0-9]{64}$/);
	});
});
