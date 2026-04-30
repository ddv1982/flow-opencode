import {
	FLOW_PLAN_COMMAND,
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_RUN_COMMAND,
	FLOW_STATUS_COMMAND,
	flowResetFeatureCommand,
} from "./constants";
import {
	activeDecisionGate,
	featureWouldReachCompletion,
	finalReviewPolicyForPlan,
} from "./domain";
import type { Session } from "./schema";

export type SessionOperatorState = {
	phase:
		| "idle"
		| "planning"
		| "decision"
		| "ready"
		| "executing"
		| "blocked"
		| "completed";
	lane: "lite" | "standard" | "strict";
	laneReason: string;
	blocker: string | null;
	reason: string;
	nextStep: string;
	nextCommand: string;
};

export function deriveExecutionLane(session: Session | null): {
	lane: SessionOperatorState["lane"];
	laneReason: string;
} {
	if (!session?.plan) {
		return {
			lane: "lite",
			laneReason:
				"Flow can stay in the lite lane until a non-trivial plan or risk signal appears.",
		};
	}

	const decisionGate = activeDecisionGate(session);
	const hasStrictPolicy =
		Boolean(session.plan.completionPolicy?.minCompletedFeatures) ||
		session.plan.deliveryPolicy?.stopRule !== undefined ||
		session.plan.deliveryPolicy?.deferAllowed === true ||
		session.plan.goalMode !== "implementation" ||
		session.plan.decompositionPolicy !== "atomic_feature";
	const blockedNeedsHuman = Boolean(
		session.status === "blocked" &&
			(session.execution.lastOutcome?.needsHuman ||
				session.execution.lastOutcome?.kind === "replan_required"),
	);
	if (
		decisionGate ||
		session.planning.replanLog.length > 0 ||
		hasStrictPolicy ||
		blockedNeedsHuman
	) {
		return {
			lane: "strict",
			laneReason:
				"Flow detected elevated coordination or recovery risk, so the strict lane is the safest fit.",
		};
	}

	if (
		session.plan.features.length <= 1 &&
		session.planning.research.length === 0 &&
		session.planning.decisionLog.length === 0 &&
		session.planning.implementationApproach === undefined
	) {
		return {
			lane: "lite",
			laneReason:
				"This looks like a small single-feature task, so Flow can stay in the lite lane.",
		};
	}

	return {
		lane: "standard",
		laneReason:
			"This session has multi-step work but no elevated risk signals, so the standard lane fits best.",
	};
}

export function deriveSessionOperatorState(
	session: Session | null,
): SessionOperatorState {
	const lane = deriveExecutionLane(session);
	if (!session) {
		return {
			phase: "idle",
			lane: lane.lane,
			laneReason: lane.laneReason,
			blocker: "No active Flow session exists for this workspace.",
			reason: "Flow has not started a tracked session for this workspace yet.",
			nextStep: "Start a new Flow session with /flow-plan <goal>.",
			nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
		};
	}

	const nextCommand = deriveNextCommand(session);
	const decisionGate = activeDecisionGate(session);
	if (decisionGate) {
		return {
			phase: "decision",
			lane: lane.lane,
			laneReason: lane.laneReason,
			blocker: decisionGate.question,
			reason:
				"A meaningful planning decision is still open, so Flow should pause before continuing execution.",
			nextStep: decisionGate.recommendation,
			nextCommand,
		};
	}

	if (session.status === "planning") {
		const hasPlan = Boolean(session.plan);
		return {
			phase: "planning",
			lane: lane.lane,
			laneReason: lane.laneReason,
			blocker: hasPlan
				? "The draft plan is not approved yet."
				: "No draft plan exists yet.",
			reason: hasPlan
				? "Planning is still active because execution is gated on reviewing or approving the draft plan."
				: "Planning is still active because Flow does not have an execution-ready draft plan yet.",
			nextStep: hasPlan
				? "Review or refine the draft plan, then approve it when ready."
				: "Create or refresh the draft plan for the current goal.",
			nextCommand,
		};
	}

	if (session.status === "blocked") {
		const outcome = session.execution.lastOutcome;
		const reviewerDecision = session.execution.lastReviewerDecision;
		return {
			phase: "blocked",
			lane: lane.lane,
			laneReason: lane.laneReason,
			blocker:
				outcome?.summary ??
				reviewerDecision?.summary ??
				session.execution.lastSummary ??
				"Flow is blocked and needs recovery before it can continue.",
			reason:
				"The last execution result or review outcome requires recovery before Flow can continue.",
			nextStep:
				session.execution.lastNextStep ??
				outcome?.resolutionHint ??
				(outcome?.retryable || outcome?.autoResolvable
					? "Address the blocking prerequisite, then retry the feature."
					: "Inspect the blocker and decide whether to reset, replan, or stop."),
			nextCommand,
		};
	}

	if (session.status === "ready" || session.status === "running") {
		const activeFeature = session.plan?.features.find(
			(feature) => feature.id === session.execution.activeFeatureId,
		);
		const activeFeatureIsFinalPath = Boolean(
			session.plan &&
				activeFeature &&
				featureWouldReachCompletion(session.plan, activeFeature.id),
		);
		const finalReviewPolicy = finalReviewPolicyForPlan(session.plan);
		const defaultExecutionNextStep = activeFeature
			? activeFeatureIsFinalPath
				? `Continue the active feature through broad validation and the ${finalReviewPolicy === "detailed" ? "detailed final cross-feature review" : "broad final review"}.`
				: "Continue the active feature through validation and review."
			: "Run the next approved feature.";
		return {
			phase: session.status === "running" ? "executing" : "ready",
			lane: lane.lane,
			laneReason: lane.laneReason,
			blocker: null,
			reason: activeFeature
				? "An approved feature is active, so Flow should stay in execution."
				: "Planning is approved and Flow can run the next feature.",
			nextStep: session.execution.lastNextStep ?? defaultExecutionNextStep,
			nextCommand,
		};
	}

	return {
		phase: "completed",
		lane: lane.lane,
		laneReason: lane.laneReason,
		blocker: null,
		reason:
			"The active session is complete, so Flow is no longer holding execution state for it.",
		nextStep: "Start a new goal when you are ready for more work.",
		nextCommand,
	};
}

export function deriveNextCommand(session: Session): string {
	if (!session.plan) {
		return FLOW_PLAN_WITH_GOAL_COMMAND;
	}
	if (session.status === "planning") {
		return FLOW_PLAN_COMMAND;
	}
	if (session.status === "ready" || session.status === "running") {
		return FLOW_RUN_COMMAND;
	}
	if (session.status === "blocked") {
		const lastFeatureId = session.execution.lastFeatureId;
		const outcome = session.execution.lastOutcome;

		if (
			lastFeatureId &&
			!outcome?.needsHuman &&
			(outcome?.retryable ||
				outcome?.autoResolvable ||
				outcome?.kind === "contract_error")
		) {
			return flowResetFeatureCommand(lastFeatureId);
		}
	}
	if (session.status === "completed") {
		return FLOW_PLAN_WITH_GOAL_COMMAND;
	}

	return FLOW_STATUS_COMMAND;
}
