import { expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	OpenCodeClient,
	SessionMessageAssistantTool,
} from "@opencode/client";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import {
	packPlugin,
	preparePackageCache,
	terminateChildProcessTree,
} from "../evals/harness.js";
import {
	extractObservedModelIdentity,
	isRecord,
} from "../evals/host-observation.js";
import {
	installedOpenCodePluginEntry,
	listNativeMessages,
	listNativeSessions,
	OPENCODE_HOST_VERSION,
	OpenCodeStartup,
	openCodeInvocation,
} from "../evals/opencode-host.js";
import { packedPackageManifest, tarballSha256 } from "../evals/provenance.js";
import packageJson from "../package.json" with { type: "json" };
import { FLOW_CORE_AGENTS } from "../src/config-shared.js";
import { runPackedReviewerReturn } from "./fixtures/opencode-v2-reviewer-return.js";
import { localScriptedProvider } from "./fixtures/opencode-v2-scripted-provider.js";
import { proveNativeUsage } from "./fixtures/opencode-v2-usage-proof.js";
import {
	junitFixtureFiles,
	packedValidationPlan,
	runPackedValidationCases,
} from "./fixtures/opencode-v2-validation-cases.js";

const LIVE = process.env.FLOW_LIVE_SMOKE === "1";
const VERSION =
	process.env.FLOW_OPENCODE_SMOKE_VERSION?.trim() || OPENCODE_HOST_VERSION;
const EXPECTED_COMMANDS = [
	"flow-auto",
	"flow-plan",
	"flow-review",
	"flow-run",
	"flow-status",
];
const EXPECTED_TOOLS = [
	"flow_feature_complete",
	"flow_feature_reset",
	"flow_guidance",
	"flow_plan_amend",
	"flow_plan_approve",
	"flow_plan_save",
	"flow_review_start",
	"flow_run_start",
	"flow_session_close",
	"flow_status",
	"flow_validation_start",
];

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("No loopback port");
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

async function tools(
	client: OpenCodeClient,
	sessionID: string,
): Promise<SessionMessageAssistantTool[]> {
	return (await listNativeMessages(client, sessionID)).flatMap((message) =>
		message.type === "assistant"
			? message.content.filter((content) => content.type === "tool")
			: [],
	);
}

async function verifyInstalledCandidate(
	tarball: string,
	installed: string,
	root: string,
): Promise<void> {
	const expected = join(root, "expected-package");
	await mkdir(expected);
	const extracted = spawnSync("tar", ["-xzf", tarball, "-C", expected], {
		encoding: "utf8",
	});
	if (extracted.status !== 0)
		throw new Error("Could not inspect candidate archive");
	const packageRoot = join(expected, "package");
	const files = (await readdir(packageRoot, { recursive: true })).sort();
	for (const file of files) {
		const entry = await lstat(join(packageRoot, file));
		if (entry.isDirectory()) continue;
		if (!entry.isFile())
			throw new Error("Candidate contains an unsupported non-file entry");
		expect(await readFile(join(installed, file))).toEqual(
			await readFile(join(packageRoot, file)),
		);
	}
	const installedFiles = (await readdir(installed, { recursive: true }))
		.filter(
			(path) => path !== "node_modules" && !path.startsWith("node_modules/"),
		)
		.sort();
	expect(installedFiles).toEqual(files);
}

const save = {
	request: {
		operationId: "smoke-save",
		expectedRevision: 0,
		goal: "Verify the installed V2 package",
		plan: packedValidationPlan,
	},
};

test("reserved native permissions retain the planner boundary", () => {
	const rules = FLOW_CORE_AGENTS["flow-planner"].permissions;
	const effect = (action: string) =>
		rules.filter((rule) => rule.action === "*" || rule.action === action).at(-1)
			?.effect;
	expect(
		[
			"shell",
			"subagent",
			"flow_plan_save",
			"flow_plan_approve",
			"flow_run_start",
			"flow_review_start",
			"flow_feature_complete",
		].map(effect),
	).toEqual(["deny", "deny", "deny", "deny", "deny", "deny", "deny"]);
	expect(["read", "glob", "grep"].map(effect)).toEqual([
		"allow",
		"allow",
		"allow",
	]);
});

