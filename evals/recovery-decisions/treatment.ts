import { z } from "zod";
import { requestBudgetStatus } from "./request-budget.js";

export const SimulationScriptSchema = z
	.object({
		kind: z.literal("guarded-reset-v1"),
		outcome: z.enum(["accepted", "subthreshold"]),
	})
	.strict();
export const RecoveryTreatmentSchema = z
	.object({
		origin: z.literal("simulation"),
		arm: z.enum(["manager-only", "manager-plus-jev"]),
		script: SimulationScriptSchema,
	})
	.strict();
export type RecoveryTreatment = z.infer<typeof RecoveryTreatmentSchema>;
export const ExperimentalProfile = Object.freeze({
	id: "isolated-simulation-v1",
	model: "jev-1.13.0" as const,
	rubric: "recovery-v1" as const,
	policy: "bounded-recovery-v1" as const,
	choice: 0.9,
	goal: 0.95,
	suitability: 0.95,
});
export async function validateTreatmentBudget(
	treatment: RecoveryTreatment,
	budget:
		| {
				directory: string;
				authorizationDigest: string;
				managerModel: string;
		  }
		| undefined,
) {
	RecoveryTreatmentSchema.parse(treatment);
	if (!budget) throw new Error("Isolated treatment requires a request budget.");
	const status = await requestBudgetStatus(budget.directory);
	if (
		status.authorization.origin !== "simulation" ||
		status.cancelled ||
		status.authorizationDigest !== budget.authorizationDigest ||
		Date.parse(status.authorization.expiresAt) <= Date.now() ||
		![budget.managerModel, "typesafe/jev-1.13.0"].every((model) =>
			status.authorization.models.some((row) => row.model === model),
		)
	)
		throw new Error("Invalid simulation treatment authorization.");
	if (!["openai/gpt-5.6-terra", "xai/grok-4.6"].includes(budget.managerModel))
		throw new Error("Unsupported simulation manager.");
	return status;
}
