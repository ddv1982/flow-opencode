import type { Feature, Session } from "./schema";

export type ContextDiagnosticSeverity = "info" | "warn";
export type WorkflowReadinessState =
	| "planning_ready"
	| "execution_ready"
	| "feature_review_ready"
	| "final_review_ready"
	| "release_ready"
	| "blocked_by_context"
	| "blocked_by_validation"
	| "blocked_by_review";

export type ContextDiagnostic = {
	id: string;
	severity: ContextDiagnosticSeverity;
	summary: string;
	featureId?: string;
	remediation: string;
};

export type FeatureContextProjection = {
	id: string;
	title: string;
	status: Feature["status"];
	fileTargets: string[];
	reviewScope: string[];
	verification: string[];
};

export type TraceabilityGap = {
	id: string;
	severity: ContextDiagnosticSeverity;
	summary: string;
	remediation: string;
};

export type FeatureTraceabilityProjection = FeatureContextProjection & {
	changedArtifacts: string[];
	validationCommands: string[];
	reviewerDecisionStatus: string | null;
	featureReviewStatus: string | null;
	finalReviewStatus: string | null;
	gaps: TraceabilityGap[];
};

export type ContextTraceabilityProjection = {
	plannedTargetCount: number;
	changedArtifactCount: number;
	validationCommandCount: number;
	unplannedChangedArtifacts: string[];
	reviewedFeatureCount: number;
	features: FeatureTraceabilityProjection[];
};

export type WorkflowReadinessProjection = {
	state: WorkflowReadinessState;
	blocking: Array<{
		id: string;
		featureId?: string;
		summary: string;
		remediation: string;
	}>;
	warnings: Array<{
		id: string;
		featureId?: string;
		summary: string;
	}>;
	nextAction: string;
};

export type ContextPackProjection = {
	sessionId: string;
	goal: string;
	repoProfile: string[];
	research: string[];
	requirements: string[];
	architectureDecisions: string[];
	notes: string[];
	features: FeatureContextProjection[];
	changedArtifacts: string[];
	validationCommands: string[];
	diagnostics: ContextDiagnostic[];
	traceability: ContextTraceabilityProjection;
	workflowReadiness: WorkflowReadinessProjection;
};

function uniqueStrings(values: string[]): string[] {
	return Array.from(
		new Set(values.map((value) => value.trim()).filter(Boolean)),
	);
}

function featureReviewScope(feature: Feature): string[] {
	return uniqueStrings([
		...feature.fileTargets,
		...(feature.reviewScope ?? []).map((target) =>
			target.description
				? `${target.kind}:${target.target} (${target.description})`
				: `${target.kind}:${target.target}`,
		),
	]);
}

function featureReviewScopeTargets(feature: Feature): string[] {
	return uniqueStrings(
		(feature.reviewScope ?? []).map((target) => target.target),
	);
}

function featureContextTargets(feature: Feature): string[] {
	return uniqueStrings([
		...feature.fileTargets,
		...featureReviewScopeTargets(feature),
	]);
}

function changedArtifactPaths(session: Session): string[] {
	return uniqueStrings([
		...session.artifacts.map((artifact) => artifact.path),
		...session.execution.history.flatMap((entry) =>
			entry.artifactsChanged.map((artifact) => artifact.path),
		),
	]);
}

function validationCommands(session: Session): string[] {
	return uniqueStrings([
		...session.execution.lastValidationRun.map((entry) => entry.command),
		...session.execution.history.flatMap((entry) =>
			entry.validationRun.map((validation) => validation.command),
		),
	]);
}

function plannedContextTargets(features: Feature[]): Set<string> {
	return new Set(features.flatMap((feature) => featureContextTargets(feature)));
}

function artifactMatchesTarget(path: string, target: string): boolean {
	if (path === target) {
		return true;
	}
	if (target.endsWith("/") && path.startsWith(target)) {
		return true;
	}
	if (target.includes("*")) {
		const escaped = target
			.split("*")
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
			.join(".*");
		return new RegExp(`^${escaped}$`).test(path);
	}
	return false;
}

function artifactMatchesAnyTarget(
	path: string,
	targets: Iterable<string>,
): boolean {
	for (const target of targets) {
		if (artifactMatchesTarget(path, target)) {
			return true;
		}
	}
	return false;
}

function featureHistoryEntries(session: Session, featureId: string) {
	return session.execution.history.filter(
		(entry) => entry.featureId === featureId,
	);
}

function lastValue<T>(values: Array<T | null | undefined>): T | null {
	for (let index = values.length - 1; index >= 0; index -= 1) {
		const value = values[index];
		if (value !== null && value !== undefined) {
			return value;
		}
	}
	return null;
}

