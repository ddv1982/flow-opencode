import type { z } from "zod";
import type {
	PlanArgs,
	PlanArgsSchema,
	PlanningContextArgs,
	PlanningContextArgsSchema,
	ReviewerDecision,
	WorkerResultArgsSchema,
} from "../src/runtime/schema";
import type {
	FlowPlanApplyArgsSchema,
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFinalArgsSchema,
} from "../src/tools/schemas";
import type { Equal, Expect } from "../src/types/typecheck";

type ExpectedFlowPlanApplyArgs = {
	plan: PlanArgs;
	planning?: PlanningContextArgs | undefined;
};

type ExpectedFeatureReviewRecordArgs = {
	scope: "feature";
	featureId: string;
	reviewPurpose?: "execution_gate" | "completion_gate" | undefined;
	status: "approved" | "needs_fix" | "blocked";
	summary: string;
	blockingFindings?: { summary: string }[] | undefined;
	followUps?:
		| {
				summary: string;
				severity?: string | undefined;
		  }[]
		| undefined;
	suggestedValidation?: string[] | undefined;
};

type ExpectedFinalReviewRecordArgs = {
	scope: "final";
	reviewPurpose?: "execution_gate" | "completion_gate" | undefined;
	status: "approved" | "needs_fix" | "blocked";
	summary: string;
	blockingFindings?: { summary: string }[] | undefined;
	followUps?:
		| {
				summary: string;
				severity?: string | undefined;
		  }[]
		| undefined;
	suggestedValidation?: string[] | undefined;
};

export type _planArgsMatchesPlan = Expect<
	Equal<z.input<typeof PlanArgsSchema>, PlanArgs>
>;

export type _planningContextArgsMatchesPlanningContext = Expect<
	Equal<z.input<typeof PlanningContextArgsSchema>, PlanningContextArgs>
>;

export type _flowPlanApplyArgsMatchExpected = Expect<
	Equal<z.input<typeof FlowPlanApplyArgsSchema>, ExpectedFlowPlanApplyArgs>
>;

export type _workerResultArgsIncludesReplanWithoutRequiredOutcomeOmission =
	Expect<
		Equal<
			Extract<
				z.input<typeof WorkerResultArgsSchema>,
				{ status: "needs_input" }
			>["outcome"]["kind"],
			| "completed"
			| "replan_required"
			| "blocked_external"
			| "needs_operator_input"
			| "contract_error"
		>
	>;

export type _featureReviewArgsMatchExpected = Expect<
	Equal<
		z.input<typeof FlowReviewRecordFeatureArgsSchema>,
		ExpectedFeatureReviewRecordArgs
	>
>;

export type _finalReviewArgsMatchExpected = Expect<
	Equal<
		z.input<typeof FlowReviewRecordFinalArgsSchema>,
		ExpectedFinalReviewRecordArgs
	>
>;

export type _reviewerDecisionFeatureSliceStaysAligned =
	Extract<ReviewerDecision, { scope: "feature" }> extends {
		scope: "feature";
		featureId?: string | undefined;
	}
		? true
		: never;

export type _reviewerDecisionFinalSliceStaysAligned =
	Extract<ReviewerDecision, { scope: "final" }> extends {
		scope: "final";
		featureId?: string | undefined;
	}
		? true
		: never;
