import { expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenCodeClient } from "@opencode/client";
import { terminateChildProcessTree } from "../evals/harness.js";
import { extractObservedModelIdentity } from "../evals/host-observation.js";
import {
	installedOpenCodePluginEntry,
	listNativeMessages,
	listNativeSessions,
	OpenCodeStartup,
	projectEvalMessage,
} from "../evals/opencode-host.js";
import {
	cancelRequestBudget,
	createRequestBudget,
	requestBudgetStatus,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import { localScriptedProvider } from "./fixtures/opencode-v2-scripted-provider.js";
import { proveNativeUsage } from "./fixtures/opencode-v2-usage-proof.js";

const executable = process.env.FLOW_OPENCODE_NATIVE_EXECUTABLE;

for (const mode of ["client", "budget"] as const)
	test.skipIf(!executable)(
		`native ${mode} helpers and local fixture execute on isolated OpenCode 2.1.4`,
		async () => {
			if (!executable)
				throw new Error("An existing exact 2.1.4 executable is required");
			const root = await mkdtemp(join(tmpdir(), "flow-v2-native-eval-test-"));
			const provider = localScriptedProvider();
			const startup = new OpenCodeStartup();
			let child: ChildProcess | undefined;
			try {
				const project = join(root, "project");
				const fixture = join(root, "plugin");
				for (const path of [
					project,
					fixture,
					...["home", "config", "data", "cache", "state", "tmp"].map((name) =>
						join(root, name),
					),
				])
					await mkdir(path);
				await writeFile(join(project, "README.md"), "Native client fixture\n");
				const directory = join(root, "budget");
				const authorization =
					mode === "budget"
						? await createRequestBudget(directory, {
								schemaVersion: 1,
								origin: "simulation",
								purpose: "Native local request accounting proof",
								maxRequests: 1,
								maxMicroUsd: 5000,
								expiresAt: new Date(Date.now() + 60000).toISOString(),
								models: [
									{
										model: "xai/grok-4.6",
										reservationMicroUsd: 5000,
										basis: { kind: "simulation" },
									},
								],
							})
						: null;
				await writeFile(
					join(fixture, "index.ts"),
					`export { default } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, mode === "budget" ? "fixtures/opencode-v2-budget-plugin.ts" : "fixtures/opencode-v2-smoke-plugin.ts")).href)};\n`,
				);
				if (mode === "client") {
					await mkdir(join(fixture, "dist"));
					await writeFile(
						join(fixture, "dist/index.js"),
						await readFile(join(fixture, "index.ts"), "utf8"),
					);
					await writeFile(
						join(fixture, "dist/tui.js"),
						"export default { id: 'local-tui-fixture', setup() {} };\n",
					);
					await rm(join(fixture, "index.ts"));
					await writeFile(
						join(fixture, "package.json"),
						JSON.stringify({
							name: "native-package-layout-proof",
							type: "module",
							exports: { ".": "./dist/index.js", "./tui": "./dist/tui.js" },
						}),
					);
				}

				const pluginEntry =
					mode === "client"
						? await installedOpenCodePluginEntry(fixture, join(root, "entry"))
						: fixture;
				await writeFile(
					join(project, "opencode.json"),
					JSON.stringify({
						plugins: [
							{
								package: pluginEntry,
								options: {
									baseURL: provider.baseURL,
									receipt: join(root, "receipt.jsonl"),
									...(authorization
										? {
												directory,
												authorizationDigest: datasetDigest(authorization),
												readyPath: join(root, "budget-ready.json"),
											}
										: {}),
								},
							},
						],
					}),
				);

				const listener = createServer();
				await new Promise<void>((resolve) =>
					listener.listen(0, "127.0.0.1", resolve),
				);
				const address = listener.address();
				if (!address || typeof address === "string")
					throw new Error("No native test port");
				await new Promise<void>((resolve) => listener.close(() => resolve()));
				child = spawn(
					executable,
					["serve", "--hostname", "127.0.0.1", "--port", String(address.port)],
					{
						cwd: project,
						detached: process.platform !== "win32",
						stdio: ["ignore", "pipe", "pipe"],
						env: {
							PATH: "/usr/bin:/bin",
							HOME: join(root, "home"),
							XDG_CONFIG_HOME: join(root, "config"),
							XDG_CACHE_HOME: join(root, "cache"),
							XDG_DATA_HOME: join(root, "data"),
							XDG_STATE_HOME: join(root, "state"),
							TMPDIR: join(root, "tmp"),
						},
					},
				);
				child.stdout?.on("data", (chunk) => startup.consume(String(chunk)));
				child.stderr?.on("data", (chunk) =>
					startup.consume(String(chunk), "stderr"),
				);
				let client: OpenCodeClient | null = null;
				const deadline = Date.now() + 15000;
				while (Date.now() < deadline) {
					if (child.exitCode !== null)
						throw new Error(`Native host exited. ${startup.log}`);
					client = startup.client(`http://127.0.0.1:${address.port}`, project);
					if (client) break;
					await Bun.sleep(20);
				}
				if (!client)
					throw new Error(`Native startup timed out. ${startup.log}`);
				expect((await client.server.info()).version).toBe("2.1.4");
				const request = () => ({ signal: AbortSignal.timeout(15000) });
				const parent = await client.session.create(
					{
						title: "Native helpers",
						permissions: [{ action: "*", resource: "*", effect: "allow" }],
						model: { providerID: "flow-smoke", id: "catalog-model" },
						location: { directory: project },
					},
					request(),
				);
				const childSession = await client.session.create(
					{
						parentID: parent.id,
						agent: "general",
						location: { directory: project },
					},
					request(),
				);
				expect(
					(await client.session.get({ sessionID: childSession.id }, request()))
						.parentID,
				).toBe(parent.id);
				expect(await realpath(parent.location.directory)).toBe(
					await realpath(project),
				);
				await client.session.prompt(
					{ sessionID: parent.id, text: "Local native client ping" },
					request(),
				);
				await client.session.wait({ sessionID: parent.id }, request());
				if (mode === "budget") {
					const native = await listNativeMessages(client, parent.id);
					expect(
						native.some(
							(message) =>
								message.type === "assistant" && message.error !== undefined,
						),
					).toBe(true);
					expect((await requestBudgetStatus(directory)).consumed).toBe(1);
					expect((await requestBudgetStatus(directory)).reservedMicroUsd).toBe(
						5000,
					);
					await client.session.prompt(
						{ sessionID: parent.id, text: "Budget exhaustion must refuse" },
						request(),
					);
					await client.session.wait({ sessionID: parent.id }, request());
					expect((await requestBudgetStatus(directory)).consumed).toBe(1);
					await cancelRequestBudget(directory);
					await client.session.prompt(
						{ sessionID: parent.id, text: "Cancelled budget must refuse" },
						request(),
					);
					await client.session.wait({ sessionID: parent.id }, request());
					expect((await requestBudgetStatus(directory)).consumed).toBe(1);
					expect(provider.requests).toEqual([]);
					return;
				}

				const native = await listNativeMessages(client, parent.id);
				await proveNativeUsage(client, parent.id, project);

				expect(extractObservedModelIdentity(native)).toEqual({
					kind: "observed",
					value: { providerID: "flow-smoke", modelID: "catalog-model" },
				});
				expect(
					native
						.filter((message) => message.type === "assistant")
						.flatMap((message) =>
							projectEvalMessage(message, parent.id).parts.map(
								(part) => part.text,
							),
						),
				).toContain("Local smoke complete");
				expect(
					(await listNativeSessions(client, project)).some(
						(session) =>
							session.id === childSession.id && session.parentID === parent.id,
					),
				).toBe(true);
				await client.session.prompt(
					{
						sessionID: parent.id,
						text: `FLOW_SMOKE_ACTIONS ${JSON.stringify([{ tool: "shell", input: { command: "printf native-smoke-ok", description: "Local native fixture" } }])}`,
					},
					request(),
				);
				await client.session.wait({ sessionID: parent.id }, request());
				expect(
					(await listNativeMessages(client, parent.id)).flatMap((message) =>
						message.type === "assistant"
							? message.content
									.filter((content) => content.type === "tool")
									.map((content) => [content.name, content.state.status])
							: [],
					),
				).toEqual([["shell", "completed"]]);

				await client.session.compact({ sessionID: parent.id }, request());
				await client.session.wait({ sessionID: parent.id }, request());
				expect(
					(await listNativeMessages(client, parent.id))
						.filter((message) => message.type === "compaction")
						.map((message) => message.status),
				).toEqual(["completed"]);
				expect(provider.requests.map((request) => request.model)).toEqual([
					"wire-model",
					"wire-model",
					"wire-model",
				]);
				const errorSession = await client.session.create(
					{
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
				expect(
					(await listNativeMessages(client, errorSession.id)).some(
						(message) =>
							message.type === "assistant" &&
							message.error?.message.includes("Local scripted provider error"),
					),
				).toBe(true);
				const cancelSession = await client.session.create(
					{
						model: { providerID: "flow-smoke", id: "catalog-model" },
						location: { directory: project },
					},
					request(),
				);
				await client.session.prompt(
					{ sessionID: cancelSession.id, text: "FLOW_SMOKE_DELAY" },
					request(),
				);
				const cancelDeadline = Date.now() + 3000;
				while (
					Date.now() < cancelDeadline &&
					!(await listNativeMessages(client, cancelSession.id)).some(
						(message) =>
							message.type === "assistant" && !message.time.completed,
					)
				)
					await Bun.sleep(10);
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

				expect(
					(await readFile(join(root, "receipt.jsonl"), "utf8")).includes(
						'"version":"2.1.4"',
					),
				).toBe(true);
			} finally {
				startup.clear();
				if (child) await terminateChildProcessTree(child);
				await provider.server.stop(true);
				await rm(root, { recursive: true, force: true });
			}
		},
		45000,
	);
