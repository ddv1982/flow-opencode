import type { LocationRef, ProviderInfo } from "@opencode/client";
import type { Dialog, Toast } from "@opencode/plugin/tui/context";
import type {
	FlowModelRole,
	PickerChoice,
	PickerSnapshot,
	SaveModelPreference,
	SaveModelPreferenceResult,
} from "../../application/model-preferences.js";
import {
	choiceKey,
	FLOW_MODEL_ROLES,
	modelChoices,
	type PickerCatalogModel,
	sameChoice,
	sameProject,
} from "./model-picker.js";

export interface ModelPickerHost {
	location(): LocationRef;
	read(signal: AbortSignal): Promise<PickerSnapshot>;
	save(
		input: SaveModelPreference,
		location: LocationRef,
		signal: AbortSignal,
	): Promise<SaveModelPreferenceResult>;
	catalog(
		location: LocationRef,
		signal: AbortSignal,
	): Promise<{
		models: readonly PickerCatalogModel[];
		providers: readonly Pick<ProviderInfo, "id" | "name">[];
	}>;
	busy(signal: AbortSignal): Promise<boolean>;
	dialog: Pick<Dialog, "select" | "confirm" | "clear">;
	toast: Toast;
}
const refusalMessages = {
	busy: "Wait for active work to finish before changing Flow models.",
	"stale-preference": "Flow model preferences changed. Open the picker again.",
	"stale-project": "Project model preferences changed. Open the picker again.",
	"unavailable-model":
		"That model is no longer available from a connected provider.",
	unloaded: "Flow model preferences have unloaded.",
};
export function createModelPicker(host: ModelPickerHost) {
	const controller = new AbortController();
	let open = false;
	const sameLocation = (location: LocationRef) => {
		const current = host.location();
		return (
			current.directory === location.directory &&
			current.workspaceID === location.workspaceID
		);
	};
	return {
		async open(): Promise<void> {
			if (open || controller.signal.aborted) return;
			open = true;
			try {
				const location = host.location();
				const role = await host.dialog.select<FlowModelRole>({
					title: "Flow model settings",
					options: (["planning", "review"] as const).map((value) => ({
						title: value === "planning" ? "Planning specialist" : "Reviewer",
						value,
						description: FLOW_MODEL_ROLES[value].defaultDescription,
					})),
				});
				if (!role || controller.signal.aborted) return;
				if (!sameLocation(location))
					throw new Error("Project changed. Open the picker again.");
				const [snapshot, catalog] = await Promise.all([
					host.read(controller.signal),
					host.catalog(location, controller.signal),
				]);
				if (controller.signal.aborted) return;
				if (!sameLocation(location))
					throw new Error("Project changed. Open the picker again.");
				const setting = FLOW_MODEL_ROLES[role];
				const current = snapshot.global[role];
				const options = [
					{
						title: "Use default",
						value: { kind: "default" } satisfies PickerChoice,
						category: "Default",
						description: setting.defaultDescription,
					},
					...modelChoices(catalog.models, catalog.providers),
				];
				const selected = await host.dialog.select<PickerChoice>({
					title: `Flow ${setting.title} · global default`,
					placeholder: "Search connected models",
					current:
						options.find((option) => sameChoice(option.value, current))
							?.value ?? current,
					options: [
						...(current.kind === "model" &&
						!options.some((option) => sameChoice(option.value, current))
							? [
									{
										title: choiceKey(current),
										value: current,
										category: "Current preference",
										description:
											"Unavailable here; reconnect or choose another model",
										disabled: true,
									},
								]
							: []),
						...options,
					],
				});
				if (
					!selected ||
					controller.signal.aborted ||
					sameChoice(current, selected)
				)
					return;
				const override = snapshot.project[role];
				const confirmed = await host.dialog.confirm({
					title: `Save Flow ${setting.title}?`,
					message: `${choiceKey(selected) || "Use configured default"}\n\nChanges the global Flow ${setting.title}. Finish active work in all projects first. ${override ? `This project overrides the global setting with ${choiceKey(override) || "its role default"}. ` : ""}Project options take precedence. Picker models use default reasoning. Use default restores the role's configured model and variant. Your coding model stays unchanged.`,
				});
				if (!confirmed || controller.signal.aborted) return;
				if (!sameLocation(location))
					throw new Error("Project changed. Open the picker again.");
				const [latest, available, busy] = await Promise.all([
					host.read(controller.signal),
					host.catalog(location, controller.signal),
					host.busy(controller.signal),
				]);
				if (controller.signal.aborted) return;
				if (!sameLocation(location))
					throw new Error("Project changed. Open the picker again.");
				if (busy) throw new Error(refusalMessages.busy);
				if (latest.revision !== snapshot.revision)
					throw new Error(refusalMessages["stale-preference"]);
				if (!sameProject(latest.project, snapshot.project))
					throw new Error(refusalMessages["stale-project"]);
				if (
					selected.kind === "model" &&
					!modelChoices(available.models, available.providers).some((option) =>
						sameChoice(option.value, selected),
					)
				)
					throw new Error(refusalMessages["unavailable-model"]);
				const result = await host.save(
					{
						role,
						expectedRevision: snapshot.revision,
						expectedProject: snapshot.project,
						choice: selected,
					},
					location,
					controller.signal,
				);
				if (controller.signal.aborted) return;
				if (result.kind === "refused")
					throw new Error(refusalMessages[result.reason]);
				host.toast.show({
					variant: "success",
					title: `Flow ${setting.title} saved`,
					message:
						"Global preference saved. Use /flow-status to check the effective models.",
				});
			} catch (error) {
				if (!controller.signal.aborted)
					host.toast.show({
						variant: "error",
						title: "Flow models",
						message:
							error instanceof Error
								? error.message
								: "Could not update Flow model settings.",
					});
			} finally {
				open = false;
			}
		},
		dispose() {
			controller.abort();
			if (open) host.dialog.clear();
		},
	};
}
