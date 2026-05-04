import { z } from "zod";
import { NEEDS_INPUT_OUTCOME_KINDS, type OUTCOME_KINDS } from "./constants";

export function isNeedsInputOutcomeKind(
	value: (typeof OUTCOME_KINDS)[number],
): value is (typeof NEEDS_INPUT_OUTCOME_KINDS)[number] {
	return NEEDS_INPUT_OUTCOME_KINDS.includes(
		value as (typeof NEEDS_INPUT_OUTCOME_KINDS)[number],
	);
}

function hasStructuredReplanReason(value: {
	replanReason?: string | undefined;
	failedAssumption?: string | undefined;
	recommendedAdjustment?: string | undefined;
}): boolean {
	return Boolean(
		value.replanReason && value.failedAssumption && value.recommendedAdjustment,
	);
}

export function addReplanRequiredIssueIfNeeded(
	value: {
		status: "ok" | "needs_input";
		outcome?:
			| {
					kind: string;
					replanReason?: string | undefined;
					failedAssumption?: string | undefined;
					recommendedAdjustment?: string | undefined;
			  }
			| undefined;
	},
	context: z.RefinementCtx,
): void {
	if (
		value.status === "needs_input" &&
		value.outcome?.kind === "replan_required" &&
		!hasStructuredReplanReason(value.outcome)
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"replan_required outcomes must include replanReason, failedAssumption, and recommendedAdjustment.",
			path: ["outcome"],
		});
	}
}