function featureTraceability(
	session: Session,
	feature: Feature,
): FeatureTraceabilityProjection {
	const history = featureHistoryEntries(session, feature.id);
	const targets = featureContextTargets(feature);
	const changedArtifacts = uniqueStrings(
		history.flatMap((entry) =>
			entry.artifactsChanged.map((artifact) => artifact.path),
		),
	);
	const validationCommandsForFeature = uniqueStrings(
		history.flatMap((entry) =>
			entry.validationRun.map((validation) => validation.command),
		),
	);
	const reviewerDecision = lastValue(
		history.map((entry) => entry.reviewerDecision ?? null),
	);
	const featureReview = lastValue(history.map((entry) => entry.featureReview));
	const finalReview = lastValue(history.map((entry) => entry.finalReview));
	const unplannedChangedArtifacts = changedArtifacts.filter(
		(path) => !artifactMatchesAnyTarget(path, targets),
	);
	const gaps: TraceabilityGap[] = [];

	if (
		changedArtifacts.length > 0 &&
		validationCommandsForFeature.length === 0
	) {
		gaps.push({
			id: "feature_changed_without_validation",
			severity: "warn",
			summary: `Feature '${feature.id}' changed artifacts but has no recorded validation commands.`,
			remediation:
				"Run and record targeted validation that covers the changed artifacts before review or completion claims.",
		});
	}

	if (unplannedChangedArtifacts.length > 0) {
		gaps.push({
			id: "feature_changed_artifacts_outside_scope",
			severity: "warn",
			summary: `Feature '${feature.id}' changed artifacts outside its planned targets or review scope: ${unplannedChangedArtifacts.join(", ")}.`,
			remediation:
				"Review whether the artifacts are legitimate scope expansion; reset/replan when they change the approved plan.",
		});
	}

	if (feature.status === "completed" && !featureReview) {
		gaps.push({
			id: "completed_feature_missing_feature_review",
			severity: "warn",
			summary: `Feature '${feature.id}' is completed but no feature review payload is visible in history.`,
			remediation:
				"Inspect persisted completion evidence and rerun the feature completion path if review evidence is missing.",
		});
	}

	if (
		session.plan?.deliveryPolicy?.strictReview &&
		feature.status === "completed" &&
		reviewerDecision?.status !== "approved"
	) {
		gaps.push({
			id: "strict_review_feature_missing_approval",
			severity: "warn",
			summary: `Feature '${feature.id}' is completed without an approved recorded reviewer decision under strict review.`,
			remediation:
				"Run the read-only review lane and record an approved feature decision before claiming the session is review-complete.",
		});
	}

	return {
		id: feature.id,
		title: feature.title,
		status: feature.status,
		fileTargets: feature.fileTargets,
		reviewScope: featureReviewScope(feature),
		verification: feature.verification,
		changedArtifacts,
		validationCommands: validationCommandsForFeature,
		reviewerDecisionStatus: reviewerDecision?.status ?? null,
		featureReviewStatus: featureReview?.status ?? null,
		finalReviewStatus: finalReview?.status ?? null,
		gaps,
	};
}

function buildTraceabilityProjection(
	session: Session,
	features: Feature[],
	changedArtifacts: string[],
	commands: string[],
): ContextTraceabilityProjection {
	const plannedTargets = plannedContextTargets(features);
	const featureTraceabilityRows = features.map((feature) =>
		featureTraceability(session, feature),
	);

	return {
		plannedTargetCount: plannedTargets.size,
		changedArtifactCount: changedArtifacts.length,
		validationCommandCount: commands.length,
		unplannedChangedArtifacts: changedArtifacts.filter(
			(path) => !artifactMatchesAnyTarget(path, plannedTargets),
		),
		reviewedFeatureCount: featureTraceabilityRows.filter(
			(feature) =>
				feature.reviewerDecisionStatus === "approved" ||
				feature.featureReviewStatus === "passed",
		).length,
		features: featureTraceabilityRows,
	};
}

