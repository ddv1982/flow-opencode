import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeQualificationBundle } from "../evals/qualification-bundle.js";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("prospective release restoration selects the verified bundle artifact and preserves its exact bytes", async () => {
	const root = await mkdtemp(join(tmpdir(), "flow-v2-artifact-"));
	temporary.push(root);
	const directory = join(root, "package");
	await mkdir(directory);
	const readme = join(directory, "README.md");
	await writeFile(readme, "qualified package\n");
	const sealed = join(root, "sealed.tgz");
	const rebuilt = join(root, "rebuilt.tgz");
	const pack = (path: string) => {
		const result = spawnSync("tar", ["-czf", path, "-C", root, "package"], {
			encoding: "utf8",
		});
		expect(result.status, result.stderr).toBe(0);
	};
	await chmod(readme, 0o664);
	pack(sealed);
	const bytes = await readFile(sealed);
	const roles = [
		"report",
		"catalog",
		"policy",
		"plan",
		"completion",
		"expected-provenance",
		"decision",
		"canary-record",
		"canary-installation",
		"canary-session",
		"canary-transcript",
	] as const;
	const bundle = await writeQualificationBundle({
		outputRoot: join(root, "bundles"),
		input: {
			reportId: "restoration-fixture",
			packageVersion: "10.0.0",
			verdict: "VERIFIED",
			files: [
				...roles.map((role) => ({
					role,
					mediaType: "application/json" as const,
					bytes: Buffer.from(JSON.stringify({ role })),
				})),
				{ role: "artifact", mediaType: "application/gzip", bytes },
				{
					role: "attempt",
					id: "attempt-1",
					mediaType: "application/json",
					bytes: Buffer.from("{}"),
				},
				{
					role: "transcript",
					id: "attempt-1",
					mediaType: "application/json",
					bytes: Buffer.from("{}"),
				},
				{
					role: "authority-source",
					id: "evals/analysis.ts",
					mediaType: "text/typescript",
					bytes: Buffer.from("export const fixture = true;\n"),
				},
			],
		},
	});
	await chmod(readme, 0o644);
	pack(rebuilt);
	expect(await readFile(rebuilt)).not.toEqual(bytes);
	const restore = (version: string) =>
		spawnSync(
			process.execPath,
			[
				resolve("scripts/restore-exact-release-artifact.ts"),
				rebuilt,
				"--bundle",
				bundle.path,
				version,
			],
			{ encoding: "utf8" },
		);
	expect(restore("9.6.0").status).not.toBe(0);
	const restored = restore("10.0.0");
	expect(restored.status, restored.stderr).toBe(0);
	expect(await readFile(rebuilt)).toEqual(bytes);
	await writeFile(readme, "unqualified change\n");
	pack(rebuilt);
	const changed = await readFile(rebuilt);
	const rejected = restore("10.0.0");
	expect(rejected.status).not.toBe(0);
	expect(rejected.stderr).toContain("Rebuilt package contents differ");
	expect(await readFile(rebuilt)).toEqual(changed);
});
