import { MAX_HISTORY_ENTRIES } from "./limits.js";
import type {
	EvidenceRecord,
	FeatureId,
	Plan,
	ReviewAssignment,
	ReviewAssignmentResultInput,
	ReviewExecution,
	Session,
} from "./session.js";
import {
	canonicalEvidenceId,
	canonicalLogicalReviewPassId,
	canonicalOperationRequestDigest,
	canonicalReviewAssignmentResultDigest,
	canonicalReviewAttemptId,
	canonicalReviewPacketDigest,
	planProjectionBudgetFailure,
	stableReviewFindingFingerprint,
	validatePlan,
} from "./transitions.js";

const ISO_OFFSET_DATETIME_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function time(value: string): number | null {
	if (!ISO_OFFSET_DATETIME_PATTERN.test(value)) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function resultMatchesExecution(
	result: ReviewAssignmentResultInput,
	execution: ReviewExecution,
): boolean {
	return (
		result.assignmentId === execution.assignmentId &&
		result.verdict === execution.verdict &&
		result.completedAt === execution.completedAt &&
		result.terminalDisposition === execution.terminalDisposition &&
		JSON.stringify(result.findings) ===
			JSON.stringify(
				execution.findings.map(
					({ fingerprint: _fingerprint, ...finding }) => finding,
				),
			)
	);
}

function uniqueBy<T>(
	items: readonly T[],
	key: (item: T) => string,
	description: string,
): string | null {
	const seen = new Set<string>();
	for (const item of items) {
		const id = key(item);
		if (seen.has(id)) return `${description} '${id}' is duplicated.`;
		seen.add(id);
	}
	return null;
}

function snapshotAtRevision(session: Session, revision: number): string | null {
	if (revision === 0) return session.causal.genesisSnapshotId;
	return session.causal.mutations[revision - 1]?.currentSnapshotId ?? null;
}

function evidenceAcceptanceMutation(
	session: Session,
	evidence: EvidenceRecord,
) {
	return session.causal.mutations.find((mutation) =>
		mutation.evidenceRefs.includes(evidence.evidenceId),
	);
}

function assignmentExecution(
	session: Session,
	assignment: ReviewAssignment,
): ReviewExecution | undefined {
	return session.budget.reviewExecutions.find(
		(execution) => execution.assignmentId === assignment.id,
	);
}

function resetAffectedFeatureIds(
	plan: Plan,
	targetFeatureId: FeatureId,
): FeatureId[] | null {
	if (!plan.features.some((feature) => feature.id === targetFeatureId)) {
		return null;
	}
	const affected = new Set<FeatureId>([targetFeatureId]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const feature of plan.features) {
			if (
				!affected.has(feature.id) &&
				feature.dependsOn.some((dependency) => affected.has(dependency))
			) {
				affected.add(feature.id);
				changed = true;
			}
		}
	}
	return [...affected];
}

/**
 * Validate relationships that cannot be expressed by the local Session v4
 * object schemas. The first returned error is stable, curated recovery
 * evidence; callers must treat any error as corruption and never partially
 * hydrate the graph.
 */
