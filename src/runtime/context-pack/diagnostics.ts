import { artifactMatchesAnyTarget } from "../context-paths";
import type { Feature, Session } from "../schema";
import {
	featureContextTargets,
	featureHistoryEntries,
	featureReviewScope,
	isBroadContextTarget,
	plannedContextTargets,
	uniqueStrings,
} from "./facts";
import type { ContextDiagnostic } from "./types";

export function contextDiagnostics(
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
