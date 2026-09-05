import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { canonicalJson } from "../evals/canonical-json.js";
import {
	type QualificationBundleInput,
	readQualificationBundle,
	readStableQualificationInput,
	writeQualificationBundle,
} from "../evals/qualification-bundle.js";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

const json = (value: unknown) => Buffer.from(canonicalJson(value));
const temporaryToolOutput =
	"/tmp/flow-eval-Vj7Io4/home/.local/share/opencode/tool-output/tool_123.txt";
function tarball(
	content = "safe artifact\n",
	name = "package/readme.txt",
): Buffer {
	const body = Buffer.from(content);
	const header = Buffer.alloc(512);
	header.write(name, 0, "utf8");
	const octal = (value: number, offset: number, length: number) =>
		header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset);
	octal(0o644, 100, 8);
	octal(0, 108, 8);
	octal(0, 116, 8);
	octal(body.byteLength, 124, 12);
	octal(0, 136, 12);
	header.fill(0x20, 148, 156);
	header.write("0", 156, "ascii");
	header.write("ustar\0", 257, "ascii");
	header.write("00", 263, "ascii");
	const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
	header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
	const padding = Buffer.alloc(((512 - (body.byteLength % 512)) % 512) + 1024);
	return gzipSync(Buffer.concat([header, body, padding]));
}
const input = (): QualificationBundleInput => ({
	reportId: "report-1",
	packageVersion: "9.0.0",
	verdict: "VERIFIED",
	files: [
		...(
			[
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
			] as const
		).map((role) => ({
			role,
			mediaType: "application/json" as const,
			bytes: json({ role, session: "id_0123456789abcdef" }),
		})),
		{
			role: "artifact" as const,
			mediaType: "application/gzip" as const,
			bytes: tarball(),
		},
		{
			role: "attempt" as const,
			id: "attempt-1",
			mediaType: "application/json" as const,
			bytes: json({ attemptId: "attempt-1" }),
		},
		{
			role: "transcript" as const,
			id: "attempt-1",
			mediaType: "application/json" as const,
			bytes: json({ gradeInput: { schemaVersion: 1 } }),
		},
		{
			role: "authority-source" as const,
			id: "evals/analysis.ts",
			mediaType: "text/typescript" as const,
			bytes: Buffer.from("export const analyzer = true;\n"),
		},
	],
});

