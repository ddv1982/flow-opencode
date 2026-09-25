import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { RecoveryController } from "../../src/application/recovery-policy.js";
import { createJevDecisionProvider } from "../../src/infrastructure/jev-decision-provider.js";
import { createFlowPlugin } from "../../src/platform/opencode/plugin-composition.js";
import { EpisodeReservationScopeSchema } from "./request-budget.js";
import { datasetDigest } from "./schema.js";
import {
	ExperimentalProfile,
	RecoveryTreatmentSchema,
	validateTreatmentBudget,
} from "./treatment.js";

const Options = z
	.object({
		treatment: RecoveryTreatmentSchema,
		budget: z
			.object({
				directory: z.string().min(1),
				scope: EpisodeReservationScopeSchema.optional(),
				authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
				managerModel: z.enum(["openai/gpt-5.6-terra", "xai/grok-4.6"]),
			})
			.strict(),
		readyPath: z.string().min(1),
		budgetReadyPath: z.string().min(1),
	})
	.strict();
const TreatmentPlugin: Plugin = async (context, input) => {
	const options = Options.parse(input);
	await validateTreatmentBudget(options.treatment, options.budget);
	const gate = z
		.object({
			pid: z.number(),
			scopeDigest: z.string().nullable(),
			authorizationDigest: z.string(),
			scriptDigest: z.string(),
			origin: z.literal("simulation"),
		})
		.parse(JSON.parse(await readFile(options.budgetReadyPath, "utf8")));
	if (
		gate.pid !== process.pid ||
		gate.scopeDigest !==
			(options.budget.scope ? datasetDigest(options.budget.scope) : null) ||
		gate.authorizationDigest !== options.budget.authorizationDigest ||
		gate.scriptDigest !== datasetDigest(options.treatment.script)
	)
		throw new Error("Simulation gate is not installed in this process.");
	const hooks = await createFlowPlugin({
		entryUrl: import.meta.url,
		createRecovery: () =>
			new RecoveryController(
				createJevDecisionProvider(() => "simulation-jev-credential"),
				options.treatment.arm === "manager-plus-jev"
					? { profiles: [ExperimentalProfile] }
					: {},
			),
	})(context);
	try {
		await writeExclusive(options.readyPath, {
			origin: "simulation",
			arm: options.treatment.arm,
			pid: process.pid,
			authorizationDigest: options.budget.authorizationDigest,
			treatmentDigest: datasetDigest(options.treatment),
			pluginEntrySha256: createHash("sha256")
				.update(await readFile(fileURLToPath(import.meta.url)))
				.digest("hex"),
		});
	} catch (error) {
		await hooks.dispose?.();
		throw error;
	}
	return hooks;
};
export default TreatmentPlugin;
