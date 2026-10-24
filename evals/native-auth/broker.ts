import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageNativeAuthSource } from "./host.js";
import {
	capability,
	loopbackURL,
	type NativeAccountConnection,
	NativeAccountRpc,
	object,
	parseResolved,
	parseSelection,
	privateAccount,
	providersForModels,
	type ResolvedAccount,
	refuse,
	sameMetadata,
} from "./protocol.js";

export type NativeAccountBroker = {
	configuration: NativeAccountConnection;
	dispose(): Promise<void>;
};

export async function nativeAccountCLI(
	executable: string,
	args: readonly string[],
	cwd: string,
	signal?: AbortSignal,
): Promise<string> {
	if (signal?.aborted) refuse();
	return new Promise((resolve, reject) => {
		const child = spawn(executable, [...args], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const chunks: Buffer[] = [];
		let size = 0;
		let failed = false;
		const stop = () => {
			failed = true;
			child.kill("SIGKILL");
		};
		const timer = setTimeout(stop, 20000);
		signal?.addEventListener("abort", stop, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > 1024 * 1024) stop();
			else chunks.push(chunk);
		});
		child.stderr.on("data", () => {});
		child.once("error", () => {
			failed = true;
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", stop);
			if (failed || code !== 0 || signal?.aborted)
				reject(new Error("Native account authentication failed."));
			else resolve(Buffer.concat(chunks).toString("utf8"));
		});
	});
}
function decode(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		refuse();
	}
}

