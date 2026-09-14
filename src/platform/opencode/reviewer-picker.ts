import type { FlowReviewerConfiguration } from "../../config-shared.js";
import type { Provider } from "./sdk.js";

export function reviewerChoices(
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

export function reviewerPreference(config: {
	agent?: Record<string, unknown>;
}): string | undefined {
	const agent = config.agent?.["flow-reviewer"];
	if (!agent || typeof agent !== "object" || !("options" in agent))
		return undefined;
	const options = agent.options;
	if (
		!options ||
		typeof options !== "object" ||
		!("flowReviewerModel" in options)
	)
		return undefined;
	if (typeof options.flowReviewerModel !== "string")
		throw new Error("Flow reviewer preference must be a string.");
	return options.flowReviewerModel.trim();
}

export function reviewerPreferencePatch(model: string) {
	return {
		agent: { "flow-reviewer": { options: { flowReviewerModel: model } } },
	};
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
