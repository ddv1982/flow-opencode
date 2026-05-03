import type {
	PlanArgs,
	PlanningContext,
	PlanningContextArgs,
	ReviewerDecision,
	Session,
	WorkerResultArgs,
} from "../../runtime/schema";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	resetFeature,
	selectPlanFeatures,
	startRun,
} from "../../runtime/transitions";
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

function normalizePlanningContextPatch(
	planning?: PlanningContextArgs | undefined,
): Partial<PlanningContext> | undefined {
	if (!planning) {
		return undefined;
	}

	const normalized: Partial<PlanningContext> = {};
	if (planning.repoProfile !== undefined) {
		normalized.repoProfile = planning.repoProfile;
	}
	if (planning.packageManager !== undefined) {
		normalized.packageManager = planning.packageManager;
	}
	if (planning.packageManagerAmbiguous !== undefined) {
		normalized.packageManagerAmbiguous = planning.packageManagerAmbiguous;
	}
	if (planning.stackProfile !== undefined) {
		normalized.stackProfile =
			planning.stackProfile as PlanningContext["stackProfile"];
	}
	if (planning.standardsProfile !== undefined) {
		normalized.standardsProfile =
			planning.standardsProfile as PlanningContext["standardsProfile"];
	}
	if (planning.research !== undefined) {
		normalized.research = planning.research;
	}
	if (planning.implementationApproach !== undefined) {
		normalized.implementationApproach = {
			chosenDirection: planning.implementationApproach.chosenDirection,
			keyConstraints: planning.implementationApproach.keyConstraints ?? [],
			validationSignals:
				planning.implementationApproach.validationSignals ?? [],
			sources: planning.implementationApproach.sources ?? [],
		};
	}
	if (planning.decisionLog !== undefined) {
		normalized.decisionLog = planning.decisionLog.map((decision) => ({
			question: decision.question,
			decisionMode: decision.decisionMode ?? "recommend_confirm",
			decisionDomain: decision.decisionDomain ?? "architecture",
			options: decision.options.map((option) => ({
				label: option.label,
				tradeoffs: option.tradeoffs ?? [],
			})),
			recommendation: decision.recommendation,
			rationale: decision.rationale ?? [],
		}));
	}
	if (planning.replanLog !== undefined) {
		normalized.replanLog = planning.replanLog;
	}
	return normalized;
}

function normalizeAcceptedStateTimestamps(
	state: Session,
	recordedAt: string,
): Session {
	const lastHistoryIndex = state.execution.history.length - 1;
	return {
		...state,
		closure: state.closure ? { ...state.closure, recordedAt } : state.closure,
		execution: {
			...state.execution,
			history: state.execution.history.map((entry, index) =>
				index === lastHistoryIndex ? { ...entry, recordedAt } : entry,
			),
		},
		timestamps: {
			...state.timestamps,
			updatedAt: recordedAt,
			completedAt:
				state.status === "completed"
					? recordedAt
					: state.timestamps.completedAt,
		},
	};
}

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
				return rejectWorkflowCommand(
					"transition_rejected",
					transition.message,
					transition.recovery,
				);
			}
			if (!transition.value.plan) {
				return rejectWorkflowCommand(
					"transition_rejected",
					"Plan application did not produce a plan.",
				);
			}
			return acceptWorkflowEvents([
				{
					type: "plan_applied",
					plan: transition.value.plan,
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
				return rejectWorkflowCommand(
					"transition_rejected",
					transition.message,
					transition.recovery,
				);
			}
			if (!transition.value.plan) {
				return rejectWorkflowCommand(
					"transition_rejected",
					"Plan approval did not produce a plan.",
				);
			}
			return acceptWorkflowEvents([
				{
					type: "plan_approved",
					plan: transition.value.plan,
					recordedAt: context.recordedAt,
				},
			]);
		}
		case "select_plan_features": {
			const transition = selectPlanFeatures(current, [...command.featureIds]);
			if (!transition.ok) {
				return rejectWorkflowCommand(
					"transition_rejected",
					transition.message,
					transition.recovery,
				);
			}
			if (!transition.value.plan) {
				return rejectWorkflowCommand(
					"transition_rejected",
					"Feature selection did not produce a plan.",
				);
			}
			return acceptWorkflowEvents([
				{
					type: "plan_features_selected",
					plan: transition.value.plan,
					recordedAt: context.recordedAt,
				},
			]);
		}
		case "start_run": {
			const transition = startRun(current, command.featureId);
			if (!transition.ok) {
				return rejectWorkflowCommand(
					"transition_rejected",
					transition.message,
					transition.recovery,
				);
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
				return rejectWorkflowCommand(
					"transition_rejected",
					transition.message,
					transition.recovery,
				);
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
				return rejectWorkflowCommand(
					"transition_rejected",
					transition.message,
					transition.recovery,
				);
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
				return rejectWorkflowCommand(
					"transition_rejected",
					transition.message,
					transition.recovery,
				);
			}
			const affectedFeatureIds = transition.value.plan?.features
				.filter((feature) => {
					const previous = current.plan?.features.find(
						(item) => item.id === feature.id,
					);
					return previous?.status !== feature.status;
				})
				.map((feature) => feature.id) ?? [command.featureId];
			return acceptWorkflowEvents([
				{
					type: "feature_reset",
					featureId: command.featureId,
					affectedFeatureIds:
						affectedFeatureIds.length > 0
							? affectedFeatureIds
							: [command.featureId],
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
