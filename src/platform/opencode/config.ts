import {
	applyFlowConfig,
	type FlowReviewerConfiguration,
	type MutableFlowConfig,
} from "../../config-shared.js";
import { createFlowLog } from "./logging.js";
import {
	applyReviewerPreference,
	FLOW_MODEL_ROLES,
	modelPreference,
} from "./model-picker.js";

export function createConfigHook(
	ctx: unknown,
	options?: {
		assertOperational?: (action: string) => void;
		reviewerConfiguration?: FlowReviewerConfiguration | undefined;
		onPlanningModel?: (model: string | undefined) => void;
		onReviewerConfiguration?: (
			configuration: FlowReviewerConfiguration,
		) => void;
	},
) {
	const log = createFlowLog(ctx);
	let preference: string | undefined;
	let planningModel: string | undefined;
	return async (config: MutableFlowConfig) => {
		try {
			options?.assertOperational?.("apply its OpenCode configuration");
		} catch (error) {
			log("error", error instanceof Error ? error.message : String(error));
			return;
		}
		const planning = modelPreference(config, "planning");
		if (planning !== undefined) planningModel = planning || undefined;
		options?.onPlanningModel?.(planningModel);
		const saved = modelPreference(config, "review");
		if (saved !== undefined) preference = saved;
		const reviewer = options?.reviewerConfiguration
			? applyReviewerPreference(options.reviewerConfiguration, preference)
			: undefined;
		if (reviewer) options?.onReviewerConfiguration?.(reviewer);
		for (const { agent, key } of Object.values(FLOW_MODEL_ROLES)) {
			const entry = config.agent?.[agent];
			if (
				!entry ||
				typeof entry !== "object" ||
				Object.keys(entry).length !== 1 ||
				!("options" in entry)
			)
				continue;
			const value = entry.options;
			if (
				value &&
				typeof value === "object" &&
				Object.keys(value).length === 1 &&
				Object.hasOwn(value, key) &&
				typeof Reflect.get(value, key) === "string"
			) {
				config.agent = { ...config.agent };
				delete config.agent[agent];
			}
		}

		applyFlowConfig(config, {
			planningModel,
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
