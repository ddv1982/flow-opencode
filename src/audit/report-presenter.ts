import type { ReviewReport } from "./report-schema";

export type ReviewRenderView = "human" | "structured" | "both";

const FINDING_CATEGORY_ORDER = [
	"confirmed_defect",
	"likely_risk",
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
		case "likely_risk":
			return "likely risk";
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
	if (topFinding.severity === "high" || topFinding.severity === "medium") {
		return `Usable with caveats, but '${topFinding.title}' should be addressed before release.`;
	}
	return `No obvious release blocker was confirmed, but '${topFinding.title}' should be addressed next.`;
}

function bulletLines(items: string[], limit = items.length): string[] {
	return items.slice(0, limit).map((item) => `- ${item}`);
}

function renderConclusion(report: ReviewReport): string[] {
	const topFinding = highestPriorityFinding(report);
	return [
		"## Conclusion",
		`- Requested depth: ${depthLabel(report.requestedDepth)}`,
		`- Achieved depth: ${depthLabel(report.achievedDepth)}`,
		`- Overall verdict: ${report.overallVerdict}`,
		...(topFinding
			? [`- Highest-priority issue: ${topFinding.title}`]
			: [`- Highest-priority issue: none identified at this review depth`]),
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
			]
				.filter(Boolean)
				.join(" · ");
			return [
				`### ${index + 1}. ${finding.title}${labels ? ` — ${labels}` : ""}`,
				`- Impact: ${finding.impact}`,
				...(finding.remediation
					? [`- Recommendation: ${finding.remediation}`]
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
	const notes = report.coverageSummary.notes ?? [];
	const unreviewed = report.unreviewedSurfaces.map(
		(surface) => `${surface.name}: ${surface.reason}`,
	);
	const validationNotes = report.validationRun.map(
		(entry) => `${entry.command} — ${entry.status}: ${entry.summary}`,
	);
	return [
		"## Coverage notes",
		`- Coverage: ${report.coverageSummary.reviewedSurfaceCount}/${report.coverageSummary.discoveredSurfaceCount} discovered surfaces reviewed; ${report.coverageSummary.unreviewedSurfaceCount} unreviewed.`,
		`- Full audit eligible: ${report.coverageRubric.fullAuditEligible ? "yes" : "no"}`,
		...(notes.length > 0 ? bulletLines(notes) : []),
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
