import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { isRecord } from "../../evals/host-observation.js";
import BudgetPlugin from "../../evals/recovery-decisions/budget-plugin.js";
import LocalPlugin from "./opencode-v2-smoke-plugin.js";

const Options = z
	.object({
		baseURL: z.string(),
		receipt: z.string(),
		directory: z.string(),
		authorizationDigest: z.string(),
		readyPath: z.string(),
	})
	.strict();
export default Plugin.define({
	id: "flow-v2-native-budget-proof",
	async setup(context) {
		const options = Options.parse(context.options);
		const cleanup = await LocalPlugin.setup({
			...context,
			options: { baseURL: options.baseURL, receipt: options.receipt },
		});
		await context.session.hook("http.request", async (input) => {
			const body: unknown = await input.request.clone().json();
			if (!isRecord(body)) throw new Error("Invalid local budget body");
			input.request = new Request("https://api.x.ai/v1/chat/completions", {
				method: "POST",
				headers: input.request.headers,
				body: JSON.stringify({ ...body, model: "grok-4.6" }),
				signal: input.request.signal,
			});
		});
		await BudgetPlugin.install(context, {
			directory: options.directory,
			authorizationDigest: options.authorizationDigest,
			readyPath: options.readyPath,
		});
		await context.session.hook("http.request", (input) => {
			if (new URL(input.request.url).hostname !== "127.0.0.1")
				throw new Error("Native budget proof must dispatch only to loopback");
		});
		await context.session.hook("retry", (input) => {
			input.decision = { retry: false };
		});
		return cleanup;
	},
});
