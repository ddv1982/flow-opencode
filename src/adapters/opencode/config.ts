import { applyFlowConfig, type MutableFlowConfig } from "../../config-shared";

export {
	applyFlowConfig,
	createFlowCoreConfigEntries,
} from "../../config-shared";

export function createConfigHook(_ctx: unknown) {
	return async (config: MutableFlowConfig) => {
		applyFlowConfig(config);
	};
}
