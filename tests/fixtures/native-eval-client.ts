import { afterAll, beforeAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	OpenCode,
	type OpenCodeClient,
	type SessionInfo,
	type SessionMessageAssistant,
	type SessionMessageAssistantTool,
	type SessionMessageInfo,
	type SessionMessagesResponse,
	type SessionsResponse,
} from "@opencode/client";
import { EvalHost } from "../../evals/harness.js";
import { authorizePaidRun } from "../../scripts/paid-budget.js";

export const fixtureModel = "fixture/model";
export type NativeRequest = { url: URL; method: string; init: RequestInit };
export type NativeHandler = (
	request: NativeRequest,
) => Response | Promise<Response>;
export type NativeTokens = NonNullable<SessionMessageAssistant["tokens"]>;
export const zeroNativeTokens: NativeTokens = {
	input: 0,
	output: 0,
	reasoning: 0,
	cache: { read: 0, write: 0 },
};

export function nativeSession(
	id: string,
	directory: string,
	options: Partial<SessionInfo> = {},
): SessionInfo {
	return {
		id,
		projectID: "project_fixture",
		agent: "build",
		cost: 0,
		tokens: structuredClone(zeroNativeTokens),
		time: { created: 1, updated: 1 },
		location: { directory },
		...options,
	};
}

export function nativeAssistant(
	id: string,
	options: Partial<Omit<SessionMessageAssistant, "id" | "type">> = {},
): SessionMessageAssistant {
	return {
		id,
		type: "assistant",
		agent: "build",
		model: { providerID: "fixture", id: "model" },
		time: { created: 1 },
		content: [],
		...options,
	};
}

export function nativeTool(
	id: string,
	name: string,
	state: SessionMessageAssistantTool["state"],
	time: SessionMessageAssistantTool["time"] = { created: 1 },
): SessionMessageAssistantTool {
	return { type: "tool", id, name, state, time };
}

export function messagePage(
	data: SessionMessageInfo[],
	next?: string,
): Response {
	return Response.json({
		data,
		cursor: next ? { next } : {},
	} satisfies SessionMessagesResponse);
}

export function sessionPage(data: SessionInfo[], next?: string): Response {
	return Response.json({
		data,
		cursor: next ? { next } : {},
	} satisfies SessionsResponse);
}

export function sessionReply(data: SessionInfo): Response {
	return Response.json({ data });
}

export function nativeClient(
	handler: NativeHandler,
	active: () => Record<string, { type: "running" }> = () => ({}),
): OpenCodeClient {
	const transport: typeof fetch = Object.assign(
		async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.origin !== "http://native-eval.invalid")
				throw new Error(
					`Fixture refused transport outside its origin ${url.origin}`,
				);
			if (url.pathname === "/api/session/active")
				return Response.json({ data: active() });
			return handler({ url, method: init?.method ?? "GET", init: init ?? {} });
		},
		{ preconnect: globalThis.fetch.preconnect },
	);
	return OpenCode.make({
		baseUrl: "http://native-eval.invalid",
		fetch: transport,
	});
}

export function nativeHost(
	project: string,
	client: OpenCodeClient,
	signal?: AbortSignal,
): EvalHost {
	const host: unknown = Reflect.construct(EvalHost, [project, project, signal]);
	if (!(host instanceof EvalHost))
		throw new Error("Expected EvalHost fixture.");
	Reflect.set(host, "nativeClient", client);
	return host;
}

export function useNativeFixtureBudget(): void {
	let directory: string;
	let previous: string | undefined;
	beforeAll(async () => {
		previous = process.env.FLOW_EVAL_AUTHORIZATION;
		directory = await mkdtemp(join(tmpdir(), "native-fixture-budget-"));
		await authorizePaidRun(directory, {
			schemaVersion: 1,
			purpose: "In-memory native SDK transport fixtures only",
			models: [fixtureModel, "fixture/manager"],
			maxDispatches: 1000,
			expiresAt: new Date(Date.now() + 3600000).toISOString(),
		});
		process.env.FLOW_EVAL_AUTHORIZATION = directory;
	});
	afterAll(async () => {
		if (previous === undefined) delete process.env.FLOW_EVAL_AUTHORIZATION;
		else process.env.FLOW_EVAL_AUTHORIZATION = previous;
		await rm(directory, { recursive: true, force: true });
	});
}