export function validateSessionInvariants(session: Session): string | null {
	const duplicateRun = uniqueBy(
		session.featureRuns,
		(run) => run.id,
		"Feature run",
	);
	if (duplicateRun) return duplicateRun;
	const duplicateAssignment = uniqueBy(
		session.reviewAssignments,
		(assignment) => assignment.id,
		"Review assignment",
	);
	if (duplicateAssignment) return duplicateAssignment;
	const pendingAssignments = new Set<string>();
	for (const assignment of session.reviewAssignments) {
		if (assignment.status !== "pending") continue;
		const key = `${assignment.featureRunId}\u0000${assignment.reviewKind}`;
		if (pendingAssignments.has(key)) {
			return `Feature run '${assignment.featureRunId}' has multiple pending ${assignment.reviewKind} review assignments.`;
		}
		pendingAssignments.add(key);
	}
	const duplicateExecution = uniqueBy(
		session.budget.reviewExecutions,
		(execution) => execution.assignmentId,
		"Recorded review execution",
	);
	if (duplicateExecution) return duplicateExecution;
	const duplicateExecutionAttempt = uniqueBy(
		session.budget.reviewExecutions,
		(execution) => execution.attemptId,
		"Recorded review attempt",
	);
	if (duplicateExecutionAttempt) return duplicateExecutionAttempt;
	const duplicateEvidence = uniqueBy(
		session.causal.evidence,
		(evidence) => evidence.evidenceId,
		"Evidence record",
	);
	if (duplicateEvidence) return duplicateEvidence;

	const isPlanning = session.status === "planning";
	if ((session.approval === "pending") !== isPlanning) {
		return "Session approval must be pending exactly while the session is planning.";
	}
	if (!session.plan && !isPlanning) {
		return "A non-planning session requires an approved plan.";
	}
	if ((session.status === "blocked") !== (session.lastError !== null)) {
		return "A persisted lifecycle error must exist exactly while the session is blocked.";
	}
	if (
		session.lastError &&
		(time(session.lastError.recordedAt) === null ||
			(time(session.timestamps.updatedAt) ?? -1) <
				(time(session.lastError.recordedAt) ?? Number.POSITIVE_INFINITY))
	) {
		return "Persisted lifecycle error time must be valid and no later than the session update time.";
	}
	const completedAt =
		session.timestamps.completedAt === null
			? null
			: time(session.timestamps.completedAt);
	const createdAt = time(session.timestamps.createdAt);
	const updatedAt = time(session.timestamps.updatedAt);
	if (createdAt === null || updatedAt === null) {
		return "Session timestamps must be valid offset timestamps.";
	}
	if (updatedAt < createdAt) {
		return "Session update time cannot precede its creation time.";
	}
	if (session.causal.mutations.length === 0 && updatedAt !== createdAt) {
		return "A fresh session update time must equal its creation time.";
	}
	if (
		(session.status === "completed") !==
			(session.timestamps.completedAt !== null) ||
		(session.timestamps.completedAt !== null && completedAt === null)
	) {
		return "Session completed status must agree with its valid completion timestamp.";
	}
	if (session.plan) {
		const planGraphError = validatePlan(session.plan);
		if (planGraphError) return planGraphError;
		const planBudgetError = planProjectionBudgetFailure(
			session.goal,
			session.plan,
		);
		if (planBudgetError) return planBudgetError;
		const pendingCount = session.plan.features.filter(
			(feature) => feature.status === "pending",
		).length;
		const inProgressCount = session.plan.features.filter(
			(feature) => feature.status === "in_progress",
		).length;
		const blockedCount = session.plan.features.filter(
			(feature) => feature.status === "blocked",
		).length;
		const completedCount = session.plan.features.filter(
			(feature) => feature.status === "completed",
		).length;
		const featureCount = session.plan.features.length;
		switch (session.status) {
			case "planning":
				if (pendingCount !== featureCount) {
					return "A planning session can contain only pending plan features.";
				}
				break;
			case "ready":
				if (pendingCount === 0 || inProgressCount > 0 || blockedCount > 0) {
					return "A ready session requires pending work and no in-progress or blocked feature.";
				}
				break;
			case "running":
				if (inProgressCount !== 1 || blockedCount > 0) {
					return "A running session requires exactly one in-progress feature and no blocked feature.";
				}
				break;
			case "blocked":
				if (blockedCount !== 1 || inProgressCount > 0) {
					return "A blocked session requires exactly one blocked feature and no in-progress feature.";
				}
				break;
			case "completed":
				if (completedCount !== featureCount) {
					return "A completed session requires every plan feature to be completed.";
				}
				break;
		}
		const featureStatuses = new Map(
			session.plan.features.map((feature) => [feature.id, feature.status]),
		);
		for (const feature of session.plan.features) {
			if (
				feature.status !== "pending" &&
				feature.dependsOn.some(
					(dependency) => featureStatuses.get(dependency) !== "completed",
				)
			) {
				return `Plan feature '${feature.id}' advanced before all dependencies completed.`;
			}
		}
	}
	if (
		isPlanning &&
		(session.featureRuns.length > 0 ||
			session.reviewAssignments.length > 0 ||
			session.history.length > 0 ||
			session.causal.evidence.length > 0 ||
			session.budget.reviewExecutions.length > 0)
	) {
		return "A planning session cannot retain execution or review graph state.";
	}

	const hasActiveFeature = session.activeFeatureId !== null;
	const hasActiveRun = session.activeFeatureRunId !== null;
	if (hasActiveFeature !== hasActiveRun) {
		return "Active feature and active feature run must be present or absent together.";
	}
	const activeRuns = session.featureRuns.filter(
		(run) => run.status === "active",
	);
	if (hasActiveRun) {
		if (activeRuns.length !== 1) {
			return "An active execution requires exactly one active feature run.";
		}
		const activeRun = activeRuns[0];
		if (
			!activeRun ||
			activeRun.id !== session.activeFeatureRunId ||
			activeRun.featureId !== session.activeFeatureId
		) {
			return "The active feature run must belong to the active feature.";
		}
		const activeFeature = session.plan?.features.find(
			(feature) => feature.id === session.activeFeatureId,
		);
		if (activeFeature?.status !== "in_progress") {
			return "The active execution must reference an in-progress plan feature.";
		}
		if (session.status !== "running" || session.closure !== null) {
			return "Only an open running session can have an active execution.";
		}
	} else if (activeRuns.length !== 0) {
		return "An active feature run cannot exist without active execution pointers.";
	}
	if (session.status === "running" && !session.closure && !hasActiveRun) {
		return "An open running session requires an active execution.";
	}

	const runs = new Map(session.featureRuns.map((run) => [run.id, run]));
	const features = new Map(
		(session.plan?.features ?? []).map((feature) => [feature.id, feature]),
	);
	const latestPlanSaveRevision =
		session.causal.mutations.findLast(
			(mutation) => mutation.operationKind === "plan_save",
		)?.revision ?? 0;
	for (const mutation of session.causal.mutations) {
		if (
			mutation.operationKind !== "feature_reset" ||
			mutation.revision <= latestPlanSaveRevision
		) {
			continue;
		}
		const expectedAffected =
			mutation.changedEntity.kind === "feature" && session.plan
				? resetAffectedFeatureIds(
						session.plan,
						mutation.changedEntity.id as FeatureId,
					)
				: null;
		if (
			!expectedAffected ||
			mutation.blockerDelta.added.length !== 0 ||
			JSON.stringify(mutation.blockerDelta.removed) !==
				JSON.stringify(expectedAffected)
		) {
			return `Feature reset '${mutation.operationId}' must record its exact dependency closure.`;
		}
	}
	const nextRunSequenceByFeature = new Map<FeatureId, number>();
	const latestRunByFeature = new Map<
		FeatureId,
		(typeof session.featureRuns)[number]
	>();
	for (const run of session.featureRuns) {
		const expectedSequence =
			(nextRunSequenceByFeature.get(run.featureId) ?? 0) + 1;
		if (run.sequence !== expectedSequence) {
			return `Feature run '${run.id}' is out of sequence for plan feature '${run.featureId}'.`;
		}
		nextRunSequenceByFeature.set(run.featureId, expectedSequence);
		latestRunByFeature.set(run.featureId, run);
	}
	for (const feature of features.values()) {
		const latestRun = latestRunByFeature.get(feature.id);
		if (feature.status === "completed" && latestRun?.status !== "completed") {
			return `Completed plan feature '${feature.id}' requires a latest completed feature run.`;
		}
		if (feature.status === "blocked" && latestRun?.status !== "blocked") {
			return `Blocked plan feature '${feature.id}' requires a latest blocked feature run.`;
		}
		if (
			feature.status === "in_progress" &&
			latestRun?.status !== "active" &&
			latestRun?.status !== "deferred" &&
			latestRun?.status !== "abandoned"
		) {
			return `In-progress plan feature '${feature.id}' requires a latest active or closed-active feature run.`;
		}
	}
	const lastFeatureCompletionByRun = new Map(
		session.causal.mutations
			.filter(
				(mutation) =>
					mutation.operationKind === "feature_complete" &&
					mutation.featureRunId !== null,
			)
			.map((mutation) => [mutation.featureRunId as string, mutation]),
	);
	for (const feature of features.values()) {
		const latestRun = latestRunByFeature.get(feature.id);
		if (
			feature.status === "pending" &&
			(latestRun?.status === "completed" || latestRun?.status === "blocked")
		) {
			const terminalMutation = lastFeatureCompletionByRun.get(latestRun.id);
			if (
				!terminalMutation ||
				!session.causal.mutations.some(
					(mutation) =>
						mutation.operationKind === "feature_reset" &&
						mutation.revision > terminalMutation.revision &&
						mutation.blockerDelta.removed.includes(feature.id),
				)
			) {
				return `Pending plan feature '${feature.id}' requires a later feature reset after its terminal run.`;
			}
		}
		if (feature.status !== "completed" && feature.status !== "blocked") {
			continue;
		}
		const terminalMutation = latestRun
			? lastFeatureCompletionByRun.get(latestRun.id)
			: undefined;
		if (
			terminalMutation &&
			session.causal.mutations.some(
				(mutation) =>
					mutation.operationKind === "feature_reset" &&
					mutation.revision > terminalMutation.revision &&
					mutation.blockerDelta.removed.includes(feature.id),
			)
		) {
			return `Plan feature '${feature.id}' cannot retain terminal status after a later feature reset.`;
		}
	}
	const runStartOwnerByRun = new Map<
		string,
		(typeof session.causal.mutations)[number]
	>();
	const terminalOwnerByRun = new Map<
		string,
		(typeof session.causal.mutations)[number]
	>();
	const previousRunByFeature = new Map<
		FeatureId,
		(typeof session.featureRuns)[number]
	>();
	for (const run of session.featureRuns) {
		const feature = features.get(run.featureId);
		if (!feature) {
			return `Feature run '${run.id}' references a missing plan feature.`;
		}
		const startedAt = time(run.startedAt);
		const endedAt = run.endedAt === null ? null : time(run.endedAt);
		if (startedAt === null || (run.endedAt !== null && endedAt === null)) {
			return `Feature run '${run.id}' contains an invalid timestamp.`;
		}
		if (
			(run.status === "active" && run.endedAt !== null) ||
			(run.status !== "active" && run.endedAt === null)
		) {
			return `Feature run '${run.id}' status must agree with its end time.`;
		}
		if (endedAt !== null && endedAt < startedAt) {
			return `Feature run '${run.id}' ends before it starts.`;
		}
		const startOwners = session.causal.mutations.filter(
			(mutation) =>
				mutation.operationKind === "run_start" &&
				mutation.featureRunId === run.id &&
				mutation.changedEntity.kind === "feature" &&
				mutation.changedEntity.id === run.featureId &&
				mutation.recordedAt === run.startedAt,
		);
		const startOwner = startOwners[0];
		if (startOwners.length !== 1 || !startOwner) {
			return `Feature run '${run.id}' must have one runtime-owned start mutation at its start time.`;
		}
		runStartOwnerByRun.set(run.id, startOwner);
		const previousRun = previousRunByFeature.get(run.featureId);
		if (previousRun) {
			const previousTerminal = terminalOwnerByRun.get(previousRun.id);
			if (
				!previousTerminal ||
				previousTerminal.revision >= startOwner.revision ||
				!session.causal.mutations.some(
					(mutation) =>
						mutation.operationKind === "feature_reset" &&
						mutation.revision >= previousTerminal.revision &&
						mutation.revision < startOwner.revision &&
						mutation.blockerDelta.removed.includes(run.featureId),
				)
			) {
				return `Feature run '${run.id}' requires a causal feature reset after its prior run and before its start.`;
			}
		}
		for (const dependency of feature.dependsOn) {
			const dependencyCompletion = session.causal.mutations
				.filter(
					(mutation) =>
						mutation.operationKind === "feature_complete" &&
						mutation.changedEntity.kind === "feature" &&
						mutation.changedEntity.id === dependency &&
						mutation.revision < startOwner.revision,
				)
				.at(-1);
			if (
				!dependencyCompletion ||
				session.causal.mutations.some(
					(mutation) =>
						mutation.operationKind === "feature_reset" &&
						mutation.revision > dependencyCompletion.revision &&
						mutation.revision < startOwner.revision &&
						mutation.blockerDelta.removed.includes(dependency),
				)
			) {
				return `Feature run '${run.id}' started before dependency '${dependency}' had a current successful completion.`;
			}
		}
		previousRunByFeature.set(run.featureId, run);
		if (run.status === "active") continue;

		const historyEntries = session.history.filter(
			(entry) => entry.featureRunId === run.id,
		);
		const terminalOwners = session.causal.mutations.filter((mutation) => {
			if (
				mutation.featureRunId !== run.id ||
				mutation.recordedAt !== run.endedAt
			) {
				return false;
			}
			switch (run.status) {
				case "completed":
					return (
						mutation.operationKind === "feature_complete" &&
						mutation.changedEntity.kind === "feature" &&
						mutation.changedEntity.id === run.featureId
					);
				case "blocked":
					return (
						mutation.operationKind === "feature_complete" &&
						mutation.changedEntity.kind === "review" &&
						lastFeatureCompletionByRun.get(run.id) === mutation
					);
				case "reset":
					return (
						mutation.operationKind === "feature_reset" &&
						mutation.changedEntity.kind === "feature" &&
						mutation.blockerDelta.removed.includes(run.featureId)
					);
				case "deferred":
				case "abandoned":
					return (
						mutation.operationKind === "session_close" &&
						mutation.changedEntity.kind === "closure" &&
						mutation.changedEntity.id === session.id
					);
				case "active":
					return false;
			}
			return false;
		});
		const terminalOwner = terminalOwners[0];
		if (
			terminalOwners.length !== 1 ||
			!terminalOwner ||
			terminalOwner.revision <= startOwner.revision
		) {
			return `Feature run '${run.id}' must have one runtime-owned terminal mutation at its end time.`;
		}
		terminalOwnerByRun.set(run.id, terminalOwner);
		if (
			(run.status === "reset" ||
				run.status === "deferred" ||
				run.status === "abandoned") &&
			historyEntries.length !== 0
		) {
			return `Non-outcome feature run '${run.id}' cannot have a feature-outcome history entry.`;
		}
	}

	const evidence = new Map(
		session.causal.evidence.map((record) => [record.evidenceId, record]),
	);
	for (const mutation of session.causal.mutations) {
		if (new Set(mutation.evidenceRefs).size !== mutation.evidenceRefs.length) {
			return `Causal mutation '${mutation.operationId}' contains duplicate evidence references.`;
		}
		for (const reference of mutation.evidenceRefs) {
			if (!evidence.has(reference)) {
				return `Causal mutation '${mutation.operationId}' references missing evidence '${reference}'.`;
			}
		}
		if (
			mutation.evidenceRefs.length > 0 &&
			mutation.operationKind !== "review_start" &&
			mutation.operationKind !== "feature_complete"
		) {
			return `Causal mutation '${mutation.operationId}' cannot accept evidence for operation kind '${mutation.operationKind}'.`;
		}
	}
	const assignments = new Map(
		session.reviewAssignments.map((assignment) => [assignment.id, assignment]),
	);
	for (const record of session.causal.evidence) {
		const run = runs.get(record.featureRunId);
		if (!run) {
			return `Evidence '${record.evidenceId}' references a missing feature run.`;
		}
		const startedAt = time(record.startedAt);
		const completedAt = time(record.completedAt);
		if (
			startedAt === null ||
			completedAt === null ||
			startedAt < (time(run.startedAt) ?? Number.POSITIVE_INFINITY) ||
			completedAt < startedAt
		) {
			return `Evidence '${record.evidenceId}' violates feature-run chronology.`;
		}
		if (
			record.capturedAtRevision > session.causal.revision ||
			record.capturedAtSnapshotId !==
				snapshotAtRevision(session, record.capturedAtRevision) ||
			record.snapshotId !== record.capturedAtSnapshotId
		) {
			return `Evidence '${record.evidenceId}' has an invalid capture checkpoint.`;
		}
		const acceptanceOwners = session.causal.mutations.filter((mutation) =>
			mutation.evidenceRefs.includes(record.evidenceId),
		);
		const acceptedBy = acceptanceOwners[0];
		if (
			acceptanceOwners.length !== 1 ||
			!acceptedBy ||
			completedAt > (time(acceptedBy.recordedAt) ?? -1)
		) {
			return `Evidence '${record.evidenceId}' postdates its accepting mutation.`;
		}
		if (
			record.capturedAtRevision !== acceptedBy.priorRevision ||
			record.capturedAtSnapshotId !== acceptedBy.priorSnapshotId
		) {
			return `Evidence '${record.evidenceId}' capture checkpoint disagrees with its accepting mutation.`;
		}
		if (
			(record.kind === "validation" &&
				acceptedBy.operationKind !== "review_start") ||
			(record.kind === "review" &&
				acceptedBy.operationKind !== "feature_complete")
		) {
			return `Evidence '${record.evidenceId}' was accepted by the wrong mutation kind.`;
		}
		if (acceptedBy.featureRunId !== record.featureRunId) {
			return `Evidence '${record.evidenceId}' was accepted for a different feature run.`;
		}
		if (record.kind === "validation") {
			const owner = assignments.get(acceptedBy.changedEntity.id);
			if (
				acceptedBy.changedEntity.kind !== "review" ||
				owner?.operationId !== acceptedBy.operationId ||
				owner.featureRunId !== record.featureRunId ||
				!owner.validationEvidenceRefs.includes(record.evidenceId)
			) {
				return `Validation evidence '${record.evidenceId}' is not bound to its review assignment.`;
			}
		} else {
			const assignment = assignments.get(record.assignmentId);
			const execution = assignment
				? assignmentExecution(session, assignment)
				: undefined;
			const assignmentMutation = assignment
				? session.causal.mutations.find(
						(mutation) =>
							mutation.operationKind === "review_start" &&
							mutation.operationId === assignment.operationId,
					)
				: undefined;
			const terminalOwner = terminalOwnerByRun.get(record.featureRunId);
			if (
				!assignment ||
				!execution ||
				!assignmentMutation ||
				acceptedBy.revision <= assignmentMutation.revision ||
				(terminalOwner !== undefined &&
					acceptedBy.revision > terminalOwner.revision) ||
				assignment.featureRunId !== record.featureRunId ||
				assignment.sourceDigest !== record.sourceDigest ||
				assignment.attemptId !== record.attemptId ||
				assignment.packetDigest !== record.packetDigest ||
				assignment.startedAt !== record.startedAt ||
				assignment.completedAt !== record.completedAt ||
				execution.completedAt !== record.completedAt
			) {
				return `Review evidence '${record.evidenceId}' is inconsistent with its assignment and execution.`;
			}
		}
		if (run.endedAt && completedAt > (time(run.endedAt) ?? -1)) {
			return `Evidence '${record.evidenceId}' postdates its feature run.`;
		}
		if (record.evidenceId !== canonicalEvidenceId(record)) {
			return `Evidence '${record.evidenceId}' does not match its canonical identity.`;
		}
	}

	const finalPrerequisitesByRunSourceAndAssignment = new Map<
		string,
		{ assignmentId: string; resultDigest: string }
	>();
	for (const assignment of session.reviewAssignments) {
		const run = runs.get(assignment.featureRunId);
		const feature = features.get(assignment.featureId);
		if (!run || run.featureId !== assignment.featureId) {
			return `Review assignment '${assignment.id}' does not match its feature run.`;
		}
		if (!feature) {
			return `Review assignment '${assignment.id}' references a missing plan feature.`;
		}
		const requiredScope =
			assignment.reviewKind === "final" ? "broad" : "targeted";
		if (assignment.validationScope !== requiredScope) {
			return `Review assignment '${assignment.id}' has a validation scope inconsistent with its review kind.`;
		}
		const requiredDepth =
			assignment.reviewKind === "final"
				? session.plan?.finalReviewPolicy
				: feature.reviewDepth;
		if (assignment.requiredDepth !== requiredDepth) {
			return `Review assignment '${assignment.id}' required depth disagrees with approved plan policy.`;
		}
		if (
			assignment.packetDigest !== canonicalReviewPacketDigest(assignment) ||
			assignment.attemptId !== canonicalReviewAttemptId(assignment.id) ||
			assignment.logicalPassId !==
				canonicalLogicalReviewPassId(
					assignment.featureRunId,
					assignment.reviewKind,
				)
		) {
			return `Review assignment '${assignment.id}' has invalid canonical review identity.`;
		}
		const assignmentMutation = session.causal.mutations.find(
			(mutation) =>
				mutation.operationId === assignment.operationId &&
				mutation.operationKind === "review_start",
		);
		if (
			!assignmentMutation ||
			assignmentMutation.featureRunId !== assignment.featureRunId ||
			assignmentMutation.changedEntity.kind !== "review" ||
			assignmentMutation.changedEntity.id !== assignment.id
		) {
			return `Review assignment '${assignment.id}' has no matching start mutation.`;
		}
		const assignmentStartedAt = time(assignment.startedAt);
		const runStartOwner = runStartOwnerByRun.get(run.id);
		const terminalOwner = terminalOwnerByRun.get(run.id);
		if (
			assignmentStartedAt === null ||
			assignmentStartedAt !== time(assignmentMutation.recordedAt) ||
			assignmentStartedAt < (time(run.startedAt) ?? Number.POSITIVE_INFINITY) ||
			!runStartOwner ||
			assignmentMutation.revision <= runStartOwner.revision ||
			(terminalOwner !== undefined &&
				assignmentMutation.revision >= terminalOwner.revision)
		) {
			return `Review assignment '${assignment.id}' violates start chronology.`;
		}
		if (
			run.endedAt !== null &&
			assignmentStartedAt > (time(run.endedAt) ?? -1)
		) {
			return `Review assignment '${assignment.id}' starts after its feature run ended.`;
		}
		if (
			new Set(assignment.validationEvidenceRefs).size !==
				assignment.validationEvidenceRefs.length ||
			JSON.stringify(assignmentMutation.evidenceRefs) !==
				JSON.stringify(assignment.validationEvidenceRefs)
		) {
			return `Review assignment '${assignment.id}' validation evidence disagrees with its start mutation.`;
		}
		for (const reference of assignment.validationEvidenceRefs) {
			const validation = evidence.get(reference);
			if (
				validation?.kind !== "validation" ||
				validation.featureRunId !== assignment.featureRunId ||
				validation.sourceDigest !== assignment.sourceDigest ||
				validation.exitCode !== 0
			) {
				return `Review assignment '${assignment.id}' has invalid validation evidence.`;
			}
			if (
				(time(validation.completedAt) ?? Number.POSITIVE_INFINITY) >
				assignmentStartedAt
			) {
				return `Review assignment '${assignment.id}' starts before validation completes.`;
			}
		}

		const execution = assignmentExecution(session, assignment);
		if (assignment.status === "pending") {
			if (execution || assignment.completedAt || assignment.invalidatedAt) {
				return `Pending review assignment '${assignment.id}' has terminal state.`;
			}
			if (assignment.featureRunId !== session.activeFeatureRunId) {
				return `Pending review assignment '${assignment.id}' is not actionable on the active run.`;
			}
		} else if (
			assignment.status === "submitted" ||
			assignment.status === "observed_unsubmitted"
		) {
			if (
				!execution ||
				execution.terminalDisposition !== assignment.status ||
				execution.completedAt !== assignment.completedAt
			) {
				return `Terminal review assignment '${assignment.id}' has no matching recorded execution.`;
			}
		} else if (execution) {
			return `Invalidated review assignment '${assignment.id}' cannot have a recorded execution.`;
		}
		if (assignment.invalidatedAt !== null) {
			const invalidatedAt = time(assignment.invalidatedAt);
			if (
				invalidatedAt === null ||
				(run.endedAt !== null && invalidatedAt > (time(run.endedAt) ?? -1)) ||
				(assignment.invalidationReason !== "source_changed" &&
					run.endedAt === null)
			) {
				return `Invalidated review assignment '${assignment.id}' outlives its feature run.`;
			}

			let invalidationOwners = session.causal.mutations.filter(
				(mutation) =>
					mutation.featureRunId === assignment.featureRunId &&
					mutation.recordedAt === assignment.invalidatedAt,
			);
			switch (assignment.invalidationReason) {
				case "source_changed": {
					const assignmentIndex = session.reviewAssignments.indexOf(assignment);
					const replacement = session.reviewAssignments
						.slice(assignmentIndex + 1)
						.find(
							(candidate) =>
								candidate.featureRunId === assignment.featureRunId &&
								candidate.reviewKind === assignment.reviewKind,
						);
					invalidationOwners = invalidationOwners.filter(
						(mutation) =>
							replacement !== undefined &&
							replacement.sourceDigest !== assignment.sourceDigest &&
							mutation.operationKind === "review_start" &&
							mutation.operationId === replacement.operationId &&
							mutation.changedEntity.kind === "review" &&
							mutation.changedEntity.id === replacement.id,
					);
					break;
				}
				case "feature_reset":
					invalidationOwners = invalidationOwners.filter(
						(mutation) =>
							mutation.operationKind === "feature_reset" &&
							mutation.changedEntity.kind === "feature",
					);
					break;
				case "session_deferred":
				case "session_abandoned":
					invalidationOwners = invalidationOwners.filter(
						(mutation) =>
							mutation.operationKind === "session_close" &&
							mutation.changedEntity.kind === "closure" &&
							mutation.changedEntity.id === session.id &&
							session.closure?.retryOperationId === mutation.operationId,
					);
					break;
				case null:
					invalidationOwners = [];
					break;
			}
			if (
				invalidationOwners.length !== 1 ||
				(invalidationOwners[0]?.revision ?? -1) <= assignmentMutation.revision
			) {
				return `Invalidated review assignment '${assignment.id}' must have one runtime-owned invalidation mutation at its invalidation time.`;
			}
		}
		if (
			(assignment.invalidationReason === "feature_reset" &&
				run.status !== "reset") ||
			(assignment.invalidationReason === "session_deferred" &&
				run.status !== "deferred") ||
			(assignment.invalidationReason === "session_abandoned" &&
				run.status !== "abandoned")
		) {
			return `Review assignment '${assignment.id}' invalidation reason disagrees with its feature run.`;
		}

		if (assignment.reviewKind === "feature" && assignment.prerequisite) {
			return `Feature review assignment '${assignment.id}' cannot have a prerequisite.`;
		}
		if (assignment.reviewKind === "final" && !assignment.prerequisite) {
			return `Final review assignment '${assignment.id}' requires a bound prerequisite.`;
		}
		if (assignment.prerequisite) {
			const prerequisite = assignment.prerequisite;
			const referenced = assignments.get(prerequisite.assignmentId);
			if (
				prerequisite.result.assignmentId !== prerequisite.assignmentId ||
				prerequisite.resultDigest !==
					canonicalReviewAssignmentResultDigest(prerequisite.result)
			) {
				return `Final review assignment '${assignment.id}' has a tampered prerequisite result.`;
			}
			if (
				referenced?.reviewKind !== "feature" ||
				referenced.featureRunId !== assignment.featureRunId ||
				referenced.featureId !== assignment.featureId ||
				referenced.sourceDigest !== assignment.sourceDigest
			) {
				return `Final review assignment '${assignment.id}' has an unrelated prerequisite assignment.`;
			}
			if (
				prerequisite.result.verdict !== "passed" ||
				prerequisite.result.terminalDisposition !== "submitted" ||
				prerequisite.result.findings.some(
					(finding) => finding.severity === "blocking",
				)
			) {
				return `Final review assignment '${assignment.id}' requires a submitted passing prerequisite.`;
			}
			const bindingKey = `${assignment.featureRunId}\u0000${assignment.sourceDigest}\u0000${prerequisite.assignmentId}`;
			const durableBinding =
				finalPrerequisitesByRunSourceAndAssignment.get(bindingKey);
			if (
				durableBinding &&
				(durableBinding.assignmentId !== prerequisite.assignmentId ||
					durableBinding.resultDigest !== prerequisite.resultDigest)
			) {
				return `Final review assignments for feature run '${assignment.featureRunId}' diverge from the first durable prerequisite binding for their source and feature assignment.`;
			}
			finalPrerequisitesByRunSourceAndAssignment.set(bindingKey, {
				assignmentId: prerequisite.assignmentId,
				resultDigest: prerequisite.resultDigest,
			});
			const prerequisiteCompletedAt = time(prerequisite.result.completedAt);
			if (
				prerequisiteCompletedAt === null ||
				prerequisiteCompletedAt > assignmentStartedAt
			) {
				return `Final review assignment '${assignment.id}' predates its prerequisite result.`;
			}
			for (const reference of assignment.validationEvidenceRefs) {
				const validation = evidence.get(reference);
				if (
					validation?.kind !== "validation" ||
					validation.commandClass === undefined ||
					(time(validation.startedAt) ?? -1) < prerequisiteCompletedAt
				) {
					return `Final review assignment '${assignment.id}' has broad validation before feature review completion.`;
				}
			}
			const recordedPrerequisite = assignmentExecution(session, referenced);
			if (
				recordedPrerequisite &&
				!resultMatchesExecution(prerequisite.result, recordedPrerequisite)
			) {
				return `Final review assignment '${assignment.id}' prerequisite differs from recorded review execution.`;
			}
		}
	}

	for (const execution of session.budget.reviewExecutions) {
		const assignment = assignments.get(execution.assignmentId);
		const run = runs.get(execution.featureRunId);
		const completedAt = time(execution.completedAt);
		if (
			!assignment ||
			!run ||
			execution.featureRunId !== assignment.featureRunId ||
			execution.attemptId !== assignment.attemptId ||
			execution.logicalPassId !== assignment.logicalPassId ||
			execution.featureId !== assignment.featureId ||
			execution.reviewKind !== assignment.reviewKind ||
			execution.reviewSnapshotId !== assignment.packetDigest ||
			execution.startedAt !== assignment.startedAt ||
			completedAt === null ||
			completedAt < (time(execution.startedAt) ?? Number.POSITIVE_INFINITY)
		) {
			return `Recorded review execution '${execution.assignmentId}' is inconsistent with its assignment.`;
		}
		if (
			execution.findings.some(
				(finding) =>
					finding.fingerprint !== stableReviewFindingFingerprint(finding),
			)
		) {
			return `Recorded review execution '${execution.assignmentId}' has a noncanonical finding fingerprint.`;
		}
		const reviewRecords = session.causal.evidence.filter(
			(record): record is Extract<EvidenceRecord, { kind: "review" }> =>
				record.kind === "review" &&
				record.assignmentId === execution.assignmentId,
		);
		const reviewRecord = reviewRecords[0];
		const acceptedBy = reviewRecord
			? evidenceAcceptanceMutation(session, reviewRecord)
			: undefined;
		if (
			reviewRecords.length !== 1 ||
			!reviewRecord ||
			!acceptedBy ||
			acceptedBy.operationKind !== "feature_complete" ||
			acceptedBy.featureRunId !== execution.featureRunId ||
			reviewRecord.sourceDigest !== assignment.sourceDigest ||
			reviewRecord.attemptId !== assignment.attemptId ||
			reviewRecord.packetDigest !== assignment.packetDigest ||
			reviewRecord.startedAt !== assignment.startedAt ||
			reviewRecord.completedAt !== execution.completedAt ||
			completedAt > (time(acceptedBy.recordedAt) ?? -1)
		) {
			return `Recorded review execution '${execution.assignmentId}' lacks trusted acceptance evidence.`;
		}
		if (run.endedAt && completedAt > (time(run.endedAt) ?? -1)) {
			return `Recorded review execution '${execution.assignmentId}' postdates its feature run.`;
		}
	}

	const retainedOutcomeRunIds: string[] = [];
	let successfulCompletionReviewCount = 0;
	let latestSuccessfulCompletionTime: string | null = null;
	for (const mutation of session.causal.mutations) {
		if (mutation.operationKind !== "feature_complete") continue;
		const run = mutation.featureRunId
			? runs.get(mutation.featureRunId)
			: undefined;
		const reviewRecords = mutation.evidenceRefs.map((reference) =>
			evidence.get(reference),
		);
		if (
			!run ||
			reviewRecords.length === 0 ||
			reviewRecords.some((record) => record?.kind !== "review")
		) {
			return `Feature completion '${mutation.operationId}' has invalid review evidence.`;
		}
		const mutationAssignmentIds = reviewRecords.map((record) =>
			record?.kind === "review" ? record.assignmentId : null,
		);
		const mutationAssignments = mutationAssignmentIds.map((assignmentId) =>
			assignmentId ? assignments.get(assignmentId) : undefined,
		);
		const mutationExecutions = mutationAssignments.map((assignment) =>
			assignment ? assignmentExecution(session, assignment) : undefined,
		);
		const terminalAssignment = mutationAssignments.at(-1);
		const terminalExecution = mutationExecutions.at(-1);
		if (
			mutationAssignmentIds.some((assignmentId) => !assignmentId) ||
			new Set(mutationAssignmentIds).size !== mutationAssignmentIds.length ||
			mutationAssignments.some(
				(assignment) =>
					!assignment || assignment.featureRunId !== mutation.featureRunId,
			) ||
			mutationExecutions.some((execution) => !execution) ||
			!terminalAssignment ||
			!terminalExecution
		) {
			return `Feature completion '${mutation.operationId}' has an invalid assignment execution graph.`;
		}

		if (mutation.changedEntity.kind === "feature") {
			const expectedAssignmentIds =
				terminalAssignment.reviewKind === "final"
					? [
							terminalAssignment.prerequisite?.assignmentId,
							terminalAssignment.id,
						]
					: [terminalAssignment.id];
			if (
				run.status !== "completed" ||
				run.endedAt !== mutation.recordedAt ||
				mutation.changedEntity.id !== run.featureId ||
				JSON.stringify(mutationAssignmentIds) !==
					JSON.stringify(expectedAssignmentIds) ||
				mutationExecutions.some(
					(execution) =>
						execution?.verdict !== "passed" ||
						execution.terminalDisposition !== "submitted",
				)
			) {
				return `Successful feature completion '${mutation.operationId}' disagrees with its terminal run and review outcomes.`;
			}
			retainedOutcomeRunIds.push(run.id);
			successfulCompletionReviewCount += reviewRecords.length;
			latestSuccessfulCompletionTime = mutation.recordedAt;
			continue;
		}

		if (mutation.changedEntity.kind !== "review") {
			return `Blocked feature completion '${mutation.operationId}' must identify its failed review assignment.`;
		}
		const isTerminalBlocked =
			run.status === "blocked" &&
			run.endedAt === mutation.recordedAt &&
			lastFeatureCompletionByRun.get(run.id) === mutation;
		const expectedAssignmentIds =
			isTerminalBlocked && terminalAssignment.reviewKind === "final"
				? [terminalAssignment.prerequisite?.assignmentId, terminalAssignment.id]
				: [terminalAssignment.id];
		if (
			mutation.changedEntity.id !== terminalAssignment.id ||
			terminalExecution.verdict !== "failed" ||
			JSON.stringify(mutationAssignmentIds) !==
				JSON.stringify(expectedAssignmentIds) ||
			mutationExecutions
				.slice(0, -1)
				.some(
					(execution) =>
						execution?.verdict !== "passed" ||
						execution.terminalDisposition !== "submitted",
				)
		) {
			return `Blocked feature completion '${mutation.operationId}' disagrees with its review outcomes.`;
		}
		if (isTerminalBlocked) retainedOutcomeRunIds.push(run.id);
	}
	const expectedHistoryRunIds = retainedOutcomeRunIds.slice(
		-MAX_HISTORY_ENTRIES,
	);
	if (
		session.status === "completed" &&
		session.timestamps.completedAt !== latestSuccessfulCompletionTime
	) {
		return "Session completion timestamp must identify the latest successful feature completion.";
	}
	if (
		JSON.stringify(session.history.map((entry) => entry.featureRunId)) !==
		JSON.stringify(expectedHistoryRunIds)
	) {
		return "Canonical history must retain the latest terminal feature outcomes in causal order.";
	}

	for (const entry of session.history) {
		const run = runs.get(entry.featureRunId);
		if (
			!run ||
			run.featureId !== entry.featureId ||
			run.status !== entry.status ||
			entry.outcome.kind !== entry.status ||
			entry.outcome.summary !== entry.summary ||
			entry.recordedAt !== run.endedAt
		) {
			return `History entry '${entry.featureRunId}' does not match its terminal feature run.`;
		}
		const historyAssignments = entry.reviewAssignmentIds.map((reference) =>
			assignments.get(reference),
		);
		const historyExecutions = historyAssignments.map((assignment) =>
			assignment ? assignmentExecution(session, assignment) : undefined,
		);
		if (
			new Set(entry.validationEvidenceRefs).size !==
				entry.validationEvidenceRefs.length ||
			new Set(entry.reviewAssignmentIds).size !==
				entry.reviewAssignmentIds.length ||
			entry.validationEvidenceRefs.some((reference) => {
				const record = evidence.get(reference);
				return (
					record?.kind !== "validation" ||
					record.featureRunId !== entry.featureRunId
				);
			}) ||
			historyAssignments.some(
				(assignment) =>
					!assignment ||
					assignment.featureRunId !== entry.featureRunId ||
					(assignment.status !== "submitted" &&
						assignment.status !== "observed_unsubmitted"),
			) ||
			historyExecutions.some((execution) => !execution)
		) {
			return `History entry '${entry.featureRunId}' contains an unresolved evidence or assignment reference.`;
		}
		const terminalAssignment = historyAssignments.at(-1);
		const terminalMutations = session.causal.mutations.filter(
			(mutation) =>
				mutation.operationKind === "feature_complete" &&
				mutation.featureRunId === entry.featureRunId &&
				mutation.recordedAt === entry.recordedAt &&
				(entry.status === "completed"
					? mutation.changedEntity.kind === "feature" &&
						mutation.changedEntity.id === entry.featureId
					: mutation.changedEntity.kind === "review" &&
						mutation.changedEntity.id === terminalAssignment?.id),
		);
		const terminalMutation = terminalMutations[0];
		const terminalReviewEvidence = terminalMutation?.evidenceRefs.map(
			(reference) => evidence.get(reference),
		);
		const terminalMutationAssignmentIds = terminalReviewEvidence?.map(
			(record) => (record?.kind === "review" ? record.assignmentId : null),
		);
		const expectedAssignmentIds = terminalAssignment
			? terminalAssignment.reviewKind === "final"
				? [terminalAssignment.prerequisite?.assignmentId, terminalAssignment.id]
				: [terminalAssignment.id]
			: [];
		const expectedValidationRefs =
			entry.status === "completed"
				? [
						...new Set(
							historyAssignments.flatMap(
								(assignment) => assignment?.validationEvidenceRefs ?? [],
							),
						),
					]
				: [...(terminalAssignment?.validationEvidenceRefs ?? [])];
		if (
			!terminalAssignment ||
			terminalMutations.length !== 1 ||
			!terminalMutation ||
			!terminalReviewEvidence ||
			terminalReviewEvidence.length === 0 ||
			terminalMutationAssignmentIds?.some((assignmentId) => !assignmentId) ||
			JSON.stringify(entry.reviewAssignmentIds) !==
				JSON.stringify(expectedAssignmentIds) ||
			JSON.stringify(entry.reviewAssignmentIds) !==
				JSON.stringify(terminalMutationAssignmentIds) ||
			JSON.stringify(entry.validationEvidenceRefs) !==
				JSON.stringify(expectedValidationRefs) ||
			entry.validationScope !== terminalAssignment.validationScope ||
			(entry.status === "completed" &&
				historyExecutions.some(
					(execution) =>
						execution?.verdict !== "passed" ||
						execution.terminalDisposition !== "submitted",
				)) ||
			(entry.status === "blocked" &&
				(historyExecutions.at(-1)?.verdict !== "failed" ||
					historyExecutions
						.slice(0, -1)
						.some(
							(execution) =>
								execution?.verdict !== "passed" ||
								execution.terminalDisposition !== "submitted",
						)))
		) {
			return `History entry '${entry.featureRunId}' disagrees with its terminal review outcomes.`;
		}
	}
	if (session.status === "blocked") {
		const terminalEntry = session.history.at(-1);
		const expectedRecovery =
			terminalEntry?.outcome.kind === "blocked"
				? (terminalEntry.outcome.resolutionHint ??
					"Reset or replan only after explicit user direction.")
				: null;
		if (
			terminalEntry?.status !== "blocked" ||
			session.lastError?.tool !== "flow_feature_complete" ||
			session.lastError.summary !== terminalEntry.summary ||
			session.lastError.recordedAt !== terminalEntry.recordedAt ||
			session.lastError.recovery !== expectedRecovery
		) {
			return "Blocked session error must exactly match its latest terminal history outcome.";
		}
	}

	const expectedFailedByRun = new Map<string, number>();
	let featureAttemptCount = 0;
	let finalAttemptCount = 0;
	let passedVerdictCount = 0;
	let failedVerdictCount = 0;
	for (const execution of session.budget.reviewExecutions) {
		if (execution.reviewKind === "feature") featureAttemptCount += 1;
		else finalAttemptCount += 1;
		if (execution.verdict === "passed") {
			passedVerdictCount += 1;
		} else {
			failedVerdictCount += 1;
			expectedFailedByRun.set(
				execution.featureRunId,
				(expectedFailedByRun.get(execution.featureRunId) ?? 0) + 1,
			);
		}
	}
	const actualFailedByRun = Object.entries(
		session.budget.failedReviewAttemptsByFeatureRun,
	).sort(([left], [right]) => left.localeCompare(right));
	const canonicalFailedByRun = [...expectedFailedByRun.entries()].sort(
		([left], [right]) => left.localeCompare(right),
	);
	if (
		session.budget.failedReviewCount !== failedVerdictCount ||
		JSON.stringify(actualFailedByRun) !== JSON.stringify(canonicalFailedByRun)
	) {
		return "Failed-review counters must exactly match the recorded review execution ledger.";
	}
	const lifecycle = session.budget.reviewLifecycle;
	if (
		lifecycle.featureAttemptCount !== featureAttemptCount ||
		lifecycle.finalAttemptCount !== finalAttemptCount ||
		lifecycle.passedVerdictCount !== passedVerdictCount ||
		lifecycle.failedVerdictCount !== failedVerdictCount ||
		lifecycle.retryConsumedCount !== failedVerdictCount
	) {
		return "Review lifecycle counters must exactly match the recorded review execution ledger.";
	}
	if (session.budget.reviewCount !== successfulCompletionReviewCount) {
		return "Completed-review count must equal review evidence accepted by successful feature completions.";
	}

	let priorMutationTime = createdAt;
	for (const mutation of session.causal.mutations) {
		const recordedAt = time(mutation.recordedAt);
		if (recordedAt === null || recordedAt < priorMutationTime) {
			return `Causal mutation '${mutation.operationId}' violates runtime chronology.`;
		}
		priorMutationTime = recordedAt;
	}
	const latestMutation = session.causal.mutations.at(-1);
	if (
		latestMutation &&
		latestMutation.recordedAt !== session.timestamps.updatedAt
	) {
		return "Session update time must equal the latest accepting mutation time.";
	}

	if (session.closure) {
		const closure = session.closure;
		if (
			(session.closure.kind === "completed") !==
			(session.status === "completed")
		) {
			return "Session closure kind must agree with completed workflow status.";
		}
		if (
			hasActiveFeature ||
			hasActiveRun ||
			activeRuns.length > 0 ||
			session.reviewAssignments.some(
				(assignment) => assignment.status === "pending",
			)
		) {
			return "A closed session cannot retain actionable execution or review work.";
		}
		const closeMutation = session.causal.mutations.find(
			(mutation) =>
				mutation.operationId === session.closure?.retryOperationId &&
				mutation.operationKind === "session_close",
		);
		const omittedSummaryRequestDigest = closeMutation
			? canonicalOperationRequestDigest("session_close", {
					mode: "start",
					kind: session.closure.kind,
					summary: undefined,
					expectedRevision: closeMutation.priorRevision,
					expectedSnapshotId: closeMutation.priorSnapshotId,
				})
			: null;
		const explicitSummaryRequestDigest = closeMutation
			? canonicalOperationRequestDigest("session_close", {
					mode: "start",
					kind: session.closure.kind,
					summary: session.closure.summary,
					expectedRevision: closeMutation.priorRevision,
					expectedSnapshotId: closeMutation.priorSnapshotId,
				})
			: null;
		const closureSummaryMatchesRequest =
			closeMutation?.requestDigest === explicitSummaryRequestDigest ||
			(closeMutation?.requestDigest === omittedSummaryRequestDigest &&
				session.closure.summary ===
					`Session closed as ${session.closure.kind}.`);
		const closedRun = closeMutation?.featureRunId
			? runs.get(closeMutation.featureRunId)
			: undefined;
		const expectedInvalidationReason =
			session.closure.kind === "deferred"
				? "session_deferred"
				: session.closure.kind === "abandoned"
					? "session_abandoned"
					: null;
		if (
			closeMutation?.changedEntity.kind !== "closure" ||
			closeMutation.changedEntity.id !== session.id ||
			closeMutation.recordedAt !== session.closure.recordedAt ||
			!closureSummaryMatchesRequest ||
			(session.closure.kind === "completed" &&
				closeMutation.featureRunId !== null) ||
			(session.closure.kind !== "completed" &&
				closeMutation.featureRunId !== null &&
				(!closedRun ||
					closedRun.status !== session.closure.kind ||
					closedRun.endedAt !== session.closure.recordedAt)) ||
			session.reviewAssignments.some((assignment) => {
				if (
					assignment.invalidationReason !== "session_deferred" &&
					assignment.invalidationReason !== "session_abandoned"
				) {
					return false;
				}
				return (
					assignment.invalidationReason !== expectedInvalidationReason ||
					assignment.invalidatedAt !== closure.recordedAt ||
					assignment.featureRunId !== closeMutation.featureRunId
				);
			}) ||
			session.causal.mutations.at(-1)?.operationId !==
				session.closure.retryOperationId
		) {
			return "Session closure must identify its accepted close mutation.";
		}
	}

	return null;
}
