import { join } from "node:path";
import {
	assertDescendant,
	getFlowDir,
	sanitizePathComponent,
} from "../runtime/paths";

export function getAuditsDir(worktree: string): string {
	return join(getFlowDir(worktree), "audits");
}

export function getAuditReportDir(worktree: string, reportId: string): string {
	const auditsRoot = getAuditsDir(worktree);
	return assertDescendant(
		auditsRoot,
		join(auditsRoot, sanitizePathComponent("audit", reportId)),
	);
}

export function getAuditReportJsonPath(
	worktree: string,
	reportId: string,
): string {
	return join(getAuditReportDir(worktree, reportId), "report.json");
}

export function getAuditReportMarkdownPath(
	worktree: string,
	reportId: string,
): string {
	return join(getAuditReportDir(worktree, reportId), "report.md");
}

export function getLatestAuditReportJsonPath(worktree: string): string {
	return join(getAuditsDir(worktree), "latest.json");
}

export function getLatestAuditReportMarkdownPath(worktree: string): string {
	return join(getAuditsDir(worktree), "latest.md");
}
