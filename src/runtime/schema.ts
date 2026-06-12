// Flow runtime schema public barrel: stable exports for runtime-owned schema subdomains.

import type { z } from "zod";
import type {
	FeatureSchema,
	PackageManagerSchema,
	PlanArgsSchema,
	PlanningContextSchema,
	PlanSchema,
	ReviewFindingPlanningContextSchema,
} from "./schema-plan";
import type {
	FinalReviewerDecisionSchema,
	FlowReviewRecordFeatureArgsSchema,
	ReviewerDecisionSchema,
} from "./schema-review-decisions";
import type {
	LatestFailedFlowAttemptSchema,
	WorkerResultArgsSchema,
	WorkerResultSchema,
} from "./schema-worker-result";

export { EvidencePacketSchema } from "./schema-evidence-packets";
export {
	FeatureSchema,
	PackageManagerSchema,
	PlanArgsSchema,
	PlanningContextArgsSchema,
	PlanningContextSchema,
	PlanSchema,
	ReviewFindingPlanningContextSchema,
	SessionStatusSchema,
} from "./schema-plan";
export {
	FinalReviewerDecisionSchema,
	FlowReviewRecordFeatureArgsSchema,
	ReviewerDecisionSchema,
} from "./schema-review-decisions";
export { type Session, SessionSchema } from "./schema-session";
export {
	LatestFailedFlowAttemptSchema,
	WorkerResultArgsSchema,
	WorkerResultBaseSchema,
	WorkerResultSchema,
} from "./schema-worker-result";
export { OutcomeSchema } from "./schema-worker-result-shared";

export type Feature = z.infer<typeof FeatureSchema>;
export type FlowReviewRecordFeatureArgs = z.input<
	typeof FlowReviewRecordFeatureArgsSchema
>;
export type FlowReviewRecordFinalArgs = z.input<
	typeof FinalReviewerDecisionSchema
>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanInput = z.input<typeof PlanSchema>;
export type PlanArgs = z.input<typeof PlanArgsSchema>;
export type PlanningContext = z.infer<typeof PlanningContextSchema>;
export type ReviewFindingPlanningContext = z.infer<
	typeof ReviewFindingPlanningContextSchema
>;
export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type ReviewerDecision = z.infer<typeof ReviewerDecisionSchema>;
export type LatestFailedFlowAttempt = z.infer<
	typeof LatestFailedFlowAttemptSchema
>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
export type WorkerResultArgs = z.input<typeof WorkerResultArgsSchema>;
