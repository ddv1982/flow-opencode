import type { Session } from "../schema";
import { deriveSessionViewModel, type SessionGuidance } from "../summary";
import type { TaskProgressRow } from "../summary-projections";
import type { DoctorCheck } from "./doctor-checks";

function prioritizedTaskProgressRows(
	rows: TaskProgressRow[],
): TaskProgressRow[] {
	const selected: TaskProgressRow[] = [];
	const add = (candidates: TaskProgressRow[]) => {
		for (const row of candidates) {
			if (selected.length >= 4) {
				return;
			}
			if (!selected.some((item) => item.id === row.id)) {
				selected.push(row);
			}
		}
	};

	add(rows.filter((row) => row.status === "active"));
	add(rows.filter((row) => row.status === "ready"));
	add(
		rows.filter((row) =>
			["blocked", "needs_fix", "needs_input"].includes(row.status),
		),
	);
	add(
		rows.filter((row) =>
			["validation", "review", "final_review"].includes(row.phase),
		),
	);
	add(rows.filter((row) => row.status === "pending").slice(0, 1));
	return selected;
}

function toInlineSummaryText(value: string, maxLength: number): string {
	const inline = value
		.replace(/\r?\n+/g, " / ")
		.replace(/\s+/g, " ")
		.trim();
	if (inline.length <= maxLength) {
		return inline;
	}
	return `${inline.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function renderTaskProgressSummary(rows: TaskProgressRow[]): string[] {
	const selected = prioritizedTaskProgressRows(rows);
	if (selected.length === 0) {
		return [];
	}

	return [
		"Task progress:",
		...selected.map((row) => {
			const subject = toInlineSummaryText(row.subject, 80);
			const next = toInlineSummaryText(row.next, 100);
			return `- ${row.ownerRole} | ${row.phase} | ${row.status} | ${subject} | next: ${next}`;
		}),
	];
}

export function renderSessionStatusSummary(
	session: Session | null,
	options?: {
		nextCommand?: string;
		nextStep?: string;
		taskProgressOverride?: TaskProgressRow[];
	},
): string {
	const viewModel = deriveSessionViewModel(session);
	const lines = [
		`Flow: ${viewModel.guidance.summary}`,
		`Next: ${options?.nextStep ?? viewModel.guidance.nextStep}`,
		`Command: ${options?.nextCommand ?? viewModel.guidance.nextCommand}`,
	];

	if (viewModel.guidance.blocker) {
		lines.splice(1, 0, `Blocker: ${viewModel.guidance.blocker}`);
	}

	if (viewModel.session?.activeFeature) {
		const activeFeature = viewModel.session.activeFeature;
		lines.push(
			`Working on: ${activeFeature.id} — ${activeFeature.title} (${activeFeature.status})`,
		);
	}

	if (viewModel.session?.featureProgress) {
		lines.push(
			`Progress: ${viewModel.session.featureProgress.completed}/${viewModel.session.featureProgress.total} completed`,
		);
	}

	const taskProgress =
		options?.taskProgressOverride ?? viewModel.session?.taskProgress;
	if (taskProgress) {
		lines.push(...renderTaskProgressSummary(taskProgress));
	}

	if (viewModel.session?.finalReviewPolicy) {
		lines.push(`Final review policy: ${viewModel.session.finalReviewPolicy}`);
	}

	if (viewModel.session?.goal) {
		lines.push(`Goal: ${viewModel.session.goal}`);
	}

	return lines.join("\n");
}

export function renderDoctorSummary(
	status: "ok" | "warn" | "fail",
	checks: DoctorCheck[],
	guidance: SessionGuidance,
	nextStep: string,
	nextCommand: string,
) {
	const firstIssue =
		checks.find((check) => check.status === "fail") ??
		checks.find((check) => check.status === "warn");

	if (!firstIssue) {
		return [
			"Flow doctor: Ready.",
			...(guidance.blocker ? [`Blocker: ${guidance.blocker}`] : []),
			`Next: ${nextStep}`,
			`Command: ${nextCommand}`,
		].join("\n");
	}

	const lines = [`Flow doctor ${status}: ${firstIssue.summary}`];
	if (firstIssue.remediation) {
		lines.push(`Fix: ${firstIssue.remediation}`);
	}
	if (guidance.blocker) {
		lines.push(`Blocker: ${guidance.blocker}`);
	}
	lines.push(`Next: ${nextStep}`);
	lines.push(`Command: ${nextCommand}`);
	return lines.join("\n");
}
