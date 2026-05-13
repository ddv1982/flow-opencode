import type { Feature } from "./schema";
import type { TaskProgressRow } from "./summary-task-progress";

type TaskProgressSelectionRule = {
	matches: (row: TaskProgressRow) => boolean;
	limit?: number;
};

type TaskProgressSelectionPolicy = {
	maxRows?: number;
	rules: TaskProgressSelectionRule[];
};

const BLOCKED_OR_INPUT_STATUSES = new Set<TaskProgressRow["status"]>([
	"blocked",
	"needs_fix",
	"needs_input",
]);

const REVIEW_OR_VALIDATION_PHASES = new Set<TaskProgressRow["phase"]>([
	"validation",
	"review",
	"final_review",
]);

const INDEX_TASK_PROGRESS_SELECTION: TaskProgressSelectionPolicy = {
	maxRows: 8,
	rules: [
		{ matches: (row) => row.status === "active" },
		{ matches: (row) => row.status === "ready" },
		{ matches: (row) => BLOCKED_OR_INPUT_STATUSES.has(row.status) },
		{ matches: (row) => REVIEW_OR_VALIDATION_PHASES.has(row.phase) },
		{ matches: (row) => row.status === "pending", limit: 2 },
		{ matches: (row) => row.status === "completed", limit: 2 },
	],
};

const OPERATOR_TASK_PROGRESS_SELECTION: TaskProgressSelectionPolicy = {
	maxRows: 4,
	rules: [
		{ matches: (row) => row.status === "active" },
		{ matches: (row) => row.status === "ready" },
		{ matches: (row) => BLOCKED_OR_INPUT_STATUSES.has(row.status) },
		{ matches: (row) => REVIEW_OR_VALIDATION_PHASES.has(row.phase) },
		{ matches: (row) => row.status === "pending", limit: 1 },
	],
};

function appendRows(
	selected: TaskProgressRow[],
	candidates: TaskProgressRow[],
	policy: TaskProgressSelectionPolicy,
): void {
	for (const row of candidates) {
		if (policy.maxRows !== undefined && selected.length >= policy.maxRows) {
			return;
		}
		if (!selected.some((item) => item.id === row.id)) {
			selected.push(row);
		}
	}
}

function selectTaskProgressRows(
	rows: TaskProgressRow[],
	policy: TaskProgressSelectionPolicy,
): TaskProgressRow[] {
	const selected: TaskProgressRow[] = [];
	for (const rule of policy.rules) {
		const candidates = rows.filter(rule.matches);
		appendRows(
			selected,
			rule.limit === undefined ? candidates : candidates.slice(0, rule.limit),
			policy,
		);
	}
	return selected;
}

export function selectIndexTaskProgressRows(
	rows: TaskProgressRow[],
): TaskProgressRow[] {
	return selectTaskProgressRows(rows, INDEX_TASK_PROGRESS_SELECTION);
}

export function selectOperatorTaskProgressRows(
	rows: TaskProgressRow[],
): TaskProgressRow[] {
	return selectTaskProgressRows(rows, OPERATOR_TASK_PROGRESS_SELECTION);
}

export function selectFeatureTaskProgressRows(
	rows: TaskProgressRow[],
	featureId: Feature["id"],
): TaskProgressRow[] {
	return rows.filter(
		(row) =>
			row.featureId === featureId &&
			(row.phase !== "execution" || row.status !== "pending"),
	);
}
