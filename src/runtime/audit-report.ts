import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getFlowDir } from "./paths";
import type { AuditReport, AuditReportArgs, AuditSurface } from "./schema";
import { AuditReportSchema } from "./schema";
import { pathExists } from "./session-completed-storage";
import { completedTimestampNow } from "./util";
import { assertMutableWorkspaceRoot } from "./workspace-root";

function uniqueCategories(
	surfaces: AuditSurface[],
	predicate: (surface: AuditSurface) => boolean,
) {
	return [
		...new Set(surfaces.filter(predicate).map((surface) => surface.category)),
	].sort();
}

export function normalizeAuditReport(input: AuditReportArgs): AuditReport {
	const discoveredSurfaces: AuditSurface[] = input.discoveredSurfaces.map(
		(surface) => ({
			...surface,
			evidence: [...(surface.evidence ?? [])],
		}),
	);
	const reviewedSurfaces = discoveredSurfaces
		.filter((surface) => surface.reviewStatus !== "unreviewed")
		.map((surface) => ({
			name: surface.name,
			evidence: [...surface.evidence],
		}));
	const unreviewedSurfaces = discoveredSurfaces
		.filter((surface) => surface.reviewStatus === "unreviewed")
		.map((surface) => ({
			name: surface.name,
			reason: surface.reason ?? "Coverage gap not explained.",
		}));
	const directlyReviewedCategories = uniqueCategories(
		discoveredSurfaces,
		(surface) => surface.reviewStatus === "directly_reviewed",
	);
	const spotCheckedCategories = uniqueCategories(
		discoveredSurfaces,
		(surface) => surface.reviewStatus === "spot_checked",
	);
	const unreviewedCategories = uniqueCategories(
		discoveredSurfaces,
		(surface) => surface.reviewStatus === "unreviewed",
	);
	const fullAuditEligible =
		discoveredSurfaces.length > 0 &&
		discoveredSurfaces.every(
			(surface) => surface.reviewStatus === "directly_reviewed",
		);
	const blockingReasons: string[] = [];
	if (spotCheckedCategories.length > 0) {
		blockingReasons.push(
			`Spot-checked categories prevent full_audit: ${spotCheckedCategories.join(", ")}.`,
		);
	}
	if (unreviewedSurfaces.length > 0) {
		blockingReasons.push(
			`Unreviewed surfaces prevent full_audit: ${unreviewedSurfaces
				.map((surface) => surface.name)
				.join(", ")}.`,
		);
	}

	return AuditReportSchema.parse({
		requestedDepth: input.requestedDepth,
		achievedDepth: input.achievedDepth,
		repoSummary: input.repoSummary,
		overallVerdict: input.overallVerdict,
		discoveredSurfaces,
		coverageSummary: {
			discoveredSurfaceCount: discoveredSurfaces.length,
			reviewedSurfaceCount: reviewedSurfaces.length,
			unreviewedSurfaceCount: unreviewedSurfaces.length,
			...(input.achievedDepth !== "full_audit"
				? { notes: ["Coverage rubric was normalized from discoveredSurfaces."] }
				: {}),
		},
		reviewedSurfaces,
		unreviewedSurfaces,
		coverageRubric: {
			fullAuditEligible,
			directlyReviewedCategories,
			spotCheckedCategories,
			unreviewedCategories,
			blockingReasons,
		},
		validationRun: input.validationRun,
		findings: input.findings,
		...(input.nextSteps ? { nextSteps: input.nextSteps } : {}),
	});
}

function renderAuditReportMarkdown(report: AuditReport): string {
	const lines = [
		"# Flow Audit Report",
		"",
		`- Requested depth: ${report.requestedDepth}`,
		`- Achieved depth: ${report.achievedDepth}`,
		`- Full-audit eligible: ${report.coverageRubric.fullAuditEligible ? "yes" : "no"}`,
		"",
		"## Repo Summary",
		"",
		report.repoSummary,
		"",
		"## Overall Verdict",
		"",
		report.overallVerdict,
		"",
		"## Coverage",
		"",
		`- Discovered surfaces: ${report.coverageSummary.discoveredSurfaceCount}`,
		`- Reviewed surfaces: ${report.coverageSummary.reviewedSurfaceCount}`,
		`- Unreviewed surfaces: ${report.coverageSummary.unreviewedSurfaceCount}`,
	];

	if (report.coverageRubric.blockingReasons.length > 0) {
		lines.push(
			"",
			"### Full-audit blockers",
			"",
			...report.coverageRubric.blockingReasons.map((reason) => `- ${reason}`),
		);
	}

	lines.push(
		"",
		"### Discovered surfaces",
		"",
		...report.discoveredSurfaces.flatMap((surface) => {
			const base = `- ${surface.name} (${surface.category}, ${surface.reviewStatus})`;
			const extras =
				surface.reviewStatus === "unreviewed"
					? [`  - Reason: ${surface.reason ?? "Not provided."}`]
					: surface.evidence.map((evidence) => `  - Evidence: ${evidence}`);
			return [base, ...extras];
		}),
		"",
		"## Validation",
		"",
		...report.validationRun.flatMap((entry) => [
			`- ${entry.command} — ${entry.status}`,
			`  - ${entry.summary}`,
		]),
		"",
		"## Findings",
		"",
	);

	if (report.findings.length === 0) {
		lines.push("- No findings recorded.");
	} else {
		lines.push(
			...report.findings.flatMap((finding) => [
				`- ${finding.title} [${finding.category}; ${finding.confidence}${finding.severity ? `; ${finding.severity}` : ""}]`,
				`  - Impact: ${finding.impact}`,
				...finding.evidence.map((evidence) => `  - Evidence: ${evidence}`),
				...(finding.remediation
					? [`  - Remediation: ${finding.remediation}`]
					: []),
			]),
		);
	}

	if (report.nextSteps?.length) {
		lines.push(
			"",
			"## Next Steps",
			"",
			...report.nextSteps.map((step) => `- ${step}`),
		);
	}

	lines.push("");
	return lines.join("\n");
}

export type WrittenAuditReport = {
	reportDir: string;
	jsonPath: string;
	markdownPath: string;
	report: AuditReport;
};

function auditReportDirectoryName(timestamp: string, attempt = 0) {
	return `${timestamp}${attempt === 0 ? "" : `-${attempt}`}`;
}

async function allocateAuditReportDir(reportsDir: string): Promise<string> {
	const timestamp = completedTimestampNow();
	for (let attempt = 0; ; attempt += 1) {
		const candidate = join(
			reportsDir,
			auditReportDirectoryName(timestamp, attempt),
		);
		if (!(await pathExists(candidate))) {
			return candidate;
		}
	}
}

export async function writeAuditReport(
	worktree: string,
	input: AuditReportArgs,
): Promise<WrittenAuditReport> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const report = normalizeAuditReport(input);
	const reportsDir = join(getFlowDir(mutableWorktree), "audits");
	const reportDir = await allocateAuditReportDir(reportsDir);
	await mkdir(reportDir, { recursive: true });
	const jsonPath = join(reportDir, "report.json");
	const markdownPath = join(reportDir, "report.md");
	await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	await writeFile(markdownPath, renderAuditReportMarkdown(report), "utf8");
	await writeFile(
		join(reportsDir, "latest.json"),
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);
	await writeFile(
		join(reportsDir, "latest.md"),
		renderAuditReportMarkdown(report),
		"utf8",
	);
	return { reportDir, jsonPath, markdownPath, report };
}
