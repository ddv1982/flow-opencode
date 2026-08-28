import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import {
	evaluatorIdentity,
	hostConfigSha256,
	inspectArtifact,
	inspectWorkingSource,
	instructionDelivery,
	normalizeRequestedModel,
	redactTranscript,
	samePackedArtifact,
	unpackedManifestSha256,
} from "../evals/provenance.js";

const exec = promisify(execFile);
const temporary: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function directory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "flow-provenance-"));
	temporary.push(path);
	return path;
}

async function command(cwd: string, args: readonly string[]): Promise<void> {
	await exec("git", args, { cwd });
}

async function repository(): Promise<string> {
	const root = await directory();
	await command(root, ["init", "--initial-branch=main"]);
	await command(root, ["config", "user.email", "eval@example.com"]);
	await command(root, ["config", "user.name", "Eval"]);
	await writeFile(join(root, "source.ts"), "export const source = 1;\n");
	await command(root, ["add", "source.ts"]);
	await command(root, ["commit", "-m", "fixture"]);
	return root;
}

async function artifact(
	root: string,
	name: string,
	contents: string,
): Promise<string> {
	const packageDirectory = join(root, "package");
	await mkdir(packageDirectory, { recursive: true });
	await writeFile(
		join(packageDirectory, "package.json"),
		'{"name":"fixture","version":"1.2.3"}\n',
	);
	await writeFile(join(packageDirectory, "index.js"), contents);
	const path = join(root, name);
	await exec("tar", ["-czf", path, "-C", root, "package"]);
	return path;
}

function unsafeTarball(path: string): Promise<void> {
	const contents = Buffer.from("unsafe\n");
	const header = Buffer.alloc(512);
	header.write("../outside.txt", 0, "utf8");
	header.write("0000644\0", 100, "ascii");
	header.write("0000000\0", 108, "ascii");
	header.write("0000000\0", 116, "ascii");
	header.write(`${contents.byteLength.toString(8).padStart(11, "0")}\0`, 124);
	header.write("00000000000\0", 136, "ascii");
	header.fill(" ", 148, 156);
	header.write("0", 156, "ascii");
	header.write("ustar\0", 257, "ascii");
	header.write("00", 263, "ascii");
	const checksum = header.reduce((total, byte) => total + byte, 0);
	header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
	const padding = Buffer.alloc((512 - (contents.byteLength % 512)) % 512);
	return writeFile(
		path,
		gzipSync(Buffer.concat([header, contents, padding, Buffer.alloc(1024)])),
	);
}

