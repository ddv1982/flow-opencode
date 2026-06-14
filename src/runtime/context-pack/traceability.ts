import { artifactMatchesAnyTarget } from "../context-paths";
import type { Feature, Session } from "../schema";
import {
	featureContextTargets,
	featureHistoryEntries,
	featureReviewScope,
	lastValue,
	plannedContextTargets,
	uniqueStrings,
} from "./facts";
import type {
	ContextTraceabilityProjection,
	FeatureTraceabilityProjection,
	TraceabilityGap,
} from "./types";

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

export function buildTraceabilityProjection(
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
