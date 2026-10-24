import { Rpc } from "@opencode/plugin/rpc";
import { z } from "zod";
import {
	pickerSnapshotSchema,
	savePreferenceResultSchema,
	savePreferenceSchema,
} from "./application/model-preferences-schema.js";

export const FlowModelPreferencesRpc = Rpc.define({
	id: "flow.model-preferences",
	methods: {
		read: {
			input: { type: "object", properties: {}, additionalProperties: false },
			output: z.toJSONSchema(pickerSnapshotSchema),
		},
		set: {
			input: z.toJSONSchema(savePreferenceSchema),
			output: z.toJSONSchema(savePreferenceResultSchema),
		},
	},
	events: {},
});
