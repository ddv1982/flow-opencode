import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { Credential, Integration, Plugin } from "@opencode/plugin";
import type { Context } from "@opencode/plugin/promise/plugin";
import {
	boundedNativeAuth,
	type NativeAccount,
	NativeAccountReadinessRpc,
	type OAuthValue,
	object,
	PLACEHOLDER_REFRESH,
	parseChildOptions,
	parseOAuth,
	parseReadinessInput,
	parseResolved,
	type ReadinessModel,
	type ReadinessReason,
	type ReadinessResult,
	refuse,
	responseJSON,
	sameMetadata,
	UNRESOLVED_ACCESS,
} from "./protocol.js";

class ReadinessFailure extends Error {
	readonly reason: ReadinessReason;
	readonly pending: boolean;
	constructor(reason: ReadinessReason, pending = false) {
		super(reason);
		this.reason = reason;
		this.pending = pending;
	}
}
const codex = "https://chatgpt.com/backend-api/codex";
function legacy(account: NativeAccount): boolean {
	const route = account.route;
	return (
		route.providerID === "openai" &&
		route.integrationID === "openai" &&
		["chatgpt-browser", "chatgpt-headless"].includes(route.methodID)
	);
}
function routeProjection(
	account: NativeAccount,
	provider: unknown,
	model: unknown,
	variant?: string,
) {
	if (!object(provider) || !object(model) || !Array.isArray(model.variants))
		throw new ReadinessFailure("metadata-unavailable", true);
	const variants = model.variants.filter(
		(candidate) => object(candidate) && candidate.id === variant,
	);
	if (variant !== undefined && variant !== "default" && variants.length !== 1)
		throw new ReadinessFailure("profile-unapproved");
	const selected =
		variant === undefined || variant === "default" ? undefined : variants[0];
	if (!legacy(account)) return { modelID: model.modelID, variant };
	const accountID = account.metadata?.accountID;
	if (typeof accountID !== "string" || !accountID)
		throw new ReadinessFailure("credential-invalid");
	for (const layer of [
		provider,
		model,
		selected,
		{ settings: account.metadata },
	]) {
		if (layer === undefined) continue;
		if (!object(layer))
			throw new ReadinessFailure("metadata-unavailable", true);
		if (layer.settings !== undefined) {
			if (!object(layer.settings))
				throw new ReadinessFailure("metadata-unavailable", true);
			const settings = layer.settings;
			if (
				["apiKey", "authToken", "accessToken", "auth"].some(
					(key) => settings[key] !== undefined && settings[key] !== "",
				)
			)
				throw new ReadinessFailure("route-unsettled", true);
		}
		if (
			layer.headers !== undefined &&
			(!object(layer.headers) ||
				Object.entries(layer.headers).some(
					([key, value]) =>
						typeof value !== "string" ||
						key.toLowerCase() === "authorization" ||
						(key.toLowerCase() === "chatgpt-account-id" && value !== accountID),
				))
		)
			throw new ReadinessFailure("route-unsettled", true);
	}
	const settings = (layer: Record<string, unknown> | undefined) =>
		layer?.settings === undefined
			? {}
			: (layer.settings as Record<string, unknown>);
	const effective = {
		...settings(provider),
		...settings(model),
		...settings(selected),
	};
	const headers = (
		layer: Record<string, unknown> | undefined,
	): Record<string, unknown> =>
		layer?.headers === undefined
			? {}
			: (layer.headers as Record<string, unknown>);
	const merged = {
		...headers(provider),
		...headers(model),
		...headers(selected),
	};
	const header = Object.entries(merged).filter(
		([key]) => key.toLowerCase() === "chatgpt-account-id",
	);
	if (
		provider.package !== "@opencode/ai/providers/openai" ||
		(model.package !== undefined && model.package !== provider.package) ||
		model.modelID !== model.id ||
		provider.settings === undefined ||
		settings(provider).transport !== "http" ||
		settings(provider).baseURL !== codex ||
		effective.baseURL !== codex ||
		(account.metadata?.baseURL !== undefined &&
			account.metadata.baseURL !== codex) ||
		(effective.transport !== undefined && effective.transport !== "http") ||
		!Object.entries(headers(provider)).some(
			([key, value]) =>
				key.toLowerCase() === "chatgpt-account-id" && value === accountID,
		) ||
		header.length === 0 ||
		header.some(([, value]) => value !== accountID)
	)
		throw new ReadinessFailure("route-unsettled", true);
	return {
		package: provider.package,
		modelID: model.modelID,
		baseURL: effective.baseURL,
		transport: settings(provider).transport,
		account: accountID,
	};
}

