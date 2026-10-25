import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import {
	nativeAccountCLI,
	startNativeAccountBroker,
} from "../../evals/native-auth/broker.js";
import {
	connectNativeAccountSource,
	stageNativeAuthClient,
} from "../../evals/native-auth/host.js";
import {
	object,
	PLACEHOLDER_REFRESH,
} from "../../evals/native-auth/protocol.js";
import { FixtureRpc } from "./native-auth-plugin.js";
import { localScriptedProvider } from "./opencode-v2-scripted-provider.js";

process.umask(0o077);
const configuredBinary = process.env.FLOW_OPENCODE_NATIVE_EXECUTABLE;
if (!configuredBinary)
	throw new Error("A private native executable is required.");
const binary: string = configuredBinary;
const root = await mkdtemp(join(tmpdir(), "flow-native-auth-production-"));
const fixture = localScriptedProvider();
let bearerVerified = false;
let expectedAccess = "";
const proxy = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		bearerVerified =
			request.headers.get("authorization") === `Bearer ${expectedAccess}`;
		const url = new URL(request.url);
		url.host = fixture.server.url.host;
		return fetch(new Request(url.href, request));
	},
});
const children: {
	pid: number;
	exitCode: number | null;
	kill(signal?: "SIGTERM"): void;
	exited: Promise<number>;
}[] = [];
const receipt: Record<string, unknown> = { root, cloudRequests: 0 };
let stage = "setup";
let broker: Awaited<ReturnType<typeof startNativeAccountBroker>> | undefined;
let source: ReturnType<typeof connectNativeAccountSource> | undefined;
async function host(
	role: "source" | "child",
	plugin?: { package: string; options: object },
) {
	const dir = join(root, role);
	await mkdir(dir, { mode: 0o700 });
	for (const name of [
		"home",
		"config",
		"cache",
		"data",
		"state",
		"tmp",
		"project",
	])
		await mkdir(join(dir, name), { mode: 0o700 });
	await mkdir(join(dir, "config/opencode"), { mode: 0o700 });
	const fixtureDirectory = join(dir, "fixture");
	await mkdir(fixtureDirectory, { mode: 0o700 });
	await writeFile(
		join(fixtureDirectory, "index.ts"),
		`export {default} from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "native-auth-plugin.ts")).href)};\n`,
		{ mode: 0o600 },
	);
	await writeFile(
		join(dir, "config/opencode/opencode.json"),
		JSON.stringify({
			update: "disable",
			warming: false,
			share: "disabled",
			plugins: [
				{
					package: fixtureDirectory,
					options: { role, baseURL: new URL("v1", proxy.url).href },
				},
			],
		}),
		{ mode: 0o600 },
	);
	if (plugin)
		await writeFile(
			join(dir, "project/opencode.json"),
			JSON.stringify({ plugins: [plugin] }),
			{ mode: 0o600 },
		);
	const env = {
		PATH: "/usr/bin:/bin",
		HOME: join(dir, "home"),
		XDG_CONFIG_HOME: join(dir, "config"),
		XDG_CACHE_HOME: join(dir, "cache"),
		XDG_DATA_HOME: join(dir, "data"),
		XDG_STATE_HOME: join(dir, "state"),
		TMPDIR: join(dir, "tmp"),
		...(role === "child" ? { OPENAI_API_KEY: "synthetic-ambient-key" } : {}),
	};
	let client: ReturnType<typeof OpenCode.make>;
	let child: {
		pid: number;
		exitCode: number | null;
		kill(signal?: "SIGTERM"): void;
		exited: Promise<number>;
	};
	if (role === "source") {
		for (const key of Object.keys(process.env)) delete process.env[key];
		for (const [key, value] of Object.entries(env)) process.env[key] = value;
		const allocation = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response(),
		});
		const privatePort = allocation.port;
		allocation.stop(true);
		await nativeAccountCLI(
			binary,
			["service", "set", "port", String(privatePort)],
			join(dir, "project"),
		);
		const endpoint = await Service.ensure({
			command: [binary, "serve", "--service"],
			env,
			file: join(dir, "state/opencode/service.json"),
			version: "2.1.4",
		});
		client = OpenCode.make({
			baseUrl: endpoint.url,
			headers: Service.headers(endpoint),
		});
		const info = await client.server.info();
		let stopping = false;
		let resolveExit: (code: number) => void = () => {};
		let rejectExit: (error: Error) => void = () => {};
		const exited = new Promise<number>((resolve, reject) => {
			resolveExit = resolve;
			rejectExit = reject;
		});
		const managed = {
			pid: info.pid,
			exitCode: null as number | null,
			exited,
			kill: () => {
				if (stopping) return;
				stopping = true;
				void (async () => {
					try {
						process.kill(info.pid, "SIGTERM");
					} catch {}
					for (let i = 0; i < 320; i++) {
						try {
							process.kill(info.pid, 0);
						} catch {
							managed.exitCode = 0;
							resolveExit(0);
							return;
						}
						if (i === 160)
							try {
								process.kill(info.pid, "SIGKILL");
							} catch {}
						await Bun.sleep(25);
					}
					rejectExit(new Error("Private native service did not stop"));
				})();
			},
		};
		child = managed;
	} else {
		const listener = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response(),
		});
		const port = listener.port;
		listener.stop(true);
		const spawned = Bun.spawn(
			[binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
			{ cwd: join(dir, "project"), env, stdout: "pipe", stderr: "pipe" },
		);
		child = spawned;
		let password = "";
		async function consume(stream: ReadableStream<Uint8Array>) {
			let pending = "";
			for await (const chunk of stream) {
				pending = (pending + new TextDecoder().decode(chunk)).slice(-4096);
				password = pending.match(/server password (\S+)/)?.[1] ?? password;
			}
		}
		void consume(spawned.stdout);
		void consume(spawned.stderr);
		const transport: typeof fetch = Object.assign(
			(input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const headers = new Headers(init?.headers);
				headers.set(
					"authorization",
					`Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
				);
				return fetch(input, {
					...init,
					headers,
					signal: AbortSignal.any([
						...(init?.signal ? [init.signal] : []),
						AbortSignal.timeout(15000),
					]),
				});
			},
			{ preconnect: globalThis.fetch.preconnect },
		);
		client = OpenCode.make({
			baseUrl: `http://127.0.0.1:${port}`,
			fetch: transport,
		});
		for (let i = 0; ; i++) {
			try {
				await client.server.info();
				break;
			} catch {
				if (i === 100) throw new Error("Private source unavailable");
				await Bun.sleep(50);
			}
		}
	}
	children.push(child);
	const project = join(dir, "project");
	const ready = await client.session.create({
		location: { directory: project },
		title: "Native auth readiness",
	});
	await client.session.remove({ sessionID: ready.id });
	await client.config.get({ location: { directory: project } });
	for (let i = 0; ; i++) {
		const plugins = (
			await client.plugin.list({ location: { directory: project } })
		).data;
		const required = [
			"native-auth.fixture",
			...(plugin ? ["flow.native-account-client"] : []),
		];
		if (
			required.every((id) =>
				plugins.some(
					(candidate) =>
						candidate.id === id && candidate.state.status === "active",
				),
			)
		)
			break;
		if (i === 100) throw new Error("Native auth plugins did not activate");
		await Bun.sleep(50);
	}
	receipt[`${role}PluginsActiveBeforeCredentialImport`] = true;
	return { dir, env, client, child, project: join(dir, "project") };
}
try {
	const owner = await host("source");
	for (const [key, value] of Object.entries(owner.env))
		process.env[key] = value;
	stage = "default-cli-discovery";
	const info: unknown = JSON.parse(
		await nativeAccountCLI(binary, ["api", "GET", "/api/info"], owner.project),
	);
	assert.equal(object(info) && info.version === "2.1.4", true);
	const query = new URLSearchParams({ "location[directory]": owner.project });
	const stats: unknown = JSON.parse(
		await nativeAccountCLI(
			binary,
			[
				"api",
				"POST",
				`/api/rpc/${FixtureRpc.id}/stats?${query}`,
				"--data",
				JSON.stringify({ input: {} }),
			],
			owner.project,
		),
	);
	assert.equal(object(stats) && object(stats.output), true);
	receipt.defaultCliAuthenticated = true;
	receipt.exactRpcQueryAccepted = true;
	const baseline = {
		id: "native-auth-selected",
		integrationID: "openai",
		label: "Selected synthetic account",
		active: true,
		value: {
			type: "oauth" as const,
			methodID: "native-auth-fixture-method",
			access: "synthetic-before-access",
			refresh: "synthetic-before-refresh",
			expires: 0,
			metadata: { accountId: "synthetic-account", nested: { tier: "fixture" } },
		},
	};
	await owner.client.credential.create({ ...baseline, activate: true });
	const other = {
		...baseline,
		id: "native-auth-other",
		label: "Other synthetic account",
		active: false,
		value: {
			...baseline.value,
			refresh: "synthetic-unrelated-refresh",
			expires: 4102444800000,
		},
	};
	await owner.client.credential.create({ ...other, activate: false });
	stage = "broker";
	broker = await startNativeAccountBroker({
		opencodeExecutable: binary,
		models: ["native-auth-fixture/model"],
	});
	source = connectNativeAccountSource(broker.configuration);
	const unauthorized = await fetch(
		new URL("resolve", broker.configuration.url),
		{ method: "POST", body: "{}" },
	);
	assert.equal(unauthorized.status, 401);
	receipt.capabilityRequired = true;
	const unused = await source.prepareHost({
		directory: join(root, "unused-startup"),
		models: ["native-auth-fixture/model"],
	});
	await unused.dispose();
	await unused.dispose();
	receipt.unusedStartupLeaseReleased = true;
	const artifact = await stageNativeAuthClient(join(root, "sealed-client"));
	const auth = await source.prepareHost({
		directory: join(root, "attachment"),
		models: ["native-auth-fixture/model"],
		stagedClient: artifact,
	});
	await assert.rejects(
		source.prepareHost({
			directory: join(root, "overlap"),
			models: ["native-auth-fixture/model"],
		}),
		(error) =>
			error instanceof Error &&
			error.message === "Native account authentication failed.",
	);
	receipt.concurrentHostRefused = true;
	assert.deepEqual(Object.keys(auth.plugin.options), ["configurationPath"]);
	assert.equal(
		JSON.stringify(auth.credentialHandoff.entries).includes(
			baseline.value.refresh,
		),
		false,
	);
	const child = await host("child", auth.plugin);
	const failedExecution = async () => {
		const session = await child.client.session.create({
			title: "Authentication must fail closed",
			location: { directory: child.project },
			model: { providerID: "native-auth-fixture", id: "model" },
		});
		const controller = new AbortController();
		let failed = false;
		const observe = (async () => {
			try {
				for await (const event of child.client.event.subscribe({
					signal: controller.signal,
				}))
					if (
						event.type === "session.execution.failed" &&
						event.data.sessionID === session.id
					)
						failed = true;
			} catch {}
		})();
		await Bun.sleep(20);
		await child.client.session.prompt({
			sessionID: session.id,
			text: "No model request may be sent",
		});
		await child.client.session.wait({ sessionID: session.id });
		await Bun.sleep(50);
		controller.abort();
		await observe;
		return failed;
	};
	stage = "ambient-fallback-negative";
	assert.equal(await failedExecution(), true);
	assert.equal(fixture.requests.length, 0);
	receipt.ambientFallbackRefused = true;
	for (const entry of auth.credentialHandoff.entries)
		await child.client.credential.create({
			id: entry.id,
			integrationID: entry.integrationID,
			label: entry.label,
			value: entry.value,
			activate: entry.active,
		});
	const ownerRows = await owner.client.credential.list();
	const current = ownerRows.find((entry) => entry.id === baseline.id);
	assert.equal(current?.value.type === "oauth", true);
	if (current?.value.type !== "oauth")
		throw new Error("Synthetic source absent");
	expectedAccess = current.value.access;
	receipt.nativeRotationPersisted =
		current.value.refresh !== baseline.value.refresh;
	receipt.unrelatedPreserved = isDeepStrictEqual(
		ownerRows.find((entry) => entry.id === other.id),
		other,
	);
	assert.equal(receipt.unrelatedPreserved, true);
	stage = "child-model";
	const session = await child.client.session.create({
		title: "Auth candidate proof",
		location: { directory: child.project },
		model: { providerID: "native-auth-fixture", id: "model" },
	});
	await child.client.session.prompt({
		sessionID: session.id,
		text: "Synthetic loopback response",
	});
	await child.client.session.wait({ sessionID: session.id });
	const messages = await child.client.message.list({ sessionID: session.id });
	assert.equal(
		messages.data.some(
			(message) => message.type === "assistant" && !message.error,
		),
		true,
	);
	assert.equal(fixture.requests.length, 1);
	assert.equal(bearerVerified, true);
	const after = await child.client.credential.list();
	assert.equal(
		after.every(
			(entry) =>
				entry.value.type === "oauth" &&
				entry.value.refresh === PLACEHOLDER_REFRESH,
		),
		true,
	);
	await auth.credentialHandoff.onStop({
		before: auth.credentialHandoff.entries,
		after,
	});
	const fixtureStats = await child.client
		.rpc(FixtureRpc)
		.stats({}, { location: { directory: child.project } });
	assert.equal(
		object(fixtureStats) &&
			fixtureStats.foreignRequests === 0 &&
			fixtureStats.directChildRefreshes === 0,
		true,
	);
	receipt.fixtureStats = fixtureStats;
	receipt.nativeBearerVerified = bearerVerified;
	receipt.localModelRequests = fixture.requests.length;
	stage = "other-account-negative";
	await child.client.credential.create({
		id: "native-auth-unapproved-child",
		integrationID: "openai",
		activate: true,
		value: { type: "key", key: "synthetic-unapproved-key" },
	});
	assert.equal(await failedExecution(), true);
	assert.equal(fixture.requests.length, 1);
	await child.client.credential.activate({ credentialID: baseline.id });
	receipt.otherAccountRefused = true;
	stage = "dispose";
	const beforeLocations = await owner.client.debug.location.list();
	await broker.dispose();
	await broker.dispose();
	broker = undefined;
	const afterLocations = await owner.client.debug.location.list();
	receipt.sourceLocationEvicted =
		beforeLocations.some((location) =>
			location.directory.includes("flow-native-account-"),
		) &&
		!afterLocations.some((location) =>
			location.directory.includes("flow-native-account-"),
		);
	assert.equal(receipt.sourceLocationEvicted, true);
	stage = "cached-access-source-loss";
	assert.equal(
		after.some(
			(entry) =>
				entry.value.type === "oauth" && entry.value.expires > Date.now(),
		),
		true,
	);
	assert.equal(await failedExecution(), true);
	assert.equal(fixture.requests.length, 1);
	receipt.validCachedAccessRefusedWithoutSource = true;
	child.child.kill("SIGTERM");
	await child.child.exited;
	await auth.dispose().catch(() => {});
	await auth.dispose().catch(() => {});
	await source.dispose().catch(() => {});
	receipt.status = "passed";
} catch {
	receipt.status = "failed";
	receipt.stage = stage;
	process.exitCode = 1;
} finally {
	await source?.dispose().catch(() => {});
	await broker?.dispose().catch(() => {});
	for (const child of children)
		if (child.exitCode === null) child.kill("SIGTERM");
	await Promise.all(children.map((child) => child.exited));
	fixture.server.stop(true);
	proxy.stop(true);
	const processes = children.map((child) => {
		let alive = true;
		try {
			process.kill(child.pid, 0);
		} catch {
			alive = false;
		}
		return { pid: child.pid, alive };
	});
	receipt.processes = processes;
	receipt.processesStopped = processes.every((child) => !child.alive);
	assert.equal(receipt.processesStopped, true);
	await writeFile(
		join(root, "receipt.json"),
		JSON.stringify(receipt, null, 2),
		{ mode: 0o600 },
	);
	console.log(JSON.stringify(receipt, null, 2));
}
