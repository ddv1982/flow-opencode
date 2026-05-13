import type { z } from "zod";
import type {
	FlowPlanApplyArgsSchema,
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFinalArgsSchema,
} from "../src/adapters/opencode/tool-surface/schemas";
import type * as RuntimeSchemaBarrel from "../src/runtime/schema";
import type {
	FlowReviewRecordFeatureArgs,
	FlowReviewRecordFinalArgs,
	PlanArgs,
	PlanArgsSchema,
	PlanningContextArgs,
	PlanningContextArgsSchema,
	ReviewerDecision,
	WorkerResultArgsSchema,
} from "../src/runtime/schema";
import type { Equal, Expect } from "../src/types/typecheck";

type ExpectedFlowPlanApplyArgs = {
	plan: PlanArgs;
	planning?: PlanningContextArgs | undefined;
};

type ExpectedRuntimeSchemaBarrelValueExports =
	| "ApprovalStatusSchema"
	| "ArtifactSchema"
	| "BehaviorCheckResultSchema"
	| "BehaviorCheckSchema"
	| "BehaviorRiskClassSchema"
	| "ClosureSchema"
	| "CompletionPolicySchema"
	| "DecisionSchema"
	| "DecompositionPolicySchema"
	| "DeliveryPolicySchema"
	| "EvidenceConfidenceSchema"
	| "EvidencePacketArraySchema"
	| "EvidencePacketPurposeSchema"
	| "EvidencePacketReferenceArraySchema"
	| "EvidencePacketReferenceSchema"
	| "EvidencePacketSchema"
	| "EvidencePacketValidationRunSchema"
	| "EvidencePacketValidationStatusSchema"
	| "ExecutionHistoryEntrySchema"
	| "FeatureIdSchema"
	| "FeatureResultSchema"
	| "FeatureReviewerDecisionSchema"
	| "FeatureSchema"
	| "FeatureStatusSchema"
	| "FinalReviewSchema"
	| "FinalReviewerDecisionSchema"
	| "FlowContextLaneSchema"
	| "FlowReviewRecordFeatureArgsSchema"
	| "FlowReviewRecordFinalArgsSchema"
	| "GoalModeSchema"
	| "ImplementationApproachSchema"
	| "LatestFailedFlowAttemptSchema"
	| "NoteSchema"
	| "OutcomeKindSchema"
	| "OutcomeSchema"
	| "PackageManagerSchema"
	| "PersistedFinalReviewSchema"
	| "PersistedFinalReviewerDecisionSchema"
	| "PlanArgsSchema"
	| "PlanSchema"
	| "PlanningContextArgsSchema"
	| "PlanningContextSchema"
	| "PlanningDecisionOptionSchema"
	| "PlanningDecisionSchema"
	| "ReplanRecordSchema"
	| "ReviewFindingPlanningContextSchema"
	| "ReviewScopeAccountingStatusSchema"
	| "ReviewScopeLedgerEntrySchema"
	| "ReviewScopeTargetSchema"
	| "ReviewerDecisionSchema"
	| "SessionSchema"
	| "SessionStatusSchema"
	| "StackProfileEntrySchema"
	| "StackProfileSchema"
	| "StandardsGapSchema"
	| "StandardsProfileSchema"
	| "StandardsRuleSchema"
	| "StandardsSourceSchema"
	| "ValidationCoverageSchema"
	| "ValidationRunSchema"
	| "ValidationStatusSchema"
	| "WorkerResultArgsSchema"
	| "WorkerResultBaseSchema"
	| "WorkerResultNeedsInputArgsSchema"
	| "WorkerResultOkArgsSchema"
	| "WorkerResultSchema";

export type _runtimeSchemaBarrelValueExportsStayExplicit = Expect<
	Equal<
		keyof typeof RuntimeSchemaBarrel,
		ExpectedRuntimeSchemaBarrelValueExports
	>
>;

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
		FlowReviewRecordFeatureArgs
	>
>;

export type _finalReviewArgsMatchExpected = Expect<
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
		reviewDepth: "broad" | "detailed";
		featureId?: string | undefined;
	}
		? true
		: never;
