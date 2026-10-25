import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { OpenCodeClient } from "@opencode/client";
import { canonicalJson } from "../evals/canonical-json.js";
import {
	mapStrings,
	normalizeRecorded,
	scrubSecrets,
} from "../evals/cassette.js";
import { terminateChildProcessTree } from "../evals/harness.js";
import {
	connectNativeAccountSource,
	type NativeAuthHost,
} from "../evals/native-auth/host.js";
import type { NativeAccountConnection } from "../evals/native-auth/protocol.js";
import { readNativeAccountConnection } from "../evals/native-auth-config.js";
import {
	nativeModel,
	OPENCODE_HOST_VERSION,
	OpenCodeStartup,
	openCodeInvocation,
} from "../evals/opencode-host.js";
import {
	CANARY_PLUGIN_DIRECTORY,
	CanaryAuthLaunchReceiptSchema,
	canaryAuthLaunchMatches,
	canaryProviderConfiguration,
	measureCanaryInstallation,
	type PreparedCanary,
	parsePreparedCanary,
} from "./eval-canary.js";
import { collectNativeCanary } from "./export-canary-native.js";
import { consumePaidDispatch } from "./paid-budget.js";

type NativeCanaryPhase =
	| "prepare"
	| "dependencies"
	| "startup"
	| "plugins"
	| "credentials"
	| "execution"
	| "export"
	| "cleanup";
class NativeCanaryError extends Error {
	constructor(phase: NativeCanaryPhase) {
		super(`Native-auth canary execution failed during ${phase}.`);
	}
}

export async function runPaidCanary(
	input: {
		prepared: string;
		model: string;
		prompt: string;
		nativeAuthSource?: string;
	},
	launch: (
		directory: string,
		model: string,
		prompt: string,
		prepared: PreparedCanary,
		nativeAuth?: NativeAccountConnection,
	) => Promise<number> = launchCanary,
): Promise<number> {
	const directory = await realpath(dirname(resolve(input.prepared)));
	const prepared = parsePreparedCanary(
		JSON.parse(await readFile(input.prepared, "utf8")),
	);
	if (prepared.schemaVersion !== 2)
		throw new Error(
			"Active canary launch requires a native OpenCode v2 preparation.",
		);
	if (
		process.env.FLOW_EVAL_OPENCODE_VERSION &&
		process.env.FLOW_EVAL_OPENCODE_VERSION !== prepared.runtime.hostVersion
	)
		throw new Error("Unapproved canary host override.");
	await measureCanaryInstallation(prepared, directory);
	if (Boolean(prepared.runtime.nativeAuth) !== Boolean(input.nativeAuthSource))
		throw new Error(
			"Native auth source and prepared attachment must be selected together.",
		);
	const nativeAuth = input.nativeAuthSource
		? await readNativeAccountConnection(input.nativeAuthSource)
		: undefined;
	nativeModel(input.model, "default");
	const prompt = await readFile(input.prompt, "utf8");
	if (!prompt.trim()) throw new Error("Canary prompt is empty.");
	await consumePaidDispatch({ model: input.model, kind: "canary" });
	try {
		return await launch(
			join(directory, "fixture"),
			input.model,
			prompt,
			prepared,
			nativeAuth,
		);
	} catch (error) {
		if (nativeAuth)
			throw error instanceof NativeCanaryError
				? error
				: new NativeCanaryError("execution");
		throw error;
	}
}
export function canaryLaunchEnvironment(
	directory: string,
	inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...inherited, PWD: directory };
	delete environment.FLOW_EVAL_AUTHORIZATION;
	delete environment.TYPESAFE_API_KEY;
	delete environment.FLOW_EVAL_NATIVE_AUTH;
	for (const name of Object.keys(environment))
		if (name.startsWith("OPENCODE_") && name !== "OPENCODE_API_KEY")
			delete environment[name];
	for (const name of [
		"NODE_OPTIONS",
		"NODE_PATH",
		"BUN_OPTIONS",
		"BUN_PRELOAD",
	])
		delete environment[name];
	return environment;
}
export { canaryProviderConfiguration } from "./eval-canary.js";