export async function startNativeAccountBroker(options: {
	opencodeExecutable: string;
	models: readonly string[];
	signal?: AbortSignal;
}): Promise<NativeAccountBroker> {
	const providers = providersForModels(options.models);
	const models = [...options.models];
	if (options.signal?.aborted) refuse();
	const directory = await mkdtemp(join(tmpdir(), "flow-native-account-"));
	await chmod(directory, 0o700);
	const project = join(directory, "project");
	await mkdir(project, { mode: 0o700 });
	const cli = (args: readonly string[], signal?: AbortSignal) =>
		nativeAccountCLI(options.opencodeExecutable, args, project, signal);
	let initialized = false;
	let disposed = false;
	let closing: Promise<void> | undefined;
	let relay: ReturnType<typeof Bun.serve> | undefined;
	let service: { url: string; pid: number } | undefined;
	const currentService = async (signal?: AbortSignal) => {
		if (
			!service ||
			loopbackURL((await cli(["service", "status"], signal)).trim()) !==
				service.url
		)
			refuse();
		const info = decode(await cli(["api", "GET", "/api/info"], signal));
		if (!object(info) || info.version !== "2.1.4" || info.pid !== service.pid)
			refuse();
	};
	const location = new URLSearchParams({
		"location[directory]": project,
	}).toString();
	const api = async (
		method: "GET" | "POST" | "DELETE",
		path: string,
		input?: unknown,
		signal: AbortSignal | null = options.signal ?? null,
	) => {
		const args = [
			"api",
			method,
			path,
			...(input === undefined ? [] : ["--data", JSON.stringify({ input })]),
		];
		const result = await cli(args, signal ?? undefined);
		return result.trim() ? decode(result) : undefined;
	};
	const rpc = async (
		method: "describe" | "resolve" | "check" | "close",
		input: unknown,
		signal: AbortSignal | null = options.signal ?? null,
	) => {
		await currentService(signal ?? undefined);
		const result = await api(
			"POST",
			`/api/rpc/${NativeAccountRpc.id}/${method}?${location}`,
			input,
			signal,
		);
		await currentService(signal ?? undefined);
		if (!object(result) || !("output" in result)) refuse();
		return result.output;
	};
	const dispose = () => {
		closing ??= (async () => {
			disposed = true;
			options.signal?.removeEventListener("abort", abort);
			try {
				if (relay) await relay.stop(true);
				if (initialized) {
					let running = true;
					try {
						await currentService();
					} catch {
						running = false;
						if (service) {
							try {
								process.kill(service.pid, 0);
							} catch (error) {
								if (object(error) && error.code === "ESRCH")
									service = undefined;
							}
							if (service) refuse();
						}
					}
					if (running) {
						await rpc("close", {}, null).catch(() => {});
						await currentService();
						await api(
							"DELETE",
							`/api/debug/location?${location}`,
							undefined,
							null,
						);
					}
				}
			} finally {
				await rm(directory, { recursive: true });
			}
		})().catch(refuse);
		return closing;
	};
	const abort = () => {
		void dispose().catch(() => {});
	};
	try {
		const url = loopbackURL(
			(await cli(["service", "status"], options.signal)).trim(),
		);
		const health = await api("GET", "/api/info");
		if (
			!object(health) ||
			health.version !== "2.1.4" ||
			typeof health.pid !== "number"
		)
			refuse();
		service = { url, pid: health.pid };
		const source = await stageNativeAuthSource(join(directory, "plugin"));
		await writeFile(
			join(project, "opencode.json"),
			JSON.stringify({
				plugins: [{ package: source.pluginDirectory, options: { providers } }],
				update: "disable",
				share: "disabled",
				warming: false,
			}),
			{ mode: 0o600, flag: "wx" },
		);
		initialized = true;
		const described = await rpc("describe", {});
		if (!object(described) || !Array.isArray(described.accounts)) refuse();
		const accounts = described.accounts.map(parseResolved);
		if (
			accounts.length !== providers.length ||
			providers.some(
				(provider) =>
					!accounts.some((account) => account.route.providerID === provider),
			)
		)
			refuse();
		const token = randomBytes(32).toString("hex");
		let lease: { id: string; providers: readonly string[] } | undefined;
		const authorized = (request: Request) => {
			const actual = Buffer.from(request.headers.get("authorization") ?? "");
			const expected = Buffer.from(`Bearer ${token}`);
			return (
				actual.length === expected.length && timingSafeEqual(actual, expected)
			);
		};
		const validate = async (account: ResolvedAccount) => {
			const result = parseResolved(
				await rpc(
					"resolve",
					{
						providerID: account.route.providerID,
						credentialID: account.route.credentialID,
					},
					options.signal,
				),
			);
			if (
				!sameMetadata(result.route, account.route) ||
				!sameMetadata(result.value.metadata, account.value.metadata)
			)
				refuse();
			return result;
		};
		relay = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			maxRequestBodySize: 16384,
			async fetch(request) {
				const reply = (body: unknown, status = 200) =>
					Response.json(body, {
						status,
						headers: { "cache-control": "no-store" },
					});
				if (disposed || request.method !== "POST" || !authorized(request))
					return reply({ error: "Native account authentication failed." }, 401);
				try {
					if (Number(request.headers.get("content-length") ?? 0) > 16384)
						refuse();
					const bytes = await request.text();
					if (bytes.length > 16384) refuse();
					const input: unknown = decode(bytes);
					if (!object(input)) refuse();
					const path = new URL(request.url).pathname;
					if (path === "/acquire") {
						if (
							lease !== undefined ||
							!Array.isArray(input.models) ||
							!input.models.every(
								(model) => typeof model === "string" && models.includes(model),
							)
						)
							return reply(
								{ error: "Native account authentication failed." },
								409,
							);
						const selectedProviders = providersForModels(input.models);
						const selected = accounts.filter((account) =>
							selectedProviders.includes(account.route.providerID),
						);
						lease = {
							id: randomBytes(32).toString("hex"),
							providers: selectedProviders,
						};
						const acquired = lease;
						try {
							for (const account of selected) await validate(account);
						} catch {
							if (lease === acquired) lease = undefined;
							refuse();
						}
						if (disposed || lease !== acquired) refuse();
						return reply({ lease: acquired.id });
					}
					const current = capability(input.lease);
					if (path === "/release") {
						if (lease !== undefined && current !== lease.id) refuse();
						lease = undefined;
						return reply({});
					}
					if (
						(path !== "/resolve" && path !== "/check") ||
						current !== lease?.id
					)
						refuse();
					const selected = parseSelection(input);
					if (!lease.providers.includes(selected.providerID)) refuse();
					const account = accounts.find(
						(candidate) =>
							candidate.route.providerID === selected.providerID &&
							candidate.route.credentialID === selected.credentialID,
					);
					if (!account) refuse();
					if (path === "/check") {
						await rpc("check", selected, options.signal);
						if (disposed || current !== lease?.id) refuse();
						return reply({});
					}
					const resolved = await validate(account);
					if (disposed || current !== lease?.id) refuse();
					return reply(resolved);
				} catch {
					return reply({ error: "Native account authentication failed." }, 503);
				}
			},
		});
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) {
			await dispose();
			refuse();
		}
		return {
			configuration: {
				version: 1,
				url: relay.url.href,
				capability: token,
				accounts: accounts.map(privateAccount),
			},
			dispose,
		};
	} catch {
		await dispose().catch(() => {});
		refuse();
	}
}
