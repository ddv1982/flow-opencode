import type { LatestFailedFlowAttempt, Session } from "../schema";
import { deriveSessionViewModel } from "../summary";
import {
	selectOperatorTaskProgressRows,
	type TaskProgressRow,
} from "../summary-projections";

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

function renderLatestFailedAttemptLines(
	failure: LatestFailedFlowAttempt | null | undefined,
): string[] {
	if (!failure) {
		return [];
	}
	const repeated = failure.sameCategoryFailureCount
		? ` (${failure.sameCategoryFailureCount} same-category attempts)`
		: "";
	return [
		`Latest failed attempt: ${failure.tool} — ${failure.failureCategory}${repeated}.`,
		...(failure.recoveryHint
			? [`Fix: ${toInlineSummaryText(failure.recoveryHint, 160)}`]
			: []),
	];
}

function renderTaskProgressSummary(rows: TaskProgressRow[]): string[] {
	const selected = selectOperatorTaskProgressRows(rows);
	if (selected.length === 0) {
		return [];
	}

	return [
		"Task progress:",
		...selected.map((row) => {
			const subject = toInlineSummaryText(row.subject, 55);
			const next = toInlineSummaryText(row.next, 75);
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

	lines.push(
		...renderLatestFailedAttemptLines(viewModel.session?.latestFailedAttempt),
	);

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
