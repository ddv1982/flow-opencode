import {
	FLOW_MODEL_ROLES,
	type FlowModelRole,
	modelChoices,
	modelPreference,
	modelPreferencePatch,
} from "./platform/opencode/model-picker.js";
import type { TuiPlugin, TuiPluginModule } from "./platform/opencode/sdk.js";

const tui: TuiPlugin = async (api) => {
	let saving = false;
	const error = (cause: unknown) =>
		api.ui.toast({
			variant: "error",
			title: "Flow models",
			message:
				cause instanceof Error
					? cause.message
					: "Could not update Flow model settings.",
		});
	const open = async (role: FlowModelRole) => {
		const setting = FLOW_MODEL_ROLES[role];
		if (saving || api.lifecycle.signal.aborted) return;
		try {
			if (!api.state.ready)
				throw new Error("OpenCode is still syncing. Try again shortly.");
			const directory = api.state.path.directory;
			const [global, providers] = await Promise.all([
				api.client.global.config.get({ throwOnError: true }),
				api.client.provider.list({ directory }, { throwOnError: true }),
			]);
			if (!global.data || !providers.data)
				throw new Error(
					"OpenCode configuration or model catalog is unavailable.",
				);
			const config = global.data;
			modelPreference(config, role);
			const choices = [
				{
					title: "Use default",
					value: "",
					category: "Default",
					description: setting.defaultDescription,
				},
				...modelChoices(providers.data.all, providers.data.connected),
			];
			const current = modelPreference(config, role) ?? "";
			if (current && !choices.some((choice) => choice.value === current)) {
				const unavailable = {
					title: current,
					value: current,
					category: "Current preference",
					description: "Unavailable here; reconnect or choose another model",
					disabled: true,
				};
				choices.unshift(unavailable);
			}
			api.ui.dialog.replace(() =>
				api.ui.DialogSelect({
					title: `Flow ${setting.title} · global default`,
					placeholder: "Search connected models",
					current,
					options: choices,
					onSelect: ({ value }) => {
						if (saving || api.lifecycle.signal.aborted) return;
						if (value === (modelPreference(config, role) ?? "")) {
							api.ui.dialog.clear();
							return;
						}
						api.ui.dialog.replace(() =>
							api.ui.DialogConfirm({
								title: `Save Flow ${setting.title}?`,
								message: `${value || "Use configured default"}\n\nChanges the global Flow ${setting.title} and reloads OpenCode server instances. Finish work in other projects first. Project picker preferences take precedence. Picker selections use the model’s default reasoning. Use default to restore this role’s default behavior. The coding model stays under OpenCode’s normal model selection.`,
								onCancel: () => api.ui.dialog.clear(),
								onConfirm: () => {
									if (saving || api.lifecycle.signal.aborted) return;
									saving = true;
									void (async () => {
										try {
											const [latest, status, catalog] = await Promise.all([
												api.client.global.config.get({ throwOnError: true }),
												api.client.session.status(
													{ directory },
													{ throwOnError: true },
												),
												api.client.provider.list(
													{ directory },
													{ throwOnError: true },
												),
											]);
											if (!latest.data || !status.data || !catalog.data)
												throw new Error(
													"Could not verify current settings and session activity.",
												);
											if (
												Object.values(status.data).some(
													(session) => session.type !== "idle",
												)
											)
												throw new Error(
													"Wait for this project's active work to finish before changing Flow models.",
												);
											if (
												modelPreference(latest.data, role) !==
												modelPreference(config, role)
											)
												throw new Error(
													"Model preference changed while the picker was open. Open it again.",
												);
											if (
												value &&
												!modelChoices(
													catalog.data.all,
													catalog.data.connected,
												).some((choice) => choice.value === value)
											)
												throw new Error(
													"That model is no longer available from a connected provider.",
												);
											if (api.lifecycle.signal.aborted) return;
											if (api.state.path.directory !== directory)
												throw new Error(
													"Project changed while the picker was open. Open it again.",
												);
											if (value !== (modelPreference(latest.data, role) ?? ""))
												await api.client.global.config.update(
													{ config: modelPreferencePatch(role, value) },
													{ throwOnError: true },
												);
											api.ui.dialog.clear();
											api.ui.toast({
												variant: "success",
												title: `Flow ${setting.title} saved`,
												message:
													"Global preference saved. Use /flow-status after reload to check the effective models.",
											});
										} catch (cause) {
											error(cause);
										} finally {
											saving = false;
										}
									})();
								},
							}),
						);
					},
				}),
			);
		} catch (cause) {
			error(cause);
		}
	};
	api.keymap.registerLayer({
		commands: [
			{
				name: "flow.models.select",
				title: "Flow: Model settings",
				category: "Flow",
				namespace: "palette",
				slashName: "flow-models",
				run: () => {
					if (saving || api.lifecycle.signal.aborted) return;
					api.ui.dialog.replace(() =>
						api.ui.DialogSelect({
							title: "Flow model settings",
							options: (Object.keys(FLOW_MODEL_ROLES) as FlowModelRole[]).map(
								(role) => ({
									title:
										role === "planning" ? "Planning specialist" : "Reviewer",
									value: role,
									description: FLOW_MODEL_ROLES[role].defaultDescription,
								}),
							),
							onSelect: ({ value }) => {
								void open(value);
							},
						}),
					);
				},
			},
		],
	});
};

export default {
	id: "opencode-plugin-flow.model-picker",
	tui,
} satisfies TuiPluginModule;