function contextDiagnostics(
	session: Session,
	features: Feature[],
	changedArtifacts: string[],
	commands: string[],
): ContextDiagnostic[] {
	const diagnostics: ContextDiagnostic[] = [];

	if (session.planning.repoProfile.length === 0) {
		diagnostics.push({
			id: "missing_repo_profile",
			severity: "warn",
			summary: "Planning context has no repo profile entries.",
			remediation:
				"Record package manager, build/test commands, framework conventions, and local house rules before relying on the plan.",
		});
	}

	if (session.planning.research.length === 0) {
		diagnostics.push({
			id: "missing_research",
			severity: "warn",
			summary: "Planning context has no inspected references.",
			remediation:
				"Record the source files, tests, docs, configs, or prior decisions inspected during planning.",
		});
	}

	for (const feature of features) {
		if (feature.fileTargets.length === 0) {
			diagnostics.push({
				id: "feature_missing_file_targets",
				severity: "warn",
				featureId: feature.id,
				summary: `Feature '${feature.id}' has no planned file targets.`,
				remediation:
					"Add the expected source, test, documentation, or configuration surfaces to feature fileTargets before execution.",
			});
		}

		if (featureReviewScope(feature).length === 0) {
			diagnostics.push({
				id: "feature_missing_review_scope",
				severity: "warn",
				featureId: feature.id,
				summary: `Feature '${feature.id}' has no reviewable context scope.`,
				remediation:
					"Record fileTargets or reviewScope entries so review can compare implementation against the planned context.",
			});
		}

		if (feature.verification.length === 0) {
			diagnostics.push({
				id: "feature_missing_verification",
				severity: "warn",
				featureId: feature.id,
				summary: `Feature '${feature.id}' has no planned verification commands or checks.`,
				remediation:
					"Record targeted validation checks on the feature before approving or running it.",
			});
		}
	}

	const plannedTargets = plannedContextTargets(features);
	const unplannedArtifacts = changedArtifacts.filter(
		(path) => !artifactMatchesAnyTarget(path, plannedTargets),
	);
	if (unplannedArtifacts.length > 0 && plannedTargets.size > 0) {
		diagnostics.push({
			id: "changed_artifacts_outside_planned_context",
			severity: "warn",
			summary: `Changed artifacts were not named in planned file targets or review scope: ${unplannedArtifacts.join(", ")}.`,
			remediation:
				"Compare these artifacts against the approved scope and reset/replan if they represent implementation drift.",
		});
	}

	if (
		changedArtifacts.length > 0 &&
		features.length > 0 &&
		features.every((feature) => feature.fileTargets.length === 0)
	) {
		diagnostics.push({
			id: "changed_artifacts_without_planned_targets",
			severity: "warn",
			summary:
				"The session has changed artifacts, but no feature named planned file targets.",
			remediation:
				"Compare changed artifacts against the approved scope and update the plan via reset/replan if the implementation drifted.",
		});
	}

	if (
		commands.length === 0 &&
		features.some((feature) => feature.status === "completed")
	) {
		diagnostics.push({
			id: "completed_without_recorded_validation_commands",
			severity: "warn",
			summary:
				"At least one feature is completed, but the context pack has no recorded validation commands.",
			remediation:
				"Inspect completion evidence and rerun/record targeted or broad validation before approving review claims.",
		});
	}

	return diagnostics;
}

function diagnosticSummary(
	diagnostic: ContextDiagnostic,
): WorkflowReadinessProjection["blocking"][number] {
	return {
		id: diagnostic.id,
		...(diagnostic.featureId ? { featureId: diagnostic.featureId } : {}),
		summary: diagnostic.summary,
		remediation: diagnostic.remediation,
	};
}

function warningSummary(
	diagnostic: ContextDiagnostic,
): WorkflowReadinessProjection["warnings"][number] {
	return {
		id: diagnostic.id,
		...(diagnostic.featureId ? { featureId: diagnostic.featureId } : {}),
		summary: diagnostic.summary,
	};
}

