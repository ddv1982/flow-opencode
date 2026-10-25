import { afterEach, expect, test } from "bun:test";
import {
	chmod,
	link,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Credential, Integration } from "@opencode/plugin";
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/promise/integration";
import type { Context } from "@opencode/plugin/promise/plugin";
import { registerNativeAccountClient } from "../evals/native-auth/client-plugin.js";
import {
	connectNativeAccountSource,
	nativeAuthSourceSha256,
	stageNativeAuthClient,
	verifyNativeAuthClient,
} from "../evals/native-auth/host.js";
import {
	type NativeAccountConnection,
	NativeAuthError,
	PLACEHOLDER_REFRESH,
	parseConnection,
	parseOAuth,
	providersForModels,
} from "../evals/native-auth/protocol.js";
import { registerNativeAccountSource } from "../evals/native-auth/source-plugin.js";

const roots: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) await server.stop(true);
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});
async function directory() {
	const root = await mkdtemp(join(tmpdir(), "flow-native-auth-unit-"));
	await chmod(root, 0o700);
	roots.push(root);
	return root;
}
const route = {
	providerID: "alias",
	integrationID: "openai",
	credentialID: "credential-selected",
	methodID: "selected-oauth",
	label: "Selected",
};
const account = {
	route,
	metadata: { accountId: "synthetic-account", nested: { tier: "fixture" } },
};
const oauth = {
	type: "oauth" as const,
	methodID: route.methodID,
	access: "synthetic-access",
	refresh: PLACEHOLDER_REFRESH,
	expires: 4102444800000,
	metadata: account.metadata,
};
const cap = "a".repeat(64),
	lease = "b".repeat(64);
