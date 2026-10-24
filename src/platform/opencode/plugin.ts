import { RecoveryController } from "../../application/recovery-policy.js";
import { createJevDecisionProvider } from "../../infrastructure/jev-decision-provider.js";
import { createFlowLog } from "./logging.js";
import { createFlowPlugin } from "./plugin-composition.js";
import { Plugin } from "./sdk.js";
import { resolveTypesafeApiKeyReader } from "./typesafe-key-env.js";

export default Plugin.define({
	id: "opencode-plugin-flow",
	setup(ctx) {
		const log = createFlowLog(ctx);
		const selectedKey = resolveTypesafeApiKeyReader({
			pluginOptions: ctx.options,
			onWarning: (warning) => log("warn", warning),
		});
		const recovery = ctx.options.recovery;
		const recoveryOff =
			typeof recovery === "object" &&
			recovery !== null &&
			"mode" in recovery &&
			recovery.mode === "off";
		const readApiKey = recoveryOff ? () => undefined : selectedKey;
		return createFlowPlugin({
			entryUrl: import.meta.url,
			defaultRecovery: () =>
				readApiKey() ? { mode: "shadow", maxCalls: 6, maxUsd: 0.02 } : null,
			createRecovery: () =>
				new RecoveryController(createJevDecisionProvider(readApiKey)),
		}).setup(ctx);
	},
});
