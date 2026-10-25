import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@opencode/plugin/promise/plugin";
import { EvaluationPhaseError } from "../evals/failure-origin.js";
import { EvalHost } from "../evals/harness.js";
import { registerNativeAccountClient } from "../evals/native-auth/client-plugin.js";
import { PLACEHOLDER_REFRESH } from "../evals/native-auth/protocol.js";

const roots: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposers.splice(0)) await dispose();
	for (const server of servers.splice(0)) await server.stop(true);
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});
const route = {
	providerID: "openai",
	integrationID: "openai",
	credentialID: "synthetic-selected",
	methodID: "chatgpt-browser",
	label: "Synthetic",
};
const metadata = {
	accountID: "synthetic-account",
	nested: { tier: "fixture" },
};
const value = {
	type: "oauth",
	methodID: route.methodID,
	access: "synthetic-bearer",
	refresh: PLACEHOLDER_REFRESH,
	expires: 4102444800000,
	metadata,
};
const profile = { providerID: "openai", id: "gpt-6.1-sol" };
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "flow-readiness-"));
	roots.push(root);
	await chmod(root, 0o700);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			return Response.json(
				new URL(request.url).pathname === "/resolve" ? { route, value } : {},
			);
		},
	});
	servers.push(server);
	const configurationPath = join(root, "configuration.json");
	await writeFile(
		configurationPath,
		JSON.stringify({
			connection: {
				version: 1,
				url: server.url.href,
				capability: "a".repeat(64),
				accounts: [{ route, metadata }],
			},
			lease: "b".repeat(64),
			models: ["openai/gpt-6.1-sol"],
		}),
		{ mode: 0o600 },
	);
	const hooks = new Map<string, (input: unknown) => Promise<void>>();
	const provider = {
		id: "openai",
		integrationID: "openai",
		activation: "enabled",
		package: "@opencode/ai/providers/openai",
		settings: {
			baseURL: "https://chatgpt.com/backend-api/codex",
			transport: "http",
		},
		headers: { "chatgpt-account-id": metadata.accountID },
	};
	const active = {
		type: "credential",
		id: route.credentialID,
		label: route.label,
		method: "oauth",
	};
	const ctx = {
		options: { configurationPath },
		provider: {
			get: async () => ({ data: provider }),
			list: async () => ({ data: [provider] }),
		},
		model: {
			list: async () => ({
				data: [
					{ ...profile, modelID: profile.id, enabled: true, variants: [] },
				],
			}),
		},
		integration: {
			get: async () => ({
				data: {
					id: "openai",
					methods: [{ type: "oauth", id: route.methodID }],
				},
			}),
			connection: { active: async () => active, resolve: async () => value },
			transform: async (callback: (editor: unknown) => void) => {
				callback({
					method: {
						list: () => [{ type: "oauth", id: route.methodID }],
						update: () => {},
					},
				});
				return { dispose: async () => {} };
			},
		},
		rpc: { register: async () => ({ dispose: async () => {} }) },
		session: {
			hook: async (
				name: string,
				callback: (input: unknown) => Promise<void>,
			) => {
				hooks.set(name, callback);
				return {
					dispose: async () => {
						hooks.delete(name);
					},
				};
			},
		},
	} as unknown as Context;
	disposers.push(await registerNativeAccountClient(ctx));
	return {
		async guard(
			url: string,
			account = metadata.accountID,
			name = "http.request",
		) {
			const hook = hooks.get(name);
			if (!hook) throw new Error("Missing guard");
			await hook({
				model: profile,
				request: new Request(url, {
					headers: { "chatgpt-account-id": account },
				}),
			});
		},
	};
}
for (const [url, account] of [
	["https://api.openai.com/v1/responses", metadata.accountID],
	[
		"https://chatgpt.com/backend-api/codex-elsewhere/responses",
		metadata.accountID,
	],
	[
		"https://chatgpt.com/backend-api/codex/responses",
		"synthetic-other-account",
	],
] as const)
	test(`legacy final HTTP refuses mismatched target or account ${url} ${account}`, async () => {
		const f = await fixture();
		await expect(f.guard(url, account)).rejects.toThrow(
			"Native account authentication failed.",
		);
	});
test("legacy final HTTP permits Codex base descendants and refuses a late WebSocket route", async () => {
	const f = await fixture();
	await f.guard("https://chatgpt.com/backend-api/codex/responses?synthetic=1");
	await expect(
		f.guard(
			"https://chatgpt.com/backend-api/codex/responses",
			metadata.accountID,
			"experimental.ws.handshake",
		),
	).rejects.toThrow("Native account authentication failed.");
});
test("probe readiness fails as host infrastructure before creating a session or invoking dispatch", async () => {
	const host = Object.create(EvalHost.prototype) as EvalHost;
	const failure = new EvaluationPhaseError(
		{
			origin: "host",
			code: "native-auth-not-ready",
			detail: "Native account authentication is not ready (route-unsettled).",
			retryable: false,
		},
		undefined,
	);
	let sessions = 0,
		callbacks = 0;
	Object.assign(host, {
		project: "/synthetic/project",
		verifyArtifacts: async () => {},
		nativeAuthHost: {
			requireReady: async () => {
				throw failure;
			},
		},
		createSession: async () => {
			sessions++;
			throw failure;
		},
	});
	await expect(
		host.probeModel("openai/gpt-6.1-sol", {
			onDispatch: () => {
				callbacks++;
			},
		}),
	).rejects.toBe(failure);
	expect({ sessions, callbacks }).toEqual({ sessions: 0, callbacks: 0 });
});
