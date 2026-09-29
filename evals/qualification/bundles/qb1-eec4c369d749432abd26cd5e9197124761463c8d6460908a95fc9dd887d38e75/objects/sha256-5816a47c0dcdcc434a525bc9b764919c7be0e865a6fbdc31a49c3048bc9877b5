import { canonicalJson } from "./canonical-json.js";
import { isRetainableEnvironmentFailure } from "./grader-input.js";
import type {
	AttemptRecordV2,
	CampaignPlan,
	ScheduledCell,
	ValidatedReport,
} from "./report.js";

export type EnvironmentReserveState = Readonly<{
	activatedReserveCellIds: readonly string[];
	nextReserveCellIds: readonly string[];
	targetsSatisfied: boolean;
	exhaustedStrata: readonly string[];
	fatal: boolean;
}>;

export function environmentStratumKey(cell: ScheduledCell): string {
	return canonicalJson({
		caseId: cell.caseId,
		caseVersion: cell.caseVersion,
		managerModel: cell.managerModel,
	});
}

export function isEligibleEnvironmentFailure(
	attempt: Pick<ValidatedReport["attempts"][number], "outcome">,
): boolean {
	return (
		attempt.outcome.kind === "failure" &&
		isRetainableEnvironmentFailure(attempt.outcome)
	);
}

export function deriveEnvironmentReserveState(
	plan: CampaignPlan,
	attempts: readonly AttemptRecordV2[],
): EnvironmentReserveState {
	const attemptsByCell = new Map(
		attempts.map((attempt) => [attempt.cellId, attempt]),
	);
	const primaryByStratum = new Map<string, ScheduledCell[]>();
	const reserveByStratum = new Map<string, ScheduledCell>();
	for (const cell of plan.cells) {
		const key = environmentStratumKey(cell);
		if (cell.schedule === "primary") {
			const primary = primaryByStratum.get(key) ?? [];
			primary.push(cell);
			primaryByStratum.set(key, primary);
		} else if (cell.schedule === "environment-reserve") {
			reserveByStratum.set(key, cell);
		}
	}

	const activatedReserveCellIds: string[] = [];
	const nextReserveCellIds: string[] = [];
	const exhaustedStrata: string[] = [];
	let targetsSatisfied = true;
	for (const [key, primary] of primaryByStratum) {
		const reserve = reserveByStratum.get(key);
		const primaryProductCount = primary.filter(
			(cell) => attemptsByCell.get(cell.cellId)?.outcome.kind === "product",
		).length;
		const eligible = primary.some((cell) => {
			const attempt = attemptsByCell.get(cell.cellId);
			return attempt ? isEligibleEnvironmentFailure(attempt) : false;
		});
		const shouldActivate =
			primaryProductCount + 1 === primary.length &&
			eligible &&
			reserve !== undefined;
		if (shouldActivate) {
			activatedReserveCellIds.push(reserve.cellId);
		}
		const reserveAttempt = reserve
			? attemptsByCell.get(reserve.cellId)
			: undefined;
		const productCount =
			primaryProductCount +
			(reserveAttempt?.outcome.kind === "product" ? 1 : 0);
		if (productCount === primary.length) continue;
		targetsSatisfied = false;
		if (shouldActivate && reserveAttempt === undefined) {
			nextReserveCellIds.push(reserve.cellId);
			continue;
		}
		const allPrimaryAttempted = primary.every((cell) =>
			attemptsByCell.has(cell.cellId),
		);
		if (allPrimaryAttempted) exhaustedStrata.push(key);
	}

	return {
		activatedReserveCellIds,
		nextReserveCellIds,
		targetsSatisfied,
		exhaustedStrata,
		fatal: attempts.some(
			(attempt) =>
				attempt.outcome.kind === "failure" &&
				attempt.outcome.origin === "evaluator",
		),
	};
}
