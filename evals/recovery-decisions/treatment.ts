import { z } from "zod";
import {
	type EpisodeReservationScope,
	EpisodeReservationScopeSchema,
	requestBudgetStatus,
} from "./request-budget.js";

export const SimulationScriptSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("guarded-reset-v1"),
			outcome: z.enum(["accepted", "subthreshold"]),
		})
		.strict(),
	z.object({ kind: z.literal("operator-resume-v1") }).strict(),
	z.object({ kind: z.literal("recovery-operator-v1") }).strict(),
]);
export const SimulationTreatmentSchema = z
	.object({
		origin: z.literal("simulation"),
		arm: z.enum(["manager-only", "manager-plus-jev"]),
		script: SimulationScriptSchema,
	})
	.strict();
export const RecoveryTreatmentSchema = z.discriminatedUnion("origin", [
	SimulationTreatmentSchema,
	z
		.object({
			origin: z.literal("live"),
			arm: z.enum(["manager-only", "manager-plus-jev"]),
		})
		.strict(),
]);
export const ExperimentalLiveProfile = Object.freeze({
	id: "isolated-live-evaluation-v1",
	model: "jev-1.13.0" as const,
	rubric: "recovery-v1" as const,
	policy: "bounded-recovery-v1" as const,
	choice: 0.9,
	goal: 0.95,
	suitability: 0.95,
});
export async function validateLiveTreatmentBudget(budget: {
	directory: string;
	authorizationDigest: string;
	managerModel: string;
	scope: EpisodeReservationScope;
}) {
	EpisodeReservationScopeSchema.parse(budget.scope);
	const status = await requestBudgetStatus(budget.directory);
	const models = status.authorization.models.map((row) => row.model);
	if (
		status.authorization.origin !== "live" ||
		status.cancelled ||
		status.authorizationDigest !== budget.authorizationDigest ||
		Date.parse(status.authorization.expiresAt) <= Date.now() ||
		!["openai/gpt-5.6-terra", "xai/grok-4.6"].includes(budget.managerModel) ||
		!models.some((model) => model === budget.managerModel) ||
		models.some(
			(model) =>
				model !== budget.managerModel && model !== "typesafe/jev-1.13.0",
		) ||
		(budget.scope.arm === "manager-plus-jev" &&
			!models.includes("typesafe/jev-1.13.0")) ||
		(budget.scope.arm === "manager-only" &&
			models.includes("typesafe/jev-1.13.0"))
	)
		throw new Error("Live evaluation authorization unavailable.");
	return status;
}
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
				scope?: EpisodeReservationScope | undefined;
		  }
		| undefined,
) {
	RecoveryTreatmentSchema.parse(treatment);
	if (!budget) throw new Error("Isolated treatment requires a request budget.");
	if (treatment.origin === "live") {
		const scope = EpisodeReservationScopeSchema.parse(budget.scope);
		if (scope.arm !== treatment.arm)
			throw new Error("Treatment arm differs from reservation scope.");
		return validateLiveTreatmentBudget({ ...budget, scope });
	}
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
