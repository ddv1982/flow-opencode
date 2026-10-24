import type { ModelInfo, ProviderInfo } from "@opencode/client";
import type {
	EffectivePreference,
	FlowModelRole,
	PickerChoice,
	ProjectPreferences,
	RoleChoices,
} from "../../application/model-preferences.js";
import type { FlowReviewerConfiguration } from "../../config-shared.js";

export type { FlowModelRole } from "../../application/model-preferences.js";
export const FLOW_MODEL_ROLES = {
	planning: {
		title: "planning specialist",
		defaultDescription:
			"The coding manager plans directly, without a specialist",
	},
	review: {
		title: "reviewer",
		defaultDescription:
			"Existing plugin/environment settings, otherwise the coding model",
	},
} as const;
export type PickerCatalogModel = Pick<
	ModelInfo,
	"id" | "providerID" | "name" | "enabled" | "status"
> & {
	capabilities: Pick<ModelInfo["capabilities"], "tools" | "input" | "output">;
};
export function choiceKey(choice: PickerChoice): string {
	return choice.kind === "default"
		? ""
		: `${choice.model.providerID}/${choice.model.id}`;
}
export function sameChoice(left: PickerChoice, right: PickerChoice) {
	return left.kind === "default"
		? right.kind === "default"
		: right.kind === "model" &&
				left.model.providerID === right.model.providerID &&
				left.model.id === right.model.id;
}
export function sameProject(
	left: ProjectPreferences,
	right: ProjectPreferences,
) {
	return (["planning", "review"] as const).every((role) => {
		const a = left[role];
		const b = right[role];
		return a === undefined
			? b === undefined
			: b !== undefined && sameChoice(a, b);
	});
}
export function resolvePreference(
	global: RoleChoices,
	project: ProjectPreferences,
	role: FlowModelRole,
): EffectivePreference {
	const override = project[role];
	if (override) return { choice: override, source: "project" };
	const choice = global[role];
	return {
		choice,
		source: choice.kind === "model" ? "global-picker" : "role-default",
	};
}
export function modelChoices(
	models: readonly PickerCatalogModel[],
	providers: readonly Pick<ProviderInfo, "id" | "name">[],
) {
	const names = new Map(
		providers.map((provider) => [provider.id, provider.name]),
	);
	return models
		.filter(
			(model) =>
				model.enabled &&
				model.status !== "deprecated" &&
				model.capabilities.tools &&
				model.capabilities.input.includes("text") &&
				model.capabilities.output.includes("text"),
		)
		.map((model) => ({
			title: model.name,
			value: {
				kind: "model",
				model: { providerID: model.providerID, id: model.id },
			} satisfies PickerChoice,
			category: names.get(model.providerID) ?? model.providerID,
			description: `${model.providerID}/${model.id}`,
		}))
		.sort(
			(a, b) =>
				a.category.localeCompare(b.category) ||
				a.title.localeCompare(b.title) ||
				a.description.localeCompare(b.description),
		);
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
