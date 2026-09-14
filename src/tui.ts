import {
	reviewerChoices,
	reviewerPreference,
	reviewerPreferencePatch,
} from "./platform/opencode/reviewer-picker.js";
import type { TuiPlugin, TuiPluginModule } from "./platform/opencode/sdk.js";

const tui: TuiPlugin = async (api) => {
	let saving = false;
	const error = (cause: unknown) =>
		api.ui.toast({
			variant: "error",
			title: "Flow reviewer",
			message:
				cause instanceof Error
					? cause.message
					: "Could not update reviewer settings.",
		});
	const open = async () => {
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
			reviewerPreference(config);
			const choices = [
				{
					title: "Use default",
					value: "",
					category: "Default",
					description:
						"Existing plugin/environment settings, otherwise the coding model",
				},
				...reviewerChoices(providers.data.all, providers.data.connected),
			];
			const current = reviewerPreference(config) ?? "";
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
					title: "Flow reviewer · global default",
					placeholder: "Search connected models",
					current,
					options: choices,
					onSelect: ({ value }) => {
						if (saving || api.lifecycle.signal.aborted) return;
						if (value === (reviewerPreference(config) ?? "")) {
							api.ui.dialog.clear();
							return;
						}
						api.ui.dialog.replace(() =>
							api.ui.DialogConfirm({
								title: "Save Flow reviewer?",
								message: `${value || "Use configured default"}\n\nChanges the global Flow reviewer and reloads OpenCode server instances. Finish work in other projects first. Project picker preferences take precedence. Picker selections use the model’s default reasoning. Use default to restore plugin/environment settings.`,
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
													"Wait for this project's active work to finish before changing the reviewer.",
												);
											if (
												reviewerPreference(latest.data) !==
												reviewerPreference(config)
											)
												throw new Error(
													"Reviewer preference changed while the picker was open. Open it again.",
												);
											if (
												value &&
												!reviewerChoices(
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
											if (value !== (reviewerPreference(latest.data) ?? ""))
												await api.client.global.config.update(
													{ config: reviewerPreferencePatch(value) },
													{ throwOnError: true },
												);
											api.ui.dialog.clear();
											api.ui.toast({
												variant: "success",
												title: "Flow reviewer saved",
												message:
													"Global preference saved. Use /flow-status after reload to check the effective reviewer.",
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
				name: "flow.reviewer.select",
				title: "Flow: Choose reviewer model",
				category: "Flow",
				namespace: "palette",
				slashName: "flow-reviewer",
				run: open,
			},
		],
	});
};

export default {
	id: "opencode-plugin-flow.reviewer-picker",
	tui,
} satisfies TuiPluginModule;
