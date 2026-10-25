import { mock } from "bun:test";
import assert from "node:assert/strict";
import { Plugin } from "@opencode/plugin";
import { CapturingRecoveryController } from "../../evals/recovery-decisions/capture.js";
import type { RecoveryController } from "../../src/application/recovery-policy.js";
import type { createFlowPlugin as FlowFactory } from "../../src/platform/opencode/plugin-composition.js";

const [workspace, captureDirectory] = process.argv.slice(2);
assert(workspace && captureDirectory);
let injected: RecoveryController | undefined;
let forwarded: unknown;
mock.module("../../src/platform/opencode/plugin-composition.js", () => ({
	createFlowPlugin: (dependencies: Parameters<typeof FlowFactory>[0]) =>
		Plugin.define({
			id: "native-capture-composition-unit",
			setup(context) {
				injected = dependencies.createRecovery();
				forwarded = context.options;
				return () => {
					injected?.revoke();
				};
			},
		}),
}));
const { default: CapturePlugin } = await import(
	"../../evals/recovery-decisions/capture-plugin.js"
);
const reviewer = { model: "provider/independent-reviewer", steps: 80 };
const cleanup: unknown = await Reflect.apply(CapturePlugin.setup, undefined, [
	{
		location: { directory: workspace },
		options: { captureDirectory, reviewer },
	},
]);
try {
	assert(injected instanceof CapturingRecoveryController);
	assert.deepEqual(forwarded, { reviewer });
	console.log(
		JSON.stringify({ pluginId: CapturePlugin.id, forwarded, capturing: true }),
	);
} finally {
	if (typeof cleanup === "function")
		await Reflect.apply(cleanup, undefined, []);
}
