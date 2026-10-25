import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { Plugin } from "@opencode/plugin";
import type { Context } from "@opencode/plugin/promise/plugin";
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
			attach: (context: Context) => Promise<void>;
			scriptDigest: string | null;
			scopeDigest: string | null;
	  }
	| undefined;
function assertInstalledRequestGate(expected: {
	directory: string;
	authorizationDigest: string;
	scope: EpisodeReservationScope;
	origin: "live";
}): void {
	if (
		!installed?.ready ||
		installed.digest !== expected.authorizationDigest ||
		installed.directory !== expected.directory ||
		installed.origin !== expected.origin ||
		installed.scriptDigest !== null ||
		installed.scopeDigest !== datasetDigest(expected.scope) ||
		installed.fetch !== globalThis.fetch ||
		installed.webSocket !== globalThis.WebSocket
	)
		throw new Error("Matching live evaluation request gate is unavailable.");
}
let installing = false;
async function install(context: Context, input: unknown): Promise<void> {
	if (installing)
		throw new Error(
			"Evaluation request gate installation is already in progress.",
		);
	installing = true;
	try {
		await installOnce(context, input);
	} finally {
		installing = false;
	}
}
async function installOnce(context: Context, input: unknown): Promise<void> {
	const options = Options.parse(input);
	const scopeDigest = options.scope ? datasetDigest(options.scope) : null;
	const status = await requestBudgetStatus(options.directory);
	if (
		status.authorizationDigest !== options.authorizationDigest ||
		status.cancelled ||
		Date.parse(status.authorization.expiresAt) <= Date.now()
	)
		throw new Error("Evaluation request authorization unavailable.");
	if (installed) {
		if (
			!installed.ready ||
			installed.fetch !== globalThis.fetch ||
			installed.webSocket !== globalThis.WebSocket ||
			installed.digest !== options.authorizationDigest ||
			installed.directory !== options.directory ||
			installed.scopeDigest !== scopeDigest ||
			installed.scriptDigest !==
				(options.simulationScript
					? datasetDigest(options.simulationScript)
					: null)
		)
			throw new Error(
				"One evaluation request budget is allowed per host process.",
			);
		await installed.attach(context);
		return;
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
	const pending = new Map<string, Request>();
	let gated: ReturnType<typeof createRequestGate>;
	const proxy = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 0,
		async fetch(request) {
			const key = new URL(request.url).pathname.slice(1);
			const originalRequest = pending.get(key);
			if (!originalRequest)
				return new Response("Unknown evaluation request", { status: 403 });
			pending.delete(key);
			try {
				return await gated(
					new Request(originalRequest, {
						signal: AbortSignal.any([request.signal, originalRequest.signal]),
					}),
				);
			} catch {
				return new Response(
					"Evaluation request refused; reservation remains consumed",
					{ status: 503 },
				);
			}
		},
	});
	const proxyOrigin = proxy.url.origin;
	gated = createRequestGate({
		...options,
		controlOrigin: proxyOrigin,
		transport: (request) =>
			status.authorization.origin === "simulation" &&
			new URL(request.url).origin !== proxyOrigin &&
			request.url !== "https://models.dev/api.json"
				? simulate
					? simulate(request)
					: Promise.resolve(
							new Response("Simulated provider refusal", { status: 503 }),
						)
				: original(request),
	});
	const attached = new WeakSet<Context>();
	const attach = async (context: Context) => {
		if (attached.has(context)) return;
		await context.session.hook("http.request", (input) => {
			if (pending.size >= 128)
				throw new Error("Too many pending evaluation requests.");
			const key = randomUUID();
			pending.set(key, input.request);
			input.request = new Request(`${proxyOrigin}/${key}`, {
				method: "POST",
				signal: input.request.signal,
			});
		});
		await context.session.hook("experimental.ws.handshake", () => {
			throw new Error(
				"WebSocket inference is disabled in budgeted evaluations.",
			);
		});
		attached.add(context);
	};
	await attach(context);
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
		attach,
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
	return;
}
const BudgetPlugin = Plugin.define({
	id: "flow-eval-request-budget",
	setup: (context) => install(context, context.options),
});
export default Object.assign(BudgetPlugin, {
	assertInstalledRequestGate,
	install,
});
