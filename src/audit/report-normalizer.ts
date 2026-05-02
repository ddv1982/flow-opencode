import type { ReviewReport } from "./report-schema";

type ReviewSurface = ReviewReport["discoveredSurfaces"][number];
type SurfaceCategory = ReviewSurface["category"];

const REQUIRED_FULL_AUDIT_CATEGORIES: SurfaceCategory[] = [
	"source_runtime",
	"tests",
	"ci_release",
	"docs_config",
	"tooling",
];

function hasSurfaceEvidence(surface: ReviewSurface): boolean {
	return (surface.evidence?.length ?? 0) > 0;
}

function isDirectlyReviewedWithEvidence(surface: ReviewSurface): boolean {
	return (
		surface.reviewStatus === "directly_reviewed" && hasSurfaceEvidence(surface)
	);
}

export type ReviewCoverageSummary = {
	directlyReviewed: ReviewSurface[];
	directlyReviewedWithEvidence: ReviewSurface[];
	spotChecked: ReviewSurface[];
	unreviewed: ReviewSurface[];
	missingFullAuditCategories: SurfaceCategory[];
	fullAuditEligible: boolean;
};

export function summarizeReviewCoverage(
	report: ReviewReport,
): ReviewCoverageSummary {
	const directlyReviewed = report.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "directly_reviewed",
	);
	const directlyReviewedWithEvidence = directlyReviewed.filter(
		isDirectlyReviewedWithEvidence,
	);
	const spotChecked = report.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "spot_checked",
	);
	const unreviewed = report.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "unreviewed",
	);
	const directlyReviewedCategories = new Set(
		directlyReviewedWithEvidence.map((surface) => surface.category),
	);
	const missingFullAuditCategories = REQUIRED_FULL_AUDIT_CATEGORIES.filter(
		(category) => !directlyReviewedCategories.has(category),
	);
	const fullAuditEligible =
		report.discoveredSurfaces.length > 0 &&
		spotChecked.length === 0 &&
		unreviewed.length === 0 &&
		directlyReviewed.every(hasSurfaceEvidence) &&
		missingFullAuditCategories.length === 0;

	return {
		directlyReviewed,
		directlyReviewedWithEvidence,
		spotChecked,
		unreviewed,
		missingFullAuditCategories,
		fullAuditEligible,
	};
}

function validationRunWithExplicitNotRun(
	report: ReviewReport,
): ReviewReport["validationRun"] {
	return report.validationRun.length > 0
		? report.validationRun
		: [
				{
					command: "not_run",
					status: "not_run",
					summary: "No validation evidence was recorded for this review.",
				},
			];
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
	const coverageSummary = summarizeReviewCoverage(report);
	const missingCategories = coverageSummary.missingFullAuditCategories;
	if (missingCategories.length > 0) {
		const hasDirectCoverage =
			coverageSummary.directlyReviewedWithEvidence.length > 0;
		return {
			achievedDepth: hasDirectCoverage ? "deep_audit" : "broad_audit",
			coverageNotes: [
				...(report.coverageNotes ?? []),
				`Achieved depth was downgraded from full_audit because these major surface categories were not directly reviewed with evidence: ${missingCategories.join(", ")}.`,
			],
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
	const hasDirectCoverage =
		summarizeReviewCoverage(report).directlyReviewedWithEvidence.length > 0;
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
		validationRun: validationRunWithExplicitNotRun(report),
	};
}
