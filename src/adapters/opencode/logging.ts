type FlowLogLevel = "info" | "warn" | "error";

export function createFlowLog(ctx: unknown) {
	const client = (ctx as { client?: { app?: { log?: unknown } } } | null)
		?.client;
	const log = client?.app?.log;
	return (level: FlowLogLevel, message: string): void => {
		if (typeof log !== "function") return;
		try {
			void log.call(client?.app, {
				body: { service: "opencode-plugin-flow", level, message },
			});
		} catch {
			// Logging is best-effort and must never break plugin startup.
		}
	};
}