describe("eval provenance", () => {
	test("binds a commit and dirty working-content digest separately", async () => {
		const root = await repository();
		const clean = await inspectWorkingSource(root);
		await writeFile(join(root, "source.ts"), "export const source = 2;\n");
		const dirty = await inspectWorkingSource(root);
		expect(dirty.sourceCommit).toBe(clean.sourceCommit);
		expect(dirty.sourceTreeSha256).not.toBe(clean.sourceTreeSha256);
	});

	test("binds exact tar bytes and an unpacked manifest", async () => {
		const root = await repository();
		const first = await artifact(
			root,
			"first.tgz",
			"export const value = 1;\n",
		);
		const firstIdentity = await inspectArtifact({
			repositoryRoot: root,
			tarballPath: first,
		});
		const second = await artifact(
			root,
			"second.tgz",
			"export const value = 2;\n",
		);
		const secondIdentity = await inspectArtifact({
			repositoryRoot: root,
			tarballPath: second,
		});
		expect(firstIdentity.packageVersion).toBe("1.2.3");
		expect(secondIdentity.tarballSha256).not.toBe(firstIdentity.tarballSha256);
		expect(secondIdentity.unpackedManifestSha256).not.toBe(
			firstIdentity.unpackedManifestSha256,
		);
	});

	test("separates packed identity from source provenance", () => {
		const packed = {
			packageVersion: "1.2.3",
			sourceCommit: "candidate",
			sourceTreeSha256: "sha256:a".padEnd(71, "a"),
			tarballSha256: "sha256:b".padEnd(71, "b"),
			unpackedManifestSha256: "sha256:c".padEnd(71, "c"),
		};
		const sourceDrift = {
			...packed,
			sourceCommit: "tag-after-evidence",
			sourceTreeSha256: "sha256:d".padEnd(71, "d"),
		};
		const tarballDrift = {
			...packed,
			tarballSha256: "sha256:e".padEnd(71, "e"),
		};
		const manifestDrift = {
			...packed,
			unpackedManifestSha256: "sha256:f".padEnd(71, "f"),
		};
		expect(samePackedArtifact(packed, sourceDrift)).toBe(true);
		expect(samePackedArtifact(packed, tarballDrift)).toBe(false);
		expect(samePackedArtifact(packed, manifestDrift)).toBe(false);
	});

	test("rejects duplicate archive paths", async () => {
		const root = await repository();
		await artifact(root, "package.tgz", "export {};\n");
		const duplicate = join(root, "duplicate.tgz");
		await exec("tar", ["-czf", duplicate, "-C", root, "package", "package"]);
		await expect(unpackedManifestSha256(duplicate)).rejects.toThrow(
			"Duplicate tar archive path",
		);
	});

	test("rejects unsafe archive paths before extraction", async () => {
		const root = await repository();
		const unsafe = join(root, "unsafe.tgz");
		await unsafeTarball(unsafe);
		await expect(unpackedManifestSha256(unsafe)).rejects.toThrow(
			"Unsafe tar archive path",
		);
	});

	test("preserves gateway model ids after their first slash", () => {
		expect(
			normalizeRequestedModel({
				modelId: "openrouter/openai/gpt-5.6-sol",
				gateway: "openrouter",
				family: "gpt-5.6",
				revision: null,
			}),
		).toEqual({
			routeProvider: "openrouter",
			gateway: "openrouter",
			family: "gpt-5.6",
			model: "openai/gpt-5.6-sol",
			revision: null,
		});
	});

	test("hashes actual UTF-8 instruction bytes and canonical evaluator/config inputs", () => {
		const instruction = instructionDelivery({
			source: "guidance",
			name: "flow-run",
			sequence: 3,
			text: "€",
		});
		expect(instruction.bytes).toBe(3);
		expect(instruction.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
		const evaluator = evaluatorIdentity({
			sourceCommit: "commit",
			caseCatalog: { b: 2, a: 1 },
			policyCatalog: { version: 1 },
			graderBundle: ["grader"],
		});
		expect(evaluator.caseCatalogSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(hostConfigSha256({ b: 2, a: 1 })).toBe(
			hostConfigSha256({ a: 1, b: 2 }),
		);
		expect(
			hostConfigSha256({ reviewerModel: "a/model", reviewerSteps: null }),
		).not.toBe(
			hostConfigSha256({ reviewerModel: "b/model", reviewerSteps: 8 }),
		);
	});

	test("rejects malformed Unicode instruction text", () => {
		expect(() =>
			instructionDelivery({
				source: "guidance",
				name: "broken",
				sequence: 0,
				text: "\ud800",
			}),
		).toThrow("Unicode scalar values");
	});

	test("retains only canonical redacted transcript bytes", () => {
		const transcript = redactTranscript({
			projectPath: "/private/eval/project",
			value: {
				sessions: ["ses_parentSecret123", "session:review-child-123"],
				output:
					"/private/eval/project/src/index.ts api_key=super-secret-value sk-proj-abcdefghijklmnopqr",
			},
		});
		expect(transcript.text).toContain("<flow-eval-workspace>/src/index.ts");
		expect(transcript.text).toContain("[redacted]");
		expect(transcript.text).not.toContain("super-secret-value");
		expect(transcript.text).not.toContain("sk-proj-abcdefghijklmnopqr");
		expect(transcript.text).not.toContain("ses_parentSecret123");
		expect(transcript.text).not.toContain("session:review-child-123");
		expect(transcript.text).toMatch(/id_[a-f0-9]{16}/);
		expect(transcript.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	test("redacts transcript object keys as well as values", () => {
		const transcript = redactTranscript({
			projectPath: "/private/eval/project",
			value: {
				"/private/eval/project/src/index.ts": "ok",
				"api_key=super-secret-value": "ok",
			},
		});
		expect(transcript.text).not.toContain("/private/eval/project");
		expect(transcript.text).not.toContain("super-secret-value");
	});

	test("redacts short values under sensitive transcript fields", () => {
		const transcript = redactTranscript({
			projectPath: "/tmp/project",
			value: { token: "short", api_key: "abc", safe: "ok" },
		});
		expect(transcript.text).not.toContain("short");
		expect(transcript.text).not.toContain("abc");
		expect(transcript.text).toContain('"safe":"ok"');
	});
});
