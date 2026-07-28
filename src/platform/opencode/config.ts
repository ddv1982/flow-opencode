import {
	applyFlowConfig,
	type MutableFlowConfig,
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
		applyFlowConfig(config, {
			onWarning: (warning) => log("warn", warning),
			onNotice: (notice) => log("info", notice),
			onCollision: (kind, name) =>
				log(
					"warn",
					`Flow replaced a user-defined ${kind} named '${name}'; rename the local entry while Flow is enabled.`,
				),
		});
	};
}
