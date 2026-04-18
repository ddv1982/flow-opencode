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
		})),
	};
}

function ensureRequestedFeatureIdsExist(
	features: Plan["features"],
	requestedIds: string[],
): string | null {
	const knownIds = new Set(features.map((feature) => feature.id));
	const unknownIds = requestedIds.filter((id) => !knownIds.has(id));
	return unknownIds.length > 0
		? `Unknown feature ids: ${unknownIds.join(", ")}.`
		: null;
}

function selectProjectedFeatureSubset(
	features: Plan["features"],
	featureIds: string[],
	dependencyErrorMessage: (featureId: string) => string,
	preserveCompleted: boolean,
): TransitionResult<Plan["features"]> {
	const unknownIdsError = ensureRequestedFeatureIdsExist(features, featureIds);
	if (unknownIdsError) {
		return fail(unknownIdsError);
	}

	const selectedIds = new Set(featureIds);
	const filtered = features.filter((feature) => selectedIds.has(feature.id));
	if (filtered.length === 0) {
		return fail("None of the requested feature ids matched the draft plan.");
	}

	const filteredIds = new Set(filtered.map((feature) => feature.id));
	for (const feature of filtered) {
		const unresolvedDependsOn = (feature.dependsOn ?? []).filter(
			(id) => !filteredIds.has(id),
		);
		const unresolvedBlockedBy = (feature.blockedBy ?? []).filter(
			(id) => !filteredIds.has(id),
		);
		if (unresolvedDependsOn.length > 0 || unresolvedBlockedBy.length > 0) {
			return fail(dependencyErrorMessage(feature.id));
		}
	}

	return succeed(
		filtered.map((feature) => ({
			...feature,
			status:
				preserveCompleted && feature.status === "completed"
					? "completed"
					: "pending",
		})),
	);
}

function validatePlanGraph(plan: Plan): string | null {
	const ids = new Set<string>();

	for (const feature of plan.features) {
		if (ids.has(feature.id)) {
			return `Plan validation failed: duplicate feature id '${feature.id}'.`;
		}
		ids.add(feature.id);
	}

	const byId = new Map(plan.features.map((feature) => [feature.id, feature]));
	for (const feature of plan.features) {
		for (const dependencyId of feature.dependsOn ?? []) {
			if (!ids.has(dependencyId)) {
				return `Plan validation failed: feature '${feature.id}' depends on unknown feature '${dependencyId}'.`;
			}
			if (dependencyId === feature.id) {
				return `Plan validation failed: feature '${feature.id}' cannot depend on itself.`;
			}
		}

		for (const blockerId of feature.blockedBy ?? []) {
			if (!ids.has(blockerId)) {
				return `Plan validation failed: feature '${feature.id}' is blocked by unknown feature '${blockerId}'.`;
			}
			if (blockerId === feature.id) {
				return `Plan validation failed: feature '${feature.id}' cannot block itself.`;
			}
		}
	}

	const visitState = new Map<string, "visiting" | "visited">();
	const visit = (featureId: string): boolean => {
		const current = visitState.get(featureId);
		if (current === "visiting") {
			return true;
		}
		if (current === "visited") {
			return false;
		}

		visitState.set(featureId, "visiting");
		const feature = byId.get(featureId);
		if (!feature) {
			visitState.set(featureId, "visited");
			return false;
		}

		for (const edge of [
			...(feature.dependsOn ?? []),
			...(feature.blockedBy ?? []),
		]) {
			if (visit(edge)) {
				return true;
			}
		}

		visitState.set(featureId, "visited");
		return false;
	};

	for (const feature of plan.features) {
		if (visit(feature.id)) {
			return "Plan validation failed: the feature dependency graph contains a cycle.";
		}
	}

	return null;
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

	const next: Session = {
		...session,
		plan,
		status: "planning",
		approval: "pending",
		timestamps: {
			...session.timestamps,
			approvedAt: null,
			completedAt: null,
		},
		notes: [],
		planning: {
			repoProfile: planning?.repoProfile ?? session.planning.repoProfile,
			research: planning?.research ?? session.planning.research,
			implementationApproach:
				planning?.implementationApproach ??
				session.planning.implementationApproach,
		},
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
			return subset;
		}

		next.plan.features = subset.value;
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
		return subset;
	}

	next.plan.features = subset.value;
	return succeed({
		...clearExecution(next),
		approval: "pending",
		status: "planning",
	});
}
