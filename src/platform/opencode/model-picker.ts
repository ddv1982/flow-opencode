import type { FlowReviewerConfiguration } from "../../config-shared.js";
import type { Provider } from "./sdk.js";

export function modelChoices(
	providers: readonly Provider[],
	connected: readonly string[],
) {
	const enabled = new Set(connected);
	return providers
		.filter((provider) => enabled.has(provider.id))
		.flatMap((provider) =>
			Object.values(provider.models)
				.filter(
					(model) =>
						model.capabilities.toolcall &&
						model.capabilities.input.text &&
						model.capabilities.output.text &&
						model.status !== "deprecated",
				)
				.map((model) => ({
					title: model.name,
					value: `${provider.id}/${model.id}`,
					category: provider.name,
					description: `${provider.id}/${model.id}`,
				})),
		)
		.sort(
			(a, b) =>
				a.category.localeCompare(b.category) ||
				a.title.localeCompare(b.title) ||
				a.value.localeCompare(b.value),
		);
}

export const FLOW_MODEL_ROLES = {
	planning: {
		agent: "flow-planner",
		key: "flowPlanningModel",
		title: "planning specialist",
		defaultDescription:
			"The coding manager plans directly, without a specialist",
	},
	review: {
		agent: "flow-reviewer",
		key: "flowReviewerModel",
		title: "reviewer",
		defaultDescription:
			"Existing plugin/environment settings, otherwise the coding model",
	},
} as const;
export type FlowModelRole = keyof typeof FLOW_MODEL_ROLES;

export function modelPreference(
	config: { agent?: Record<string, unknown> },
	role: FlowModelRole,
): string | undefined {
	const setting = FLOW_MODEL_ROLES[role];
	const agent = config.agent?.[setting.agent];
	if (!agent || typeof agent !== "object" || !("options" in agent))
		return undefined;
	const options = agent.options;
	if (!options || typeof options !== "object" || !(setting.key in options))
		return undefined;
	const value = (options as Record<string, unknown>)[setting.key];
	if (typeof value !== "string")
		throw new Error(`Flow ${setting.title} preference must be a string.`);
	return value.trim();
}

export function modelPreferencePatch(role: FlowModelRole, model: string) {
	const setting = FLOW_MODEL_ROLES[role];
	return { agent: { [setting.agent]: { options: { [setting.key]: model } } } };
}

export function applyReviewerPreference(
	base: FlowReviewerConfiguration,
	model: string | undefined,
): FlowReviewerConfiguration {
	return model
		? {
				model: { kind: "explicit", source: "picker", value: model },
				steps: base.steps,
			}
		: base;
}
