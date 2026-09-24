import { dirname, join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import {
	type EpisodeReservationScope,
	EpisodeReservationScopeSchema,
	requestBudgetStatus,
} from "./request-budget.js";
import { createRequestGate } from "./request-gate.js";
import { datasetDigest } from "./schema.js";
import { createSimulationTransport } from "./simulation-transport.js";
import { SimulationScriptSchema } from "./treatment.js";

const Options = z
	.object({
		directory: z.string().min(1),
		scope: EpisodeReservationScopeSchema.optional(),
		simulationScript: SimulationScriptSchema.optional(),
		readyPath: z.string().min(1),
		authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();
let installed:
	| {
			digest: string;
			origin: "live" | "simulation";
			ready: boolean;
			fetch: typeof globalThis.fetch;
			webSocket: typeof globalThis.WebSocket;
			directory: string;
			controlOrigin: string;
			scriptDigest: string | null;
			scopeDigest: string | null;
	  }
	| undefined;
function assertInstalledRequestGate(expected: {
	directory: string;
	authorizationDigest: string;
	scope: EpisodeReservationScope;
	controlOrigin: string;
	origin: "live";
}): void {
	if (
		!installed?.ready ||
		installed.digest !== expected.authorizationDigest ||
		installed.directory !== expected.directory ||
		installed.controlOrigin !== expected.controlOrigin ||
		installed.origin !== expected.origin ||
		installed.scriptDigest !== null ||
		installed.scopeDigest !== datasetDigest(expected.scope) ||
		installed.fetch !== globalThis.fetch ||
		installed.webSocket !== globalThis.WebSocket
	)
		throw new Error("Matching live evaluation request gate is unavailable.");
}
const BudgetPlugin: Plugin = async (context, input) => {
	const options = Options.parse(input);
	const scopeDigest = options.scope ? datasetDigest(options.scope) : null;
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
			!installed.ready ||
			installed.fetch !== globalThis.fetch ||
			installed.webSocket !== globalThis.WebSocket ||
			installed.digest !== options.authorizationDigest ||
			installed.directory !== options.directory ||
			installed.scopeDigest !== scopeDigest ||
			installed.controlOrigin !== controlOrigin ||
			installed.scriptDigest !==
				(options.simulationScript
					? datasetDigest(options.simulationScript)
					: null)
		)
			throw new Error(
				"One evaluation request budget is allowed per host process.",
			);
		return {};
	}
	if (options.simulationScript && status.authorization.origin !== "simulation")
		throw new Error("Simulation script requires simulation authorization.");
	const simulate = options.simulationScript
		? createSimulationTransport(options.simulationScript, (sha256) =>
				writeExclusive(
					join(dirname(options.readyPath), "simulation-jev-packet.json"),
					{
						schemaVersion: 1,
						model: "typesafe/jev-1.13.0",
						sha256,
					},
				),
			)
		: undefined;
	const original = globalThis.fetch;
	const gated = createRequestGate({
		...options,
		controlOrigin,
		transport: (request) =>
			status.authorization.origin === "simulation" &&
			new URL(request.url).origin !== controlOrigin &&
			request.url !== "https://models.dev/api.json"
				? simulate
					? simulate(request)
					: Promise.resolve(
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
	Object.defineProperty(globalThis, "fetch", {
		value: globalThis.fetch,
		writable: false,
		configurable: false,
	});
	Object.defineProperty(globalThis, "WebSocket", {
		value: globalThis.WebSocket,
		writable: false,
		configurable: false,
	});
	installed = {
		ready: false,
		origin: status.authorization.origin,
		fetch: globalThis.fetch,
		webSocket: globalThis.WebSocket,
		scopeDigest,
		digest: options.authorizationDigest,
		directory: options.directory,
		controlOrigin,
		scriptDigest: options.simulationScript
			? datasetDigest(options.simulationScript)
			: null,
	};
	await writeExclusive(options.readyPath, {
		scopeDigest,
		authorizationDigest: options.authorizationDigest,
		pid: process.pid,
		origin: status.authorization.origin,
		scriptDigest: options.simulationScript
			? datasetDigest(options.simulationScript)
			: null,
	});
	installed.ready = true;
	return {};
};
export default Object.assign(BudgetPlugin, { assertInstalledRequestGate });
