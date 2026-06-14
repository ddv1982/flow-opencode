import type { Feature, Session } from "../schema";
import { featureContextTargets } from "./facts";
import type {
	ContextDiagnostic,
	ContextQualityCheck,
	ContextQualityCheckStatus,
	ContextQualityProjection,
	ContextTraceabilityProjection,
} from "./types";

export function buildContextQualityProjection(
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
