import {
	applyFlowConfig,
	type MutableFlowConfig,
} from "../../config-shared.js";
import { createFlowLog } from "./logging.js";

export function createConfigHook(ctx: unknown) {
	const log = createFlowLog(ctx);
	return async (config: MutableFlowConfig) => {
		applyFlowConfig(config, {
			onCollision: (kind, name) => {
				log(
					"warn",
					`Flow replaced a user-defined ${kind} named '${name}'. Flow reserves this ${kind} id while the plugin is enabled; rename the local ${kind} to keep it.`,
				);
			},
		});
	};
}