function context(value: unknown): Context {
	return value as Context;
}
function rpcCapture() {
	let handlers: unknown;
	let disposed = 0;
	return {
		rpc: {
			register: async (_definition: unknown, value: unknown) => {
				handlers = value;
				return {
					dispose: async () => {
						disposed++;
					},
				};
			},
		},
		async call(name: string, input: unknown = {}) {
			if (!handlers || typeof handlers !== "object")
				throw new Error("Missing fixture RPC");
			const handler = Reflect.get(handlers, name);
			if (typeof handler !== "function")
				throw new Error("Missing fixture RPC method");
			return await Reflect.apply(handler, undefined, [input]);
		},
		get disposed() {
			return disposed;
		},
	};
}
function sourceFixture() {
	const rpc = rpcCapture();
	let active: unknown = {
		type: "credential",
		id: route.credentialID,
		label: route.label,
		method: "oauth",
	};
	let provider = {
		id: route.providerID,
		integrationID: route.integrationID,
		activation: "enabled",
		name: "Alias",
		package: "fixture",
	};
	let value = { ...oauth, refresh: "synthetic-original-refresh" };
	let concurrent = 0,
		maxConcurrent = 0;
	return {
		rpc,
		changeActive(next: unknown) {
			active = next;
		},
		disable() {
			provider = { ...provider, activation: "disabled" };
		},
		changeValue(next: typeof value) {
			value = next;
		},
		get maxConcurrent() {
			return maxConcurrent;
		},
		ctx: context({
			options: { providers: [route.providerID] },
			provider: { get: async () => ({ data: provider }) },
			integration: {
				get: async () => ({
					data: { methods: [{ type: "oauth", id: route.methodID }] },
				}),
				connection: {
					active: async () => active,
					resolve: async () => {
						concurrent++;
						maxConcurrent = Math.max(maxConcurrent, concurrent);
						await Bun.sleep(1);
						concurrent--;
						return structuredClone(value);
					},
				},
			},
			rpc: rpc.rpc,
		}),
	};
}
test("source returns placeholder OAuth fields and preserves metadata without exporting refresh", async () => {
	const f = sourceFixture();
	const dispose = await registerNativeAccountSource(f.ctx);
	const result = await f.rpc.call("describe");
	expect(JSON.stringify(result).includes("synthetic-original-refresh")).toBe(
		false,
	);
	expect(result).toEqual({ accounts: [{ route, value: oauth }] });
	await Promise.all([
		f.rpc.call("resolve", route),
		f.rpc.call("resolve", route),
	]);
	expect(f.maxConcurrent).toBe(1);
	await dispose();
	await dispose();
	expect(f.rpc.disposed).toBe(1);
	await expect(f.rpc.call("resolve", route)).rejects.toThrow(
		"Native account authentication failed.",
	);
});
test("source refuses switched, env, disabled, relabeled, method, and account metadata mismatches", async () => {
	for (const change of [
		"switched",
		"env",
		"disabled",
		"label",
		"method",
		"metadata",
	]) {
		const f = sourceFixture();
		const dispose = await registerNativeAccountSource(f.ctx);
		await f.rpc.call("describe");
		if (change === "switched")
			f.changeActive({
				type: "credential",
				id: "other",
				label: route.label,
				method: "oauth",
			});
		if (change === "env")
			f.changeActive({ type: "env", name: "OPENAI_API_KEY" });
		if (change === "disabled") f.disable();
		if (change === "label")
			f.changeActive({
				type: "credential",
				id: route.credentialID,
				label: "changed",
				method: "oauth",
			});
		if (change === "method")
			f.changeValue({
				...oauth,
				refresh: "synthetic-original-refresh",
				methodID: "other",
			});
		if (change === "metadata")
			f.changeValue({
				...oauth,
				refresh: "synthetic-original-refresh",
				metadata: { accountId: "other", nested: { tier: "fixture" } },
			});
		await expect(f.rpc.call("resolve", route)).rejects.toThrow(
			"Native account authentication failed.",
		);
		await dispose();
	}
});
test("source blocks original refresh duplicated in metadata or access", async () => {
	const f = sourceFixture();
	f.changeValue({
		...oauth,
		refresh: "synthetic-original-refresh",
		access: "synthetic-original-refresh",
	});
	const dispose = await registerNativeAccountSource(f.ctx);
	await expect(f.rpc.call("describe")).rejects.toThrow(
		"Native account authentication failed.",
	);
	await dispose();
});
async function relay() {
	let alive = true,
		held = false,
		resolutions = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			if (!alive)
				return new Response("synthetic-secret-diagnostic", { status: 503 });
			const path = new URL(request.url).pathname;
			if (path === "/acquire") {
				if (held) return new Response(null, { status: 409 });
				held = true;
				return Response.json({ lease });
			}
			if (path === "/release") {
				held = false;
				return Response.json({});
			}
			if (path === "/check") return Response.json({});
			resolutions++;
			return Response.json({ route, value: oauth });
		},
	});
	servers.push(server);
	const configuration: NativeAccountConnection = {
		version: 1,
		url: server.url.href,
		capability: cap,
		accounts: [account],
	};
	return {
		configuration,
		fail() {
			alive = false;
		},
		get resolutions() {
			return resolutions;
		},
		get held() {
			return held;
		},
	};
}
async function clientFixture() {
	const root = await directory();
	const remote = await relay();
	const path = join(root, "configuration.json");
	await writeFile(
		path,
		JSON.stringify({
			connection: remote.configuration,
			lease,
			models: ["alias/model"],
		}),
		{ mode: 0o600 },
	);
	let active: unknown = {
		type: "credential",
		id: route.credentialID,
		method: "oauth",
		label: route.label,
	};
	const methods: IntegrationOAuthMethodRegistration[] = [];
	const hooks = new Map<string, unknown>();
	const rpc = rpcCapture();
	const ctx = context({
		...rpc,
		options: { configurationPath: path },
		provider: {
			get: async () => ({
				data: { activation: "enabled", integrationID: route.integrationID },
			}),
		},
		integration: {
			connection: { active: async () => active },
			transform: async (callback: (editor: unknown) => void) => {
				callback({
					method: {
						list: () => [
							{ type: "oauth", id: route.methodID, label: "Selected" },
							{ type: "oauth", id: "unrelated", label: "Other" },
						],
						update: (method: IntegrationOAuthMethodRegistration) =>
							methods.push(method),
					},
				});
				return { dispose: async () => {} };
			},
		},
		session: {
			hook: async (name: string, callback: unknown) => {
				hooks.set(name, callback);
				return {
					dispose: async () => {
						hooks.delete(name);
					},
				};
			},
		},
	});
	const dispose = await registerNativeAccountClient(ctx);
	const method = methods[0];
	if (!method?.refresh) throw new Error("Missing fixture refresh");
	const credential = Credential.OAuth.make({
		...oauth,
		methodID: Integration.MethodID.make(route.methodID),
	});
	return {
		remote,
		methods,
		credential,
		dispose,
		refresh: method.refresh,
		changeActive(value: unknown) {
			active = value;
		},
		async guard(
			name = "http.request",
			input: unknown = {
				model: { providerID: route.providerID },
				request: new Request("http://127.0.0.1/model"),
			},
		) {
			const hook = hooks.get(name);
			if (typeof hook !== "function") throw new Error("Missing fixture guard");
			await Reflect.apply(hook, undefined, [input]);
			return input;
		},
	};
}
test("child replaces only selected method, uses source even for unexpired access, and preserves request identity", async () => {
	const f = await clientFixture();
	expect(f.methods.map((method) => method.method.id)).toEqual([route.methodID]);
	expect((await f.refresh(f.credential)).refresh).toBe(PLACEHOLDER_REFRESH);
	expect(f.remote.resolutions).toBe(1);
	const request = new Request("http://127.0.0.1/model", {
		headers: { "x-evidence": "unchanged" },
	});
	const input = { model: { providerID: route.providerID }, request };
	expect(await f.guard("http.request", input)).toBe(input);
	expect(input.request).toBe(request);
	expect(request.headers.get("x-evidence")).toBe("unchanged");
	await f.guard("experimental.ws.handshake");
	await f.dispose();
	await f.dispose();
});
for (const conflict of [true, false])
	test(
		conflict
			? "child refuses conflicting method credentials before registering a transform"
			: "same-account aliases share one OAuth registration and resolve successfully",
		async () => {
			const root = await directory();
			const accounts = [
				account,
				{
					...account,
					route: {
						...route,
						providerID: "alias-two",
						credentialID: conflict ? "other-credential" : route.credentialID,
					},
				},
			];
			let requests = 0;
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch() {
					requests++;
					return Response.json({ route: accounts[1]?.route, value: oauth });
				},
			});
			servers.push(server);
			const path = join(root, "configuration.json");
			await writeFile(
				path,
				JSON.stringify({
					connection: {
						version: 1,
						url: server.url.href,
						capability: cap,
						accounts,
					},
					lease,
					models: ["alias/model", "alias-two/model"],
				}),
				{ mode: 0o600 },
			);
			let transforms = 0;
			const methods: IntegrationOAuthMethodRegistration[] = [];
			const rpc = rpcCapture();
			const ctx = context({
				...rpc,
				options: { configurationPath: path },
				integration: {
					connection: {
						active: async () => ({
							type: "credential",
							id: route.credentialID,
							method: "oauth",
						}),
					},
					transform: async (callback: (editor: unknown) => void) => {
						transforms++;
						callback({
							method: {
								list: () => [
									{ type: "oauth", id: route.methodID, label: "Selected" },
								],
								update: (method: IntegrationOAuthMethodRegistration) =>
									methods.push(method),
							},
						});
						return { dispose: async () => {} };
					},
				},
				session: { hook: async () => ({ dispose: async () => {} }) },
			});
			if (conflict) {
				await expect(registerNativeAccountClient(ctx)).rejects.toThrow(
					"Native account authentication failed.",
				);
				expect(transforms).toBe(0);
				expect(methods.length).toBe(0);
				expect(requests).toBe(0);
			} else {
				const dispose = await registerNativeAccountClient(ctx);
				expect(transforms).toBe(1);
				expect(methods.map((method) => method.method.id)).toEqual([
					route.methodID,
				]);
				const refresh = methods[0]?.refresh;
				if (!refresh) throw new Error("Missing alias refresh");
				const credential = Credential.OAuth.make({
					...oauth,
					methodID: Integration.MethodID.make(route.methodID),
				});
				expect((await refresh(credential)).refresh).toBe(PLACEHOLDER_REFRESH);
				expect(requests).toBe(1);
				await dispose();
			}
		},
	);
