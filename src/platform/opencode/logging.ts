type FlowLogLevel = "info" | "warn" | "error";
const MAX_FLOW_LOG_EXTRA_BYTES = 8 * 1024;

function boundedLogExtra(
	extra: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
	if (!extra) return undefined;
	try {
		const serialized = JSON.stringify(extra);
		if (
			new TextEncoder().encode(serialized).byteLength > MAX_FLOW_LOG_EXTRA_BYTES
		) {
			return undefined;
		}
		const parsed = JSON.parse(serialized);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

export function createFlowLog(ctx: unknown) {
	const client = (ctx as { client?: { app?: { log?: unknown } } } | null)
		?.client;
	const log = client?.app?.log;
	return (
		level: FlowLogLevel,
		message: string,
		extra?: Readonly<Record<string, unknown>>,
	): void => {
		if (typeof log !== "function") return;
		try {
			const boundedExtra = boundedLogExtra(extra);
			Promise.resolve(
				log.call(client?.app, {
					body: {
						service: "opencode-plugin-flow",
						level,
						message,
						...(boundedExtra ? { extra: boundedExtra } : {}),
					},
				}),
			).catch(() => {
				// Logging is best-effort; a failed transport must stay silent.
			});
		} catch {
			// Logging is best-effort and must never break plugin startup.
		}
	};
}
