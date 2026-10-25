import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { resolveWorkspaceRoot } from "../../src/infrastructure/fs/workspace-paths.js";
import { createFlowPlugin } from "../../src/platform/opencode/plugin-composition.js";
import { CapturingRecoveryController } from "./capture.js";

const Options = z
	.object({
		captureDirectory: z.string().min(1),
		reviewer: z.unknown().optional(),
	})
	.strict();
const CapturePlugin = Plugin.define({
	id: "flow-eval-capture",
	async setup(context) {
		const input = context.options;
		const options = Options.parse(input);
		const recovery = await CapturingRecoveryController.create(
			resolveWorkspaceRoot({ directory: context.location.directory }),
			options.captureDirectory,
		);
		return createFlowPlugin({
			entryUrl: import.meta.url,
			createRecovery: () => recovery,
		}).setup({ ...context, options: { reviewer: options.reviewer } });
	},
});
export default CapturePlugin;
