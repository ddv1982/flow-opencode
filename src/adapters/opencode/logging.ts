export type FlowLogLevel = "debug" | "info" | "warn" | "error";

type PluginLogContext = {
	client?: {
		app?: {
			log(options: {
				body: { service: string; level: FlowLogLevel; message: string };
			}): unknown;
		};
	};
};

// The SDK's app.log is a class method that reads this._client, so it must be
// called through the app object. The entry also travels as options.body.
// Logging stays best-effort: it must never break plugin initialization.
export function createFlowLog(
	ctx: unknown,
): (level: FlowLogLevel, message: string) => void {
	const app = (ctx as PluginLogContext).client?.app;
	if (!app) {
		return () => {};
	}
	return (level, message) => {
		try {
			void Promise.resolve(
				app.log({
					body: { service: "opencode-plugin-flow", level, message },
				}),
			).catch(() => {});
		} catch {
			// Host log transport failures must not break Flow.
		}
	};
}
