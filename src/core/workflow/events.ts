import type {
	Plan,
	PlanningContext,
	ReviewerDecision,
	Session,
	WorkerResultArgs,
} from "../../runtime/schema";

export type WorkflowEventType =
	| "workflow_started"
	| "planning_context_recorded"
	| "plan_applied"
	| "plan_approved"
	| "plan_features_selected"
	| "run_started"
	| "reviewer_decision_recorded"
	| "run_completed"
	| "feature_reset"
	| "workflow_completed";

export type WorkflowEventBase<Type extends WorkflowEventType> = {
	type: Type;
	recordedAt: string;
};

export type WorkflowStartedEvent = WorkflowEventBase<"workflow_started"> & {
	sessionId: string;
	goal: string;
	planning?: Partial<PlanningContext> | undefined;
};

export type PlanningContextRecordedEvent =
	WorkflowEventBase<"planning_context_recorded"> & {
		planning: Partial<PlanningContext>;
	};

export type PlanAppliedEvent = WorkflowEventBase<"plan_applied"> & {
	plan: Plan;
	planning?: Partial<PlanningContext> | undefined;
};

export type PlanApprovedEvent = WorkflowEventBase<"plan_approved"> & {
	plan: Plan;
};

export type PlanFeaturesSelectedEvent =
	WorkflowEventBase<"plan_features_selected"> & {
		plan: Plan;
	};

export type RunStartedEvent = WorkflowEventBase<"run_started"> & {
	featureId: string;
};

export type ReviewerDecisionRecordedEvent =
	WorkflowEventBase<"reviewer_decision_recorded"> & {
		decision: ReviewerDecision;
	};

export type RunCompletedEvent = WorkflowEventBase<"run_completed"> & {
	featureId: string;
	worker: WorkerResultArgs;
	resultingState: Session;
};

export type FeatureResetEvent = WorkflowEventBase<"feature_reset"> & {
	featureId: string;
	affectedFeatureIds: readonly string[];
	summary: string;
	resultingState: Session;
};

export type WorkflowCompletedEvent = WorkflowEventBase<"workflow_completed"> & {
	summary: string;
};

export type WorkflowEvent =
	| WorkflowStartedEvent
	| PlanningContextRecordedEvent
	| PlanAppliedEvent
	| PlanApprovedEvent
	| PlanFeaturesSelectedEvent
	| RunStartedEvent
	| ReviewerDecisionRecordedEvent
	| RunCompletedEvent
	| FeatureResetEvent
	| WorkflowCompletedEvent;
