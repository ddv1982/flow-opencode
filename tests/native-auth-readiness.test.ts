import { afterEach, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import type { Context } from "@opencode/plugin/promise/plugin";
import { CampaignCancelled } from "../evals/campaign-stop.js";
import { EvaluationPhaseError } from "../evals/failure-origin.js";
import { EvalHost } from "../evals/harness.js";
import { registerNativeAccountClient } from "../evals/native-auth/client-plugin.js";
import { connectNativeAccountSource } from "../evals/native-auth/host.js";
import {
	PLACEHOLDER_REFRESH,
	type ReadinessModel,
	UNRESOLVED_ACCESS,
} from "../evals/native-auth/protocol.js";
import * as paidBudget from "../scripts/paid-budget.js";

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
async function fixture(generic = false, additionalModels: string[] = []) {
	const root = await mkdtemp(join(tmpdir(), "flow-readiness-"));
	roots.push(root);
	await chmod(root, 0o700);
	const pin = {
		...route,
		...(generic
			? { providerID: "synthetic-provider", methodID: "synthetic-method" }
			: {}),
	};
	const pinnedMetadata = generic ? { nested: { tier: "fixture" } } : metadata;
	const selectedProfile = { ...profile, providerID: pin.providerID };
	const state: {
		provider: Record<string, unknown>;
		active: Record<string, unknown>;
		models: Array<Record<string, unknown>>;
		value: Record<string, unknown>;
		sourceValue: Record<string, unknown>;
		sourceRoute: Record<string, unknown>;
		sourceAlive: boolean;
		leaseValid: boolean;
		resolves: number;
		sourceResolves: number;
		activeRead?: () => Promise<void>;
		modelRead?: () => Promise<void>;
		resolve?: () => Promise<unknown>;
	} = {
		provider: {
			id: pin.providerID,
			integrationID: pin.integrationID,
			activation: "enabled",
			package: "@opencode/ai/providers/openai",
			settings: {
				baseURL: "https://chatgpt.com/backend-api/codex",
				transport: "http",
			},
			headers: { "chatgpt-account-id": metadata.accountID },
		},
		active: {
			type: "credential",
			id: pin.credentialID,
			label: pin.label,
			method: "oauth",
		},
		models: [
			{
				...selectedProfile,
				modelID: generic ? "native-mapped-model" : profile.id,
				enabled: true,
				variants: [],
			},
		],
		value: { ...value, methodID: pin.methodID, metadata: pinnedMetadata },
		sourceValue: { ...value, methodID: pin.methodID, metadata: pinnedMetadata },
		sourceRoute: pin,
		sourceAlive: true,
		leaseValid: true,
		resolves: 0,
		sourceResolves: 0,
	};
	if (generic) {
		state.provider.package = "synthetic-native-package";
		state.provider.settings = { transport: "websocket" };
		delete state.provider.headers;
	}
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/acquire") return Response.json({ lease: "b".repeat(64) });
			if (path === "/release") return Response.json({});
			if (!state.sourceAlive || !state.leaseValid)
				return new Response("private-source-error-sentinel", { status: 503 });
			if (path === "/resolve") {
				state.sourceResolves++;
				return Response.json({
					route: state.sourceRoute,
					value: state.sourceValue,
				});
			}
			return Response.json({});
		},
	});
	servers.push(server);
	const source = connectNativeAccountSource({
		version: 1,
		url: server.url.href,
		capability: "a".repeat(64),
		accounts: [{ route: pin, metadata: pinnedMetadata }],
	});
	const auth = await source.prepareHost({
		directory: join(root, "attachment"),
		models: [
			`${selectedProfile.providerID}/${selectedProfile.id}`,
			...additionalModels,
		],
	});
	const hooks = new Map<string, (input: unknown) => Promise<void>>();
	let handler:
		| ((raw: unknown, call: { signal: AbortSignal }) => Promise<unknown>)
		| undefined;
	let rpcDisposed = false;
	const ctx = {
		options: auth.plugin.options,
		provider: {
			get: async () => ({ data: state.provider }),
			list: async () => ({ data: [state.provider] }),
		},
		model: {
			list: async () => {
				await state.modelRead?.();
				return { data: state.models };
			},
		},
		integration: {
			get: async () => ({
				data: {
					id: pin.integrationID,
					methods: [{ type: "oauth", id: pin.methodID }],
				},
			}),
			connection: {
				active: async () => {
					await state.activeRead?.();
					return state.active;
				},
				resolve: async () => {
					state.resolves++;
					return state.resolve ? state.resolve() : state.value;
				},
			},
			transform: async (callback: (editor: unknown) => void) => {
				callback({
					method: {
						list: () => [{ type: "oauth", id: pin.methodID }],
						update: () => {},
					},
				});
				return { dispose: async () => {} };
			},
		},
		rpc: {
			register: async (
				definition: { id: string },
				handlers: { ready: typeof handler },
			) => {
				expect(definition.id).toBe("flow.native-account-readiness");
				handler = handlers.ready;
				return {
					dispose: async () => {
						rpcDisposed = true;
					},
				};
			},
		},
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
	const dispose = await registerNativeAccountClient(ctx);
	disposers.push(async () => {
		await dispose();
		await auth.dispose();
		await source.dispose();
	});
	const client = {
		rpc: () => ({
			ready: (raw: unknown, request: { signal: AbortSignal }) => {
				if (!handler) throw new Error("Missing readiness handler");
				return handler(raw, request);
			},
		}),
	} as unknown as Pick<OpenCodeClient, "rpc">;
	return {
		auth,
		client,
		state,
		profile: selectedProfile,
		dispose,
		get rpcDisposed() {
			return rpcDisposed;
		},
		ready(
			input: {
				timeoutMs?: number;
				signal?: AbortSignal;
				models?: ReadinessModel[];
			} = {},
		) {
			return auth.requireReady(client, {
				directory: "/synthetic/project",
				models: input.models ?? [selectedProfile],
				timeoutMs: input.timeoutMs ?? 250,
				...(input.signal ? { signal: input.signal } : {}),
			});
		},
		raw(raw: unknown, signal = new AbortController().signal) {
			if (!handler) throw new Error("Missing readiness handler");
			return handler(raw, { signal });
		},
		async guard(
			url: string,
			account = metadata.accountID,
			name = "http.request",
		) {
			const hook = hooks.get(name);
			if (!hook) throw new Error("Missing guard");
			await hook({
				model: selectedProfile,
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
		nativeClient: {},
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

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function hostFailure(operation: Promise<unknown>) {
	const error: unknown = await operation.catch((error) => error);
	expect(error).toBeInstanceOf(EvaluationPhaseError);
	if (!(error instanceof EvaluationPhaseError))
		throw new Error("Missing host infrastructure failure");
	expect(error.failure.origin).toBe("host");
	expect(error.failure.code).toBe("native-auth-not-ready");
	expect(error.failure.retryable).toBe(false);
	expect(error.cause).toBeUndefined();
	expect(JSON.stringify(error)).not.toContain("private-");
	return error;
}
test("production adapter waits for observed route settlement with valid cached credentials", async () => {
	const f = await fixture();
	f.state.provider.settings = { transport: "http" };
	delete f.state.provider.headers;
	const observed = deferred<void>();
	f.state.modelRead = async () => {
		observed.resolve();
	};
	let admitted = false;
	const ready = f.ready().then(() => {
		admitted = true;
	});
	await observed.promise;
	expect({ admitted, resolutions: f.state.resolves > 0 }).toEqual({
		admitted: false,
		resolutions: true,
	});
	f.state.provider.settings = {
		transport: "http",
		baseURL: "https://chatgpt.com/backend-api/codex",
	};
	f.state.provider.headers = { "ChatGPT-Account-ID": metadata.accountID };
	await ready;
	expect(admitted).toBe(true);
	expect(f.state.sourceResolves).toBeGreaterThanOrEqual(2);
});
test("future token below five minutes and rotating bearer values remain usable", async () => {
	const f = await fixture();
	f.state.value.expires = Date.now() + 30000;
	f.state.sourceValue.expires = Date.now() + 30000;
	f.state.resolve = async () => ({
		...f.state.value,
		access: `synthetic-rotation-${f.state.resolves}`,
	});
	await f.ready();
	expect(f.state.resolves).toBe(2);
	expect(f.state.sourceResolves).toBe(2);
});
for (const change of [
	"source",
	"lease",
	"source-id",
	"source-metadata",
	"id",
	"label",
	"category",
	"integration",
	"method",
	"metadata",
	"placeholder",
] as const)
	test(`fresh cached access cannot admit after ${change} conflict`, async () => {
		const f = await fixture();
		if (change === "source") f.state.sourceAlive = false;
		if (change === "lease") f.state.leaseValid = false;
		if (change === "source-id")
			f.state.sourceRoute = { ...f.state.sourceRoute, credentialID: "other" };
		if (change === "source-metadata")
			f.state.sourceValue.metadata = { ...metadata, nested: { tier: "other" } };
		if (change === "id") f.state.active.id = "other";
		if (change === "label") f.state.active.label = "other";
		if (change === "category") f.state.active.method = "key";
		if (change === "integration") f.state.provider.integrationID = "other";
		if (change === "method") f.state.value.methodID = "other";
		if (change === "metadata")
			f.state.value.metadata = { ...metadata, nested: { tier: "other" } };
		if (change === "placeholder")
			f.state.value.refresh = "private-unowned-refresh";
		await hostFailure(f.ready());
	});
test("selection changed during awaited model metadata is refused without adoption", async () => {
	const f = await fixture();
	f.state.modelRead = async () => {
		f.state.active.label = "other";
	};
	await hostFailure(f.ready());
	expect(f.state.resolves).toBe(1);
});
for (const variant of [undefined, "default", "high"])
	test(`exact native variant semantics ${variant}`, async () => {
		const f = await fixture();
		f.state.models[0] = {
			...f.state.models[0],
			variants: [
				{ id: "default", settings: { baseURL: "https://wrong.invalid" } },
				{
					id: "high",
					settings: { baseURL: "https://chatgpt.com/backend-api/codex" },
				},
			],
		};
		await f.ready({
			models: [{ ...profile, ...(variant === undefined ? {} : { variant }) }],
		});
	});
for (const change of [
	"variant",
	"variant-route",
	"wire-id",
	"model-disabled",
	"duplicate",
	"model-missing",
	"unapproved",
	"package",
	"transport",
	"backend",
	"header",
	"duplicate-header",
	"authorization",
	"key",
	"null-settings",
] as const)
	test(`readiness refuses conflicting model projection ${change}`, async () => {
		const f = await fixture();
		const model = f.state.models[0];
		if (!model) throw new Error("Missing model");
		let models: ReadinessModel[] = [profile];
		if (change === "variant") models = [{ ...profile, variant: "missing" }];
		if (change === "variant-route") {
			models = [{ ...profile, variant: "high" }];
			model.variants = [
				{ id: "high", settings: { baseURL: "https://wrong.invalid" } },
			];
		}
		if (change === "wire-id") model.modelID = "remapped";
		if (change === "model-disabled") model.enabled = false;
		if (change === "duplicate") f.state.models.push({ ...model });
		if (change === "model-missing") f.state.models = [];
		if (change === "unapproved") models = [{ ...profile, id: "other" }];
		if (change === "package") model.package = "other";
		if (change === "transport") model.settings = { transport: "websocket" };
		if (change === "backend")
			model.settings = { baseURL: "https://api.openai.com/v1" };
		if (change === "header") model.headers = { "CHATGPT-ACCOUNT-ID": "other" };
		if (change === "duplicate-header")
			model.headers = {
				"chatgpt-account-id": metadata.accountID,
				"CHATGPT-ACCOUNT-ID": "other",
			};
		if (change === "authorization")
			model.headers = { Authorization: "private-auth-sentinel" };
		if (change === "key") model.settings = { apiKey: "private-key-sentinel" };
		if (change === "null-settings") model.settings = null;
		await hostFailure(f.ready({ models, timeoutMs: 35 }));
	});
test("generic OAuth preserves native mapping, nested metadata and WebSocket guard", async () => {
	const f = await fixture(true);
	await f.ready();
	await f.guard(
		"https://synthetic.invalid/other",
		"not-an-account",
		"experimental.ws.handshake",
	);
	expect(f.state.resolves).toBe(2);
});
for (const change of ["unresolved", "expired", "expires-during-read"] as const)
	test(`credential expiry is checked at completion ${change}`, async () => {
		const f = await fixture();
		if (change === "unresolved") f.state.value.access = UNRESOLVED_ACCESS;
		if (change === "expired") f.state.value.expires = Date.now() - 1;
		if (change === "expires-during-read")
			f.state.modelRead = async () => {
				f.state.value.expires = 0;
			};
		await hostFailure(f.ready({ timeoutMs: 35 }));
	});
test("source metadata remains fresh after a successful startup observation and at HTTP", async () => {
	const f = await fixture();
	await f.ready();
	f.state.sourceValue.metadata = { ...metadata, nested: { tier: "changed" } };
	await expect(
		f.guard("https://chatgpt.com/backend-api/codex/responses"),
	).rejects.toThrow("Native account authentication failed.");
	await hostFailure(f.ready());
});
test("bounded native resolve cancellation propagates campaign reason and rejects late admission", async () => {
	const f = await fixture();
	const started = deferred<void>(),
		resolved = deferred<unknown>();
	f.state.resolve = async () => {
		started.resolve();
		return resolved.promise;
	};
	const controller = new AbortController();
	const pending = f.ready({ signal: controller.signal });
	await started.promise;
	const reason = new CampaignCancelled(130);
	controller.abort(reason);
	await expect(pending).rejects.toBe(reason);
	resolved.resolve(f.state.value);
	await Promise.resolve();
	await hostFailure(f.ready());
});
test("deadline bounds a suspended native resolve; disposal unregisters RPC and hooks", async () => {
	const f = await fixture();
	f.state.resolve = () => new Promise(() => {});
	const start = Date.now();
	await hostFailure(f.ready({ timeoutMs: 25 }));
	expect(Date.now() - start).toBeLessThan(1000);
	await f.dispose();
	expect(f.rpcDisposed).toBe(true);
});
for (const result of [
	{ version: 1, state: "ready", credential: "private-value" },
	{ version: 2, state: "ready" },
	{ version: 1, state: "not-ready", reason: "private-value" },
	null,
])
	test(`host strictly parses RPC result ${JSON.stringify(result)}`, async () => {
		const f = await fixture();
		const client = {
			rpc: () => ({ ready: async () => result }),
		} as unknown as Pick<OpenCodeClient, "rpc">;
		const error = await hostFailure(
			f.auth.requireReady(client, {
				directory: "/synthetic/project",
				models: [profile],
			}),
		);
		expect(error.message).not.toContain("private-value");
	});
test("missing RPC and raw SDK errors remain safe infrastructure failures", async () => {
	for (const missing of [false, true]) {
		const f = await fixture();
		if (missing)
			Reflect.set(f.client, "rpc", () => {
				throw new Error("private-rpc-secret");
			});
		else
			f.state.resolve = async () => {
				throw new Error("private-sdk-secret");
			};
		const error = await hostFailure(f.ready());
		expect(error.stack).not.toContain("private-");
	}
});
test("strict child input rejects authority fields without returning observations", async () => {
	const f = await fixture();
	expect(
		await f.raw({
			models: [profile],
			timeoutMs: 10,
			accountID: "private-account",
		}),
	).toEqual({
		version: 1,
		state: "not-ready",
		reason: "readiness-unavailable",
	});
});
for (const kind of ["probe", "command", "prompt"] as const)
	test(`failed ${kind} readiness precedes fake accounting and generation`, async () => {
		const f = await fixture();
		f.state.sourceAlive = false;
		const host = Object.create(EvalHost.prototype) as EvalHost;
		let accounting = 0,
			sessions = 0,
			generation = 0,
			callbacks = 0;
		const accountingSpy = spyOn(
			paidBudget,
			"consumePaidDispatch",
		).mockImplementation(async () => {
			accounting++;
		});
		Object.assign(host, {
			project: "/synthetic/project",
			nativeClient: f.client,
			nativeAuthHost: f.auth,
			verifyArtifacts: async () => {},
			escalationQuestions: new Map(),
			createSession: async () => {
				sessions++;
				return "synthetic-session";
			},
			nativeRequest: async () => {
				generation++;
				throw new Error("Generation prohibited");
			},
			deleteSession: async () => {},
		});
		try {
			await hostFailure(
				kind === "probe"
					? host.probeModel("openai/gpt-6.1-sol", {
							onDispatch: () => {
								callbacks++;
							},
						})
					: kind === "command"
						? host.runCommand(
								"synthetic-session",
								"flow",
								"",
								"openai/gpt-6.1-sol",
							)
						: host.runPrompt(
								"synthetic-session",
								"synthetic",
								"openai/gpt-6.1-sol",
							),
			);
			expect({ accounting, sessions, generation, callbacks }).toEqual({
				accounting: 0,
				sessions: 0,
				generation: 0,
				callbacks: 0,
			});
		} finally {
			accountingSpy.mockRestore();
		}
	});

test("all startup profiles are checked and a reviewer variant cannot escape the gate", async () => {
	const f = await fixture(false, ["openai/reviewer"]);
	f.state.models.push({
		...profile,
		id: "reviewer",
		modelID: "reviewer",
		enabled: true,
		variants: [{ id: "high", settings: { baseURL: "https://wrong.invalid" } }],
	});
	await hostFailure(
		f.ready({
			models: [
				profile,
				{ providerID: "openai", id: "reviewer", variant: "high" },
			],
			timeoutMs: 35,
		}),
	);
});
test("cancellation immediately after readiness prevents fake dispatch accounting", async () => {
	const f = await fixture();
	const controller = new AbortController();
	const reason = new CampaignCancelled(130);
	const host = Object.create(EvalHost.prototype) as EvalHost;
	let accounting = 0,
		generation = 0;
	const accountingSpy = spyOn(
		paidBudget,
		"consumePaidDispatch",
	).mockImplementation(async () => {
		accounting++;
	});
	Object.assign(host, {
		project: "/synthetic/project",
		nativeClient: f.client,
		signal: controller.signal,
		nativeAuthHost: {
			requireReady: async (...args: Parameters<typeof f.auth.requireReady>) => {
				await f.auth.requireReady(...args);
				controller.abort(reason);
			},
		},
		verifyArtifacts: async () => {},
		escalationQuestions: new Map(),
		nativeRequest: async () => {
			generation++;
		},
	});
	try {
		await expect(
			host.runPrompt("synthetic", "synthetic", "openai/gpt-6.1-sol"),
		).rejects.toBe(reason);
		expect({ accounting, generation }).toEqual({
			accounting: 0,
			generation: 0,
		});
	} finally {
		accountingSpy.mockRestore();
	}
});
test("plugin disposal while resolving is bounded and does not admit a late value", async () => {
	const f = await fixture();
	const started = deferred<void>(),
		resolved = deferred<unknown>();
	f.state.resolve = async () => {
		started.resolve();
		return resolved.promise;
	};
	const pending = f.ready();
	await started.promise;
	await f.dispose();
	const error = await hostFailure(pending);
	expect(error.message).toBe(
		"Native account authentication is not ready (readiness-cancelled).",
	);
	resolved.resolve(f.state.value);
});

test("closing source resolve catches a metadata change during the final model read", async () => {
	const f = await fixture();
	let reads = 0;
	f.state.modelRead = async () => {
		if (++reads === 2)
			f.state.sourceValue.metadata = {
				...metadata,
				nested: { tier: "changed-at-close" },
			};
	};
	const error = await hostFailure(f.ready());
	expect(error.message).toBe(
		"Native account authentication is not ready (source-unavailable).",
	);
});
test("late HTTP refusal remains consumed after a successful pre-account gate", async () => {
	const f = await fixture();
	const host = Object.create(EvalHost.prototype) as EvalHost;
	let accounting = 0,
		callbacks = 0,
		transports = 0;
	const accountingSpy = spyOn(
		paidBudget,
		"consumePaidDispatch",
	).mockImplementation(async () => {
		accounting++;
	});
	Object.assign(host, {
		project: "/synthetic/project",
		nativeAuthHost: f.auth,
		serverLog: "",
		nativeClient: {
			...f.client,
			session: {
				switchModel: async () => {},
				prompt: async () => {
					await f.guard("https://api.openai.com/v1/responses");
					transports++;
				},
			},
		},
		verifyArtifacts: async () => {},
		createSession: async () => "synthetic-session",
		deleteSession: async () => {},
		nativeRequest: async (operation: (request: object) => Promise<unknown>) =>
			operation({}),
	});
	try {
		expect(
			await host.probeModel("openai/gpt-6.1-sol", {
				onDispatch: () => {
					callbacks++;
				},
			}),
		).toBe("Native account authentication failed.");
		expect({ accounting, callbacks, transports }).toEqual({
			accounting: 1,
			callbacks: 1,
			transports: 0,
		});
	} finally {
		accountingSpy.mockRestore();
	}
});

for (const variant of ["high effort", "高"] as const)
	test(`parent valid native variant ${variant} remains usable`, async () => {
		const { Model } = await import("@opencode/schema/model");
		const ref = Model.Ref.parse(`synthetic-provider/gpt-6.1-sol#${variant}`);
		expect<string | undefined>(ref.variant).toBe(variant);
		const f = await fixture(true);
		f.state.models[0] = {
			...f.state.models[0],
			variants: [{ id: variant, settings: {} }],
		};
		await f.ready({ models: [{ ...ref, variant }] });
	});

for (const unavailable of ["missing", "misspelled", "disabled"] as const)
	test(`catalog diagnostic ${unavailable} retains zero fake accounting`, async () => {
		const f = await fixture(true, ["synthetic-provider/gpt-6.1-sol-typo"]);
		const requested =
			unavailable === "misspelled"
				? { ...f.profile, id: "gpt-6.1-sol-typo" }
				: f.profile;
		if (unavailable === "missing") f.state.models = [];
		if (unavailable === "disabled")
			f.state.models[0] = { ...f.state.models[0], enabled: false };
		const host = Object.create(EvalHost.prototype) as EvalHost;
		let accounting = 0,
			sessions = 0,
			dispatches = 0;
		const accountingSpy = spyOn(
			paidBudget,
			"consumePaidDispatch",
		).mockImplementation(async () => {
			accounting++;
		});
		Object.assign(host, {
			project: "/synthetic/project",
			nativeClient: f.client,
			nativeAuthHost: {
				requireReady: async () =>
					f.ready({ models: [requested], timeoutMs: 40 }),
			},
			verifyArtifacts: async () => {},
			createSession: async () => {
				sessions++;
				return "synthetic-session";
			},
		});
		try {
			const error = await hostFailure(
				host.probeModel(`${requested.providerID}/${requested.id}`, {
					onDispatch: () => {
						dispatches++;
					},
				}),
			);
			expect({ accounting, sessions, dispatches }).toEqual({
				accounting: 0,
				sessions: 0,
				dispatches: 0,
			});
			expect(error.message).toBe(
				"Native account authentication is not ready (readiness-deadline). Check that each requested model is present and enabled in the native catalog; OAuth initialization may also be incomplete.",
			);
		} finally {
			accountingSpy.mockRestore();
		}
	});
for (const unavailable of ["missing", "disabled"] as const)
	test(`catalog diagnostic transient ${unavailable} waits for valid OAuth bootstrap`, async () => {
		const f = await fixture(true);
		const settled = [...f.state.models];
		f.state.models =
			unavailable === "missing"
				? []
				: settled.map((model) => ({ ...model, enabled: false }));
		const observed = deferred<void>(),
			release = deferred<void>();
		let reads = 0,
			accounting = 0;
		f.state.modelRead = async () => {
			if (++reads === 2) {
				observed.resolve();
				await release.promise;
			}
		};
		const pending = f.ready({ timeoutMs: 1000 }).then(() => {
			accounting++;
		});
		try {
			await observed.promise;
			expect({ reads, accounting }).toEqual({ reads: 2, accounting: 0 });
			f.state.models = settled;
			release.resolve();
			await pending;
			expect(accounting).toBe(1);
		} finally {
			release.resolve();
			await pending.catch(() => {});
		}
	});
