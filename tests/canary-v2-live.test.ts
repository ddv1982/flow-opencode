import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../evals/canonical-json.js";
import { unpackedManifestSha256 } from "../evals/provenance.js";
import { runPaidCanary } from "../scripts/canary-run.js";
import { prepareCanaryWorkspace } from "../scripts/canary-workspace.js";
import {
	artifactIdentitySha256,
	CANARY_CHECKLIST_SHA256,
	CANARY_CHECKLIST_VERSION,
	CANARY_PLUGIN_LOADER,
	CANARY_PLUGIN_LOADER_SHA256,
	deriveCanaryResult,
	preparedCanarySha256,
} from "../scripts/eval-canary.js";
import type { NativeCanaryExport } from "../scripts/export-canary-native.js";
import { authorizePaidRun, paidRunStatus } from "../scripts/paid-budget.js";

const LIVE = process.env.FLOW_CANARY_LIVE === "1";
const digest = (bytes: string | Uint8Array) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test.skipIf(!LIVE)(
	"charged canary exports real native manager and reviewer sessions before its pinned host stops",
	async () => {
		const executable = process.env.FLOW_CANARY_LIVE_EXECUTABLE;
		if (!executable)
			throw new Error(
				"FLOW_CANARY_LIVE_EXECUTABLE must name the existing pinned host.",
			);
		const root = await realpath(
			await mkdtemp(
				join(
					process.env.FLOW_CANARY_LIVE_ROOT ?? tmpdir(),
					"flow-canary-native-live-",
				),
			),
		);
		const old = {
			PATH: process.env.PATH,
			FLOW_EVAL_AUTHORIZATION: process.env.FLOW_EVAL_AUTHORIZATION,
			TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
			FLOW_CANARY_SENTINEL: process.env.FLOW_CANARY_SENTINEL,
			OPENCODE_CONFIG: process.env.OPENCODE_CONFIG,
			OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
			OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT,
			OPENCODE_FLOW_REVIEWER_MODEL: process.env.OPENCODE_FLOW_REVIEWER_MODEL,
		};
		let requests = 0;
		let upgrades = 0;
		const provider = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
					upgrades++;
					return new Response("WebSocket is outside this canary", {
						status: 400,
					});
				}
				const body = await request.json();
				if (
					!body ||
					typeof body !== "object" ||
					!("input" in body) ||
					!Array.isArray(body.input)
				)
					throw new Error("Invalid native Responses request");
				const reviewer = JSON.stringify(body.input).includes("Review fixture");
				const delivered = body.input.some(
					(item) => item.type === "function_call_output",
				);
				const spawn = !reviewer && !delivered;
				requests++;
				const item = spawn
					? {
							id: "fc_spawn",
							type: "function_call",
							call_id: "call_spawn_reviewer",
							name: "canary_spawn",
							arguments: "{}",
							status: "completed",
						}
					: {
							id: `message_${requests}`,
							type: "message",
							role: "assistant",
							status: "completed",
							content: [
								{
									type: "output_text",
									text: reviewer ? "Reviewed locally" : "Finished locally",
									annotations: [],
								},
							],
						};
				const events: Record<string, unknown>[] = spawn
					? [
							{
								type: "response.output_item.added",
								output_index: 0,
								item: { ...item, arguments: "", status: "in_progress" },
							},
							{
								type: "response.function_call_arguments.delta",
								item_id: item.id,
								output_index: 0,
								delta: "{}",
							},
							{
								type: "response.function_call_arguments.done",
								item_id: item.id,
								output_index: 0,
								arguments: "{}",
							},
							{ type: "response.output_item.done", output_index: 0, item },
						]
					: [{ type: "response.output_item.done", output_index: 0, item }];
				events.push({
					type: "response.completed",
					response: {
						id: `resp_${requests}`,
						object: "response",
						created_at: 1,
						status: "completed",
						model: "model",
						output: [item],
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					},
				});
				return new Response(
					events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
					{ headers: { "content-type": "text/event-stream" } },
				);
			},
		});

		try {
			const directory = join(root, "fixture/.opencode/plugins/flow");
			await mkdir(directory, { recursive: true });
			await mkdir(join(root, "package/dist"), { recursive: true });
			const ambient = join(root, "ambient");
			await mkdir(ambient);
			const ambientMarker = join(root, "ambient-loaded.json");
			await writeFile(
				join(ambient, "index.js"),
				`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(ambientMarker)}, "loaded"); throw new Error("Ambient plugin loaded");`,
			);
			const ambientConfig = JSON.stringify({ plugins: [{ package: ambient }] });
			await writeFile(join(ambient, "opencode.json"), ambientConfig);
			const receipt = join(root, "cleanup.json");
			const entry = `import { Plugin, Provider, Model } from "@opencode/plugin";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
export default Plugin.define({ id: "flow-canary-local-proof", async setup(ctx) {
 const providerID = Provider.ID.make("fake");
 const modelID = Model.ID.make("model");
 await ctx.provider.transform(editor => editor.add({ info: { ...Provider.Info.empty(providerID), name: "Local canary", activation: "enabled", package: "@opencode/ai/providers/openai/responses", settings: { baseURL: ${JSON.stringify(`http://127.0.0.1:${provider.port}/v1`)}, transport: "http", apiKey: "synthetic-local-only" } }, models: [{ ...Model.Info.default(providerID, modelID), settings: { transport: "http" }, variants: [{ id: "default", settings: { transport: "http" } }], capabilities: { ...Model.Info.default(providerID, modelID).capabilities, tools: true } }] }));
 await ctx.agent.transform(editor => editor.update("flow-reviewer", agent => { agent.mode = "subagent"; agent.system = "Review the fixture"; agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]; }));
 await ctx.session.hook("title", input => { input.result = "Local canary"; });
 await ctx.session.hook("http.request", input => { if (new URL(input.request.url).origin !== ${JSON.stringify(`http://127.0.0.1:${provider.port}`)}) throw new Error("Remote model access forbidden"); });
 await ctx.tool.transform(editor => editor.add({ name: "canary_spawn", description: "Create local reviewer evidence", options: { codemode: false }, input: { type: "object", properties: {} }, async execute(_, context) {
  const child = await ctx.session.create({ parentID: context.sessionID, agent: "flow-reviewer", model: { providerID: "fake", id: "model" }, location: { directory: ctx.location.directory } });
  await ctx.session.prompt({ sessionID: child.id, text: "Review fixture" });
  await ctx.session.wait({ sessionID: child.id });
  return { content: "Reviewer finished" };
 } }));
 return () => { const output = dirname(process.env.XDG_DATA_HOME); writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ nativeExistsBeforeCleanup: existsSync(join(output, "native.json")), pid: process.pid, authorization: process.env.FLOW_EVAL_AUTHORIZATION === undefined, typesafe: process.env.TYPESAFE_API_KEY === undefined, reviewer: process.env.OPENCODE_FLOW_REVIEWER_MODEL, recovery: ctx.options.recovery, ambientConfigAbsent: ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT"].every(key => process.env[key] === undefined) })); };
} });`;
			const tui = "export default {};\n";
			const metadata = JSON.stringify({
				name: "opencode-plugin-flow",
				version: "10.0.0",
				dependencies: {},
				devDependencies: { "@opencode/plugin": "2.1.4" },
			});
			const pluginPackage = canonicalJson({
				name: "opencode-plugin-flow",
				version: "10.0.0",
				type: "module",
				main: "./dist/index.js",
				exports: { ".": "./dist/index.js", "./tui": "./dist/tui.js" },
				dependencies: { "@opencode/plugin": "2.1.4" },
			});
			const config = canonicalJson({
				plugins: [
					{
						package: "./.opencode/plugins/flow",
						options: { recovery: { mode: "off" } },
					},
				],
				update: "disable",
				share: "disabled",
			});
			await mkdir(join(directory, "dist"), { recursive: true });
			for (const [path, bytes] of [
				["package/package.json", metadata],
				["package/dist/index.js", entry],
				["package/dist/tui.js", tui],
				["fixture/.opencode/plugins/flow/index.js", CANARY_PLUGIN_LOADER],
				["fixture/.opencode/plugins/flow/dist/index.js", entry],
				["fixture/.opencode/plugins/flow/dist/tui.js", tui],
				["fixture/.opencode/plugins/flow/package.json", pluginPackage],
				["fixture/opencode.json", config],
			] as const)
				await writeFile(join(root, path), bytes);
			await symlink(
				join(import.meta.dir, "../node_modules"),
				join(directory, "node_modules"),
				"dir",
			);
			const packed = Bun.spawn(
				["tar", "-czf", join(root, "artifact.tgz"), "package"],
				{ cwd: root, stderr: "pipe" },
			);
			if (await packed.exited)
				throw new Error(await new Response(packed.stderr).text());
			const artifact = {
				packageVersion: "10.0.0",
				sourceCommit: "local-fixture",
				sourceTreeSha256: digest("fixture"),
				tarballSha256: digest(await readFile(join(root, "artifact.tgz"))),
				unpackedManifestSha256: await unpackedManifestSha256(
					join(root, "artifact.tgz"),
				),
			};
			const base = {
				schemaVersion: 2 as const,
				releaseTag: "v10.0.0",
				artifact,
				artifactSha256: artifactIdentitySha256(artifact),
				checklistVersion:
					CANARY_CHECKLIST_VERSION as typeof CANARY_CHECKLIST_VERSION,
				checklistSha256: CANARY_CHECKLIST_SHA256,
				preparedAt: new Date().toISOString(),
				artifactFile: "artifact.tgz" as const,
				pluginEntrySha256: digest(entry),
				runtime: {
					hostVersion: "2.1.4" as const,
					sourcePackageSha256: digest(metadata),
					tuiEntrySha256: digest(tui),
					pluginPackageSha256: digest(pluginPackage),
					loaderEntrySha256: CANARY_PLUGIN_LOADER_SHA256,
					configSha256: digest(config),
				},
			};
			const prepared = { ...base, sha256: preparedCanarySha256(base) };
			await writeFile(join(root, "prepared.json"), JSON.stringify(prepared));
			await prepareCanaryWorkspace(join(root, "fixture"));
			await writeFile(join(root, "prompt.txt"), "Run fixture");
			await writeFile(
				join(root, "npm"),
				`#!/usr/bin/env node\nconst {spawn} = require("node:child_process");\nconst args = process.argv.slice(2);\nif (args[0] === "install") process.exit(0);\nif (JSON.stringify(args.slice(0,5)) !== JSON.stringify(["exec","--yes","--package=@opencode/cli@2.1.4","--","opencode"])) process.exit(99);\nconst child = spawn(${JSON.stringify(executable)}, args.slice(5), {stdio:"inherit"});\nchild.on("error", () => process.exit(98));\nchild.on("exit", code => process.exit(code ?? 97));\n`,
			);
			await chmod(join(root, "npm"), 0o755);
			await authorizePaidRun(root, {
				schemaVersion: 1,
				purpose: "Local fake provider only",
				models: ["fake/model"],
				maxDispatches: 1,
				expiresAt: new Date(Date.now() + 120000).toISOString(),
			});
			process.env.FLOW_EVAL_AUTHORIZATION = root;
			process.env.PATH = `${root}:${old.PATH ?? ""}`;
			process.env.TYPESAFE_API_KEY = "synthetic-not-real";
			process.env.FLOW_CANARY_SENTINEL = "retained";
			process.env.OPENCODE_CONFIG = join(ambient, "opencode.json");
			process.env.OPENCODE_CONFIG_DIR = ambient;
			process.env.OPENCODE_CONFIG_CONTENT = ambientConfig;
			process.env.OPENCODE_FLOW_REVIEWER_MODEL = "unreviewed/override";
			expect(
				await runPaidCanary({
					prepared: join(root, "prepared.json"),
					model: "fake/model",
					prompt: join(root, "prompt.txt"),
				}),
			).toBe(0);
			const runs = (await readdir(root)).filter((path) =>
				path.startsWith("run-"),
			);
			expect(runs.length).toBe(1);
			const output = join(root, runs[0] ?? "missing");
			const native: NativeCanaryExport = JSON.parse(
				await readFile(join(output, "native.json"), "utf8"),
			);
			const run = JSON.parse(await readFile(join(output, "run.json"), "utf8"));
			const observed = deriveCanaryResult({
				packageVersion: prepared.artifact.packageVersion,
				artifactSha256: prepared.artifactSha256,
				tarballSha256: prepared.artifact.tarballSha256,
				preparedSha256: prepared.sha256,
				pluginEntrySha256: prepared.pluginEntrySha256,
				installation: null,
				session: null,
				transcript: native,
			});
			expect(observed.actors.map((actor) => actor.role).sort()).toEqual([
				"manager",
				"reviewer",
			]);
			expect(
				JSON.parse(
					await readFile(join(output, "config/opencode/opencode.json"), "utf8"),
				),
			).toEqual({
				providers: {
					fake: {
						settings: { transport: "http" },
						models: {
							model: {
								settings: { transport: "http" },
								variants: [{ id: "default", settings: { transport: "http" } }],
							},
						},
					},
				},
			});
			expect(native.host.version).toBe("2.1.4");
			expect(native.sessions.length).toBe(2);
			const manager = native.sessions.find(
				(session) => session.info.parentID === undefined,
			);
			const reviewer = native.sessions.find(
				(session) => session.info.agent === "flow-reviewer",
			);
			expect(manager?.info.model).toEqual({
				providerID: "fake",
				id: "model",
				variant: "default",
			});
			expect(reviewer?.info.parentID).toBe(manager?.info.id);
			expect(reviewer?.info.model).toEqual({
				providerID: "fake",
				id: "model",
				variant: "default",
			});
			expect(
				reviewer?.messages.some(
					(message) =>
						message.type === "assistant" &&
						message.content.some(
							(part) =>
								part.type === "text" && part.text === "Reviewed locally",
						),
				),
			).toBe(true);
			expect(run).toMatchObject({
				preparedSha256: prepared.sha256,
				rootSessionID: manager?.info.id,
				host: { version: "2.1.4", pid: native.host.pid },
				native: {
					path: "native.json",
					sha256: digest(await readFile(join(output, "native.json"))),
				},
				outcome: "succeeded",
				provider: { id: "fake", transport: "http" },
				providerConfiguration: {
					path: "config/opencode/opencode.json",
					sha256: digest(
						await readFile(join(output, "config/opencode/opencode.json")),
					),
				},
			});
			expect(JSON.parse(await readFile(receipt, "utf8"))).toEqual({
				nativeExistsBeforeCleanup: true,
				pid: native.host.pid,
				authorization: true,
				typesafe: true,
				reviewer: "fake/model",
				recovery: { mode: "off" },
				ambientConfigAbsent: true,
			});
			await expect(stat(ambientMarker)).rejects.toThrow();
			expect((await paidRunStatus(root)).consumed).toBe(1);
			expect(requests).toBe(3);
			expect(upgrades).toBe(0);
			expect(() => process.kill(native.host.pid, 0)).toThrow();
			const log = await readFile(join(output, "server.log"), "utf8");
			expect(log).not.toContain("server password");
			await expect(
				runPaidCanary({
					prepared: join(root, "prepared.json"),
					model: "fake/model",
					prompt: join(root, "prompt.txt"),
				}),
			).rejects.toThrow("exhausted");
			await writeFile(
				join(root, "verification.json"),
				JSON.stringify(
					{
						status: "PASS",
						requests,
						upgrades,
						protocol: "native-openai-responses",
						nativeHost: native.host,
						exportedSessions: native.sessions.map((session) => ({
							id: session.info.id,
							parentID: session.info.parentID,
							agent: session.info.agent,
							model: session.info.model,
						})),
						charged: 1,
						hostStopped: true,
						exportedBeforeCleanup: true,
						ambientConfigRejected: true,
						recovery: "off",
					},
					null,
					2,
				),
			);
		} finally {
			provider.stop(true);
			for (const [key, value] of Object.entries(old)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			if (!process.env.FLOW_CANARY_LIVE_ROOT)
				await rm(root, { recursive: true, force: true });
		}
	},
	60000,
);
