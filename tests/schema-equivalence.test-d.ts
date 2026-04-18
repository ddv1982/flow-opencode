import type { z } from "zod";
import type {
	FlowReviewRecordFeatureArgs,
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFinalArgs,
	FlowReviewRecordFinalArgsSchema,
	PlanArgs,
	PlanArgsSchema,
	PlanningContextArgs,
	PlanningContextArgsSchema,
	ReviewerDecision,
	WorkerResultArgs,
	WorkerResultArgsSchema,
} from "../src/runtime/schema";
import type { Equal, Expect } from "../src/types/typecheck";

export type _planArgsMatchesPlan = Expect<
	Equal<z.input<typeof PlanArgsSchema>, PlanArgs>
>;

export type _planningContextArgsMatchesPlanningContext = Expect<
	Equal<z.input<typeof PlanningContextArgsSchema>, PlanningContextArgs>
>;

export type _workerResultArgsMatchesWorkerResult = Expect<
	Equal<z.input<typeof WorkerResultArgsSchema>, WorkerResultArgs>
>;

export type _featureReviewArgsMatchReviewerDecision = Expect<
	Equal<
		z.input<typeof FlowReviewRecordFeatureArgsSchema>,
		FlowReviewRecordFeatureArgs
	>
>;

export type _finalReviewArgsMatchReviewerDecision = Expect<
	Equal<
		z.input<typeof FlowReviewRecordFinalArgsSchema>,
		FlowReviewRecordFinalArgs
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
