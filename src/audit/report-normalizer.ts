import type { ReviewReport } from "./report-schema";

type ReviewSurface = ReviewReport["discoveredSurfaces"][number];

function hasSurfaceEvidence(surface: ReviewSurface): boolean {
	return (surface.evidence?.length ?? 0) > 0;
}

function isDirectlyReviewedWithEvidence(surface: ReviewSurface): boolean {
	return (
		surface.reviewStatus === "directly_reviewed" && hasSurfaceEvidence(surface)
	);
}

function normalizedAchievedDepth(
	report: ReviewReport,
): Pick<ReviewReport, "achievedDepth" | "coverageNotes"> {
	if (report.achievedDepth === "broad_audit") {
		return {
			achievedDepth: report.achievedDepth,
			coverageNotes: report.coverageNotes,
		};
	}
	const hasUnreviewedSurface = report.discoveredSurfaces.some(
		(surface) => surface.reviewStatus === "unreviewed",
	);
	if (hasUnreviewedSurface) {
		const note =
			report.achievedDepth === "full_audit"
				? "Achieved depth was downgraded from full_audit because some discovered surfaces remained unreviewed."
				: "Achieved depth was downgraded from deep_audit because some discovered surfaces remained unreviewed.";
		return {
			achievedDepth: "broad_audit",
			coverageNotes: [...(report.coverageNotes ?? []), note],
		};
	}
	if (report.achievedDepth === "deep_audit") {
		return {
			achievedDepth: report.achievedDepth,
			coverageNotes: report.coverageNotes,
		};
	}
	const allDirectlyReviewed =
		report.discoveredSurfaces.length > 0 &&
		report.discoveredSurfaces.every(isDirectlyReviewedWithEvidence);
	if (allDirectlyReviewed) {
		return {
			achievedDepth: report.achievedDepth,
			coverageNotes: report.coverageNotes,
		};
	}
	const hasDirectCoverage = report.discoveredSurfaces.some(
		isDirectlyReviewedWithEvidence,
	);
	return {
		achievedDepth: hasDirectCoverage ? "deep_audit" : "broad_audit",
		coverageNotes: [
			...(report.coverageNotes ?? []),
			"Achieved depth was downgraded from full_audit because not every discovered surface was directly reviewed with evidence.",
		],
	};
}

export function normalizeReviewReport(report: ReviewReport): ReviewReport {
	const depthNormalization = normalizedAchievedDepth(report);
	return {
		...report,
		achievedDepth: depthNormalization.achievedDepth,
		coverageNotes: depthNormalization.coverageNotes,
	};
}
