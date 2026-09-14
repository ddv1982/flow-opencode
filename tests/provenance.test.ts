import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { EvalHost } from "../evals/harness.js";
import {
	extractObservedActor,
	extractObservedVariant,
} from "../evals/host-observation.js";
import {
	evaluatorIdentity,
	hostActorObservation,
	hostConfigSha256,
	inspectArtifact,
	inspectWorkingSource,
	instructionDelivery,
	normalizeRequestedModel,
	redactTranscript,
	samePackedArtifact,
	unpackedManifestSha256,
} from "../evals/provenance.js";
import { authorizePaidRun } from "../scripts/paid-budget.js";

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
	test("forwards requested variants to both native host endpoints without changing wait policy", async () => {
		const previousAuthorization = process.env.FLOW_EVAL_AUTHORIZATION;
		const authorization = await directory();
		await authorizePaidRun(authorization, {
			schemaVersion: 1,
			purpose: "Fake variant transport",
			models: ["route/model"],
			maxDispatches: 3,
			expiresAt: new Date(Date.now() + 60000).toISOString(),
		});
		process.env.FLOW_EVAL_AUTHORIZATION = authorization;
		const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
		const waited: object[] = [];
		const requests = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (
					url: Parameters<typeof fetch>[0],
					init?: Parameters<typeof fetch>[1],
				) => {
					posted.push({
						path: new URL(String(url)).pathname,
						body: JSON.parse(String(init?.body)),
					});
					return Response.json({});
				},
				{ preconnect: fetch.preconnect },
			),
		);
		const host = Reflect.construct(EvalHost, [
			"/unused",
			"/unused",
		]) as EvalHost;
		Object.assign(host, {
			baseUrl: "http://127.0.0.1:1",
			waitForQuiet: async (
				_sessionId: string,
				options: { request: { settled: Promise<void> } },
			) => {
				waited.push(options);
				await options.request.settled;
				return "quiet";
			},
		});
		try {
			await host.runCommand("session", "flow-auto", "task", "route/model", {
				variant: "high",
				quietMs: 25,
			});
			await host.runPrompt("session", "task", "route/model", {
				variant: "low",
				quietMs: 35,
			});
			await host.runPrompt("session", "task", "route/model");
			expect(posted).toEqual([
				{
					path: "/session/session/command",
					body: {
						command: "flow-auto",
						arguments: "task",
						model: "route/model",
						variant: "high",
					},
				},
				{
					path: "/session/session/message",
					body: {
						model: { providerID: "route", modelID: "model" },
						variant: "low",
						parts: [{ type: "text", text: "task" }],
					},
				},
				{
					path: "/session/session/message",
					body: {
						model: { providerID: "route", modelID: "model" },
						parts: [{ type: "text", text: "task" }],
					},
				},
			]);
			expect(waited[0]).toHaveProperty("quietMs", 25);
			expect(waited[1]).toHaveProperty("quietMs", 35);
			for (const options of waited)
				expect(options).not.toHaveProperty("variant");
		} finally {
			requests.mockRestore();
			if (previousAuthorization === undefined)
				delete process.env.FLOW_EVAL_AUTHORIZATION;
			else process.env.FLOW_EVAL_AUTHORIZATION = previousAuthorization;
		}
	});

	test("retains a requested variant independently of observed host settings", () => {
		const requested = normalizeRequestedModel({
			modelId: "route/model",
			variant: "high",
			family: "declared-family",
			gateway: null,
			revision: null,
		});
		expect(requested).toEqual({
			routeProvider: "route",
			model: "model",
			variant: "high",
			family: "declared-family",
			gateway: null,
			revision: null,
		});
		expect(
			normalizeRequestedModel({
				modelId: "route/model",
				family: "declared-family",
				gateway: null,
				revision: null,
			}),
		).not.toHaveProperty("variant");
	});

	test("retains host model fields when the variant and provider facts are unavailable", () => {
		const actor = extractObservedActor({
			role: "reviewer",
			sessions: [
				{
					id: "reviewer",
					messages: [
						{
							info: {
								role: "assistant",
								time: { completed: 2 },
								providerID: "route",
								modelID: "model",
							},
						},
					],
				},
			],
		});
		expect(hostActorObservation(actor)).toEqual({
			model: {
				kind: "observed",
				value: { providerID: "route", modelID: "model" },
			},
			variant: { kind: "unobserved", reason: "field-unavailable" },
		});
		expect(hostActorObservation(actor).model).not.toHaveProperty("family");
	});

	test("keeps completed-assistant variant observations separate from model identity", () => {
		const messages = [
			{
				info: {
					role: "assistant",
					time: { completed: 2 },
					providerID: "route",
					modelID: "model",
					variant: "high",
				},
			},
			{
				info: {
					role: "assistant",
					time: { completed: 3 },
					model: { providerID: "route", modelID: "model", variant: "high" },
				},
			},
		];
		const actor = extractObservedActor({
			role: "manager",
			sessions: [{ id: "parent", messages }],
		});
		expect(hostActorObservation(actor)).toEqual({
			model: {
				kind: "observed",
				value: { providerID: "route", modelID: "model" },
			},
			variant: { kind: "observed", value: "high" },
		});
		const conflicting = extractObservedActor({
			role: "manager",
			sessions: [
				{
					id: "parent",
					messages: [
						messages[0],
						{ info: { ...messages[0]?.info, variant: "low" } },
					],
				},
			],
		});
		expect(hostActorObservation(conflicting)).toEqual({
			model: actor.actualModel,
			variant: { kind: "unobserved", reason: "conflicting-observations" },
		});
	});

	test("does not promote requested, errored, or incomplete variants to observations", () => {
		for (const info of [
			{ role: "user", time: { completed: 2 }, model: { variant: "high" } },
			{ role: "assistant", time: { created: 1 }, variant: "high" },
			{ role: "assistant", time: { completed: 2 }, error: {}, variant: "high" },
		]) {
			expect(extractObservedVariant([{ info }])).toEqual({
				kind: "unobserved",
				reason: "no-completed-assistant",
			});
		}
		expect(extractObservedVariant(null)).toEqual({
			kind: "unobserved",
			reason: "endpoint-failure",
		});
		expect(
			extractObservedVariant([
				{
					info: { role: "assistant", time: { completed: 2 }, variant: "high" },
				},
				{ info: { role: "assistant", time: { completed: 3 } } },
			]),
		).toEqual({ kind: "unobserved", reason: "field-unavailable" });
	});

	test("does not label missing variant evidence as a model identity conflict", () => {
		const actor = extractObservedActor({
			role: "manager",
			sessions: [
				{
					id: "parent",
					messages: ["first", "second"].map((modelID) => ({
						info: {
							role: "assistant",
							time: { completed: 2 },
							providerID: "route",
							modelID,
						},
					})),
				},
			],
		});
		expect(hostActorObservation(actor)).toEqual({
			model: { kind: "unobserved", reason: "conflicting-observations" },
			variant: { kind: "unobserved", reason: "field-unavailable" },
		});
	});

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

	test("preserves token-count metrics while redacting credential tokens", () => {
		const transcript = redactTranscript({
			projectPath: "/tmp/project",
			value: {
				counts: {
					outputTokens: 321,
					input_tokens: 123,
					reasoning_tokens: 45,
					cacheReadTokens: 67,
					cache_read_tokens: 89,
					"cache-write-tokens": 10,
				},
				unsafeCounts: {
					outputTokens: "output-secret",
					cache_read_tokens: "cache-secret",
				},
				inputToken: "singular-secret",
				output_tokens_count: "suffixed-secret",
				token: "credential-secret",
				accessToken: "access-secret",
			},
		});
		expect(JSON.parse(transcript.text)).toEqual({
			accessToken: "[redacted]",
			counts: {
				"cache-write-tokens": 10,
				cacheReadTokens: 67,
				cache_read_tokens: 89,
				input_tokens: 123,
				outputTokens: 321,
				reasoning_tokens: 45,
			},
			unsafeCounts: {
				cache_read_tokens: "[redacted]",
				outputTokens: "[redacted]",
			},
			inputToken: "[redacted]",
			output_tokens_count: "[redacted]",
			token: "[redacted]",
		});
	});
});