test.skipIf(!LIVE)(
	"packed candidate executes allowed and denied native custom calls with a local provider",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-v2-packed-smoke-"));
		const project = join(root, "project");
		const receipt = join(root, "receipt.jsonl");
		const provider = localScriptedProvider();
		const startup = new OpenCodeStartup();
		let child: ChildProcess | undefined;
		const validationEvidence: unknown[] = [];
		try {
			const toolchain = currentBunToolchain(packageJson.packageManager);
			const tarball =
				process.env.FLOW_LIVE_SMOKE_TARBALL ??
				(await packPlugin(join(import.meta.dir, ".."), root, toolchain));
			const manifest = await packedPackageManifest(tarball);
			expect(manifest.version).toBe(packageJson.version);
			const archiveDigest = await tarballSha256(tarball);
			const cache =
				process.env.FLOW_LIVE_SMOKE_PACKAGE_CACHE ??
				(await preparePackageCache(tarball, root, toolchain));
			const installed = join(root, "installed");
			await cp(cache, installed, { recursive: true });
			const pluginDirectory = join(
				installed,
				"node_modules",
				"opencode-plugin-flow",
			);
			await verifyInstalledCandidate(tarball, pluginDirectory, root);
			const installedManifest: unknown = JSON.parse(
				await readFile(join(pluginDirectory, "package.json"), "utf8"),
			);
			if (!isRecord(installedManifest))
				throw new Error("Invalid installed candidate manifest");
			expect(installedManifest.version).toBe(manifest.version);
			expect(installedManifest.exports).toEqual({
				".": {
					types: "./dist/index.d.ts",
					import: "./dist/index.js",
					default: "./dist/index.js",
				},
				"./tui": { types: "./dist/tui.d.ts", import: "./dist/tui.js" },
			});
			await mkdir(project);
			await writeFile(join(project, "README.md"), "Local V2 smoke fixture\n");
			await writeFile(
				join(project, ".gitignore"),
				"/.flow/\n/opencode.json\n/.opencode/\n",
			);
			for (const [name, content] of Object.entries(junitFixtureFiles))
				await writeFile(join(project, name), content, { mode: 0o755 });

			for (const args of [
				["init", "--initial-branch=main"],
				["add", "README.md", ".gitignore", ...Object.keys(junitFixtureFiles)],
				[
					"-c",
					"user.name=Smoke",
					"-c",
					"user.email=smoke@example.invalid",
					"-c",
					"commit.gpgSign=false",
					"commit",
					"-m",
					"fixture",
				],
			]) {
				const result = spawnSync(
					"git",
					["-c", "core.hooksPath=/dev/null", ...args],
					{
						cwd: project,
						encoding: "utf8",
						env: {
							PATH: toolchain.environment.PATH,
							GIT_CONFIG_NOSYSTEM: "1",
							GIT_CONFIG_GLOBAL: "/dev/null",
						},
					},
				);
				if (result.status !== 0)
					throw new Error(
						"Could not prepare isolated smoke fixture repository",
					);
			}
			const pluginEntry = await installedOpenCodePluginEntry(
				pluginDirectory,
				join(root, "flow-plugin-entry"),
			);
			const fixture = join(root, "fixture");
			await mkdir(fixture);
			await writeFile(
				join(fixture, "index.ts"),
				`export { default } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "fixtures/opencode-v2-smoke-plugin.ts")).href)};\n`,
			);
			await writeFile(
				join(project, "opencode.json"),
				JSON.stringify({
					plugins: [
						{ package: pluginEntry },
						{
							package: fixture,
							options: { baseURL: provider.baseURL, receipt },
						},
					],
					permissions: [{ action: "*", resource: "*", effect: "allow" }],
				}),
			);
			for (const directory of [
				"home",
				"config",
				"data",
				"cache",
				"state",
				"tmp",
			])
				await mkdir(join(root, directory));
			const port = await availablePort();
			const args = ["serve", "--hostname", "127.0.0.1", "--port", String(port)];
			const invocation = process.env.FLOW_OPENCODE_SMOKE_EXECUTABLE
				? { command: process.env.FLOW_OPENCODE_SMOKE_EXECUTABLE, args }
				: openCodeInvocation(args, VERSION);
			const launch = () =>
				spawn(invocation.command, invocation.args, {
					cwd: project,
					detached: process.platform !== "win32",
					stdio: ["ignore", "pipe", "pipe"],
					env: {
						PATH: toolchain.environment.PATH,
						HOME: join(root, "home"),
						XDG_CONFIG_HOME: join(root, "config"),
						XDG_DATA_HOME: join(root, "data"),
						XDG_CACHE_HOME: join(root, "cache"),
						XDG_STATE_HOME: join(root, "state"),
						TMPDIR: join(root, "tmp"),
					},
				});
			child = launch();
			child.stdout?.on("data", (chunk) => startup.consume(String(chunk)));
			child.stderr?.on("data", (chunk) =>
				startup.consume(String(chunk), "stderr"),
			);
			let client: OpenCodeClient | null = null;
			const deadline = Date.now() + 180000;
			let spawnError: Error | undefined;
			child.once("error", (error) => {
				spawnError = error;
			});
			while (Date.now() < deadline) {
				if (spawnError) throw spawnError;
				if (child.exitCode !== null)
					throw new Error(`OpenCode exited before readiness. ${startup.log}`);
				client = startup.client(`http://127.0.0.1:${port}`, project);
				if (client) {
					const info = await client.server.info({
						signal: AbortSignal.timeout(3000),
					});
					expect(info.version).toBe(VERSION);
					break;
				}
				await Bun.sleep(50);
			}
			if (!client)
				throw new Error(
					`OpenCode did not publish private startup authentication. ${startup.log}`,
				);
			startup.clear();
			const request = () => ({ signal: AbortSignal.timeout(30000) });
			const rootSession = await client.session.create(
				{
					title: "Packed smoke root",
					agent: "build",
					model: { providerID: "flow-smoke", id: "catalog-model" },
					location: { directory: project },
				},
				request(),
			);
			await client.session.prompt(
				{ sessionID: rootSession.id, text: "FLOW_SMOKE_USAGE_ONLY" },
				request(),
			);
			await client.session.wait({ sessionID: rootSession.id }, request());
			validationEvidence.push({
				kind: "usage",
				...(await proveNativeUsage(client, rootSession.id, project)),
			});

			await client.session.command(
				{ sessionID: rootSession.id, name: "flow-smoke-inventory", text: "" },
				request(),
			);
			expect(
				(
					await client.command.list(
						{ location: { directory: project } },
						request(),
					)
				).data
					.map((command) => command.name)
					.filter(
						(name) =>
							name.startsWith("flow-") && name !== "flow-smoke-inventory",
					)
					.sort(),
			).toEqual(EXPECTED_COMMANDS);
			const agents = (
				await client.agent.list({ location: { directory: project } }, request())
			).data;
			expect(
				agents.find((agent) => agent.id === "flow-planner"),
			).toBeUndefined();
			for (const id of ["flow-worker", "flow-reviewer"])
				expect(agents.find((agent) => agent.id === id)?.hidden).toBe(true);
			const nativeRoot = await client.session.get(
				{ sessionID: rootSession.id },
				request(),
			);
			expect(nativeRoot.parentID).toBeUndefined();
			expect(await realpath(nativeRoot.location.directory)).toBe(
				await realpath(project),
			);
			const primaryClient = client;
			const dispatch = async (
				agent: string,
				actions: { tool: string; input: Record<string, unknown> }[],
			) => {
				const session =
					agent === "build"
						? rootSession
						: await primaryClient.session.create(
								{
									title: agent,
									parentID: rootSession.id,
									agent,
									model: { providerID: "flow-smoke", id: "catalog-model" },
									location: { directory: project },
								},
								request(),
							);
				const priorCalls = await tools(primaryClient, session.id);
				await primaryClient.session.prompt(
					{
						sessionID: session.id,
						text: `FLOW_SMOKE_ACTIONS ${JSON.stringify(actions)}`,
					},
					request(),
				);
				await primaryClient.session.wait({ sessionID: session.id }, request());
				return {
					session,
					calls: (await tools(primaryClient, session.id)).slice(
						priorCalls.length,
					),
				};
			};
			const denied = await dispatch("flow-worker", [
				{ tool: "flow_plan_save", input: save },
				{ tool: "flow_feature_complete", input: { request: {} } },
			]);
			expect(denied.calls.length).toBeGreaterThan(0);
			for (const call of denied.calls) {
				if (call.state.status === "error") continue;
				expect(call.state.status).toBe("completed");
				if (call.state.status !== "completed")
					throw new Error("Denied native call did not settle");
				const text = call.state.content
					.filter((item) => item.type === "text")
					.map((item) => item.text)
					.join("\n");
				expect(JSON.parse(text)).toMatchObject({ status: "error" });
			}
			expect(
				await lstat(join(project, ".flow/session.json")).then(
					() => true,
					() => false,
				),
			).toBe(false);
			const reviewer = await dispatch("flow-reviewer", [
				{ tool: "flow_status", input: { request: { view: "compact" } } },
			]);
			expect(
				reviewer.calls.map((call) => [call.name, call.state.status]),
			).toEqual([["flow_status", "completed"]]);
			const allowed = await dispatch("build", [
				{ tool: "flow_plan_save", input: save },
			]);
			expect(
				allowed.calls
					.filter((call) => call.name === "flow_plan_save")
					.map((call) => call.state.status),
			).toEqual(["completed"]);
			const savedCall = allowed.calls.find(
				(call) => call.name === "flow_plan_save",
			);
			if (savedCall?.state.status !== "completed")
				throw new Error("Manager plan save did not complete");
			expect(
				JSON.parse(
					savedCall.state.content
						.filter((item) => item.type === "text")
						.map((item) => item.text)
						.join("\n"),
				),
			).toMatchObject({ status: "ok" });

			const durable: unknown = JSON.parse(
				await readFile(join(project, ".flow/session.json"), "utf8"),
			);
			if (!isRecord(durable)) throw new Error("No durable Flow session");
			expect(durable.goal).toBe("Verify the installed V2 package");
			expect(
				extractObservedModelIdentity(
					await listNativeMessages(client, rootSession.id),
				),
			).toEqual({
				kind: "observed",
				value: { providerID: "flow-smoke", modelID: "catalog-model" },
			});
			expect(
				(await listNativeSessions(client, project))
					.filter((session) => session.parentID === rootSession.id)
					.map((session) => session.id)
					.sort(),
			).toEqual([denied.session.id, reviewer.session.id].sort());
			const validationResult = await runPackedValidationCases(
				project,
				dispatch,
				validationEvidence,
			);
			await runPackedReviewerReturn(
				project,
				client,
				rootSession.id,
				dispatch,
				validationEvidence,
			);

			try {
				const errorSession = await client.session.create(
					{
						title: "Provider failure control",
						agent: "build",
						model: { providerID: "flow-smoke", id: "catalog-model" },
						location: { directory: project },
					},
					request(),
				);
				await client.session.prompt(
					{ sessionID: errorSession.id, text: "FLOW_SMOKE_PROVIDER_ERROR" },
					request(),
				);
				await client.session.wait({ sessionID: errorSession.id }, request());
				validationEvidence.push({
					kind: "provider-error",
					messages: (await listNativeMessages(client, errorSession.id)).map(
						(message) => ({
							id: message.id,
							type: message.type,
							time: message.time,
							...(message.type === "assistant" ? { error: message.error } : {}),
						}),
					),
					requests: provider.requests.map(({ model, scenario }) => ({
						model,
						scenario,
					})),
				});

				expect(
					(await listNativeMessages(client, errorSession.id)).some(
						(message) =>
							message.type === "assistant" &&
							message.error?.message.includes("Local scripted provider error"),
					),
				).toBe(true);
			} catch (error) {
				validationResult.failures.push(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
			try {
				const cancelSession = await client.session.create(
					{
						title: "Cancellation control",
						agent: "build",
						model: { providerID: "flow-smoke", id: "catalog-model" },
						location: { directory: project },
					},
					request(),
				);
				await client.session.prompt(
					{ sessionID: cancelSession.id, text: "FLOW_SMOKE_DELAY" },
					request(),
				);
				const cancelDeadline = Date.now() + 5000;
				let running = false;
				while (Date.now() < cancelDeadline) {
					running = (await listNativeMessages(client, cancelSession.id)).some(
						(message) =>
							message.type === "assistant" &&
							message.time.completed === undefined,
					);
					if (running) break;
					await Bun.sleep(10);
				}
				expect(running).toBe(true);
				expect(
					(
						await client.session.interrupt(
							{ sessionID: cancelSession.id, resume: false },
							request(),
						)
					).interrupted,
				).toBe(true);
				await client.session.wait({ sessionID: cancelSession.id }, request());
				expect(
					(await listNativeMessages(client, cancelSession.id))
						.filter((message) => message.type === "assistant")
						.map((message) => message.error?.type),
				).toContain("aborted");

				await client.session.compact(
					{ sessionID: cancelSession.id },
					request(),
				);
				await client.session.wait({ sessionID: cancelSession.id }, request());
				expect(
					(await listNativeMessages(client, cancelSession.id))
						.filter((message) => message.type === "compaction")
						.map((message) => message.status),
				).toEqual(["completed"]);
				validationEvidence.push({
					kind: "cancel-compaction",
					sessionID: cancelSession.id,
					outcome: (
						await client.session.get({ sessionID: cancelSession.id }, request())
					).outcome,
					messages: await listNativeMessages(client, cancelSession.id),
				});
			} catch (error) {
				validationResult.failures.push(
					error instanceof Error ? error : new Error(String(error)),
				);
			}

			const records = (await readFile(receipt, "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line))
				.filter(isRecord);
			expect(
				records
					.filter((row) => row.kind === "inventory")
					.flatMap((row) => row.tools)
					.filter(
						(tool: unknown) =>
							typeof tool === "string" && tool.startsWith("flow_"),
					)
					.sort(),
			).toEqual(EXPECTED_TOOLS);
			expect(
				records
					.filter(
						(row) =>
							row.kind === "tool" &&
							row.tool === "flow_plan_save" &&
							row.status === "completed" &&
							isRecord(row.application) &&
							row.application.status === "ok",
					)
					.map((row) => row.sessionID),
			).toEqual([rootSession.id]);
			expect(provider.requests.every((row) => row.model === "wire-model")).toBe(
				true,
			);
			expect(provider.requests.length).toBeGreaterThan(0);
			await writeFile(
				join(project, "opencode.json"),
				JSON.stringify({
					plugins: [
						{
							package: fixture,
							options: { baseURL: provider.baseURL, receipt },
						},
						{
							package: pluginEntry,
							options: {
								modelPreferences: {
									planning: {
										kind: "model",
										model: { providerID: "flow-smoke", id: "catalog-model" },
									},
								},
							},
						},
					],
					permissions: [{ action: "*", resource: "*", effect: "allow" }],
				}),
			);
			await terminateChildProcessTree(child);
			startup.clear();
			child = launch();
			child.stdout?.on("data", (chunk) => startup.consume(String(chunk)));
			child.stderr?.on("data", (chunk) =>
				startup.consume(String(chunk), "stderr"),
			);
			let restarted: OpenCodeClient | null = null;
			const restartDeadline = Date.now() + 30000;
			while (Date.now() < restartDeadline) {
				if (child.exitCode !== null)
					throw new Error("Configured planner host exited before readiness");
				restarted = startup.client(`http://127.0.0.1:${port}`, project);
				if (restarted) break;
				await Bun.sleep(20);
			}
			if (!restarted)
				throw new Error("Configured planner host did not become ready");
			client = restarted;
			expect((await client.server.info(request())).version).toBe(VERSION);
			const ready = await client.session.create(
				{
					title: "Configured planner readiness",
					agent: "build",
					location: { directory: project },
				},
				request(),
			);
			const configuredPlugins = await client.plugin.list(
				{ location: { directory: project } },
				request(),
			);
			validationEvidence.push({
				kind: "configured-plugins",
				plugins: configuredPlugins.data,
			});
			expect(
				configuredPlugins.data.filter(
					(plugin) => plugin.state.status === "failed",
				),
			).toEqual([]);
			await client.session.command(
				{ sessionID: ready.id, name: "flow-smoke-inventory", text: "" },
				request(),
			);
			await client.session.remove({ sessionID: ready.id }, request());
			const preferenceSnapshot = await client.rpc.call(
				{
					rpcID: "flow.model-preferences",
					method: "read",
					input: {},
					location: { directory: project },
				},
				request(),
			);
			validationEvidence.push({
				kind: "planner-rpc",
				snapshot: preferenceSnapshot.output,
			});
			const configuredAgents = (
				await client.agent.list({ location: { directory: project } }, request())
			).data;

			const configuration: unknown = await client.config.get(
				{ location: { directory: project } },
				request(),
			);
			validationEvidence.push({
				kind: "planner-configuration",
				choices: Array.isArray(configuration)
					? configuration.filter(isRecord).flatMap((entry) =>
							isRecord(entry.info) && Array.isArray(entry.info.plugins)
								? entry.info.plugins
										.filter(isRecord)
										.filter((plugin) => plugin.package === pluginEntry)
										.map((plugin) => plugin.options)
								: [],
						)
					: [],
				planners: configuredAgents
					.filter((agent) => agent.id.includes("planner"))
					.map((agent) => ({ id: agent.id, model: agent.model })),
			});

			expect(
				configuredAgents.find((agent) => agent.id === "flow-planner"),
			).toMatchObject({
				hidden: true,
				model: { providerID: "flow-smoke", id: "catalog-model" },
			});

			validationEvidence.push({
				kind: "configured-planner",
				planner: configuredAgents.find((agent) => agent.id === "flow-planner")
					?.model,
			});
			expect(
				(await client.session.get({ sessionID: rootSession.id }, request()))
					.model,
			).toEqual({
				providerID: "flow-smoke",
				id: "catalog-model",
				variant: "default",
			});
			expect(await tarballSha256(tarball)).toBe(archiveDigest);
			if (validationResult.failures.length)
				throw new AggregateError(
					validationResult.failures,
					"Packed native validation gates failed",
				);
		} finally {
			if (process.env.FLOW_LIVE_SMOKE_EVIDENCE_DIR) {
				const destination = process.env.FLOW_LIVE_SMOKE_EVIDENCE_DIR;
				await mkdir(destination, { recursive: true, mode: 0o700 });
				await writeFile(
					join(destination, "validation.json"),
					JSON.stringify(
						{ hostVersion: VERSION, cases: validationEvidence },
						null,
						2,
					),
					{ mode: 0o600 },
				);
				await writeFile(
					join(destination, "flow.log"),
					startup.log
						.split("\n")
						.filter((line) => line.startsWith("[opencode-plugin-flow]"))
						.join("\n"),
					{ mode: 0o600 },
				);
				const shellRoot = join(root, "data/opencode/shell");
				const shellOutputs: {
					original: string;
					retained: string;
					sha256: string;
					bytes: number;
				}[] = [];
				for (const path of await readdir(shellRoot, { recursive: true }).catch(
					() => [],
				)) {
					if (!/^([a-f0-9]+)\/sh_[a-zA-Z0-9]+\.out$/.test(path)) continue;
					const original = join(shellRoot, path);
					const bytes = await readFile(original);
					const retained = join(destination, "shell-output", path);
					await mkdir(join(retained, ".."), { recursive: true, mode: 0o700 });
					await writeFile(retained, bytes, { mode: 0o600 });
					shellOutputs.push({
						original,
						retained,
						sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
						bytes: bytes.length,
					});
				}
				await writeFile(
					join(destination, "shell-output.json"),
					JSON.stringify(shellOutputs, null, 2),
					{ mode: 0o600 },
				);

				await readFile(receipt, "utf8").then(
					(bytes) =>
						writeFile(join(destination, "native-receipt.jsonl"), bytes, {
							mode: 0o600,
						}),
					() => {},
				);
			}
			startup.clear();
			if (child) await terminateChildProcessTree(child);
			await provider.server.stop(true);
			await rm(root, { recursive: true, force: true });
		}
	},
	240000,
);
