import { readdir, readFile } from "node:fs/promises";
import {
	getAuditReportJsonPath,
	getAuditsDir,
	getLatestAuditReportJsonPath,
} from "../audit/paths";
import { type AuditReport, AuditReportSchema } from "../audit/schema";

export type StoredAuditReport = {
	reportId: string;
	path: string;
	report: AuditReport;
};

export type AuditReportHistory = {
	latest: StoredAuditReport | null;
	reports: StoredAuditReport[];
};

async function readAuditReportAtPath(
	reportId: string,
	path: string,
): Promise<StoredAuditReport | null> {
	try {
		const raw = await readFile(path, "utf8");
		return {
			reportId,
			path,
			report: AuditReportSchema.parse(JSON.parse(raw)),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function tryReadAuditReportAtPath(
	reportId: string,
	path: string,
): Promise<StoredAuditReport | null> {
	try {
		return await readAuditReportAtPath(reportId, path);
	} catch {
		return null;
	}
}

export async function loadAuditReport(
	worktree: string,
	reportId: string,
): Promise<StoredAuditReport | null> {
	if (reportId === "latest") {
		return readAuditReportAtPath(
			reportId,
			getLatestAuditReportJsonPath(worktree),
		);
	}
	return readAuditReportAtPath(
		reportId,
		getAuditReportJsonPath(worktree, reportId),
	);
}

export async function listAuditReports(
	worktree: string,
): Promise<AuditReportHistory> {
	const auditsDir = getAuditsDir(worktree);
	let entries: string[] = [];
	try {
		entries = (await readdir(auditsDir, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()
			.reverse();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}

	const reports = (
		await Promise.all(
			entries.map((entry) =>
				tryReadAuditReportAtPath(
					entry,
					getAuditReportJsonPath(worktree, entry),
				),
			),
		)
	).filter((entry): entry is StoredAuditReport => entry !== null);
	const latest = await tryReadAuditReportAtPath(
		"latest",
		getLatestAuditReportJsonPath(worktree),
	);
	return { latest, reports };
}
