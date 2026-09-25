import { RecoveryController } from "../../application/recovery-policy.js";
import { createJevDecisionProvider } from "../../infrastructure/jev-decision-provider.js";
import { createFlowPlugin } from "./plugin-composition.js";

export default createFlowPlugin({
	entryUrl: import.meta.url,
	createRecovery: () =>
		new RecoveryController(
			createJevDecisionProvider(() => process.env.TYPESAFE_API_KEY),
		),
});
