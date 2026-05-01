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

function missingFullAuditCategories(report: ReviewReport): SurfaceCategory[] {
	const directlyReviewedCategories = new Set(
		report.discoveredSurfaces
			.filter(isDirectlyReviewedWithEvidence)
			.map((surface) => surface.category),
	);
	return REQUIRED_FULL_AUDIT_CATEGORIES.filter(
		(category) => !directlyReviewedCategories.has(category),
	);
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
	const missingCategories = missingFullAuditCategories(report);
	if (missingCategories.length > 0) {
		const hasDirectCoverage = report.discoveredSurfaces.some(
			isDirectlyReviewedWithEvidence,
		);
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
		validationRun: validationRunWithExplicitNotRun(report),
	};
}

export function fullAuditRequiredCategories(): readonly SurfaceCategory[] {
	return REQUIRED_FULL_AUDIT_CATEGORIES;
}
