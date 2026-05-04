import { FINAL_REVIEW_SURFACES } from "../constants";
import type { Session } from "../schema";
import {
	artifactPathsForWorker,
	deriveRequiredFinalReviewSurfaces,
	type FinalReviewSurface,
	type FinalReviewWorkerEvidence,
	surfaceHasArtifactEvidence,
	validationCommandsForWorker,
} from "./final-review-coverage-evidence";
import { normalizeArtifactPath } from "./final-review-coverage-paths";
import { finalReviewPolicyForPlan } from "./workflow-policy";

export type { FinalReviewSurface } from "./final-review-coverage-evidence";

export type FinalReviewCoverageTarget = {
	reviewDepth: string;
	reviewedSurfaces: string[];
	evidenceSummary?: string | undefined;
	validationAssessment?: string | undefined;
	evidenceRefs?:
		| {
				changedArtifacts: string[];
				validationCommands: string[];
		  }
		| undefined;
	integrationChecks?: string[] | undefined;
	regressionChecks?: string[] | undefined;
};

export type DetailedFinalReviewRequirementFailure =
	| "too_few_surfaces"
	| "missing_validation_evidence"
	| "missing_cross_feature_surface"
	| "missing_integration_checks"
	| "missing_regression_checks";

type DetailedFinalReviewTarget = Pick<
	FinalReviewCoverageTarget,
	"reviewDepth" | "reviewedSurfaces" | "integrationChecks" | "regressionChecks"
>;

export function finalReviewDepthMatchesPolicy(
	session: Session,
	reviewDepth: string | undefined,
): boolean {
	return reviewDepth === finalReviewPolicyForPlan(session.plan);
}

const DETAILED_FINAL_REVIEW_CROSS_FEATURE_SURFACES: readonly FinalReviewSurface[] =
	[
		"integration_points",
		"shared_surfaces",
		"tooling_and_config",
		"release_surface",
	] as const;

export function isKnownFinalReviewSurface(
	surface: string,
): surface is FinalReviewSurface {
	return FINAL_REVIEW_SURFACES.includes(
		surface as (typeof FINAL_REVIEW_SURFACES)[number],
	);
}

export function detailedFinalReviewRequirementFailures(
	review: DetailedFinalReviewTarget,
): DetailedFinalReviewRequirementFailure[] {
	if (review.reviewDepth !== "detailed") {
		return [];
	}

	const failures: DetailedFinalReviewRequirementFailure[] = [];
	const reviewedSurfaceSet = new Set(review.reviewedSurfaces);

	if (review.reviewedSurfaces.length < 2) {
		failures.push("too_few_surfaces");
	}
	if (!reviewedSurfaceSet.has("validation_evidence")) {
		failures.push("missing_validation_evidence");
	}
	if (
		!DETAILED_FINAL_REVIEW_CROSS_FEATURE_SURFACES.some((surface) =>
			reviewedSurfaceSet.has(surface),
		)
	) {
		failures.push("missing_cross_feature_surface");
	}
	if (!review.integrationChecks?.length) {
		failures.push("missing_integration_checks");
	}
	if (!review.regressionChecks?.length) {
		failures.push("missing_regression_checks");
	}

	return failures;
}

function finalReviewCoverageFailureReasons(
	session: Session,
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewCoverageTarget,
): string[] {
	const reasons: string[] = [];
	const artifactPaths = artifactPathsForWorker(worker);
	const validationCommands = validationCommandsForWorker(worker);
	const evidenceRefs = review.evidenceRefs;
	const artifactRefPaths = (evidenceRefs?.changedArtifacts ?? []).map(
		normalizeArtifactPath,
	);
	const validationCommandRefs = (evidenceRefs?.validationCommands ?? []).map(
		(command) => command.trim(),
	);
	const actualArtifactSet = new Set(artifactPaths);
	const actualValidationCommandSet = new Set(validationCommands);

	if (review.reviewedSurfaces.length === 0) {
		reasons.push("must list reviewedSurfaces");
	}
	if (!review.evidenceSummary?.trim()) {
		reasons.push("must include an evidenceSummary");
	}
	if (!review.validationAssessment?.trim()) {
		reasons.push("must include a validationAssessment");
	}
	if (!evidenceRefs) {
		reasons.push("must include evidenceRefs");
	}

	const invalidArtifactRefs = artifactRefPaths.filter(
		(path) => !actualArtifactSet.has(path),
	);
	if (invalidArtifactRefs.length > 0) {
		reasons.push(
			`references unknown changed artifacts: ${invalidArtifactRefs.join(", ")}`,
		);
	}

	const invalidValidationCommandRefs = validationCommandRefs.filter(
		(command) => !actualValidationCommandSet.has(command),
	);
	if (invalidValidationCommandRefs.length > 0) {
		reasons.push(
			`references unknown validation commands: ${invalidValidationCommandRefs.join(", ")}`,
		);
	}

	const detailedFailureReasonMessages: Record<
		DetailedFinalReviewRequirementFailure,
		string
	> = {
		too_few_surfaces: "must cover at least two reviewedSurfaces",
		missing_validation_evidence: "must include validation_evidence",
		missing_cross_feature_surface:
			"must include at least one cross-feature surface",
		missing_integration_checks: "must include integrationChecks",
		missing_regression_checks: "must include regressionChecks",
	};
	for (const failure of detailedFinalReviewRequirementFailures(review)) {
		reasons.push(detailedFailureReasonMessages[failure]);
	}

	const requiredSurfaces = deriveRequiredFinalReviewSurfaces(
		session.execution.lastValidationRun.length > 0,
		worker,
	);
	const missingRequiredSurfaces = requiredSurfaces.filter(
		(surface) => !review.reviewedSurfaces.includes(surface),
	);
	if (missingRequiredSurfaces.length > 0) {
		reasons.push(
			`must cover derived required review surfaces: ${missingRequiredSurfaces.join(", ")}`,
		);
	}

	if (
		review.reviewedSurfaces.includes("validation_evidence") &&
		validationCommandRefs.length === 0
	) {
		reasons.push("must reference validation commands for validation_evidence");
	}

	const claimedArtifactBackedSurfaces = review.reviewedSurfaces.filter(
		(surface): surface is FinalReviewSurface =>
			surface !== "validation_evidence",
	);
	const unsupportedClaimedArtifactSurfaces =
		claimedArtifactBackedSurfaces.filter(
			(surface) => !surfaceHasArtifactEvidence(surface, artifactRefPaths),
		);
	if (unsupportedClaimedArtifactSurfaces.length > 0) {
		reasons.push(
			`claimed reviewed surfaces are not backed by evidenceRefs.changedArtifacts: ${unsupportedClaimedArtifactSurfaces.join(", ")}`,
		);
	}

	const requiredArtifactBackedSurfaces = requiredSurfaces.filter(
		(surface) => surface !== "validation_evidence",
	);
	const missingArtifactEvidenceSurfaces = requiredArtifactBackedSurfaces.filter(
		(surface) => !surfaceHasArtifactEvidence(surface, artifactRefPaths),
	);
	if (missingArtifactEvidenceSurfaces.length > 0) {
		reasons.push(
			`must reference changed artifacts covering: ${missingArtifactEvidenceSurfaces.join(", ")}`,
		);
	}

	return reasons;
}

export function describeFinalReviewCoverageFailure(
	session: Session,
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewCoverageTarget,
): string | null {
	const reasons = finalReviewCoverageFailureReasons(session, worker, review);
	return reasons.length > 0 ? reasons.join("; ") : null;
}
