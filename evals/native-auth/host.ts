import { createHash } from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CredentialEntry, OpenCodeClient } from "@opencode/client";
import { canonicalSha256 } from "../canonical-json.js";
import { EvaluationPhaseError } from "../failure-origin.js";
import ClientPlugin from "./client-plugin.js";
import {
	boundedNativeAuth,
	capability,
	type NativeAccountConnection,
	NativeAccountReadinessRpc,
	object,
	PLACEHOLDER_REFRESH,
	parseApprovedModels,
	parseConnection,
	parseReadinessInput,
	parseReadinessResult,
	providersForModels,
	type ReadinessModel,
	type ReadinessReason,
	refuse,
	responseJSON,
	UNRESOLVED_ACCESS,
} from "./protocol.js";
import SourcePlugin from "./source-plugin.js";

export type StagedNativeAuthClient = {
	pluginDirectory: string;
	entrySha256: string;
	sourceSha256: string;
	files: Readonly<Record<string, string>>;
};
export type NativeAuthHost = {
	plugin: { package: string; options: { configurationPath: string } };
	credentialHandoff: {
		entries: readonly CredentialEntry[];
		onStop(input: {
			before: readonly CredentialEntry[];
			after: readonly CredentialEntry[];
		}): Promise<void>;
	};
	artifactHashes: { entrySha256: string; sourceSha256: string };
	requireReady(
		client: Pick<OpenCodeClient, "rpc">,
		input: {
			directory: string;
			models: readonly ReadinessModel[];
			timeoutMs?: number;
			signal?: AbortSignal;
		},
	): Promise<void>;
	dispose(): Promise<void>;
};
export type NativeAuthentication = {
	configuration: NativeAccountConnection;
	models: readonly string[];
};

const sha = (bytes: string | Buffer) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export function nativeAuthSourceSha256(
	files: Readonly<Record<string, string>>,
): `sha256:${string}` {
	return canonicalSha256("flow-native-auth-client-closure-v1", files);
}
async function pluginFiles(
	kind: "client" | "source",
): Promise<Record<string, Buffer>> {
	const plugin = kind === "client" ? ClientPlugin : SourcePlugin;
	return {
		"index.ts": Buffer.from(`export { default } from "./${kind}-plugin.ts";\n`),
		"package.json": Buffer.from(
			`${JSON.stringify({ name: plugin.id, private: true, type: "module", exports: { ".": "./index.ts" } })}\n`,
		),
		"protocol.ts": await readFile(new URL("./protocol.ts", import.meta.url)),
		[`${kind}-plugin.ts`]: await readFile(
			new URL(`./${kind}-plugin.ts`, import.meta.url),
		),
	};
}
async function stage(
	kind: "client" | "source",
	directory: string,
): Promise<StagedNativeAuthClient> {
	try {
		if (!isAbsolute(directory)) refuse();
		await mkdir(directory, { mode: 0o700 });
		await chmod(directory, 0o700);
		const files = await pluginFiles(kind);
		for (const [name, bytes] of Object.entries(files))
			await writeFile(join(directory, name), bytes, {
				mode: 0o600,
				flag: "wx",
			});
		const hashes = Object.fromEntries(
			Object.entries(files).map(([name, bytes]) => [name, sha(bytes)]),
		);
		return {
			pluginDirectory: await realpath(directory),
			entrySha256: sha(files["index.ts"] ?? ""),
			sourceSha256:
				kind === "client"
					? nativeAuthSourceSha256(hashes)
					: canonicalSha256("flow-native-auth-source-closure-v1", hashes),
			files: hashes,
		};
	} catch {
		refuse();
	}
}
export function stageNativeAuthClient(
	directory: string,
): Promise<StagedNativeAuthClient> {
	return stage("client", directory);
}
export function stageNativeAuthSource(
	directory: string,
): Promise<StagedNativeAuthClient> {
	return stage("source", directory);
}
export async function verifyNativeAuthClient(
	artifact: StagedNativeAuthClient,
): Promise<void> {
	try {
		const files = await pluginFiles("client");
		const directory = await lstat(artifact.pluginDirectory);
		if (
			!directory.isDirectory() ||
			directory.isSymbolicLink() ||
			!isDeepStrictEqual(
				(await readdir(artifact.pluginDirectory)).sort(),
				Object.keys(files).sort(),
			)
		)
			refuse();
		const expected = Object.fromEntries(
			Object.entries(files).map(([name, bytes]) => [name, sha(bytes)]),
		);
		if (
			!isDeepStrictEqual(expected, artifact.files) ||
			artifact.entrySha256 !== expected["index.ts"] ||
			artifact.sourceSha256 !== nativeAuthSourceSha256(expected)
		)
			refuse();
		for (const [name, expectedHash] of Object.entries(expected)) {
			const stat = await lstat(join(artifact.pluginDirectory, name));
			if (
				!stat.isFile() ||
				stat.isSymbolicLink() ||
				stat.nlink !== 1 ||
				sha(await readFile(join(artifact.pluginDirectory, name))) !==
					expectedHash
			)
				refuse();
		}
	} catch {
		refuse();
	}
}

