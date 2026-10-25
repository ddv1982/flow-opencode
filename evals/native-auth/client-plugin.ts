import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { Credential, Integration, Plugin } from "@opencode/plugin";
import type { Context } from "@opencode/plugin/promise/plugin";
import {
	type NativeAccount,
	object,
	PLACEHOLDER_REFRESH,
	parseChildOptions,
	parseResolved,
	refuse,
	responseJSON,
	sameMetadata,
} from "./protocol.js";

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
	const request = async (path: "check" | "resolve", account: NativeAccount) => {
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
	const guard = async (input: { model: { providerID: string } }) => {
		try {
			const account = options.connection.accounts.find(
				(candidate) => candidate.route.providerID === input.model.providerID,
			);
			if (!account) refuse();
			const provider = (
				await ctx.provider.get({ providerID: account.route.providerID })
			).data;
			if (
				provider.activation === "disabled" ||
				provider.integrationID !== account.route.integrationID
			)
				refuse();
			await request("check", account);
		} catch {
			refuse();
		}
	};
	const http = await ctx.session.hook("http.request", guard);
	const websocket = await ctx.session.hook("experimental.ws.handshake", guard);
	let disposed: Promise<void> | undefined;
	return () => {
		disposed ??= (async () => {
			controller.abort();
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
