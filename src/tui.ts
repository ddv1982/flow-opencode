import type { LocationRef } from "@opencode/client";
import { define } from "@opencode/plugin/tui/plugin";
import {
	pickerSnapshotSchema,
	savePreferenceResultSchema,
} from "./application/model-preferences-schema.js";
import { FlowModelPreferencesRpc } from "./flow-rpc.js";
import { createModelPicker } from "./platform/opencode/model-picker-ui.js";

export default define({
	id: "opencode-plugin-flow.model-picker",
	setup(ctx) {
		const rpc = ctx.client.rpc(FlowModelPreferencesRpc);
		const location = (): LocationRef =>
			ctx.location ?? ctx.data.location.default();
		const picker = createModelPicker({
			location,
			async read(signal) {
				return pickerSnapshotSchema.parse(
					await rpc.read({}, { location: location(), signal }),
				);
			},
			async save(input, opened, signal) {
				return savePreferenceResultSchema.parse(
					await rpc.set(input, { location: opened, signal }),
				);
			},
			async catalog(opened, signal) {
				const [models, providers] = await Promise.all([
					ctx.client.model.list({ location: opened }, { signal }),
					ctx.client.provider.list({ location: opened }, { signal }),
				]);
				return { models: models.data, providers: providers.data };
			},
			async busy(signal) {
				return (
					Object.keys(await ctx.client.session.active({ signal })).length > 0
				);
			},
			dialog: ctx.ui.dialog,
			toast: ctx.ui.toast,
		});
		ctx.keymap.layer(() => ({
			commands: [
				{
					id: "flow.models.select",
					title: "Flow: Model settings",
					group: "Flow",
					palette: true,
					slash: { name: "flow-models" },
					run: () => picker.open(),
				},
			],
		}));
		return () => picker.dispose();
	},
});