test("child refuses ambient env and another active child account before HTTP", async () => {
	for (const active of [
		{ type: "env", name: "OPENAI_API_KEY" },
		{ type: "credential", id: "other", method: "oauth", label: "Other" },
	]) {
		const f = await clientFixture();
		f.changeActive(active);
		await expect(f.guard()).rejects.toThrow(
			"Native account authentication failed.",
		);
		expect(f.remote.resolutions).toBe(0);
		await f.dispose();
	}
});
test("valid cached child access fails closed when the source disappears", async () => {
	const f = await clientFixture();
	await f.refresh(f.credential);
	f.remote.fail();
	await expect(f.guard()).rejects.toThrow(
		"Native account authentication failed.",
	);
	await expect(f.refresh(f.credential)).rejects.toThrow(
		"Native account authentication failed.",
	);
	await f.dispose();
});
test("client configuration errors are generic and private permissions are required", async () => {
	const root = await directory();
	const path = join(root, "config.json");
	await writeFile(path, "synthetic-secret-malformed", { mode: 0o600 });
	await expect(
		registerNativeAccountClient(
			context({ options: { configurationPath: path } }),
		),
	).rejects.toThrow("Native account authentication failed.");
	await chmod(path, 0o644);
	await expect(
		registerNativeAccountClient(
			context({ options: { configurationPath: path } }),
		),
	).rejects.toThrow("Native account authentication failed.");
});
test("stage produces deterministic bytes and exact directory verification rejects extra executable paths", async () => {
	const root = await directory();
	const first = await stageNativeAuthClient(join(root, "one"));
	const second = await stageNativeAuthClient(join(root, "two"));
	expect(first.sourceSha256).toBe(second.sourceSha256);
	expect(first.entrySha256).toBe(second.entrySha256);
	expect(
		nativeAuthSourceSha256(
			Object.fromEntries(Object.entries(first.files).reverse()),
		) === first.sourceSha256,
	).toBe(true);
	await verifyNativeAuthClient(first);
	for (const kind of ["index.js", "nested", "node_modules"]) {
		if (kind === "index.js")
			await writeFile(join(first.pluginDirectory, kind), "export default {}\n");
		else await mkdir(join(first.pluginDirectory, kind));
		await expect(verifyNativeAuthClient(first)).rejects.toThrow(
			"Native account authentication failed.",
		);
		await rm(join(first.pluginDirectory, kind), { recursive: true });
	}
	await writeFile(join(first.pluginDirectory, "client-plugin.ts"), "changed");
	await expect(verifyNativeAuthClient(first)).rejects.toThrow(
		"Native account authentication failed.",
	);
});
test("staged manifest rejects hardlinks and symlink entries", async () => {
	for (const kind of ["symlink", "hardlink"]) {
		const root = await directory();
		const artifact = await stageNativeAuthClient(join(root, "plugin"));
		const path = join(artifact.pluginDirectory, "index.ts");
		const backup = join(root, "backup.ts");
		await writeFile(backup, await readFile(path));
		await rm(path);
		if (kind === "symlink") await symlink(backup, path);
		else await link(backup, path);
		await expect(verifyNativeAuthClient(artifact)).rejects.toThrow(
			"Native account authentication failed.",
		);
	}
});
test("host lease has only placeholder data, private out-of-project configuration, and startup disposal releases it", async () => {
	const root = await directory();
	const remote = await relay();
	const source = connectNativeAccountSource(remote.configuration);
	const auth = await source.prepareHost({
		directory: join(root, "attachment"),
		models: ["alias/model"],
	});
	expect(auth.credentialHandoff.entries.map((entry) => entry.id)).toEqual([
		route.credentialID,
	]);
	expect(
		JSON.stringify(auth.credentialHandoff.entries).includes(
			"synthetic-original-refresh",
		),
	).toBe(false);
	expect(Object.keys(auth.plugin.options)).toEqual(["configurationPath"]);
	expect(
		(await lstat(auth.plugin.options.configurationPath)).mode & 0o777,
	).toBe(0o600);
	await expect(
		source.prepareHost({
			directory: join(root, "overlap"),
			models: ["alias/model"],
		}),
	).rejects.toThrow("Native account authentication failed.");
	await auth.dispose();
	await auth.dispose();
	expect(remote.held).toBe(false);
	expect(await readdir(root)).toEqual([]);
	await source.dispose();
});
test("presealed staging is verified and never rebuilt or removed by host attachment", async () => {
	const root = await directory();
	const remote = await relay();
	const artifact = await stageNativeAuthClient(join(root, "sealed"));
	const source = connectNativeAccountSource(remote.configuration);
	const auth = await source.prepareHost({
		directory: join(root, "private"),
		configurationPath: join(root, "private/capability.json"),
		models: ["alias/model"],
		stagedClient: artifact,
	});
	expect(auth.plugin.package).toBe(artifact.pluginDirectory);
	expect(auth.artifactHashes.sourceSha256).toBe(artifact.sourceSha256);
	await auth.dispose();
	await verifyNativeAuthClient(artifact);
	await source.dispose();
});
for (const mode of ["configuration-directory", "release-failure", "both"])
	test(`owned host cleanup survives ${mode} and preserves presealed bytes`, async () => {
		const root = await directory();
		const remote = await relay();
		const artifact = await stageNativeAuthClient(join(root, "sealed"));
		const names = Object.keys(artifact.files);
		const before = await Promise.all(
			names.map((name) => readFile(join(artifact.pluginDirectory, name))),
		);
		const source = connectNativeAccountSource(remote.configuration);
		const owned = join(root, "attachment");
		const auth = await source.prepareHost({
			directory: owned,
			models: ["alias/model"],
			stagedClient: artifact,
		});
		if (mode !== "release-failure") {
			await rm(auth.plugin.options.configurationPath);
			await mkdir(auth.plugin.options.configurationPath);
		}
		if (mode !== "configuration-directory") remote.fail();
		if (mode === "configuration-directory") {
			await auth.dispose();
			await auth.dispose();
		} else {
			await expect(auth.dispose()).rejects.toThrow(
				"Native account authentication failed.",
			);
			await expect(auth.dispose()).rejects.toThrow(
				"Native account authentication failed.",
			);
		}
		await expect(lstat(owned)).rejects.toThrow();
		const after = await Promise.all(
			names.map((name) => readFile(join(artifact.pluginDirectory, name))),
		);
		expect(
			after.every((bytes, index) =>
				bytes.equals(before[index] ?? Buffer.alloc(0)),
			),
		).toBe(true);
		await verifyNativeAuthClient(artifact);
		await source.dispose().catch(() => {});
	});