export function canaryPublicNativeEvidence(
	value: unknown,
	privateValues: readonly string[],
): unknown {
	const values = [...new Set(privateValues.filter(Boolean))].sort(
		(left, right) => right.length - left.length,
	);
	return mapStrings(value, (text) => {
		let redacted = text;
		for (const secret of values)
			redacted = redacted.split(secret).join("<private-native-auth>");
		return scrubSecrets(redacted);
	});
}
function privateStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(privateStrings);
	if (value && typeof value === "object")
		return Object.entries(value).flatMap(([key, item]) => [
			...(key.length > 16 ? [key] : []),
			...privateStrings(item),
		]);
	return [];
}
async function launchCanary(
	directory: string,
	model: string,
	prompt: string,
	prepared: PreparedCanary,
	nativeAuth?: NativeAccountConnection,
): Promise<number> {
	const environment = canaryLaunchEnvironment(directory);
	environment.OPENCODE_FLOW_REVIEWER_MODEL = model;
	const requestedModel = nativeModel(model, "default");
	const outputDirectory = await mkdtemp(join(dirname(directory), "run-"));
	const privateRoot = nativeAuth
		? join(outputDirectory, "private-host")
		: outputDirectory;
	const source = nativeAuth
		? connectNativeAccountSource(nativeAuth)
		: undefined;
	let attachment: NativeAuthHost | undefined;
	let server: ChildProcess | undefined;
	let client: OpenCodeClient | undefined;
	let seeded = false;
	let outcomeCode = 1;
	let publicReceipt: unknown;
	let failure: unknown;
	let cleanupFailed = false;
	let phase: NativeCanaryPhase = "prepare";
	const startup = new OpenCodeStartup();
	const cancellation = new AbortController();
	let cancelledCode: number | undefined;
	const stop = (code: number) => {
		cancelledCode ??= code;
		cancellation.abort(new Error("Canary interrupted."));
	};
	const interrupt = () => stop(130);
	const terminate = () => stop(143);
	process.on("SIGINT", interrupt);
	process.on("SIGTERM", terminate);
	const signal = AbortSignal.any([
		cancellation.signal,
		AbortSignal.timeout(30 * 60 * 1000),
	]);
	try {
		if (nativeAuth) await mkdir(privateRoot, { mode: 0o700 });
		for (const [key, leaf] of Object.entries({
			HOME: "home",
			XDG_CONFIG_HOME: "config",
			XDG_DATA_HOME: "data",
			XDG_CACHE_HOME: "cache",
			XDG_STATE_HOME: "state",
			TMPDIR: "tmp",
		})) {
			const path = join(privateRoot, leaf);
			await mkdir(path, { mode: 0o700 });
			environment[key] = path;
		}
		const auth =
			prepared.schemaVersion === 2 ? prepared.runtime.nativeAuth : undefined;
		if (source && auth) {
			attachment = await source.prepareHost({
				directory: join(outputDirectory, "native-auth"),
				configurationPath: join(
					outputDirectory,
					"native-auth/configuration.json",
				),
				stagedClient: {
					...auth,
					pluginDirectory: resolve(dirname(directory), auth.pluginDirectory),
				},
				models: [model],
				signal,
			});
			if (
				attachment.plugin.package !==
					resolve(dirname(directory), auth.pluginDirectory) ||
				attachment.plugin.options.configurationPath !==
					join(outputDirectory, "native-auth/configuration.json") ||
				canonicalJson(attachment.artifactHashes) !==
					canonicalJson({
						entrySha256: auth.entrySha256,
						sourceSha256: auth.sourceSha256,
					})
			)
				throw new Error("Prepared native auth attachment changed.");
		}
		const providerConfigPath = join(
			privateRoot,
			"config/opencode/opencode.json",
		);
		await mkdir(dirname(providerConfigPath), { recursive: true, mode: 0o700 });
		const providerPolicy = canaryProviderConfiguration(requestedModel);
		const providerConfigBytes = canonicalJson({
			...providerPolicy,
			...(attachment ? { plugins: [attachment.plugin], warming: false } : {}),
		});
		await writeFile(providerConfigPath, providerConfigBytes, {
			flag: "wx",
			mode: 0o600,
		});
		phase = "dependencies";
		await promisify(execFile)(
			"npm",
			[
				"install",
				"--prefix",
				join(dirname(directory), CANARY_PLUGIN_DIRECTORY),
				"--omit=dev",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				"--legacy-peer-deps",
				"--no-package-lock",
			],
			{ cwd: directory, env: environment },
		);
		await measureCanaryInstallation(prepared, dirname(directory));
		phase = "startup";
		const versionInvocation = openCodeInvocation(
			["--version"],
			OPENCODE_HOST_VERSION,
		);
		const version = await promisify(execFile)(
			versionInvocation.command,
			versionInvocation.args,
			{ cwd: directory, env: environment },
		);
		if (version.stdout.trim() !== `opencode v${OPENCODE_HOST_VERSION}`)
			throw new Error(
				"Canary executable did not report the pinned host version.",
			);
		const invocation = openCodeInvocation(
			["serve", "--hostname", "127.0.0.1", "--port", "0"],
			OPENCODE_HOST_VERSION,
		);
		const child = spawn(invocation.command, invocation.args, {
			cwd: directory,
			env: environment,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		server = child;
		child.stdout?.on("data", (chunk) =>
			startup.consume(String(chunk), "stdout"),
		);
		child.stderr?.on("data", (chunk) =>
			startup.consume(String(chunk), "stderr"),
		);
		let spawnError: Error | undefined;
		child.once("error", (error) => {
			spawnError = error;
		});
		const deadline = Date.now() + 180000;
		const connected = async () => {
			for (;;) {
				signal.throwIfAborted();
				if (spawnError) throw spawnError;
				if (child.exitCode !== null || child.signalCode !== null)
					throw new Error("Canary server exited before readiness.");
				const address =
					/^server listening on (http:\/\/127\.0\.0\.1:\d+)\s*$/m.exec(
						startup.log,
					)?.[1];
				const candidate = address ? startup.client(address, directory) : null;
				if (candidate) {
					const host = await candidate.server.info({
						signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
					});
					if (host.version !== OPENCODE_HOST_VERSION)
						throw new Error(
							"Canary server did not report the pinned host version.",
						);
					return { client: candidate, host };
				}
				if (Date.now() >= deadline)
					throw new Error(
						"Canary server did not publish authenticated readiness.",
					);
				await Bun.sleep(25);
			}
		};
		const connectedHost = await connected();
		const nativeClient = connectedHost.client;
		client = nativeClient;
		const host = connectedHost.host;
		if (attachment) {
			phase = "plugins";
			const ready = await client.session.create(
				{ title: "Canary plugin readiness", location: { directory } },
				{ signal },
			);
			await client.session.remove({ sessionID: ready.id }, { signal });
			await client.config.get({ location: { directory } }, { signal });
			const expected = new Set([
				await realpath(join(dirname(directory), CANARY_PLUGIN_DIRECTORY)),
				attachment.plugin.package,
			]);
			for (;;) {
				signal.throwIfAborted();
				if (Date.now() >= deadline)
					throw new Error("Canary plugins did not become active.");
				const plugins = await client.plugin.list(
					{ location: { directory } },
					{ signal },
				);
				const active = new Set<string>();
				for (const plugin of plugins.data) {
					if (
						plugin.source.type === "builtin" &&
						plugin.state.status === "active"
					)
						continue;
					if (plugin.source.type !== "local")
						throw new Error("Unprepared canary plugin loaded.");
					const path = await realpath(plugin.source.path);
					const base = expected.has(path)
						? path
						: /[/\\]index\.(?:ts|js)$/.test(path)
							? dirname(path)
							: path;
					if (!expected.has(base) || plugin.state.status !== "active")
						throw new Error("Unprepared or failed canary plugin loaded.");
					active.add(base);
				}
				if ([...expected].every((path) => active.has(path))) break;
				await Bun.sleep(20);
			}
			phase = "credentials";
			seeded = true;
			for (const entry of attachment.credentialHandoff.entries)
				await client.credential.create(
					{
						id: entry.id,
						integrationID: entry.integrationID,
						label: entry.label,
						value: entry.value,
						activate: entry.active,
					},
					{ signal },
				);
		}
		if (attachment)
			await attachment.requireReady(client, {
				directory,
				models: [requestedModel],
				timeoutMs: Math.min(15000, deadline - Date.now()),
				signal,
			});
		phase = "execution";
		const manager = await client.session.create(
			{
				title: "Flow exact-artifact canary",
				agent: "build",
				model: requestedModel,
				location: { directory },
			},
			{ signal },
		);
		if (
			manager.parentID !== undefined ||
			(await realpath(manager.location.directory)) !== directory ||
			canonicalJson(manager.model) !== canonicalJson(requestedModel)
		)
			throw new Error(
				"Canary manager identity does not match the approved launch.",
			);
		const assertProviderHTTP = async () => {
			const provider = await nativeClient.provider.get(
				{ providerID: requestedModel.providerID, location: { directory } },
				{ signal },
			);
			const inventory = await nativeClient.model.list(
				{ location: { directory } },
				{ signal },
			);
			const selected = inventory.data.find(
				(model) =>
					model.providerID === requestedModel.providerID &&
					model.id === requestedModel.id,
			);
			const variant = selected?.variants.find(
				(variant) => variant.id === requestedModel.variant,
			);
			if (
				!selected ||
				(selected.settings?.transport !== undefined &&
					selected.settings.transport !== "http") ||
				variant?.settings?.transport !== "http" ||
				provider.data.id !== requestedModel.providerID ||
				provider.data.settings?.transport !== "http" ||
				(await realpath(provider.location.directory)) !== directory
			)
				throw new Error(
					`Canary provider did not retain the sealed HTTP transport policy: ${canonicalJson({ provider: provider.data.settings?.transport ?? null, model: selected?.settings?.transport ?? null, variant: variant?.settings?.transport ?? null, variantIds: selected?.variants.map((variant) => variant.id) ?? [] })}`,
				);
		};

		await client.agent.list({ location: { directory } }, { signal });
		await client.model.list({ location: { directory } }, { signal });
		await assertProviderHTTP();
		await client.session.prompt(
			{ sessionID: manager.id, text: prompt },
			{ signal },
		);
		await client.session.wait({ sessionID: manager.id }, { signal });
		await assertProviderHTTP();
		if ((await readFile(providerConfigPath, "utf8")) !== providerConfigBytes)
			throw new Error(
				"Canary provider configuration changed during execution.",
			);
		phase = "export";
		const evidence = await collectNativeCanary(client, {
			directory,
			rootSessionID: manager.id,
			signal,
		});
		if (evidence.host.pid !== host.pid)
			throw new Error("Canary server changed before export.");
		const normalized = normalizeRecorded(evidence, directory);
		let publicEvidence: unknown = mapStrings(normalized, scrubSecrets);
		if (nativeAuth && attachment) {
			const rows = await client.credential.list({ signal });
			const privateValues = [
				nativeAuth.capability,
				nativeAuth.url,
				privateRoot,
				outputDirectory,
				attachment.plugin.options.configurationPath,
				...nativeAuth.accounts.flatMap((account) => [
					account.route.credentialID,
					account.route.label,
					...privateStrings(account.metadata),
				]),
				...rows.flatMap((row) => privateStrings(row.value)),
			];
			publicEvidence = canaryPublicNativeEvidence(normalized, privateValues);
		}
		const nativeBytes = canonicalJson(publicEvidence);
		const nativePath = join(outputDirectory, "native.json");
		const root = evidence.sessions.find(
			(session) => session.info.id === manager.id,
		);
		const receipt = {
			preparedSha256: prepared.sha256,
			model: requestedModel,
			rootSessionID: manager.id,
			host: { pid: host.pid, version: host.version },
			provider: { id: requestedModel.providerID, transport: "http" },
			native: {
				path: "native.json",
				sha256: `sha256:${createHash("sha256").update(nativeBytes).digest("hex")}`,
			},
			outcome: root?.info.outcome ?? "unknown",
		};
		const run = auth
			? CanaryAuthLaunchReceiptSchema.parse({
					schemaVersion: 2,
					warming: false,
					...receipt,
					providerPolicySha256: `sha256:${createHash("sha256").update(canonicalJson(providerPolicy)).digest("hex")}`,
					nativeAuth: auth,
				})
			: {
					schemaVersion: 1,
					...receipt,
					providerConfiguration: {
						path: "config/opencode/opencode.json",
						sha256: `sha256:${createHash("sha256").update(providerConfigBytes).digest("hex")}`,
					},
				};
		if (
			auth &&
			!canaryAuthLaunchMatches({
				preparedSha256: prepared.sha256,
				nativeAuth: auth,
				receipt: run,
				transcript: publicEvidence,
			})
		)
			throw new Error("Public native auth evidence lost its launch identity.");
		await writeFile(nativePath, nativeBytes, { mode: 0o600, flag: "wx" });
		publicReceipt = run;
		outcomeCode = root?.info.outcome === "succeeded" ? 0 : 1;
	} catch (error) {
		failure = error;
	} finally {
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", terminate);
		const snapshotClient = client;
		const snapshot =
			attachment && snapshotClient && seeded
				? await Promise.allSettled([
						Promise.resolve().then(() =>
							snapshotClient.credential.list({
								signal: AbortSignal.timeout(3000),
							}),
						),
					])
				: [];
		const termination = await Promise.allSettled([
			Promise.resolve().then(() =>
				server ? terminateChildProcessTree(server) : undefined,
			),
		]);
		const cleanup = await Promise.allSettled([
			Promise.resolve().then(async () => {
				const after = snapshot[0];
				if (after?.status === "rejected") throw after.reason;
				if (attachment && after?.status === "fulfilled")
					await attachment.credentialHandoff.onStop({
						before: attachment.credentialHandoff.entries,
						after: after.value,
					});
			}),
			Promise.resolve().then(() => attachment?.dispose()),
			Promise.resolve().then(() => source?.dispose()),
			Promise.resolve().then(() =>
				nativeAuth
					? rm(privateRoot, { recursive: true, force: true })
					: undefined,
			),
			Promise.resolve().then(() =>
				writeFile(
					join(outputDirectory, "server.log"),
					nativeAuth
						? "Native authentication diagnostics omitted.\n"
						: scrubSecrets(startup.log),
					{ mode: 0o600, flag: "wx" },
				),
			),
		]);
		startup.clear();
		cleanupFailed = [...termination, ...cleanup].some(
			(result) => result.status === "rejected",
		);
	}
	if (cleanupFailed)
		throw nativeAuth
			? new NativeCanaryError("cleanup")
			: new Error("Canary cleanup failed.");
	if (cancelledCode !== undefined) return cancelledCode;
	if (failure !== undefined)
		throw nativeAuth ? new NativeCanaryError(phase) : failure;
	await writeFile(
		join(outputDirectory, "run.json"),
		canonicalJson(publicReceipt),
		{ mode: 0o600, flag: "wx" },
	);
	console.log(
		`Native canary evidence: ${join(outputDirectory, "native.json")}`,
	);
	return outcomeCode;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const [prepared, model, prompt, ...extra] = args;
	if (!prepared || prepared === "--help")
		console.log(
			"canary-run <prepared.json> <provider/model> <prompt-file> [--native-auth-source PRIVATE_FILE] (requires FLOW_EVAL_AUTHORIZATION; collects native.json before stopping its pinned server; publishes run.json after cleanup)",
		);
	else if (
		!model ||
		!prompt ||
		(extra.length !== 0 &&
			(extra.length !== 2 ||
				extra[0] !== "--native-auth-source" ||
				!extra[1] ||
				extra[1].startsWith("--")))
	) {
		console.error(
			"Expected prepared.json, model, prompt file, and optional native auth source.",
		);
		process.exitCode = 1;
	} else
		runPaidCanary({
			prepared,
			model,
			prompt,
			...(extra[1] ? { nativeAuthSource: extra[1] } : {}),
		})
			.then((code) => {
				process.exitCode = code;
			})
			.catch((error) => {
				console.error(error.message);
				process.exitCode = 1;
			});
}
