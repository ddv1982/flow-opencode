import { Plugin } from "@opencode/plugin";
import type { Context } from "@opencode/plugin/promise/plugin";
import type { Registration } from "@opencode/plugin/promise/registration";
import {
	type AccountRoute,
	containsSecret,
	identifier,
	NativeAccountRpc,
	object,
	PLACEHOLDER_REFRESH,
	parseOAuth,
	parseSelection,
	type ResolvedAccount,
	refuse,
	sameMetadata,
} from "./protocol.js";

export async function registerNativeAccountSource(
	ctx: Context,
): Promise<() => Promise<void>> {
	const options = ctx.options;
	if (
		!object(options) ||
		!Array.isArray(options.providers) ||
		options.providers.length === 0 ||
		!options.providers.every(identifier)
	)
		refuse();
	const providers = [...new Set(options.providers)];
	const pins = new Map<string, ResolvedAccount>();
	const pending = new Map<string, Promise<ResolvedAccount>>();
	let closed = false;
	let initial: Promise<void> | undefined;
	let cleanup: Promise<void> | undefined;
	let registration: Registration;
	const active = async (providerID: string, pin?: AccountRoute) => {
		if (closed || !providers.includes(providerID)) refuse();
		const provider = (await ctx.provider.get({ providerID })).data;
		if (
			provider.id !== providerID ||
			provider.activation === "disabled" ||
			!provider.integrationID ||
			(pin && provider.integrationID !== pin.integrationID)
		)
			refuse();
		const connection = await ctx.integration.connection.active(
			provider.integrationID,
		);
		if (
			connection?.type !== "credential" ||
			connection.method !== "oauth" ||
			connection.status ||
			(pin &&
				(connection.id !== pin.credentialID || connection.label !== pin.label))
		)
			refuse();
		return { provider, connection };
	};
	const resolve = async (
		providerID: string,
		pin?: ResolvedAccount,
	): Promise<ResolvedAccount> => {
		const facts = await active(providerID, pin?.route);
		const previous = pending.get(facts.connection.id);
		if (previous) {
			await previous;
			return resolve(providerID, pin);
		}
		const operation = (async (): Promise<ResolvedAccount> => {
			const credential = parseOAuth(
				await ctx.integration.connection.resolve(facts.connection),
				false,
			);
			const integrationID = facts.provider.integrationID;
			if (!integrationID) refuse();
			if (
				containsSecret(credential.access, credential.refresh) ||
				containsSecret(credential.metadata, credential.refresh)
			)
				refuse();
			const integration = (await ctx.integration.get({ integrationID })).data;
			if (
				!integration.methods.some(
					(method) =>
						method.type === "oauth" && method.id === credential.methodID,
				) ||
				(pin &&
					(credential.methodID !== pin.route.methodID ||
						!sameMetadata(credential.metadata, pin.value.metadata)))
			)
				refuse();
			const route = {
				providerID,
				integrationID,
				credentialID: facts.connection.id,
				methodID: credential.methodID,
				label: facts.connection.label,
			};
			await active(providerID, route);
			return { route, value: { ...credential, refresh: PLACEHOLDER_REFRESH } };
		})();
		pending.set(facts.connection.id, operation);
		try {
			return await operation;
		} finally {
			if (pending.get(facts.connection.id) === operation)
				pending.delete(facts.connection.id);
		}
	};
	const initialize = () => {
		if (closed) refuse();
		initial ??= (async () => {
			for (const providerID of providers)
				pins.set(providerID, await resolve(providerID));
		})();
		return initial;
	};
	const dispose = () => {
		cleanup ??= (async () => {
			closed = true;
			await initial?.catch(() => {});
			await Promise.allSettled([...pending.values()]);
			pins.clear();
			await registration.dispose();
		})();
		return cleanup;
	};
	registration = await ctx.rpc.register(NativeAccountRpc, {
		describe: async () => {
			try {
				await initialize();
				const accounts: ResolvedAccount[] = [];
				for (const [providerID, pin] of pins)
					accounts.push(await resolve(providerID, pin));
				return { accounts };
			} catch {
				refuse();
			}
		},
		resolve: async (input) => {
			try {
				const selected = parseSelection(input);
				await initialize();
				const pin = pins.get(selected.providerID);
				if (!pin || pin.route.credentialID !== selected.credentialID) refuse();
				return await resolve(selected.providerID, pin);
			} catch {
				refuse();
			}
		},
		check: async (input) => {
			try {
				const selected = parseSelection(input);
				await initialize();
				const pin = pins.get(selected.providerID);
				if (!pin || pin.route.credentialID !== selected.credentialID) refuse();
				await active(selected.providerID, pin.route);
				const integration = (
					await ctx.integration.get({ integrationID: pin.route.integrationID })
				).data;
				if (
					!integration.methods.some(
						(method) =>
							method.type === "oauth" && method.id === pin.route.methodID,
					)
				)
					refuse();
				return {};
			} catch {
				refuse();
			}
		},
		close: async () => {
			await dispose();
			return {};
		},
	});
	return dispose;
}

export default Plugin.define({
	id: "flow.native-account-source",
	setup: registerNativeAccountSource,
});