export function connectNativeAccountSource(
	configuration: NativeAccountConnection,
) {
	const connection = structuredClone(parseConnection(configuration));
	const active = new Set<NativeAuthHost>();
	let closed = false;
	let closing: Promise<void> | undefined;
	const request = async (path: string, body: unknown, signal?: AbortSignal) => {
		try {
			return await responseJSON(
				await fetch(new URL(path, connection.url), {
					method: "POST",
					headers: {
						authorization: `Bearer ${connection.capability}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(body),
					signal: signal
						? AbortSignal.any([signal, AbortSignal.timeout(15000)])
						: AbortSignal.timeout(15000),
					redirect: "error",
				}),
			);
		} catch {
			refuse();
		}
	};
	return {
		async prepareHost(options: {
			directory: string;
			models: readonly string[];
			signal?: AbortSignal;
			stagedClient?: StagedNativeAuthClient;
			configurationPath?: string;
		}): Promise<NativeAuthHost> {
			if (closed || options.signal?.aborted || !isAbsolute(options.directory))
				refuse();
			const models = parseApprovedModels(options.models);
			const providers = providersForModels(models);
			const accounts = connection.accounts.filter((account) =>
				providers.includes(account.route.providerID),
			);
			if (accounts.length !== providers.length) refuse();
			const acquired = await request("acquire", { models }, options.signal);
			if (!object(acquired)) refuse();
			const lease = capability(acquired.lease);
			const lifetime = new AbortController();
			let ownedDirectory = false;
			let done: Promise<void> | undefined;
			const configurationPath =
				options.configurationPath ??
				join(options.directory, "configuration.json");
			const dispose = () => {
				done ??= (async () => {
					lifetime.abort();
					try {
						await request("release", { lease });
					} finally {
						if (ownedDirectory)
							await rm(options.directory, { recursive: true });
					}
				})().catch(refuse);
				return done;
			};
			try {
				await mkdir(options.directory, { mode: 0o700 });
				ownedDirectory = true;
				const dir = await lstat(options.directory);
				if (dir.uid !== process.getuid?.() || (dir.mode & 0o777) !== 0o700)
					refuse();
				if (dirname(configurationPath) !== options.directory) refuse();
				const artifact =
					options.stagedClient ??
					(await stageNativeAuthClient(join(options.directory, "plugin")));
				await verifyNativeAuthClient(artifact);
				await writeFile(
					configurationPath,
					JSON.stringify({
						connection: { ...connection, accounts },
						lease,
						models,
					}),
					{ mode: 0o600, flag: "wx" },
				);
				const entries = [
					...new Map(
						accounts.map((account) => [
							account.route.credentialID,
							{
								id: account.route.credentialID,
								integrationID: account.route.integrationID,
								label: account.route.label,
								active: true,
								value: {
									type: "oauth" as const,
									methodID: account.route.methodID,
									access: UNRESOLVED_ACCESS,
									refresh: PLACEHOLDER_REFRESH,
									expires: 0,
									...(account.metadata === undefined
										? {}
										: { metadata: account.metadata }),
								},
							},
						]),
					).values(),
				];
				const attachment: NativeAuthHost = {
					requireReady: async (client, input) => {
						let reason: ReadinessReason = "readiness-unavailable";
						let timer: ReturnType<typeof setTimeout> | undefined;
						const timeout = new AbortController();
						try {
							input.signal?.throwIfAborted();
							if (lifetime.signal.aborted || closed) refuse();
							const timeoutMs = Math.min(15000, input.timeoutMs ?? 15000);
							if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
								reason = "readiness-deadline";
								refuse();
							}
							const request = parseReadinessInput({
								models: input.models,
								timeoutMs: Math.floor(timeoutMs),
							});
							if (
								request.models.some(
									(model) =>
										!models.includes(`${model.providerID}/${model.id}`),
								)
							) {
								reason = "profile-unapproved";
								refuse();
							}
							const deadline = Date.now() + request.timeoutMs;
							timer = setTimeout(() => timeout.abort(), request.timeoutMs);
							const signal = AbortSignal.any([
								lifetime.signal,
								timeout.signal,
								...(input.signal ? [input.signal] : []),
							]);
							const result = parseReadinessResult(
								await boundedNativeAuth(signal, () =>
									client.rpc(NativeAccountReadinessRpc).ready(request, {
										location: { directory: input.directory },
										signal,
									}),
								),
							);
							input.signal?.throwIfAborted();
							if (Date.now() >= deadline) {
								reason = "readiness-deadline";
								refuse();
							}
							if (result.state === "not-ready") {
								reason = result.reason;
								refuse();
							}
						} catch {
							if (timeout.signal.aborted) reason = "readiness-deadline";
							lifetime.abort();
							input.signal?.throwIfAborted();
							throw new EvaluationPhaseError(
								{
									origin: "host",
									code: "native-auth-not-ready",
									detail: `Native account authentication is not ready (${reason}).${reason === "readiness-deadline" ? " Check that each requested model is present and enabled in the native catalog; OAuth initialization may also be incomplete." : ""}`,
									retryable: false,
								},
								undefined,
							);
						} finally {
							clearTimeout(timer);
						}
					},
					plugin: {
						package: artifact.pluginDirectory,
						options: { configurationPath },
					},
					artifactHashes: {
						entrySha256: artifact.entrySha256,
						sourceSha256: artifact.sourceSha256,
					},
					credentialHandoff: {
						entries: structuredClone(entries),
						onStop: async (input) => {
							if (
								!isDeepStrictEqual(input.before, entries) ||
								input.after.length !== entries.length
							)
								refuse();
							for (const entry of entries) {
								const after = input.after.find(
									(candidate) => candidate.id === entry.id,
								);
								if (
									!after ||
									after.integrationID !== entry.integrationID ||
									after.label !== entry.label ||
									!after.active ||
									after.value.type !== "oauth" ||
									after.value.refresh !== PLACEHOLDER_REFRESH ||
									after.value.methodID !== entry.value.methodID ||
									!isDeepStrictEqual(after.value.metadata, entry.value.metadata)
								)
									refuse();
							}
						},
					},
					dispose: async () => {
						await dispose();
						active.delete(attachment);
					},
				};
				if (closed || options.signal?.aborted) {
					await attachment.dispose();
					refuse();
				}
				active.add(attachment);
				return attachment;
			} catch {
				await dispose();
				refuse();
			}
		},
		dispose() {
			closing ??= (async () => {
				closed = true;
				await Promise.all(
					[...active].map((attachment) => attachment.dispose()),
				);
			})();
			return closing;
		},
	};
}
