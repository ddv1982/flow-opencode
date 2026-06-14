import {
	artifactMatchesAnyTarget,
	isCatchAllContextTarget,
	normalizeContextPath,
} from "./context-paths";
import type { ProjectStructureMapProjection } from "./project-structure-map";
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

export type ContextQualityCheckStatus = "pass" | "warn" | "fail";
export type ContextQualityCheck = {
	id: string;
	status: ContextQualityCheckStatus;
	weight: number;
	summary: string;
};

export type ContextQualityProjection = {
	score: number;
	rating: "strong" | "adequate" | "weak";
	checks: ContextQualityCheck[];
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
	workflowProfile: string;
	repoProfile: string[];
	research: string[];
	requirements: string[];
	architectureDecisions: string[];
	notes: string[];
	features: FeatureContextProjection[];
	changedArtifacts: string[];
	validationCommands: string[];
	diagnostics: ContextDiagnostic[];
	quality: ContextQualityProjection;
	traceability: ContextTraceabilityProjection;
	workflowReadiness: WorkflowReadinessProjection;
	projectStructure?: ProjectStructureMapProjection;
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

function isBroadContextTarget(target: string): boolean {
	const normalizedTarget = normalizeContextPath(target);
	return (
		isCatchAllContextTarget(normalizedTarget) ||
		normalizedTarget.endsWith("/**")
	);
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
	const workflowProfile = session.planning.workflowProfile;

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
		const targets = featureContextTargets(feature);
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

		if (
			session.planning.research.length > 0 &&
			targets.length > 0 &&
			targets.every(
				(target) =>
					!session.planning.research.some((entry) =>
						entry.toLowerCase().includes(target.toLowerCase()),
					),
			)
		) {
			diagnostics.push({
				id: "feature_targets_not_inspected",
				severity: "info",
				featureId: feature.id,
				summary: `Feature '${feature.id}' names planned targets that are not visible in planning research notes.`,
				remediation:
					"Record the files, tests, docs, or contracts inspected for this feature target, or explain why direct inspection was unnecessary.",
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

	for (const feature of features) {
		const history = featureHistoryEntries(session, feature.id);
		const featureChangedArtifacts = history.flatMap((entry) =>
			entry.artifactsChanged.map((artifact) => artifact.path),
		);
		const featureValidationCommands = uniqueStrings(
			history.flatMap((entry) =>
				entry.validationRun.map((validation) => validation.command),
			),
		);
		const hasChangedArtifacts = featureChangedArtifacts.length > 0;
		const matchingValidation = feature.verification.some((plannedCheck) =>
			featureValidationCommands.some((command) => {
				const normalizedCommand = command.toLowerCase();
				const normalizedPlannedCheck = plannedCheck.toLowerCase();
				return (
					normalizedCommand.includes(normalizedPlannedCheck) ||
					normalizedPlannedCheck.includes(normalizedCommand)
				);
			}),
		);
		if (
			hasChangedArtifacts &&
			feature.verification.length > 0 &&
			featureValidationCommands.length > 0 &&
			!matchingValidation
		) {
			diagnostics.push({
				id: "feature_validation_not_matched_to_plan",
				severity: "warn",
				featureId: feature.id,
				summary: `Feature '${feature.id}' has changed artifacts, but recorded validation does not match the planned verification commands.`,
				remediation:
					"Run the planned targeted check, update the plan through reset/replan, or explain why a different command covers the same behavior.",
			});
		}
	}

	if (
		features.some((feature) => {
			const targets = featureContextTargets(feature);
			return (
				targets.some(isBroadContextTarget) &&
				!targets.some((target) => !isBroadContextTarget(target))
			);
		})
	) {
		diagnostics.push({
			id: "broad_target_without_narrowed_scope",
			severity: "warn",
			summary:
				"At least one feature uses a broad planned target without an obviously narrowed review scope.",
			remediation:
				"Name the expected files, directories, or reviewScope surfaces so changed artifacts can be compared to intent.",
		});
	}

	if (
		workflowProfile === "bugfix" &&
		features.some(
			(feature) =>
				!feature.verification.some((check) =>
					/(test|spec|repro|regression)/i.test(check),
				),
		)
	) {
		diagnostics.push({
			id: "bugfix_profile_missing_regression_validation",
			severity: "warn",
			summary:
				"Bugfix workflow profile expects regression-oriented validation in the feature plan.",
			remediation:
				"Record the failing/regression test, reproduction command, or targeted check that proves the bug is fixed.",
		});
	}

	if (
		workflowProfile === "release" &&
		features.some(
			(feature) =>
				!feature.verification.some((check) =>
					/check|smoke|pack|release/i.test(check),
				),
		)
	) {
		diagnostics.push({
			id: "release_profile_missing_release_validation",
			severity: "warn",
			summary:
				"Release workflow profile expects release, smoke, pack, or full-check validation in the plan.",
			remediation:
				"Record the release hygiene, smoke, packaging, or broad validation command before treating the session as release-ready.",
		});
	}

	if (
		workflowProfile === "review" &&
		features.some((feature) => (feature.reviewScope ?? []).length === 0)
	) {
		diagnostics.push({
			id: "review_profile_missing_review_scope",
			severity: "warn",
			summary:
				"Review workflow profile expects explicit reviewScope entries for the surfaces under review.",
			remediation:
				"Record the files, domains, workflows, or contracts the review is expected to inspect.",
		});
	}

	if (
		(workflowProfile === "migration" || workflowProfile === "refactor") &&
		session.plan &&
		session.plan.architectureDecisions.length === 0
	) {
		diagnostics.push({
			id:
				workflowProfile === "migration"
					? "migration_profile_missing_migration_decisions"
					: "refactor_profile_missing_invariant_context",
			severity: "warn",
			summary: `${workflowProfile} workflow profile expects architecture decisions or invariants to be recorded.`,
			remediation:
				"Record the compatibility, migration, or behavior-preservation constraints that review should protect.",
		});
	}

	return diagnostics;
}

function buildContextQualityProjection(
	session: Session,
	features: Feature[],
	diagnostics: ContextDiagnostic[],
	traceability: ContextTraceabilityProjection,
): ContextQualityProjection {
	const hasFeatures = features.length > 0;
	const check = (
		id: string,
		status: ContextQualityCheckStatus,
		weight: number,
		summary: string,
	): ContextQualityCheck => ({ id, status, weight, summary });
	const diagnosticsById = new Set(
		diagnostics.map((diagnostic) => diagnostic.id),
	);
	const checks: ContextQualityCheck[] = [
		check(
			"repo_profile",
			session.planning.repoProfile.length > 0 ? "pass" : "fail",
			2,
			"Repo profile records package, command, framework, or convention context.",
		),
		check(
			"research",
			session.planning.research.length > 0 ? "pass" : "fail",
			2,
			"Planning research names inspected files, docs, tests, configs, or contracts.",
		),
		check(
			"feature_targets",
			hasFeatures &&
				features.every((feature) => featureContextTargets(feature).length > 0)
				? "pass"
				: "fail",
			2,
			"Every feature has planned file targets or review scope.",
		),
		check(
			"planned_verification",
			hasFeatures &&
				features.every((feature) => feature.verification.length > 0)
				? "pass"
				: "fail",
			2,
			"Every feature has planned verification.",
		),
		check(
			"scope_traceability",
			traceability.unplannedChangedArtifacts.length === 0 ? "pass" : "fail",
			3,
			"Changed artifacts stay within planned file targets or review scope.",
		),
		check(
			"validation_traceability",
			traceability.features.some((feature) =>
				feature.gaps.some(
					(gap) => gap.id === "feature_changed_without_validation",
				),
			)
				? "fail"
				: diagnosticsById.has("feature_validation_not_matched_to_plan")
					? "warn"
					: "pass",
			3,
			"Changed artifacts have recorded validation evidence aligned to the plan.",
		),
		check(
			"context_specificity",
			diagnosticsById.has("broad_target_without_narrowed_scope")
				? "warn"
				: "pass",
			1,
			"Planned targets are specific enough for reviewable handoff.",
		),
	];
	const totalWeight = checks.reduce((total, item) => total + item.weight, 0);
	const earnedWeight = checks.reduce((total, item) => {
		if (item.status === "pass") return total + item.weight;
		if (item.status === "warn") return total + item.weight / 2;
		return total;
	}, 0);
	const score =
		totalWeight === 0 ? 100 : Math.round((earnedWeight / totalWeight) * 100);
	return {
		score,
		rating: score >= 85 ? "strong" : score >= 65 ? "adequate" : "weak",
		checks,
	};
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
	options: {
		projectStructure?: ProjectStructureMapProjection | undefined;
	} = {},
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
	const quality = buildContextQualityProjection(
		session,
		features,
		diagnostics,
		traceability,
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
		workflowProfile: session.planning.workflowProfile,
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
		quality,
		traceability,
		workflowReadiness,
		...(options.projectStructure
			? { projectStructure: options.projectStructure }
			: {}),
	};
}
