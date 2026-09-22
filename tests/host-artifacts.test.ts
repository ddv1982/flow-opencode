import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmod,
	copyFile,
	cp,
	lstat,
	mkdir,
	mkdtemp,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	artifactTree,
	captureHostArtifacts,
	stageHostArtifacts,
	verifyHostArtifacts,
} from "../evals/host-artifacts.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function setup() {
	const root = await mkdtemp(join(tmpdir(), "host-artifact-test-"));
	roots.push(root);
	const cache = join(root, "cache");
	await mkdir(join(cache, "empty"), { recursive: true });
	await writeFile(join(cache, "module.js"), "hello");
	const paths = {
		bun: process.execPath,
		opencode: process.execPath,
		packageCache: cache,
	};
	const expected = await captureHostArtifacts({
		paths,
		bunVersion: Bun.version,
		opencodeVersion: Bun.version,
	});
	return { root, cache, paths, expected };
}
test("tree identity covers file bytes executable mode empty directories and contained links independent of root", async () => {
	const f = await setup();
	await symlink("module.js", join(f.cache, "link"));
	expect(await artifactTree(f.cache)).toEqual([
		{ kind: "directory", path: "empty" },
		{ kind: "symlink", path: "link", target: "module.js" },
		{
			kind: "file",
			path: "module.js",
			bytes: {
				sha256:
					"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
				size: 5,
				executable: false,
			},
		},
	]);
	const relocated = join(f.root, "relocated");
	await cp(f.cache, relocated, { recursive: true, verbatimSymlinks: true });
	expect(await artifactTree(relocated)).toEqual(await artifactTree(f.cache));
	await chmod(join(relocated, "module.js"), 0o700);
	expect(await artifactTree(relocated)).not.toEqual(
		await artifactTree(f.cache),
	);
});
test("escaping links cycles and special cache entries fail closed", async () => {
	const f = await setup();
	await symlink("../outside", join(f.cache, "link"));
	await expect(artifactTree(f.cache)).rejects.toThrow("escapes");
	await rm(join(f.cache, "link"));
	await symlink("link", join(f.cache, "link"));
	await expect(artifactTree(f.cache)).rejects.toThrow();
	await rm(join(f.cache, "link"));
	if (process.platform !== "win32") {
		expect(spawnSync("mkfifo", [join(f.cache, "fifo")]).status).toBe(0);
		await expect(artifactTree(f.cache)).rejects.toThrow("Unsupported");
	}
});
test("private stage retains exact bytes and refuses destination drift", async () => {
	const f = await setup();
	await symlink("module.js", join(f.cache, "link"));
	f.expected.packageCache = await artifactTree(f.cache);
	const staged = await stageHostArtifacts({
		paths: f.paths,
		expected: f.expected,
		directory: join(f.root, "bin"),
		packageCache: join(f.root, "copied-cache"),
	});
	expect(staged.bun).toBe(join(f.root, "bin", "bun"));
	expect(await artifactTree(staged.packageCache ?? "")).toEqual(
		f.expected.packageCache,
	);
	await writeFile(join(staged.packageCache ?? "", "module.js"), "other");
	await expect(verifyHostArtifacts(staged, f.expected)).rejects.toThrow(
		"bytes changed",
	);
});
test("same-version source byte changes and native launcher scripts cannot start", async () => {
	const f = await setup();
	await writeFile(join(f.cache, "module.js"), "other");
	await expect(
		stageHostArtifacts({
			paths: f.paths,
			expected: f.expected,
			directory: join(f.root, "bin"),
			packageCache: join(f.root, "copy"),
		}),
	).rejects.toThrow("bytes changed");
	const script = join(f.root, "launcher");
	await writeFile(script, "#!/bin/sh\necho 1.4.0\n", { mode: 0o700 });
	await expect(
		captureHostArtifacts({
			paths: { ...f.paths, opencode: script },
			bunVersion: Bun.version,
			opencodeVersion: Bun.version,
		}),
	).rejects.toThrow("native");
	const native = join(f.root, "native");
	await copyFile(process.execPath, native);
	const paths = { ...f.paths, opencode: native };
	const expected = await captureHostArtifacts({
		paths,
		bunVersion: Bun.version,
		opencodeVersion: Bun.version,
	});
	const replacement = join(f.root, "replacement");
	await copyFile(process.execPath, replacement);
	await writeFile(replacement, Buffer.from("7f454c4600000000", "hex"));
	await chmod(replacement, 0o700);
	await rename(replacement, native);
	await expect(verifyHostArtifacts(paths, expected)).rejects.toThrow(
		"bytes changed",
	);
});
test("stage refuses wrong reported versions and cancellation", async () => {
	const f = await setup();
	await expect(
		stageHostArtifacts({
			paths: f.paths,
			expected: {
				...f.expected,
				opencode: { ...f.expected.opencode, version: "0.0.0" },
			},
			directory: join(f.root, "bin"),
			packageCache: join(f.root, "copy"),
		}),
	).rejects.toThrow("version differs");
	await expect(
		stageHostArtifacts({
			paths: f.paths,
			expected: f.expected,
			directory: join(f.root, "cancelled-bin"),
			packageCache: join(f.root, "cancelled-cache"),
			signal: AbortSignal.abort(),
		}),
	).rejects.toThrow();
});

test("symlinked cache root becomes an independent private directory", async () => {
	const f = await setup();
	const linked = join(f.root, "linked-cache");
	await symlink(f.cache, linked);
	const staged = await stageHostArtifacts({
		paths: { ...f.paths, packageCache: linked },
		expected: f.expected,
		directory: join(f.root, "bin"),
		packageCache: join(f.root, "copied-cache"),
	});
	expect((await lstat(staged.packageCache ?? "")).isSymbolicLink()).toBe(false);
	await writeFile(join(f.cache, "module.js"), "changed-source");
	await verifyHostArtifacts(staged, f.expected);
	expect(await artifactTree(staged.packageCache ?? "")).toEqual(
		f.expected.packageCache ?? [],
	);
});
