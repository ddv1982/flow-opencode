import type {
	PlanArgs,
	PlanningContextArgs,
	ReviewerDecision,
	WorkerResultArgs,
} from "../../workflow/contracts";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	resetFeature,
	selectPlanFeatures,
	startRun,
} from "../../workflow/transitions";
import {
	collectAffectedFeatureIds,
	normalizeAcceptedStateTimestamps,
	normalizePlanningContextPatch,
	rejectTransition,
	requireTransitionPlan,
} from "./commands-helpers";
import type { WorkflowEvent } from "./events";
import {
	acceptWorkflowEvents,
	rejectWorkflowCommand,
	type WorkflowDecision,
} from "./rejections";
import type { WorkflowState } from "./state";

export type WorkflowCommandType =
	| "start_workflow"
	| "record_planning_context"
	| "apply_plan"
	| "approve_plan"
	| "select_plan_features"
	| "start_run"
	| "record_reviewer_decision"
	| "complete_run"
	| "reset_feature";

export type StartWorkflowCommand = {
	type: "start_workflow";
	sessionId: string;
	goal: string;
	planning?: PlanningContextArgs | undefined;
};

export type WorkflowCommand =
	| StartWorkflowCommand
	| {
			type: "record_planning_context";
			planning: PlanningContextArgs;
	  }
	| {
			type: "apply_plan";
			plan: PlanArgs;
			planning?: PlanningContextArgs | undefined;
	  }
	| {
			type: "approve_plan";
			featureIds?: readonly string[] | undefined;
	  }
	| {
			type: "select_plan_features";
			featureIds: readonly string[];
	  }
	| {
			type: "start_run";
			featureId?: string | undefined;
	  }
	| {
			type: "record_reviewer_decision";
			decision: ReviewerDecision;
	  }
	| {
			type: "complete_run";
			worker: WorkerResultArgs;
	  }
	| {
			type: "reset_feature";
			featureId: string;
	  };

export type WorkflowCommandContext = {
	recordedAt: string;
};

function requireState(
	state: WorkflowState | null,
): WorkflowState | WorkflowDecision<WorkflowEvent> {
	return (
		state ??
		rejectWorkflowCommand(
			"missing_session",
			"No active workflow session exists.",
		)
	);
}

export function decideWorkflowCommand(
	state: WorkflowState | null,
	command: WorkflowCommand,
	context: WorkflowCommandContext,
): WorkflowDecision<WorkflowEvent> {
	if (command.type === "start_workflow") {
		if (state) {
			return rejectWorkflowCommand(
				"session_already_exists",
				"A workflow session already exists.",
			);
		}
		return acceptWorkflowEvents([
			{
				type: "workflow_started",
				sessionId: command.sessionId,
				goal: command.goal,
				planning: normalizePlanningContextPatch(command.planning),
				recordedAt: context.recordedAt,
			},
		]);
	}

	const current = requireState(state);
	if (!("version" in current)) {
		return current;
	}

	switch (command.type) {
		case "record_planning_context":
			return acceptWorkflowEvents([
				{
					type: "planning_context_recorded",
					planning: normalizePlanningContextPatch(command.planning) ?? {},
					recordedAt: context.recordedAt,
				},
			]);
		case "apply_plan": {
			const planning = normalizePlanningContextPatch(command.planning);
			const transition = applyPlan(current, command.plan, planning);
			if (!transition.ok) {
				return rejectTransition(transition);
			}
			const plan = requireTransitionPlan(
				transition.value.plan,
				"Plan application did not produce a plan.",
			);
			if (!("summary" in plan)) {
				return plan;
			}
			return acceptWorkflowEvents([
				{
					type: "plan_applied",
					plan,
					planning,
					recordedAt: context.recordedAt,
				},
			]);
		}
		case "approve_plan": {
			const transition = approvePlan(
				current,
				command.featureIds ? [...command.featureIds] : undefined,
			);
			if (!transition.ok) {
				return rejectTransition(transition);
			}
			const plan = requireTransitionPlan(
				transition.value.plan,
				"Plan approval did not produce a plan.",
			);
			if (!("summary" in plan)) {
				return plan;
			}
			return acceptWorkflowEvents([
				{
					type: "plan_approved",
					plan,
					recordedAt: context.recordedAt,
				},
			]);
		}
		case "select_plan_features": {
			const transition = selectPlanFeatures(current, [...command.featureIds]);
			if (!transition.ok) {
				return rejectTransition(transition);
			}
			const plan = requireTransitionPlan(
				transition.value.plan,
				"Feature selection did not produce a plan.",
			);
			if (!("summary" in plan)) {
				return plan;
			}
			return acceptWorkflowEvents([
				{
					type: "plan_features_selected",
					plan,
					recordedAt: context.recordedAt,
				},
			]);
		}
		case "start_run": {
			const transition = startRun(current, command.featureId);
			if (!transition.ok) {
				return rejectTransition(transition);
			}
			if (transition.value.reason === "complete") {
				return acceptWorkflowEvents([
					{
						type: "workflow_completed",
						summary:
							transition.value.session.execution.lastSummary ??
							"All planned features are complete.",
						recordedAt: context.recordedAt,
					},
				]);
			}
			if (!transition.value.feature) {
				return rejectWorkflowCommand(
					"transition_rejected",
					transition.value.reason ?? "No runnable feature is available.",
				);
			}
			return acceptWorkflowEvents([
				{
					type: "run_started",
					featureId: transition.value.feature.id,
					recordedAt: context.recordedAt,
				},
			]);
		}
		case "record_reviewer_decision": {
			const transition = recordReviewerDecision(current, command.decision);
			if (!transition.ok) {
				return rejectTransition(transition);
			}
			const decision = transition.value.execution.lastReviewerDecision;
			if (!decision) {
				return rejectWorkflowCommand(
					"transition_rejected",
					"Reviewer decision did not produce a decision projection.",
				);
			}
			return acceptWorkflowEvents([
				{
					type: "reviewer_decision_recorded",
					decision,
					recordedAt: context.recordedAt,
				},
			]);
		}
		case "complete_run": {
			const featureId = current.execution.activeFeatureId;
			if (!featureId) {
				return rejectWorkflowCommand(
					"transition_rejected",
					"There is no active feature to complete.",
				);
			}
			const transition = completeRun(current, command.worker);
			if (!transition.ok) {
				return rejectTransition(transition);
			}
			return acceptWorkflowEvents([
				{
					type: "run_completed",
					featureId,
					worker: command.worker,
					resultingState: normalizeAcceptedStateTimestamps(
						transition.value,
						context.recordedAt,
					),
					recordedAt: context.recordedAt,
				},
			]);
		}
		case "reset_feature": {
			const transition = resetFeature(current, command.featureId);
			if (!transition.ok) {
				return rejectTransition(transition);
			}
			const affectedFeatureIds = collectAffectedFeatureIds(
				current,
				transition.value,
				command.featureId,
			);
			return acceptWorkflowEvents([
				{
					type: "feature_reset",
					featureId: command.featureId,
					affectedFeatureIds,
					summary:
						transition.value.execution.lastSummary ??
						`Reset feature '${command.featureId}'.`,
					resultingState: normalizeAcceptedStateTimestamps(
						transition.value,
						context.recordedAt,
					),
					recordedAt: context.recordedAt,
				},
			]);
		}
	}
}