test("shutdown rejects identity and refresh corruption but explicit dispose releases consumed ownership", async () => {
	const root = await directory();
	const remote = await relay();
	const source = connectNativeAccountSource(remote.configuration);
	const auth = await source.prepareHost({
		directory: join(root, "attachment"),
		models: ["alias/model"],
	});
	const after = structuredClone([...auth.credentialHandoff.entries]);
	const entry = after[0];
	if (entry?.value.type !== "oauth") throw new Error("Missing fixture entry");
	entry.value.refresh = "synthetic-unowned-refresh";
	await expect(
		auth.credentialHandoff.onStop({
			before: auth.credentialHandoff.entries,
			after,
		}),
	).rejects.toThrow("Native account authentication failed.");
	await auth.dispose();
	expect(remote.held).toBe(false);
	await source.dispose();
});
for (const releaseFails of [false, true])
	test(`host disposal hides real local filesystem refusal with release failure ${releaseFails}`, async () => {
		const root = await directory();
		const parent = join(root, "parent");
		const retained = join(root, "retained");
		await mkdir(parent, { mode: 0o700 });
		let releases = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				if (new URL(request.url).pathname === "/acquire")
					return Response.json({ lease });
				releases++;
				await rename(parent, retained);
				await symlink(parent, parent);
				return releaseFails
					? new Response("private-release-sentinel", { status: 503 })
					: Response.json({});
			},
		});
		servers.push(server);
		const source = connectNativeAccountSource({
			version: 1,
			url: server.url.href,
			capability: cap,
			accounts: [account],
		});
		const artifact = await stageNativeAuthClient(join(root, "sealed"));
		const owned = join(parent, "attachment");
		const auth = await source.prepareHost({
			directory: owned,
			models: ["alias/model"],
			stagedClient: artifact,
		});
		try {
			const failure: unknown = await auth.dispose().catch((error) => error);
			if (!(failure instanceof Error))
				throw new Error("Missing disposal rejection");
			expect(failure.message).toBe("Native account authentication failed.");
			expect(failure instanceof NativeAuthError).toBe(true);
			expect(failure.name).toBe("NativeAuthError");
			expect(failure.message).toBe("Native account authentication failed.");
			expect("cause" in failure).toBe(false);
			expect(
				failure.stack?.includes(root.split("/").at(-1) ?? root) ?? false,
			).toBe(false);
			expect(failure.stack?.includes("private-release-sentinel") ?? false).toBe(
				false,
			);
			expect(await auth.dispose().catch((error) => error)).toBe(failure);
			expect(releases).toBe(1);
			expect((await lstat(join(retained, "attachment"))).isDirectory()).toBe(
				true,
			);
			await verifyNativeAuthClient(artifact);
			await rm(parent);
			await rename(retained, parent);
			expect(await auth.dispose().catch((error) => error)).toBe(failure);
			expect((await lstat(owned)).isDirectory()).toBe(true);
		} finally {
			if (
				await lstat(retained).then(
					() => true,
					() => false,
				)
			) {
				await rm(parent);
				await rename(retained, parent);
			}
			await source.dispose().catch(() => {});
		}
	});
test("parsers do not echo values or allow nonloopback capabilities", () => {
	for (const url of [
		"https://127.0.0.1:12/",
		"http://example.com:12/",
		"http://token@127.0.0.1:12/",
		"http://127.0.0.1:12/?secret=fixture",
	]) {
		expect(() =>
			parseConnection({
				version: 1,
				url,
				capability: cap,
				accounts: [account],
			}),
		).toThrow(NativeAuthError);
	}
	expect(() =>
		parseOAuth({ ...oauth, refresh: "synthetic-original-refresh" }),
	).toThrow("Native account authentication failed.");
	expect(() => providersForModels(["bad-model"])).toThrow(
		"Native account authentication failed.",
	);
});
