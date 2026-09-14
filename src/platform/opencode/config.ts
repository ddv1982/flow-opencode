import {
	applyFlowConfig,
	type FlowReviewerConfiguration,
	type MutableFlowConfig,
} from "../../config-shared.js";
import { createFlowLog } from "./logging.js";
import {
	applyReviewerPreference,
	reviewerPreference,
} from "./reviewer-picker.js";

export function createConfigHook(
	ctx: unknown,
	options?: {
		assertOperational?: (action: string) => void;
		reviewerConfiguration?: FlowReviewerConfiguration | undefined;
		onReviewerConfiguration?: (
			configuration: FlowReviewerConfiguration,
		) => void;
	},
) {
	const log = createFlowLog(ctx);
	let preference: string | undefined;
	return async (config: MutableFlowConfig) => {
		try {
			options?.assertOperational?.("apply its OpenCode configuration");
		} catch (error) {
			log("error", error instanceof Error ? error.message : String(error));
			return;
		}
		const saved = reviewerPreference(config);
		if (saved !== undefined) preference = saved;
		const reviewer = options?.reviewerConfiguration
			? applyReviewerPreference(options.reviewerConfiguration, preference)
			: undefined;
		if (reviewer) options?.onReviewerConfiguration?.(reviewer);
		applyFlowConfig(config, {
			...(reviewer ? { reviewerConfiguration: reviewer } : {}),
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