export function nativeHttpClient(handler: NativeHandler): {
	client: OpenCodeClient;
	stop: () => void;
} {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			if (new URL(request.url).pathname === "/api/session/active")
				return Response.json({ data: {} });
			const body = request.method === "GET" ? undefined : await request.text();
			return handler({
				url: new URL(request.url),
				method: request.method,
				init: {
					method: request.method,
					signal: request.signal,
					...(body ? { body } : {}),
				},
			});
		},
	});
	const transport: typeof fetch = Object.assign(
		(input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.origin !== server.url.origin)
				throw new Error("Fixture refused external network.");
			return globalThis.fetch(input, init);
		},
		{ preconnect: globalThis.fetch.preconnect },
	);
	return {
		client: OpenCode.make({ baseUrl: server.url.toString(), fetch: transport }),
		stop: () => {
			server.stop(true);
		},
	};
}

async function runIsolationServer(): Promise<void> {
	const { readFile } = await import("node:fs/promises");
	const { join } = await import("node:path");
	for (const name of [
		"OPENCODE_CONFIG",
		"OPENCODE_CONFIG_CONTENT",
		"OPENCODE_CONFIG_DIR",
	])
		if (process.env[name] !== undefined)
			throw new Error(`Ambient config leaked through ${name}`);
	const config: unknown = JSON.parse(
		await readFile(join(process.cwd(), "opencode.json"), "utf8"),
	);
	if (
		!config ||
		typeof config !== "object" ||
		!("plugins" in config) ||
		!Array.isArray(config.plugins) ||
		config.plugins.length !== 1 ||
		!config.plugins.some((plugin: { package?: string }) =>
			plugin.package?.endsWith("flow.eval.http-transport"),
		)
	)
		throw new Error("Expected generated native config with no plugins.");
	const configuredPlugins = config.plugins;
	const info: SessionInfo = {
		id: "ses_ready",
		projectID: "project_fixture",
		agent: "build",
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		time: { created: 1, updated: 1 },
		location: { directory: process.cwd() },
	};
	const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/api/info")
				return Response.json({
					version: "2.1.4",
					pid: process.pid,
					urls: [],
					paths: { tmp: process.env.TMPDIR ?? "" },
				} satisfies Awaited<ReturnType<OpenCodeClient["server"]["info"]>>);
			if (path === "/api/session" && request.method === "POST")
				return Response.json({ data: info });
			if (path === "/api/session/ses_ready" && request.method === "DELETE")
				return new Response(null, { status: 204 });
			if (path === "/api/plugin") {
				const plugin = configuredPlugins[0];
				if (
					!plugin ||
					typeof plugin !== "object" ||
					!("package" in plugin) ||
					typeof plugin.package !== "string"
				)
					throw new Error("Missing local transport entry");
				return Response.json({
					location: { directory: process.cwd() },
					data: [
						{
							id: "flow.eval.http-transport",
							source: { type: "local", path: plugin.package },
							features: { server: true },
							state: { status: "active" },
						},
					],
				});
			}
			if (path === "/api/config")
				return Response.json([
					{ type: "document", info: { plugins: [] } },
				] satisfies Awaited<ReturnType<OpenCodeClient["config"]["get"]>>);
			return new Response("Unexpected native isolation endpoint", {
				status: 404,
			});
		},
	});
	console.log("server password native-fixture-only");
	process.on("SIGTERM", () => {
		server.stop(true);
		process.exit(0);
	});
}

export async function nativeIsolationExecutable(
	directory: string,
): Promise<string> {
	const { chmod, writeFile } = await import("node:fs/promises");
	const script = join(directory, "native-isolation-server.js");
	const executable = join(directory, "opencode-fixture");
	await writeFile(
		script,
		`(${runIsolationServer.toString()})().catch(error => { console.error(error); process.exit(1); });\n`,
	);
	const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
	await writeFile(
		executable,
		`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
	);
	await chmod(executable, 0o755);
	return executable;
}
