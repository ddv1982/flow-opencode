import { fullAuditRequiredCategories } from "./report-normalizer";
import type { ReviewReport } from "./report-schema";

export type ReviewRenderView = "human" | "structured" | "both";

const FINDING_CATEGORY_ORDER = [
	"confirmed_defect",
	"risk",
	"hardening_opportunity",
	"process_gap",
] as const;

const SEVERITY_ORDER = ["high", "medium", "low"] as const;

function depthLabel(depth: ReviewReport["requestedDepth"]): string {
	switch (depth) {
		case "broad_audit":
			return "broad review";
		case "deep_audit":
			return "detailed review";
		case "full_audit":
			return "exhaustive review";
	}
}

function findingCategoryLabel(
	category: ReviewReport["findings"][number]["category"],
): string {
	switch (category) {
		case "confirmed_defect":
			return "confirmed defect";
		case "risk":
			return "risk";
		case "hardening_opportunity":
			return "hardening opportunity";
		case "process_gap":
			return "process gap";
	}
}

function severityLabel(
	severity: ReviewReport["findings"][number]["severity"],
): string | null {
	return severity ? `${severity} severity` : null;
}

function confidenceLabel(
	confidence: ReviewReport["findings"][number]["confidence"],
): string {
	return `confidence: ${confidence}`;
}

function sortFindings(report: ReviewReport): ReviewReport["findings"] {
	return [...report.findings].sort((left, right) => {
		const categoryDelta =
			FINDING_CATEGORY_ORDER.indexOf(left.category) -
			FINDING_CATEGORY_ORDER.indexOf(right.category);
		if (categoryDelta !== 0) {
			return categoryDelta;
		}
		const leftSeverity = left.severity
			? SEVERITY_ORDER.indexOf(left.severity)
			: SEVERITY_ORDER.length;
		const rightSeverity = right.severity
			? SEVERITY_ORDER.indexOf(right.severity)
			: SEVERITY_ORDER.length;
		return leftSeverity - rightSeverity;
	});
}

function highestPriorityFinding(report: ReviewReport) {
	return sortFindings(report)[0] ?? null;
}

function releaseRecommendation(report: ReviewReport): string {
	const topFinding = highestPriorityFinding(report);
	if (!topFinding) {
		return "No material findings were identified at this review depth.";
	}
	if (topFinding.category === "confirmed_defect") {
		return `Not ready to ship until '${topFinding.title}' is addressed.`;
	}
	if (topFinding.category === "risk") {
		if (topFinding.severity === "high") {
			return `No confirmed defect was proven here, but '${topFinding.title}' should be addressed before release if this path matters operationally.`;
		}
		return `No confirmed release blocker was proven in this review, but '${topFinding.title}' is a material risk to address next.`;
	}
	if (topFinding.category === "hardening_opportunity") {
		return `No product defect was confirmed here, but '${topFinding.title}' is a useful hardening opportunity to consider next.`;
	}
	return `No product defect was confirmed here, but '${topFinding.title}' should be cleaned up to reduce maintenance risk.`;
}

function normalizedOverallVerdict(report: ReviewReport): string {
	return report.overallVerdict;
}

function normalizedImpactLabel(
	category: ReviewReport["findings"][number]["category"],
): string {
	switch (category) {
		case "confirmed_defect":
			return "Impact";
		case "risk":
			return "Risk";
		case "hardening_opportunity":
			return "Opportunity";
		case "process_gap":
			return "Follow-up";
	}
}

function normalizedImpactText(
	finding: ReviewReport["findings"][number],
): string {
	return finding.impact;
}

function normalizedRemediation(
	finding: ReviewReport["findings"][number],
): string | null {
	return finding.remediation ?? null;
}

function bulletLines(items: string[], limit = items.length): string[] {
	return items.slice(0, limit).map((item) => `- ${item}`);
}

function surfaceHasEvidence(
	surface: ReviewReport["discoveredSurfaces"][number],
): boolean {
	return (surface.evidence?.length ?? 0) > 0;
}

function renderConclusion(report: ReviewReport): string[] {
	const topFinding = highestPriorityFinding(report);
	return [
		"## Conclusion",
		`- Requested depth: ${depthLabel(report.requestedDepth)}`,
		`- Achieved depth: ${depthLabel(report.achievedDepth)}`,
		`- Overall verdict: ${normalizedOverallVerdict(report)}`,
		...(topFinding
			? [
					`- Highest-priority finding: ${topFinding.title} (${findingCategoryLabel(topFinding.category)})`,
				]
			: [`- Highest-priority finding: none identified at this review depth`]),
		`- Recommendation: ${releaseRecommendation(report)}`,
	];
}

