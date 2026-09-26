import { z } from "zod";
import {
	type EpisodeReservationScope,
	EpisodeReservationScopeSchema,
	reserveRequest,
} from "./request-budget.js";

const routes = new Map([
	[
		"https://chatgpt.com/backend-api/codex/responses",
		{ model: "gpt-5.6-terra", budgetModel: "openai/gpt-5.6-terra" },
	],
	[
		"https://api.x.ai/v1/chat/completions",
		{ model: "grok-4.6", budgetModel: "xai/grok-4.6" },
	],
	[
		"https://api.x.ai/v1/responses",
		{ model: "grok-4.6", budgetModel: "xai/grok-4.6" },
	],
	[
		"https://api.typesafe.ai/v1/systemone",
		{ model: "jev-1.13.0", budgetModel: "typesafe/jev-1.13.0" },
	],
]);
const connectionEndpoints = new Set([
	"https://auth.openai.com/oauth/token",
	"https://auth.x.ai/oauth2/token",
]);
const Envelope = z
	.object({
		model: z.string(),
		tools: z
			.array(z.object({ type: z.literal("function") }).passthrough())
			.optional(),
	})
	.passthrough();
export type BudgetFetch = (input: Request) => Promise<Response>;

export function createRequestGate(options: {
	directory: string;
	authorizationDigest: string;
	transport: BudgetFetch;
	controlOrigin?: string;
	signal?: AbortSignal;
	scope?: EpisodeReservationScope | undefined;
}) {
	const scope =
		options.scope === undefined
			? undefined
			: Object.freeze(EpisodeReservationScopeSchema.parse(options.scope));
	const control = options.controlOrigin ? new URL(options.controlOrigin) : null;
	if (
		control &&
		(control.protocol !== "http:" ||
			!["127.0.0.1", "localhost", "[::1]"].includes(control.hostname) ||
			!control.port ||
			control.username ||
			control.password)
	)
		throw new Error(
			"Evaluation control origin must be loopback HTTP with an explicit port.",
		);
	const controlOrigin = control?.origin ?? null;
	return async (
		input: Parameters<typeof fetch>[0],
		init?: RequestInit,
	): Promise<Response> => {
		const request =
			input instanceof Request
				? new Request(input, init)
				: new Request(String(input), init);
		const signal = AbortSignal.any([
			request.signal,
			...(options.signal ? [options.signal] : []),
		]);
		signal.throwIfAborted();
		const url = new URL(request.url);
		if (url.username || url.password || url.hash)
			throw new Error("Unsupported evaluation request URL.");
		const send = async () => {
			signal.throwIfAborted();
			try {
				return await options.transport(
					new Request(request, { redirect: "error", signal }),
				);
			} catch {
				throw new Error(
					"Evaluation request failed; any reservation remains consumed.",
				);
			}
		};
		if (controlOrigin && url.origin === controlOrigin) return send();
		if (connectionEndpoints.has(url.href) && request.method === "POST")
			return send();
		if (url.href === "https://models.dev/api.json" && request.method === "GET")
			return send();
		const route = routes.get(url.href);
		if (!route || request.method !== "POST")
			throw new Error("Unmetered evaluation route refused.");
		if (
			!request.headers
				.get("content-type")
				?.toLowerCase()
				.startsWith("application/json")
		)
			throw new Error("Evaluation inference requires JSON.");
		const clone = request.clone();
		const reader = clone.body?.getReader();
		if (!reader) throw new Error("Missing inference body.");
		const abortRead = () => {
			void reader.cancel().catch(() => {});
		};
		signal.addEventListener("abort", abortRead, { once: true });
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				signal.throwIfAborted();
				const chunk = await reader.read();
				if (chunk.done) break;
				size += chunk.value.byteLength;
				if (
					size >
					(route.budgetModel === "typesafe/jev-1.13.0" ? 32_000 : 2_000_000)
				)
					throw new Error("Inference body exceeds evaluation limit.");
				chunks.push(chunk.value);
			}
		} finally {
			signal.removeEventListener("abort", abortRead);
			void reader.cancel().catch(() => {});
		}
		let body: z.infer<typeof Envelope>;
		try {
			body = Envelope.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		} catch {
			throw new Error("Unsupported inference body.");
		}
		if (
			body.search_parameters !== undefined ||
			body.background === true ||
			(body.n !== undefined && body.n !== 1) ||
			(body.service_tier !== undefined &&
				body.service_tier !== "default" &&
				body.service_tier !== "auto")
		)
			throw new Error("Unreviewed paid request features refused.");
		if (body.model !== route.model)
			throw new Error("Unregistered evaluation model refused.");
		await reserveRequest(
			options.directory,
			route.budgetModel,
			options.authorizationDigest,
			signal,
			scope,
		);
		return send();
	};
}
