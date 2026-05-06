import {
	completionPolicyTargetError,
	mergePlanningContext,
	selectProjectedFeatureSubset,
	validatePlanGraph,
} from "../domain";
import type { Plan, PlanInput, PlanningContext, Session } from "../schema";
import { nowIso } from "../util";
import { clearExecution, fail, succeed, type TransitionResult } from "./shared";

type DraftPlanEditMessages = {
	missingPlan: string;
	activeSession: string;
};

type DraftPlanSession = Session & { plan: Plan };
type ApplyPlanInput = Omit<PlanInput, "features"> & {
	features: readonly (
		| {
				id?: string;
				title?: string;
				summary?: string;
				status?: PlanInput["features"][number]["status"];
				priority?: PlanInput["features"][number]["priority"];
				deferCandidate?: PlanInput["features"][number]["deferCandidate"];
				fileTargets?: readonly string[] | undefined;
				verification?: readonly string[] | undefined;
				dependsOn?: readonly string[] | undefined;
				blockedBy?: readonly string[] | undefined;
		  }
		| undefined
	)[];
};

function normalizePlan(planInput: ApplyPlanInput): Plan {
	const features = [...planInput.features].filter(
		(feature): feature is NonNullable<typeof feature> => feature !== undefined,
	);

	return {
		summary: planInput.summary,
		overview: planInput.overview,
		requirements: [...(planInput.requirements ?? [])],
		architectureDecisions: [...(planInput.architectureDecisions ?? [])],
		goalMode: planInput.goalMode ?? "implementation",
		decompositionPolicy: planInput.decompositionPolicy ?? "atomic_feature",
		completionPolicy: planInput.completionPolicy,
		deliveryPolicy: planInput.deliveryPolicy
			? {
					priorityMode: planInput.deliveryPolicy.priorityMode ?? "balanced",
					stopRule: planInput.deliveryPolicy.stopRule ?? "ship_when_clean",
					deferAllowed: planInput.deliveryPolicy.deferAllowed ?? false,
					finalReviewPolicy:
						planInput.deliveryPolicy.finalReviewPolicy ?? "detailed",
				}
			: undefined,
		notes: planInput.notes ? [...planInput.notes] : undefined,
		features: features.map((feature) => ({
			id: feature.id ?? "",
			title: feature.title ?? "",
			summary: feature.summary ?? "",
			fileTargets: [...(feature.fileTargets ?? [])],
			verification: [...(feature.verification ?? [])],
			...(feature.dependsOn ? { dependsOn: [...feature.dependsOn] } : {}),
			...(feature.blockedBy ? { blockedBy: [...feature.blockedBy] } : {}),
			status: "pending",
			priority: feature.priority ?? "important",
			deferCandidate: feature.deferCandidate ?? false,
		})),
	};
}

function prepareDraftPlanEdit(
	session: Session,
	messages: DraftPlanEditMessages,
): TransitionResult<DraftPlanSession> {
	const { plan } = session;
	if (!plan) {
		return fail(messages.missingPlan);
	}
	if (session.status !== "planning" || session.execution.activeFeatureId) {
		return fail(messages.activeSession);
	}

	return succeed({
		...session,
		plan: {
			...plan,
			features: [...plan.features],
		},
	});
}

export function applyPlan(
	session: Session,
	planInput: ApplyPlanInput,
	planning?: Partial<PlanningContext>,
): TransitionResult<Session> {
	const plan = normalizePlan(planInput);
	const planGraphError = validatePlanGraph(plan);
	if (planGraphError) {
		return fail(planGraphError);
	}
	const completionPolicyError = completionPolicyTargetError(plan);
	if (completionPolicyError) {
		return fail(completionPolicyError);
	}

	const next: Session = {
		...session,
		plan,
		status: "planning",
		approval: "pending",
		closure: null,
		timestamps: {
			...session.timestamps,
			approvedAt: null,
			completedAt: null,
		},
		notes: [],
		planning: mergePlanningContext(session.planning, planning ?? {}),
		execution: {
			...session.execution,
		},
	};
	return succeed(clearExecution(next));
}

export function approvePlan(
	session: Session,
	featureIds?: string[],
): TransitionResult<Session> {
	const editable = prepareDraftPlanEdit(session, {
		missingPlan: "There is no draft plan to approve.",
		activeSession:
			"The active session is already executing work. Replanning or approval is only allowed while reviewing a draft plan.",
	});
	if (!editable.ok) {
		return editable;
	}

	const next = editable.value;

	if (featureIds && featureIds.length > 0) {
		const subset = selectProjectedFeatureSubset(
			next.plan.features,
			featureIds,
			(featureId) =>
				`Feature '${featureId}' depends on omitted features. Select a dependency-consistent set before approval.`,
			false,
		);
		if (!subset.ok) {
			return fail(subset.error);
		}

		next.plan.features = subset.value;
		const completionPolicyError = completionPolicyTargetError(next.plan);
		if (completionPolicyError) {
			return fail(completionPolicyError);
		}
	}

	return succeed({
		...next,
		approval: "approved",
		status: "ready",
		timestamps: {
			...next.timestamps,
			approvedAt: nowIso(),
		},
	});
}

export function selectPlanFeatures(
	session: Session,
	featureIds: string[],
): TransitionResult<Session> {
	const editable = prepareDraftPlanEdit(session, {
		missingPlan: "There is no draft plan to narrow.",
		activeSession:
			"The active session is already executing work. Narrow the plan only while it is still a draft.",
	});
	if (!editable.ok) {
		return editable;
	}
	if (featureIds.length === 0) {
		return fail("Provide at least one feature id to keep in the draft plan.");
	}

	const next = editable.value;
	const subset = selectProjectedFeatureSubset(
		next.plan.features,
		featureIds,
		(featureId) =>
			`Feature '${featureId}' depends on omitted features. Keep a dependency-consistent set.`,
		true,
	);
	if (!subset.ok) {
		return fail(subset.error);
	}

	next.plan.features = subset.value;
	const completionPolicyError = completionPolicyTargetError(next.plan);
	if (completionPolicyError) {
		return fail(completionPolicyError);
	}
	return succeed({
		...clearExecution(next),
		approval: "pending",
		status: "planning",
	});
}
