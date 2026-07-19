import {
	applyFlowConfig,
	type MutableFlowConfig,
	resolveFlowHarnessRuntimeConfig,
} from "../../config-shared.js";
import { createFlowLog } from "./logging.js";

export function createConfigHook(
	ctx: unknown,
	options?: { assertOperational?: (action: string) => void },
) {
	const log = createFlowLog(ctx);
	return async (config: MutableFlowConfig) => {
		try {
			options?.assertOperational?.("apply its OpenCode configuration");
		} catch (error) {
			log("error", error instanceof Error ? error.message : String(error));
			return;
		}
		const runtime = resolveFlowHarnessRuntimeConfig();
		for (const warning of runtime.warnings) log("warn", warning);
		log("info", "Flow harness runtime profile selected.", {
			profile: runtime.profile,
			rolloutMode: runtime.rolloutMode,
		});
		applyFlowConfig(config, {
			onWarning: (warning) => log("warn", warning),
			onCollision: (kind, name) => {
				log(
					"warn",
					`Flow replaced a user-defined ${kind} named '${name}'. Flow reserves this ${kind} id while the plugin is enabled; rename the local ${kind} to keep it.`,
				);
			},
		});
	};
}
