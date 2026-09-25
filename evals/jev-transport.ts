export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_PINNED_MODEL = "jev-1.13.0";
export const JEV_ATTEMPT_RESERVATION_USD = (64_000 * 0.042) / 1_000_000;
export const JEV_MAX_REQUEST_BYTES = 32_000;
export const JEV_MAX_RESPONSE_BYTES = 128_000;
export type JevTransport = (
	url: string,
	init: RequestInit,
) => Promise<Response>;
export type TransportFailure =
	| "budget"
	| "cancelled"
	| "timeout"
	| "transport"
	| "http"
	| "oversize"
	| "malformed";
export type TransportResult = {
	readonly attempts: number;
	readonly latencyMs: number;
	readonly reservedUsd: number;
} & (
	| { readonly ok: true; readonly payload: unknown }
	| {
			readonly ok: false;
			readonly reason: TransportFailure;
			readonly status?: number;
	  }
);
export function createJevBudget(maxCalls: number, maxUsd: number) {
	if (
		!Number.isSafeInteger(maxCalls) ||
		maxCalls < 1 ||
		!Number.isFinite(maxUsd) ||
		maxUsd <= 0
	)
		throw new Error("Invalid Jev budget");
	let calls = 0;
	let reservedUsd = 0;
	return {
		reserve(): boolean {
			const nextReservedUsd = (calls + 1) * JEV_ATTEMPT_RESERVATION_USD;
			if (
				calls >= maxCalls ||
				nextReservedUsd > maxUsd + Number.EPSILON * Math.max(1, calls + 1)
			)
				return false;
			calls++;
			reservedUsd = nextReservedUsd;
			return true;
		},
		snapshot() {
			return { calls, reservedUsd, maxCalls, maxUsd };
		},
	};
}
export type JevBudget = ReturnType<typeof createJevBudget>;
export async function requestJev(
	body: unknown,
	options: {
		readonly apiKey: string;
		readonly budget: JevBudget;
		readonly signal?: AbortSignal;
		readonly transport?: JevTransport;
		readonly timeoutMs?: number;
	},
): Promise<TransportResult> {
	const started = performance.now();
	let attempts = 0;
	const timeoutMs = options.timeoutMs ?? 10000;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000)
		throw new Error("Invalid Jev deadline");
	const controller = new AbortController();
	let reason: TransportFailure = "timeout";
	const cancel = () => {
		reason = "cancelled";
		controller.abort();
	};
	options.signal?.addEventListener("abort", cancel, { once: true });
	if (options.signal?.aborted) cancel();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const done = (
		result:
			| { ok: true; payload: unknown }
			| { ok: false; reason: TransportFailure; status?: number },
	): TransportResult => ({
		...result,
		attempts,
		latencyMs: performance.now() - started,
		reservedUsd: attempts * JEV_ATTEMPT_RESERVATION_USD,
	});
	const race = <T>(promise: Promise<T>): Promise<T> =>
		new Promise((resolve, reject) => {
			const abort = () => reject(new Error("aborted"));
			if (controller.signal.aborted) {
				reject(new Error("aborted"));
				return;
			}
			controller.signal.addEventListener("abort", abort, { once: true });
			promise
				.then(resolve, reject)
				.finally(() => controller.signal.removeEventListener("abort", abort));
		});
	try {
		const encoded = JSON.stringify(body);
		if (Buffer.byteLength(encoded) > JEV_MAX_REQUEST_BYTES)
			return done({ ok: false, reason: "oversize" });
		for (let index = 0; index < 3; index++) {
			if (controller.signal.aborted) return done({ ok: false, reason });
			if (!options.budget.reserve())
				return done({ ok: false, reason: "budget" });
			attempts++;
			const response = await race(
				(options.transport ?? fetch)(JEV_ENDPOINT, {
					method: "POST",
					redirect: "error",
					headers: {
						Authorization: `Bearer ${options.apiKey}`,
						"Content-Type": "application/json",
					},
					body: encoded,
					signal: controller.signal,
				}),
			);
			if (!response.ok) {
				await race(response.body?.cancel() ?? Promise.resolve());
				if (
					(response.status === 429 ||
						response.status === 529 ||
						response.status === 503) &&
					index < 2
				) {
					const retry = response.headers.get("retry-after");
					const retryDate = retry ? Date.parse(retry) : Number.NaN;
					const delay =
						retry && /^\d+(\.\d+)?$/.test(retry)
							? Number(retry) * 1000
							: Number.isFinite(retryDate)
								? Math.max(0, retryDate - Date.now())
								: 100 * 2 ** index;
					if (delay >= timeoutMs - (performance.now() - started))
						return done({ ok: false, reason: "timeout" });
					await race(
						new Promise<void>((resolve) => {
							const handle = setTimeout(resolve, delay);
							controller.signal.addEventListener(
								"abort",
								() => clearTimeout(handle),
								{ once: true },
							);
						}),
					);
					continue;
				}
				return done({ ok: false, reason: "http", status: response.status });
			}
			const length = Number(response.headers.get("content-length"));
			if (length > JEV_MAX_RESPONSE_BYTES) {
				void response.body?.cancel().catch(() => {});
				return done({ ok: false, reason: "oversize" });
			}
			if (!response.body) return done({ ok: false, reason: "malformed" });
			const reader = response.body.getReader();
			let size = 0;
			const chunks: Uint8Array[] = [];
			try {
				while (true) {
					const next = await race(reader.read());
					if (next.done) break;
					size += next.value.byteLength;
					if (size > JEV_MAX_RESPONSE_BYTES) {
						void reader.cancel().catch(() => {});
						return done({ ok: false, reason: "oversize" });
					}
					chunks.push(next.value);
				}
			} finally {
				if (controller.signal.aborted) void reader.cancel().catch(() => {});
			}
			try {
				return done({
					ok: true,
					payload: JSON.parse(
						Buffer.concat(chunks).toString("utf8"),
					) as unknown,
				});
			} catch {
				return done({ ok: false, reason: "malformed" });
			}
		}
		return done({ ok: false, reason: "http" });
	} catch {
		return done({
			ok: false,
			reason: controller.signal.aborted ? reason : "transport",
		});
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", cancel);
	}
}
