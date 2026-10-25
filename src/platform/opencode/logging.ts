type FlowLogLevel = "info" | "warn" | "error";
const MAX_FLOW_LOG_EXTRA_BYTES = 8 * 1024;

export function createFlowLog(_ctx?: unknown) {
	return (
		level: FlowLogLevel,
		message: string,
		extra?: Readonly<Record<string, unknown>>,
	): void => {
		try {
			const serialized = extra ? JSON.stringify(extra) : undefined;
			const suffix =
				serialized && Buffer.byteLength(serialized) <= MAX_FLOW_LOG_EXTRA_BYTES
					? ` ${serialized}`
					: "";
			process.stderr.write(
				`[opencode-plugin-flow] [${level}] ${message}${suffix}\n`,
			);
		} catch {}
	};
}
