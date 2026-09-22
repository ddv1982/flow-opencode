import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { resolveWorkspaceRoot } from "../../src/infrastructure/fs/workspace-paths.js";
import { createFlowPlugin } from "../../src/platform/opencode/plugin-composition.js";
import { CapturingRecoveryController } from "./capture.js";

const Options = z.object({ captureDirectory: z.string().min(1) }).strict();
const CapturePlugin: Plugin = async (context, input) => {
	const options = Options.parse(input);
	const recovery = await CapturingRecoveryController.create(
		resolveWorkspaceRoot(context),
		options.captureDirectory,
	);
	return createFlowPlugin({
		entryUrl: import.meta.url,
		createRecovery: () => recovery,
	})(context);
};
export default CapturePlugin;