describe("qualification bundle", () => {
	test("writes, seals, reads, and byte-identically replays one bundle", async () => {
		const outputRoot = await mkdtemp(join(tmpdir(), "flow-bundle-"));
		temporary.push(outputRoot);
		const first = await writeQualificationBundle({
			input: input(),
			outputRoot,
		});
		const replay = await writeQualificationBundle({
			input: input(),
			outputRoot,
		});
		expect(replay.path).toBe(first.path);
		expect(replay.kind).toBe("replayed");
		const read = await readQualificationBundle(first.path);
		expect(read.manifest.bundleSha256).toBe(first.manifest.bundleSha256);
		expect(read.files).toHaveLength(input().files.length);
	});

	test("R29-01 preserves temporary HOME transcript and artifact bytes", async () => {
		const outputRoot = await mkdtemp(join(tmpdir(), "flow-bundle-"));
		temporary.push(outputRoot);
		const transcript = json({
			gradeInput: {
				schemaVersion: 1,
				table: `|Path|\n|---|\n|${temporaryToolOutput}|`,
				messages: [
					{
						tool: {
							path: temporaryToolOutput,
							error: JSON.stringify({
								message: `Permission denied reading '${temporaryToolOutput}'`,
								permission: { patterns: [temporaryToolOutput] },
							}),
							escapedError: JSON.stringify({
								path: temporaryToolOutput,
							}).replaceAll("/", "\\/"),
						},
					},
				],
			},
		});
		const artifact = tarball(`Tool output: ${temporaryToolOutput}\n`);
		const fixture = input();
		const written = await writeQualificationBundle({
			input: {
				...fixture,
				files: fixture.files.map((file) =>
					file.role === "transcript"
						? { ...file, bytes: transcript }
						: file.role === "artifact"
							? { ...file, bytes: artifact }
							: file,
				),
			},
			outputRoot,
		});
		const read = await readQualificationBundle(written.path);
		expect(
			read.files.find(({ ref }) => ref.role === "transcript")?.bytes,
		).toEqual(transcript);
		expect(
			read.files.find(({ ref }) => ref.role === "artifact")?.bytes,
		).toEqual(artifact);
	});

	test.each([
		["transcript", "/home/alice/private.txt"],
		["transcript", "/Users/alice/private.txt"],
		["transcript", "C:\\Users\\alice\\private.txt"],
		["transcript", "/home/.alice/private.txt"],
		["transcript", "/Users/.alice/private.txt"],
		["transcript", "C:\\Users\\.alice\\private.txt"],
		["transcript", "Permission denied reading '/home/alice/private.txt'"],
		[
			"transcript",
			JSON.stringify({ error: { path: "C:\\Users\\alice\\private.txt" } }),
		],
		["transcript", "file:///home/alice/private.txt"],
		["transcript", "file://localhost/Users/alice/private.txt"],
		["transcript", "//home/alice/private.txt"],
		["transcript", "Permission denied:\t/home/alice/private.txt"],
		["transcript", "See **/home/alice/private.txt**"],
		["transcript", "See __/Users/alice/private.txt__"],
		["transcript", `${temporaryToolOutput}\nSee **/Users/alice/private.txt**`],
		[
			"transcript",
			JSON.stringify({ path: "/home/alice/private.txt" }).replaceAll(
				"/",
				"\\/",
			),
		],
		[
			"transcript",
			JSON.stringify({ path: "/Users/alice/private.txt" }).replaceAll(
				"/",
				"\\/",
			),
		],
		[
			"transcript",
			`${temporaryToolOutput}\n${JSON.stringify({ path: "/home/alice/private.txt" }).replaceAll("/", "\\/")}`,
		],
		["artifact", "See **/home/alice/private.txt**"],
		["transcript", "|Path|\n|---|\n|/home/alice/private.txt|"],
		["transcript", "|Path|\n|---|\n|/Users/alice/private.txt|"],
		["artifact", "|Path|\n|---|\n|/home/alice/private.txt|"],
		["artifact", "|Path|\n|---|\n|/Users/alice/private.txt|"],
		[
			"transcript",
			`|Path|\n|---|\n|${temporaryToolOutput}|\n|/home/alice/private.txt|`,
		],
		[
			"transcript",
			`|Path|\n|---|\n|${temporaryToolOutput}|\n|/Users/alice/private.txt|`,
		],
		[
			"artifact",
			`|Path|\n|---|\n|${temporaryToolOutput}|\n|/home/alice/private.txt|`,
		],
		[
			"artifact",
			`|Path|\n|---|\n|${temporaryToolOutput}|\n|/Users/alice/private.txt|`,
		],
		["transcript", `${temporaryToolOutput}\n/home/alice/private.txt`],
		["artifact", `${temporaryToolOutput}\n/home/alice/private.txt`],
	])("R29-01 rejects private user paths in %s: %s", async (role, evidence) => {
		const outputRoot = await mkdtemp(join(tmpdir(), "flow-bundle-"));
		temporary.push(outputRoot);
		const fixture = input();
		await expect(
			writeQualificationBundle({
				input: {
					...fixture,
					files: fixture.files.map((file) =>
						file.role === role
							? {
									...file,
									bytes:
										role === "artifact"
											? tarball(evidence)
											: json({ output: evidence }),
								}
							: file,
					),
				},
				outputRoot,
			}),
		).rejects.toThrow(/absolute user path/i);
	});

	test("publishes no readable seal after interruption and resumes", async () => {
		const outputRoot = await mkdtemp(join(tmpdir(), "flow-bundle-"));
		temporary.push(outputRoot);
		let path = "";
		await expect(
			writeQualificationBundle({
				input: input(),
				outputRoot,
				checkpoint(stage, bundlePath) {
					path = bundlePath;
					if (stage === "before-seal") throw new Error("interrupted");
				},
			}),
		).rejects.toThrow("interrupted");
		await expect(readQualificationBundle(path)).rejects.toThrow(/seal/i);
		const resumed = await writeQualificationBundle({
			input: input(),
			outputRoot,
		});
		expect((await readQualificationBundle(resumed.path)).manifest).toEqual(
			resumed.manifest,
		);
	});

	test("rejects missing roles, raw ids, secrets, and object corruption", async () => {
		const outputRoot = await mkdtemp(join(tmpdir(), "flow-bundle-"));
		temporary.push(outputRoot);
		const missing = input();
		await expect(
			writeQualificationBundle({
				input: { ...missing, files: missing.files.slice(1) },
				outputRoot,
			}),
		).rejects.toThrow(/role/i);
		const unsafe = input();
		await expect(
			writeQualificationBundle({
				input: {
					...unsafe,
					files: unsafe.files.map((file, index) =>
						index === 0
							? {
									...file,
									bytes: json({
										path: temporaryToolOutput,
										sessionId: "ses_rawSecret",
									}),
								}
							: file,
					),
				},
				outputRoot,
			}),
		).rejects.toThrow(/secret|session/i);
		const sourceSecret = input();
		await expect(
			writeQualificationBundle({
				input: {
					...sourceSecret,
					files: sourceSecret.files.map((file) =>
						file.role === "authority-source"
							? {
									...file,
									bytes: Buffer.from(
										"export const key = 'sk-proj-abcdefghijklmnopqr';\n",
									),
								}
							: file,
					),
				},
				outputRoot,
			}),
		).rejects.toThrow(/secret-shaped source/);
		const assignedSecret = input();
		await expect(
			writeQualificationBundle({
				input: {
					...assignedSecret,
					files: assignedSecret.files.map((file) =>
						file.role === "artifact"
							? {
									...file,
									bytes: tarball(
										`${temporaryToolOutput}\napi_key=super-secret-value`,
									),
								}
							: file,
					),
				},
				outputRoot,
			}),
		).rejects.toThrow(/secret-shaped evidence/);
		const optionMember = input();
		await expect(
			writeQualificationBundle({
				input: {
					...optionMember,
					files: optionMember.files.map((file) =>
						file.role === "artifact"
							? { ...file, bytes: tarball("safe", "-checkpoint-action=exec") }
							: file,
					),
				},
				outputRoot,
			}),
		).rejects.toThrow(/unsafe member path/);
		const artifactSecret = input();
		await expect(
			writeQualificationBundle({
				input: {
					...artifactSecret,
					files: artifactSecret.files.map((file) =>
						file.role === "artifact"
							? { ...file, bytes: tarball("sk-proj-abcdefghijklmnopqr") }
							: file,
					),
				},
				outputRoot,
			}),
		).rejects.toThrow(/secret-shaped source/);
		const written = await writeQualificationBundle({
			input: input(),
			outputRoot,
		});
		const sidecar = join(written.path, "unsealed.txt");
		await writeFile(sidecar, "secret-shaped sidecar");
		await expect(readQualificationBundle(written.path)).rejects.toThrow(
			/unexpected top-level/,
		);
		await rm(sidecar);
		const object = written.manifest.files.at(0)?.object;
		if (!object) throw new Error("Bundle object fixture is missing.");
		await writeFile(join(written.path, object), "corrupt");
		await expect(readQualificationBundle(written.path)).rejects.toThrow(
			/digest|size/i,
		);
	});

	test("concurrent identical writers converge", async () => {
		const outputRoot = await mkdtemp(join(tmpdir(), "flow-bundle-"));
		temporary.push(outputRoot);
		const [left, right] = await Promise.all([
			writeQualificationBundle({ input: input(), outputRoot }),
			writeQualificationBundle({ input: input(), outputRoot }),
		]);
		expect(left.path).toBe(right.path);
		expect(await readFile(join(left.path, "bundle.json"), "utf8")).toBe(
			await readFile(join(right.path, "bundle.json"), "utf8"),
		);
	});

	test("rejects unsafe role ids and symlinked input files", async () => {
		const outputRoot = await mkdtemp(join(tmpdir(), "flow-bundle-"));
		temporary.push(outputRoot);
		const unsafe = input();
		await expect(
			writeQualificationBundle({
				input: {
					...unsafe,
					files: unsafe.files.map((file) =>
						file.role === "authority-source"
							? { ...file, id: "../outside.ts" }
							: file,
					),
				},
				outputRoot,
			}),
		).rejects.toThrow(/safe identifier/);
		const inputRoot = join(outputRoot, "input");
		await mkdir(inputRoot);
		await writeFile(join(outputRoot, "outside.json"), "{}");
		await symlink(
			join(outputRoot, "outside.json"),
			join(inputRoot, "report.json"),
		);
		await expect(
			readStableQualificationInput(inputRoot, "report.json"),
		).rejects.toThrow(/stable expected type/);
		const archiveRoot = join(outputRoot, "archive");
		await mkdir(archiveRoot);
		await writeFile(join(archiveRoot, "target.txt"), "safe");
		await symlink("target.txt", join(archiveRoot, "link.txt"));
		const unsafeTar = join(outputRoot, "unsafe.tgz");
		const packed = Bun.spawnSync([
			"tar",
			"-czf",
			unsafeTar,
			"-C",
			archiveRoot,
			"link.txt",
		]);
		expect(packed.exitCode).toBe(0);
		const unsafeArtifact = input();
		const unsafeTarBytes = await readFile(unsafeTar);
		await expect(
			writeQualificationBundle({
				input: {
					...unsafeArtifact,
					files: unsafeArtifact.files.map((file) =>
						file.role === "artifact"
							? { ...file, bytes: unsafeTarBytes }
							: file,
					),
				},
				outputRoot,
			}),
		).rejects.toThrow(/unsupported member type/);
	});

	test("rejects parent replacement between inspection and read", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-bundle-input-"));
		temporary.push(root);
		await mkdir(join(root, "campaign"));
		await writeFile(join(root, "campaign", "report.json"), "{}");
		await expect(
			readStableQualificationInput(
				root,
				"campaign/report.json",
				undefined,
				async (stage) => {
					if (stage !== "inspected") return;
					await rename(join(root, "campaign"), join(root, "original"));
					await mkdir(join(root, "campaign"));
					await writeFile(join(root, "campaign", "report.json"), "{}");
				},
			),
		).rejects.toThrow(/changed while reading/);
	});
});
