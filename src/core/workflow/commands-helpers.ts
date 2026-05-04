import type {
	Plan,
	PlanningContext,
	PlanningContextArgs,
	Session,
} from "../../workflow/contracts";
import type { TransitionRecovery } from "../../workflow/recovery";
import type { WorkflowEvent } from "./events";
import { rejectWorkflowCommand, type WorkflowDecision } from "./rejections";

export function normalizePlanningContextPatch(
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
	if (planning.evidencePackets !== undefined) {
		normalized.evidencePackets = planning.evidencePackets;
	}
	return normalized;
}

export function normalizeAcceptedStateTimestamps(
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

export function collectAffectedFeatureIds(
	beforeState: Session,
	afterState: Session,
	fallbackFeatureId: string,
): string[] {
	const affected = afterState.plan?.features
		.filter((feature) => {
			const previous = beforeState.plan?.features.find(
				(item) => item.id === feature.id,
			);
			return previous?.status !== feature.status;
		})
		.map((feature) => feature.id) ?? [fallbackFeatureId];
	return affected.length > 0 ? affected : [fallbackFeatureId];
}

export function rejectTransition(transition: {
	message: string;
	recovery?: TransitionRecovery | undefined;
}): WorkflowDecision<WorkflowEvent> {
	return rejectWorkflowCommand(
		"transition_rejected",
		transition.message,
		transition.recovery,
	);
}

export function requireTransitionPlan(
	plan: Session["plan"],
	missingPlanMessage: string,
): Plan | WorkflowDecision<WorkflowEvent> {
	if (!plan) {
		return rejectWorkflowCommand("transition_rejected", missingPlanMessage);
	}
	return plan;
}
