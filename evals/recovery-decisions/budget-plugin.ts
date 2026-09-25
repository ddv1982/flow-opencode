import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { requestBudgetStatus } from "./request-budget.js";
import { createRequestGate } from "./request-gate.js";

const Options = z
	.object({
		directory: z.string().min(1),
		readyPath: z.string().min(1),
		authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();
let installed:
	| { digest: string; directory: string; controlOrigin: string }
	| undefined;
const BudgetPlugin: Plugin = async (context, input) => {
	const options = Options.parse(input);
	const status = await requestBudgetStatus(options.directory);
	if (
		status.authorizationDigest !== options.authorizationDigest ||
		status.cancelled ||
		Date.parse(status.authorization.expiresAt) <= Date.now()
	)
		throw new Error("Evaluation request authorization unavailable.");
	const controlOrigin = context.serverUrl.origin;
	if (installed) {
		if (
			installed.digest !== options.authorizationDigest ||
			installed.directory !== options.directory ||
			installed.controlOrigin !== controlOrigin
		)
			throw new Error(
				"One evaluation request budget is allowed per host process.",
			);
		return {};
	}
	const original = globalThis.fetch;
	const gated = createRequestGate({
		...options,
		controlOrigin,
		transport: (request) =>
			status.authorization.origin === "simulation" &&
			new URL(request.url).origin !== controlOrigin &&
			request.url !== "https://models.dev/api.json"
				? Promise.resolve(
						new Response("Simulated provider refusal", { status: 503 }),
					)
				: original(request),
	});
	globalThis.fetch = Object.assign(gated, { preconnect: original.preconnect });
	globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
		construct() {
			throw new Error(
				"WebSocket inference is disabled in budgeted evaluations.",
			);
		},
	});
	installed = {
		digest: options.authorizationDigest,
		directory: options.directory,
		controlOrigin,
	};
	await writeExclusive(options.readyPath, {
		authorizationDigest: options.authorizationDigest,
		pid: process.pid,
		origin: status.authorization.origin,
	});
	return {};
};
export default BudgetPlugin;
