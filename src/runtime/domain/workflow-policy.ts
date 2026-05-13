// Flow runtime policy owner: workflow completion targets and decision-gate semantics remain normative here.

import type { Feature, Plan, ReviewerDecision, Session } from "../schema";

type DeliveryPolicy = NonNullable<Plan["deliveryPolicy"]>;
type FinalReviewPolicy = NonNullable<DeliveryPolicy["finalReviewPolicy"]>;
type StopRule = NonNullable<DeliveryPolicy["stopRule"]>;
type DecisionLogEntry = Session["planning"]["decisionLog"][number];
type DecisionMode = DecisionLogEntry["decisionMode"];
type DecisionGateStatus = "recommend_confirm" | "human_required";
type TargetStrategy = "all_features" | "core_features" | "threshold";

const DEFAULT_FINAL_REVIEW_POLICY: FinalReviewPolicy = "detailed";
const DEFAULT_CLEAN_STOP_RULE: StopRule = "ship_when_clean";
const DEFAULT_THRESHOLD_STOP_RULE: StopRule = "ship_when_threshold_met";

const STRICT_REVIEW_GOAL_MODES = new Set<Plan["goalMode"]>([
	"review",
	"review_and_fix",
]);

const REVIEWER_PURPOSE_BY_SCOPE: Record<
	ReviewerDecision["scope"],
	NonNullable<ReviewerDecision["reviewPurpose"]>
> = {
	feature: "execution_gate",
	final: "completion_gate",
};

const STOP_RULE_TARGET_STRATEGY: Record<StopRule, TargetStrategy> = {
	ship_when_clean: "all_features",
	ship_when_core_done: "core_features",
	ship_when_threshold_met: "threshold",
};

const DECISION_MODE_REQUIRES_PAUSE: Record<DecisionMode, boolean> = {
	autonomous_choice: false,
	recommend_confirm: true,
	human_required: true,
};

const DECISION_GATE_STATUS_BY_MODE: Partial<
	Record<DecisionMode, DecisionGateStatus>
> = {
	recommend_confirm: "recommend_confirm",
	human_required: "human_required",
};

export function finalReviewPolicyForPlan(
	plan: Plan | null | undefined,
): FinalReviewPolicy {
	return plan?.deliveryPolicy?.finalReviewPolicy ?? DEFAULT_FINAL_REVIEW_POLICY;
}

export function strictReviewGovernanceRequiredForPlan(
	plan: Plan | null | undefined,
): boolean {
	return Boolean(
		(plan?.goalMode && STRICT_REVIEW_GOAL_MODES.has(plan.goalMode)) ||
			plan?.deliveryPolicy?.strictReview === true,
	);
}

export function reviewerPurposeForScope(
	scope: ReviewerDecision["scope"],
): NonNullable<ReviewerDecision["reviewPurpose"]> {
	return REVIEWER_PURPOSE_BY_SCOPE[scope];
}

function thresholdTarget(plan: Plan): number {
	return plan.completionPolicy?.minCompletedFeatures ?? plan.features.length;
}

export function completionPolicyTargetError(plan: Plan): string | null {
	const target = plan.completionPolicy?.minCompletedFeatures;
	if (target === undefined || target <= plan.features.length) {
		return null;
	}

	return `Plan validation failed: completionPolicy.minCompletedFeatures (${target}) cannot exceed the plan feature count (${plan.features.length}).`;
}

function coreFeatureTarget(plan: Plan): number {
	const coreFeatures = plan.features.filter(
		(feature) => feature.priority !== "nice_to_have" && !feature.deferCandidate,
	);
	return coreFeatures.length > 0 ? coreFeatures.length : thresholdTarget(plan);
}

function stopRuleForPlan(plan: Plan): StopRule {
	return (
		plan.deliveryPolicy?.stopRule ??
		(plan.completionPolicy?.minCompletedFeatures !== undefined
			? DEFAULT_THRESHOLD_STOP_RULE
			: DEFAULT_CLEAN_STOP_RULE)
	);
}

function targetStrategyForPlan(plan: Plan): TargetStrategy {
	const stopRule = stopRuleForPlan(plan);
	if (
		stopRule === "ship_when_core_done" &&
		!plan.deliveryPolicy?.deferAllowed
	) {
		return "threshold";
	}
	return STOP_RULE_TARGET_STRATEGY[stopRule];
}

const TARGET_COUNT_BY_STRATEGY: Record<TargetStrategy, (plan: Plan) => number> =
	{
		all_features: (plan) => plan.features.length,
		core_features: coreFeatureTarget,
		threshold: thresholdTarget,
	};

export function targetCompletedFeatureCount(plan: Plan): number {
	return TARGET_COUNT_BY_STRATEGY[targetStrategyForPlan(plan)](plan);
}

export function completedFeatureCount(features: Feature[]): number {
	return features.filter((feature) => feature.status === "completed").length;
}

export function sessionCompletionReached(
	plan: Plan,
	features: Feature[],
): boolean {
	return completedFeatureCount(features) >= targetCompletedFeatureCount(plan);
}

export function decisionRequiresPause(mode: DecisionMode): boolean {
	return DECISION_MODE_REQUIRES_PAUSE[mode];
}

function toDecisionGate(decision: DecisionLogEntry): {
	status: DecisionGateStatus;
	domain: DecisionLogEntry["decisionDomain"];
	question: string;
	recommendation: string;
	rationale: string[];
} | null {
	const status = DECISION_GATE_STATUS_BY_MODE[decision.decisionMode];
	return status
		? {
				status,
				domain: decision.decisionDomain,
				question: decision.question,
				recommendation: decision.recommendation,
				rationale: decision.rationale,
			}
		: null;
}

export function activeDecisionGate(session: Session): {
	status: DecisionGateStatus;
	domain: DecisionLogEntry["decisionDomain"];
	question: string;
	recommendation: string;
	rationale: string[];
} | null {
	for (
		let index = session.planning.decisionLog.length - 1;
		index >= 0;
		index -= 1
	) {
		const decision = session.planning.decisionLog[index];
		if (!decision) {
			continue;
		}
		const gate = toDecisionGate(decision);
		if (gate) {
			return gate;
		}
	}

	return null;
}
