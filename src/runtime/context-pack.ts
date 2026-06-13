import type { Feature, Session } from "./schema";

export type ContextDiagnosticSeverity = "info" | "warn";

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
	return new Set(
		features.flatMap((feature) => [
			...feature.fileTargets,
			...featureReviewScopeTargets(feature),
		]),
	);
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
		(path) => !plannedTargets.has(path),
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

export function buildContextPackProjection(
	session: Session,
): ContextPackProjection {
	const features = session.plan?.features ?? [];
	const changedArtifacts = changedArtifactPaths(session);
	const commands = validationCommands(session);

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
		diagnostics: contextDiagnostics(
			session,
			features,
			changedArtifacts,
			commands,
		),
	};
}