function renderFindings(report: ReviewReport): string[] {
	const findings = sortFindings(report);
	if (findings.length === 0) {
		return ["## Top findings", "- No findings were recorded."];
	}

	return [
		"## Top findings",
		...findings.flatMap((finding, index) => {
			const labels = [
				severityLabel(finding.severity),
				findingCategoryLabel(finding.category),
				confidenceLabel(finding.confidence),
			]
				.filter(Boolean)
				.join(" · ");
			return [
				`### ${index + 1}. ${finding.title}${labels ? ` — ${labels}` : ""}`,
				`- ${normalizedImpactLabel(finding.category)}: ${normalizedImpactText(finding)}`,
				...(normalizedRemediation(finding)
					? [`- Recommendation: ${normalizedRemediation(finding)}`]
					: []),
				"- Evidence:",
				...bulletLines(finding.evidence, 3),
			];
		}),
	];
}

function renderNextSteps(report: ReviewReport): string[] {
	const steps = report.nextSteps ?? [];
	if (steps.length > 0) {
		return [
			"## Recommended next actions",
			...steps.map((step, index) => `${index + 1}. ${step}`),
		];
	}
	const findings = sortFindings(report).slice(0, 3);
	return [
		"## Recommended next actions",
		...(findings.length > 0
			? findings.map(
					(finding, index) => `${index + 1}. Address ${finding.title}.`,
				)
			: ["1. No immediate follow-up was recommended."]),
	];
}

function renderCoverageNotes(report: ReviewReport): string[] {
	const notes = report.coverageNotes ?? [];
	const directlyReviewed = report.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "directly_reviewed",
	);
	const spotChecked = report.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "spot_checked",
	);
	const unreviewed = report.discoveredSurfaces
		.filter((surface) => surface.reviewStatus === "unreviewed")
		.map((surface) => `${surface.name}: ${surface.reason ?? "not reviewed"}`);
	const validationNotes =
		report.validationRun.length > 0
			? report.validationRun.map((entry) =>
					entry.command === "not_run" && entry.status === "not_run"
						? `not_run: ${entry.summary}`
						: `${entry.command} — ${entry.status}: ${entry.summary}`,
				)
			: ["not_run: no validation evidence was recorded for this review."];
	const directlyReviewedCategories = new Set(
		directlyReviewed
			.filter(surfaceHasEvidence)
			.map((surface) => surface.category),
	);
	const missingFullAuditCategories = fullAuditRequiredCategories().filter(
		(category) => !directlyReviewedCategories.has(category),
	);
	const fullAuditEligible =
		report.discoveredSurfaces.length > 0 &&
		spotChecked.length === 0 &&
		unreviewed.length === 0 &&
		directlyReviewed.every(surfaceHasEvidence) &&
		missingFullAuditCategories.length === 0;
	return [
		"## Coverage notes",
		`- Coverage: ${directlyReviewed.length} directly reviewed, ${spotChecked.length} spot-checked, ${unreviewed.length} unreviewed surfaces.`,
		`- Full audit eligible: ${fullAuditEligible ? "yes" : "no"}`,
		...(missingFullAuditCategories.length > 0
			? [
					`- Missing full-audit major categories: ${missingFullAuditCategories.join(", ")}.`,
				]
			: []),
		...(notes.length > 0 ? bulletLines(notes) : []),
		...(spotChecked.length > 0
			? [
					"- Spot-checked surfaces:",
					...bulletLines(spotChecked.map((surface) => surface.name)),
				]
			: []),
		...(unreviewed.length > 0
			? ["- Unreviewed surfaces:", ...bulletLines(unreviewed)]
			: []),
		...(validationNotes.length > 0
			? ["- Validation status:", ...bulletLines(validationNotes)]
			: []),
	];
}

function renderHumanReview(report: ReviewReport): string {
	return [
		...renderConclusion(report),
		"",
		...renderFindings(report),
		"",
		...renderNextSteps(report),
		"",
		...renderCoverageNotes(report),
	].join("\n");
}

function renderStructuredReview(report: ReviewReport): string {
	return JSON.stringify(report, null, 2);
}

export function renderReviewReport(
	report: ReviewReport,
	view: ReviewRenderView = "human",
): string {
	if (view === "structured") {
		return renderStructuredReview(report);
	}
	const human = renderHumanReview(report);
	if (view === "both") {
		return `${human}\n\n## Structured review data\n\n\`\`\`json\n${renderStructuredReview(report)}\n\`\`\``;
	}
	return human;
}