export async function registerNativeAccountClient(
	ctx: Context,
): Promise<() => Promise<void>> {
	let configuration: unknown;
	try {
		if (
			!object(ctx.options) ||
			typeof ctx.options.configurationPath !== "string" ||
			!isAbsolute(ctx.options.configurationPath)
		)
			refuse();
		const path = ctx.options.configurationPath;
		const parent = await lstat(dirname(path));
		if (
			!parent.isDirectory() ||
			parent.uid !== process.getuid?.() ||
			(parent.mode & 0o777) !== 0o700
		)
			refuse();
		const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const stat = await file.stat();
			if (
				!stat.isFile() ||
				stat.nlink !== 1 ||
				stat.uid !== process.getuid?.() ||
				(stat.mode & 0o777) !== 0o600 ||
				stat.size > 1024 * 1024
			)
				refuse();
			configuration = JSON.parse(await file.readFile("utf8"));
		} finally {
			await file.close();
		}
	} catch {
		refuse();
	}
	const options = parseChildOptions(configuration);
	const controller = new AbortController();
	const ensureSelected = async (account: NativeAccount) => {
		const route = account.route;
		const active = await ctx.integration.connection.active(route.integrationID);
		if (
			active?.type !== "credential" ||
			active.id !== route.credentialID ||
			active.method !== "oauth" ||
			active.status
		)
			refuse();
	};
	const request = async (
		path: "check" | "resolve",
		account: NativeAccount,
		signal?: AbortSignal,
	) => {
		await ensureSelected(account);
		return responseJSON(
			await fetch(new URL(path, options.connection.url), {
				method: "POST",
				headers: {
					authorization: `Bearer ${options.connection.capability}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					lease: options.lease,
					providerID: account.route.providerID,
					credentialID: account.route.credentialID,
				}),
				signal: AbortSignal.any([
					controller.signal,
					...(signal ? [signal] : []),
					AbortSignal.timeout(15000),
				]),
				redirect: "error",
			}),
		);
	};
	const selected = new Map<string, NativeAccount>();
	for (const account of options.connection.accounts) {
		const key = `${account.route.integrationID}\0${account.route.methodID}`;
		const previous = selected.get(key);
		if (previous && previous.route.credentialID !== account.route.credentialID)
			refuse();
		selected.set(key, account);
	}
	const registration = await ctx.integration.transform((editor) => {
		for (const account of selected.values()) {
			const route = account.route;
			const method = editor.method
				.list(route.integrationID)
				.find(
					(candidate) =>
						candidate.type === "oauth" && candidate.id === route.methodID,
				);
			if (method?.type !== "oauth") refuse();
			editor.method.update({
				integrationID: route.integrationID,
				method,
				authorize: async () => refuse(),
				refresh: async (credential) => {
					try {
						if (
							credential.refresh !== PLACEHOLDER_REFRESH ||
							credential.methodID !== route.methodID ||
							!sameMetadata(credential.metadata, account.metadata)
						)
							refuse();
						const resolved = parseResolved(await request("resolve", account));
						if (
							!sameMetadata(resolved.route, route) ||
							!sameMetadata(resolved.value.metadata, account.metadata)
						)
							refuse();
						return Credential.OAuth.make({
							...resolved.value,
							methodID: Integration.MethodID.make(route.methodID),
							refresh: PLACEHOLDER_REFRESH,
						});
					} catch {
						refuse();
					}
				},
			});
		}
	});

	const selection = async (account: NativeAccount, signal: AbortSignal) => {
		const route = account.route;
		const provider = (
			await boundedNativeAuth(signal, () =>
				ctx.provider.get({ providerID: route.providerID }),
			)
		).data;
		const available = (
			await boundedNativeAuth(signal, () => ctx.provider.list())
		).data;
		if (
			provider.id !== route.providerID ||
			!(["auto", "enabled"] as const).some(
				(activation) => activation === provider.activation,
			) ||
			provider.integrationID !== route.integrationID ||
			!available.some((candidate) => candidate.id === route.providerID)
		)
			throw new ReadinessFailure("selection-changed");
		const integration = (
			await boundedNativeAuth(signal, () =>
				ctx.integration.get({ integrationID: route.integrationID }),
			)
		).data;
		if (
			integration.id !== route.integrationID ||
			!integration.methods.some(
				(method) => method.type === "oauth" && method.id === route.methodID,
			)
		)
			throw new ReadinessFailure("selection-changed");
		const active = await boundedNativeAuth(signal, () =>
			ctx.integration.connection.active(route.integrationID),
		);
		if (
			active?.type !== "credential" ||
			active.id !== route.credentialID ||
			active.label !== route.label ||
			active.method !== "oauth" ||
			active.status
		)
			throw new ReadinessFailure("selection-changed");
		return { provider, active };
	};
	const usable = (raw: unknown, account: NativeAccount): OAuthValue => {
		let value: OAuthValue;
		try {
			value = parseOAuth(raw);
		} catch {
			throw new ReadinessFailure("credential-invalid");
		}
		if (
			value.methodID !== account.route.methodID ||
			!sameMetadata(value.metadata, account.metadata)
		)
			throw new ReadinessFailure("credential-invalid");
		if (!value.access || value.access === UNRESOLVED_ACCESS)
			throw new ReadinessFailure("credential-unresolved", true);
		if (value.expires <= Date.now())
			throw new ReadinessFailure("credential-stale", true);
		return value;
	};
	const source = async (account: NativeAccount, signal: AbortSignal) => {
		try {
			const resolved = parseResolved(
				await boundedNativeAuth(signal, () =>
					request("resolve", account, signal),
				),
			);
			if (
				!sameMetadata(resolved.route, account.route) ||
				!sameMetadata(resolved.value.metadata, account.metadata)
			)
				refuse();
			return usable(resolved.value, account);
		} catch {
			throw new ReadinessFailure("source-unavailable");
		}
	};
	const sample = async (
		models: readonly ReadinessModel[],
		signal: AbortSignal,
	) => {
		const values: Array<{ value: OAuthValue; account: NativeAccount }> = [];
		for (const providerID of new Set(models.map((model) => model.providerID))) {
			const account = options.connection.accounts.find(
				(candidate) => candidate.route.providerID === providerID,
			);
			if (!account) throw new ReadinessFailure("profile-unapproved");
			const initial = await selection(account, signal);
			await source(account, signal);
			usable(
				await boundedNativeAuth(signal, () =>
					ctx.integration.connection.resolve(initial.active),
				),
				account,
			);
			const projection = async () => {
				const { provider } = await selection(account, signal);
				const inventory = (
					await boundedNativeAuth(signal, () => ctx.model.list())
				).data;
				return models
					.filter((model) => model.providerID === providerID)
					.map((profile) => {
						const matches = inventory.filter(
							(model) =>
								model.providerID === providerID && model.id === profile.id,
						);
						const model = matches[0];
						if (
							matches.length !== 1 ||
							model?.enabled !== true ||
							typeof model.modelID !== "string" ||
							!model.modelID
						)
							throw new ReadinessFailure("metadata-unavailable", true);
						return routeProjection(account, provider, model, profile.variant);
					});
			};
			const before = await projection();
			const current = await selection(account, signal);
			values.push({
				value: usable(
					await boundedNativeAuth(signal, () =>
						ctx.integration.connection.resolve(current.active),
					),
					account,
				),
				account,
			});
			if (!sameMetadata(before, await projection()))
				throw new ReadinessFailure("route-unsettled", true);
			values.push({ value: await source(account, signal), account });
			await selection(account, signal);
		}
		for (const { value, account } of values) usable(value, account);
		if (signal.aborted) refuse();
	};
	const readiness = await ctx.rpc.register(NativeAccountReadinessRpc, {
		ready: async (raw, call): Promise<ReadinessResult> => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let reason: ReadinessReason = "readiness-unavailable";
			const timeout = new AbortController();
			try {
				const input = parseReadinessInput(raw);
				if (
					input.models.some(
						(model) =>
							!options.models.includes(`${model.providerID}/${model.id}`),
					)
				)
					throw new ReadinessFailure("profile-unapproved");
				const deadline = Date.now() + input.timeoutMs;
				timer = setTimeout(() => timeout.abort(), input.timeoutMs);
				const signal = AbortSignal.any([
					controller.signal,
					call.signal,
					timeout.signal,
				]);
				for (;;) {
					try {
						await sample(input.models, signal);
						if (signal.aborted || Date.now() >= deadline) refuse();
						return { version: 1, state: "ready" };
					} catch (error) {
						if (call.signal.aborted || controller.signal.aborted)
							throw new ReadinessFailure("readiness-cancelled");
						if (timeout.signal.aborted || Date.now() >= deadline)
							throw new ReadinessFailure("readiness-deadline");
						if (!(error instanceof ReadinessFailure) || !error.pending)
							throw error;
						await boundedNativeAuth(
							signal,
							() =>
								new Promise<void>((resolve) => {
									const wake = setTimeout(
										done,
										Math.min(20, Math.max(1, deadline - Date.now())),
									);
									function done() {
										clearTimeout(wake);
										signal.removeEventListener("abort", done);
										resolve();
									}
									signal.addEventListener("abort", done, { once: true });
								}),
						);
					}
				}
			} catch (error) {
				if (error instanceof ReadinessFailure) reason = error.reason;
				else if (call.signal.aborted || controller.signal.aborted)
					reason = "readiness-cancelled";
				else if (timeout.signal.aborted) reason = "readiness-deadline";
				controller.abort();
				return { version: 1, state: "not-ready", reason };
			} finally {
				clearTimeout(timer);
			}
		},
	});
	const guard = async (
		input: {
			model: { providerID: string; id: string; variant?: string | undefined };
			request?: Request;
		},
		websocket = false,
	) => {
		try {
			if (controller.signal.aborted) refuse();
			const account = options.connection.accounts.find(
				(candidate) => candidate.route.providerID === input.model.providerID,
			);
			if (!account) refuse();
			const check = async (signal?: AbortSignal) => {
				const read = async () => {
					const provider = (
						await ctx.provider.get({ providerID: account.route.providerID })
					).data;
					if (
						provider.activation === "disabled" ||
						provider.integrationID !== account.route.integrationID
					)
						refuse();
					await request("check", account, signal);
				};
				if (signal) await boundedNativeAuth(signal, read);
				else await read();
			};
			if (legacy(account)) {
				if (websocket || !input.request) refuse();
				const timeout = new AbortController();
				const timer = setTimeout(() => timeout.abort(), 15000);
				const signal = AbortSignal.any([controller.signal, timeout.signal]);
				try {
					await check(signal);
					await sample(
						[
							{
								providerID: input.model.providerID,
								id: input.model.id,
								...(input.model.variant === undefined
									? {}
									: { variant: input.model.variant }),
							},
						],
						signal,
					);
					const url = new URL(input.request.url);
					if (
						url.origin !== "https://chatgpt.com" ||
						!(
							url.pathname === "/backend-api/codex" ||
							url.pathname.startsWith("/backend-api/codex/")
						) ||
						input.request.headers.get("chatgpt-account-id") !==
							account.metadata?.accountID ||
						signal.aborted
					)
						refuse();
				} finally {
					clearTimeout(timer);
				}
			} else await check();
			if (controller.signal.aborted) refuse();
		} catch {
			refuse();
		}
	};
	const http = await ctx.session.hook("http.request", (input) => guard(input));
	const websocket = await ctx.session.hook(
		"experimental.ws.handshake",
		(input) => guard(input, true),
	);
	let disposed: Promise<void> | undefined;
	return () => {
		disposed ??= (async () => {
			controller.abort();
			await readiness.dispose();
			await registration.dispose();
			await http.dispose();
			await websocket.dispose();
		})();
		return disposed;
	};
}

export default Plugin.define({
	id: "flow.native-account-client",
	setup: registerNativeAccountClient,
});
