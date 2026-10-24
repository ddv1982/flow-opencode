export type FlowModelRole = "planning" | "review";
type PickerModel = Readonly<{ providerID: string; id: string }>;
export type PickerChoice =
	| Readonly<{ kind: "default" }>
	| Readonly<{ kind: "model"; model: PickerModel }>;
export type RoleChoices = Readonly<Record<FlowModelRole, PickerChoice>>;
export type ProjectPreferences = Readonly<
	Partial<Record<FlowModelRole, PickerChoice | undefined>>
>;
export type StoredModelPreferences = Readonly<{
	schemaVersion: 1;
	revision: number;
	roles: RoleChoices;
}>;
export type EffectivePreference = Readonly<{
	choice: PickerChoice;
	source: "project" | "global-picker" | "role-default";
}>;
export type PickerSnapshot = Readonly<{
	location: Readonly<{ directory: string; workspaceID?: string | undefined }>;
	revision: number;
	global: RoleChoices;
	project: ProjectPreferences;
	effective: Readonly<Record<FlowModelRole, EffectivePreference>>;
}>;
export type SaveModelPreference = Readonly<{
	role: FlowModelRole;
	expectedRevision: number;
	expectedProject: ProjectPreferences;
	choice: PickerChoice;
}>;
export type SaveModelPreferenceResult =
	| Readonly<{ kind: "saved" | "unchanged"; snapshot: PickerSnapshot }>
	| Readonly<{
			kind: "refused";
			reason:
				| "busy"
				| "stale-preference"
				| "stale-project"
				| "unavailable-model"
				| "unloaded";
	  }>;