function buildWorkflowReadinessProjection(
	session: Session,
	features: Feature[],
	diagnostics: ContextDiagnostic[],
	traceability: ContextTraceabilityProjection,
): WorkflowReadinessProjection {
	const warnings = diagnostics.map(warningSummary);
	const contextBlockingDiagnostics = diagnostics.filter((diagnostic) => {
		if (diagnostic.id === "changed_artifacts_outside_planned_context") {
			return true;
		}
		if (!session.plan || session.approval === "pending") {
			return diagnostic.severity === "warn";
		}
		const activeFeatureId = session.execution.activeFeatureId;
		return (
			diagnostic.severity === "warn" &&
			Boolean(activeFeatureId) &&
			diagnostic.featureId === activeFeatureId
		);
	});
	const scopeDriftGaps = traceability.features.flatMap((feature) =>
		feature.gaps
			.filter((gap) => gap.id === "feature_changed_artifacts_outside_scope")
			.map((gap) => ({
				id: gap.id,
				featureId: feature.id,
				summary: gap.summary,
				remediation: gap.remediation,
			})),
	);
	const validationBlockingGaps = traceability.features.flatMap((feature) =>
		feature.gaps
			.filter((gap) => gap.id === "feature_changed_without_validation")
			.map((gap) => ({
				id: gap.id,
				featureId: feature.id,
				summary: gap.summary,
				remediation: gap.remediation,
			})),
	);
	const reviewBlockingGaps = traceability.features.flatMap((feature) =>
		feature.gaps
			.filter(
				(gap) =>
					gap.id === "completed_feature_missing_feature_review" ||
					gap.id === "strict_review_feature_missing_approval",
			)
			.map((gap) => ({
				id: gap.id,
				featureId: feature.id,
				summary: gap.summary,
				remediation: gap.remediation,
			})),
	);

	if (contextBlockingDiagnostics.length > 0) {
		return {
			state: "blocked_by_context",
			blocking: [
				...contextBlockingDiagnostics.map(diagnosticSummary),
				...scopeDriftGaps,
			],
			warnings,
			nextAction:
				"Resolve or explicitly account for the context diagnostics before relying on the next workflow phase.",
		};
	}

	if (scopeDriftGaps.length > 0) {
		return {
			state: "blocked_by_context",
			blocking: scopeDriftGaps,
			warnings,
			nextAction:
				"Resolve changed artifacts outside planned targets or review scope before relying on the next workflow phase.",
		};
	}

	if (validationBlockingGaps.length > 0) {
		return {
			state: "blocked_by_validation",
			blocking: validationBlockingGaps,
			warnings,
			nextAction:
				"Run and record validation that covers the changed artifacts before review or completion claims.",
		};
	}

	if (reviewBlockingGaps.length > 0) {
		return {
			state: "blocked_by_review",
			blocking: reviewBlockingGaps,
			warnings,
			nextAction:
				"Run the read-only review lane and record the missing reviewer evidence.",
		};
	}

	if (session.status === "completed") {
		return {
			state: "release_ready",
			blocking: [],
			warnings,
			nextAction:
				"Use final review, validation evidence, and release hygiene checks to decide whether to cut a release.",
		};
	}

	if (!session.plan || session.approval === "pending") {
		return {
			state: "planning_ready",
			blocking: [],
			warnings,
			nextAction:
				"Finish the plan, including repo profile, inspected references, feature targets, review scope, and verification.",
		};
	}

	const allFeaturesComplete =
		features.length > 0 &&
		features.every((feature) => feature.status === "completed");
	if (allFeaturesComplete) {
		return {
			state: "final_review_ready",
			blocking: [],
			warnings,
			nextAction:
				"Run final review against planned scope, changed artifacts, validation evidence, and remaining gaps.",
		};
	}

	const activeTraceability = traceability.features.find(
		(feature) => feature.id === session.execution.activeFeatureId,
	);
	if (
		activeTraceability &&
		activeTraceability.validationCommands.length > 0 &&
		activeTraceability.featureReviewStatus !== "passed"
	) {
		return {
			state: "feature_review_ready",
			blocking: [],
			warnings,
			nextAction:
				"Review the active feature against planned targets, changed artifacts, and validation evidence.",
		};
	}

	return {
		state: "execution_ready",
		blocking: [],
		warnings,
		nextAction:
			"Continue the approved plan one feature at a time and keep validation and review evidence aligned with scope.",
	};
}

export function buildContextPackProjection(
	session: Session,
): ContextPackProjection {
	const features = session.plan?.features ?? [];
	const changedArtifacts = changedArtifactPaths(session);
	const commands = validationCommands(session);
	const diagnostics = contextDiagnostics(
		session,
		features,
		changedArtifacts,
		commands,
	);
	const traceability = buildTraceabilityProjection(
		session,
		features,
		changedArtifacts,
		commands,
	);
	const workflowReadiness = buildWorkflowReadinessProjection(
		session,
		features,
		diagnostics,
		traceability,
	);

	return {
		sessionId: session.id,
		goal: session.goal,
		repoProfile: session.planning.repoProfile,
		research: session.planning.research,
		requirements: session.plan?.requirements ?? [],
		architectureDecisions: session.plan?.architectureDecisions ?? [],
		notes: [...(session.plan?.notes ?? []), ...session.notes],
		features: features.map((feature) => ({
			id: feature.id,
			title: feature.title,
			status: feature.status,
			fileTargets: feature.fileTargets,
			reviewScope: featureReviewScope(feature),
			verification: feature.verification,
		})),
		changedArtifacts,
		validationCommands: commands,
		diagnostics,
		traceability,
		workflowReadiness,
	};
}
