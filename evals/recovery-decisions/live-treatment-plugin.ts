import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { RecoveryController } from "../../src/application/recovery-policy.js";
import { createJevDecisionProvider } from "../../src/infrastructure/jev-decision-provider.js";
import { createFlowPlugin } from "../../src/platform/opencode/plugin-composition.js";
import BudgetPlugin from "./budget-plugin.js";
import { EpisodeReservationScopeSchema } from "./request-budget.js";
import { datasetDigest } from "./schema.js";
import {
	ExperimentalLiveProfile,
	validateLiveTreatmentBudget,
} from "./treatment.js";

const Options = z
	.object({
		origin: z.literal("live"),
		budget: z
			.object({
				directory: z.string().min(1),
				authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
				managerModel: z.enum(["openai/gpt-5.6-terra", "xai/grok-4.6"]),
				scope: EpisodeReservationScopeSchema,
			})
			.strict(),
		readyPath: z.string().min(1),
		budgetReadyPath: z.string().min(1),
	})
	.strict();
const LiveTreatmentPlugin: Plugin = async (context, input) => {
	const options = Options.parse(input);
	const treatment = options.budget.scope.arm === "manager-plus-jev";
	await validateLiveTreatmentBudget(options.budget);
	if (treatment && !process.env.TYPESAFE_API_KEY)
		throw new Error("Live evaluation credential unavailable.");
	const expected = {
		...options.budget,
		controlOrigin: context.serverUrl.origin,
		origin: options.origin,
	};
	await BudgetPlugin(context, {
		directory: options.budget.directory,
		authorizationDigest: options.budget.authorizationDigest,
		scope: options.budget.scope,
		readyPath: options.budgetReadyPath,
	});
	BudgetPlugin.assertInstalledRequestGate(expected);
	const gatedFetch = globalThis.fetch;
	const hooks = await createFlowPlugin({
		entryUrl: import.meta.url,
		createRecovery: () =>
			new RecoveryController(
				treatment
					? createJevDecisionProvider(
							() => {
								BudgetPlugin.assertInstalledRequestGate(expected);
								return process.env.TYPESAFE_API_KEY;
							},
							(url, init) => {
								BudgetPlugin.assertInstalledRequestGate(expected);
								return gatedFetch(url, init);
							},
						)
					: {
							async assess() {
								return { kind: "unavailable", reason: "manager-only" };
							},
						},
				{ profiles: treatment ? [ExperimentalLiveProfile] : [] },
			),
	})(context);
	try {
		BudgetPlugin.assertInstalledRequestGate(expected);
		await writeExclusive(options.readyPath, {
			origin: "live",
			arm: options.budget.scope.arm,
			qualification: "experimental-evaluation",
			pid: process.pid,
			authorizationDigest: options.budget.authorizationDigest,
			scopeDigest: datasetDigest(options.budget.scope),
			profileDigest: treatment ? datasetDigest(ExperimentalLiveProfile) : null,
			pluginEntrySha256: createHash("sha256")
				.update(await readFile(fileURLToPath(import.meta.url)))
				.digest("hex"),
		});
		BudgetPlugin.assertInstalledRequestGate(expected);
	} catch (error) {
		await hooks.dispose?.();
		throw error;
	}
	return hooks;
};
export default LiveTreatmentPlugin;
