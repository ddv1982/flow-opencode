import type { Plan, Session } from "../../workflow/contracts";
import { SessionSchema } from "../../workflow/contracts";
import type { WorkflowEvent } from "./events";
import { createInitialWorkflowState, type WorkflowState } from "./state";

function assertState(
	state: WorkflowState | null,
	event: WorkflowEvent,
): WorkflowState {
	if (!state) {
		throw new Error(`Cannot apply '${event.type}' before workflow_started.`);
	}
	return state;
}

function parseState(state: Session): WorkflowState {
	return SessionSchema.parse(state);
}

function clearExecutionProjection(
	session: WorkflowState,
): WorkflowState["execution"] {
	return {
		...session.execution,
		activeFeatureId: null,
		lastFeatureId: null,
		lastSummary: null,
		lastOutcomeKind: null,
		lastOutcome: null,
		lastNextStep: null,
		lastFeatureResult: null,
		lastReviewerDecision: null,
		lastValidationRun: [],
	};
}

function updateFeatureStatus(
	plan: Plan,
	featureId: string,
	status: Plan["features"][number]["status"],
): Plan {
	return {
		...plan,
		features: plan.features.map((feature) =>
			feature.id === featureId ? { ...feature, status } : feature,
		),
	};
}

function reducePlanApplied(
	state: WorkflowState,
	event: Extract<WorkflowEvent, { type: "plan_applied" }>,
): WorkflowState {
	return parseState({
		...state,
		plan: event.plan,
		status: "planning",
		approval: "pending",
		closure: null,
		notes: [],
		planning: {
			...state.planning,
			...event.planning,
		},
		execution: clearExecutionProjection(state),
		timestamps: {
			...state.timestamps,
			updatedAt: event.recordedAt,
			approvedAt: null,
			completedAt: null,
		},
	});
}

function reduceRunStarted(
	state: WorkflowState,
	event: Extract<WorkflowEvent, { type: "run_started" }>,
): WorkflowState {
	if (!state.plan) {
		throw new Error("Cannot apply run_started without a plan.");
	}

	return parseState({
		...state,
		status: "running",
		plan: updateFeatureStatus(state.plan, event.featureId, "in_progress"),
		execution: {
			...state.execution,
			activeFeatureId: event.featureId,
			lastFeatureId: event.featureId,
			lastSummary: `Running feature '${event.featureId}'.`,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
		},
		timestamps: {
			...state.timestamps,
			updatedAt: event.recordedAt,
		},
	});
}

function reduceReviewerDecisionRecorded(
	state: WorkflowState,
	event: Extract<WorkflowEvent, { type: "reviewer_decision_recorded" }>,
): WorkflowState {
	return parseState({
		...state,
		execution: {
			...state.execution,
			lastSummary: event.decision.summary,
			lastReviewerDecision: event.decision,
		},
		timestamps: {
			...state.timestamps,
			updatedAt: event.recordedAt,
		},
	});
}

function reduceRunCompleted(
	_state: WorkflowState,
	event: Extract<WorkflowEvent, { type: "run_completed" }>,
): WorkflowState {
	return parseState(event.resultingState);
}

function reduceWorkflowCompleted(
	state: WorkflowState,
	event: Extract<WorkflowEvent, { type: "workflow_completed" }>,
): WorkflowState {
	return parseState({
		...state,
		status: "completed",
		closure: {
			kind: "completed",
			summary: event.summary,
			recordedAt: event.recordedAt,
		},
		execution: {
			...state.execution,
			activeFeatureId: null,
			lastSummary: event.summary,
			lastOutcomeKind: "completed",
		},
		timestamps: {
			...state.timestamps,
			updatedAt: event.recordedAt,
			completedAt: event.recordedAt,
		},
	});
}

export function applyWorkflowEvent(
	state: WorkflowState | null,
	event: WorkflowEvent,
): WorkflowState {
	switch (event.type) {
		case "workflow_started":
			if (state) {
				throw new Error("workflow_started cannot be applied twice.");
			}
			return createInitialWorkflowState({
				sessionId: event.sessionId,
				goal: event.goal,
				recordedAt: event.recordedAt,
				planning: event.planning,
			});
		case "planning_context_recorded": {
			const current = assertState(state, event);
			return parseState({
				...current,
				planning: {
					...current.planning,
					...event.planning,
				},
				timestamps: {
					...current.timestamps,
					updatedAt: event.recordedAt,
				},
			});
		}
		case "plan_applied":
			return reducePlanApplied(assertState(state, event), event);
		case "plan_approved": {
			const current = assertState(state, event);
			return parseState({
				...current,
				plan: event.plan,
				status: "ready",
				approval: "approved",
				timestamps: {
					...current.timestamps,
					updatedAt: event.recordedAt,
					approvedAt: event.recordedAt,
				},
			});
		}
		case "plan_features_selected": {
			const current = assertState(state, event);
			return parseState({
				...current,
				plan: event.plan,
				status: "planning",
				approval: "pending",
				execution: clearExecutionProjection(current),
				timestamps: {
					...current.timestamps,
					updatedAt: event.recordedAt,
					approvedAt: null,
				},
			});
		}
		case "run_started":
			return reduceRunStarted(assertState(state, event), event);
		case "reviewer_decision_recorded":
			return reduceReviewerDecisionRecorded(assertState(state, event), event);
		case "run_completed":
			return reduceRunCompleted(assertState(state, event), event);
		case "feature_reset":
			assertState(state, event);
			return parseState(event.resultingState);
		case "workflow_completed":
			return reduceWorkflowCompleted(assertState(state, event), event);
	}
}

export function replayWorkflowEvents(
	events: readonly WorkflowEvent[],
	initialState: WorkflowState | null = null,
): WorkflowState | null {
	return events.reduce<WorkflowState | null>(
		(current, event) => applyWorkflowEvent(current, event),
		initialState,
	);
}
