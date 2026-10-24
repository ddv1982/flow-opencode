import {
	Credential,
	Integration,
	Model,
	Plugin,
	Provider,
} from "@opencode/plugin";
import { Rpc } from "@opencode/plugin/rpc";
import { object, refuse } from "../../evals/native-auth/protocol.js";

export const FixtureRpc = Rpc.define({
	id: "native-auth.fixture",
	methods: {
		stats: {
			input: { type: "object", properties: {} },
			output: { type: "object" },
		},
	},
	events: {},
});
let refreshes = 0;
let foreignRequests = 0;
let directChildRefreshes = 0;
let refreshing: Promise<Credential.OAuth> | undefined;
let instances = 0;
let original: typeof fetch;

export default Plugin.define({
	id: "native-auth.fixture",
	async setup(ctx) {
		if (
			!object(ctx.options) ||
			(ctx.options.role !== "source" && ctx.options.role !== "child") ||
			typeof ctx.options.baseURL !== "string"
		)
			refuse();
		const role = ctx.options.role;
		const baseURL = ctx.options.baseURL;
		const origin = new URL(baseURL).origin;
		if (new URL(baseURL).hostname !== "127.0.0.1") refuse();
		if (instances++ === 0) {
			original = globalThis.fetch;
			globalThis.fetch = Object.assign(
				async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
					const url = new URL(
						input instanceof Request ? input.url : String(input),
					);
					if (
						url.hostname !== "127.0.0.1" &&
						url.href !== "https://models.dev/api.json"
					) {
						foreignRequests++;
						throw new Error("Synthetic auth fixture refused network request.");
					}
					return original(input, init);
				},
				{ preconnect: original.preconnect },
			);
		}
		await ctx.integration.transform((editor) =>
			editor.method.update({
				integrationID: "openai",
				method: {
					type: "oauth",
					id: "native-auth-fixture-method",
					label: "Synthetic OAuth",
				},
				authorize: async () => refuse(),
				refresh: async (credential) => {
					if (role === "child") {
						directChildRefreshes++;
						refuse();
					}
					if (credential.expires > Date.now() + 60000) return credential;
					if (refreshing) return refreshing;
					refreshing = (async () => {
						refreshes++;
						await Bun.sleep(10);
						return Credential.OAuth.make({
							...credential,
							methodID: Integration.MethodID.make("native-auth-fixture-method"),
							access: `synthetic-owner-access-${refreshes}`,
							refresh: `synthetic-owner-refresh-${refreshes}`,
							expires: Date.now() + 3600000,
						});
					})();
					try {
						return await refreshing;
					} finally {
						refreshing = undefined;
					}
				},
			}),
		);
		const providerID = Provider.ID.make("native-auth-fixture");
		const model = Model.Info.default(providerID, Model.ID.make("model"));
		await ctx.provider.transform((editor) =>
			editor.add({
				info: {
					...Provider.Info.empty(providerID),
					integrationID: Integration.ID.make("openai"),
					activation: "enabled",
					name: "Synthetic native auth",
					package: "@opencode/ai/providers/openai-compatible",
					settings: { baseURL },
				},
				models: [{ ...model, modelID: Model.ID.make("wire-model") }],
			}),
		);
		await ctx.session.hook("title", (input) => {
			input.result = "Synthetic native auth";
		});
		await ctx.session.hook("retry", (input) => {
			input.decision = { retry: false };
		});
		await ctx.session.hook("http.request", (input) => {
			if (new URL(input.request.url).origin !== origin) {
				foreignRequests++;
				refuse();
			}
		});
		const registration = await ctx.rpc.register(FixtureRpc, {
			stats: async () => ({ refreshes, foreignRequests, directChildRefreshes }),
		});
		return async () => {
			await registration.dispose();
			if (--instances === 0) globalThis.fetch = original;
		};
	},
});
