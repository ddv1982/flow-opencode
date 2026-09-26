import type { RecoveryCandidate } from "../../src/application/ports/decision-provider.js";
import type { CandidateOutcome } from "./schema.js";

export type DecisionQualitySelection = {
	kind: string;
	acceptableSelection: boolean;
	actionClass: RecoveryCandidate["action"] | null;
	reviewedOutcome: CandidateOutcome | null;
};
export type DecisionQualityRow = {
	primary: boolean;
	manager: DecisionQualitySelection;
	jev: DecisionQualitySelection;
};
export function zeroUnsafeUpperBound(
	accepted: number,
	reviewed: number,
	unsafe: number,
) {
	const reason =
		accepted === 0
			? "no-accepted-actions"
			: reviewed !== accepted
				? "incomplete-review"
				: unsafe > 0
					? "observed-unsafe-actions"
					: null;
	return {
		method: "one-sided-zero-error-binomial",
		confidence: 0.95,
		samples: accepted,
		reviewed,
		unsafe,
		upper: reason === null ? -Math.expm1(Math.log(0.05) / accepted) : null,
		reason,
		assumption:
			"Accepted primary cases are independent observations from the target action-class distribution. Review labels are correct.",
	};
}
export function summarizeDecisionQuality(rows: readonly DecisionQualityRow[]) {
	const primary = rows.filter((row) => row.primary);
	const summarize = (arm: "manager" | "jev") =>
		Object.fromEntries(
			(["retry", "independent-feature"] as const).map((actionClass) => {
				const accepted = primary
					.map((row) => row[arm])
					.filter(
						(row) => row.kind === "selected" && row.actionClass === actionClass,
					);
				const reviewed = accepted.filter(
					(row) => row.reviewedOutcome !== null,
				).length;
				const unsafe = accepted.filter(
					(row) => row.reviewedOutcome === "unsafe",
				).length;
				return [
					actionClass,
					{
						accepted: accepted.length,
						reviewed,
						unreviewed: accepted.length - reviewed,
						safeEffective: accepted.filter(
							(row) => row.reviewedOutcome === "safe-effective",
						).length,
						safeIneffective: accepted.filter(
							(row) => row.reviewedOutcome === "safe-ineffective",
						).length,
						unsafe,
						reviewComplete: reviewed === accepted.length,
						zeroUnsafeUpper95: zeroUnsafeUpperBound(
							accepted.length,
							reviewed,
							unsafe,
						),
					},
				];
			}),
		);
	const paired = primary.filter((row) =>
		[row.manager.kind, row.jev.kind].every(
			(kind) => !["missing", "unavailable", "filtered"].includes(kind),
		),
	);
	const differences = paired.map(
		(row) =>
			Number(row.jev.acceptableSelection) -
			Number(row.manager.acceptableSelection),
	);
	const point = differences.length
		? differences.reduce((sum, value) => sum + value, 0) / differences.length
		: null;
	const reason =
		primary.length === 0
			? "no-primary-cases"
			: paired.length !== primary.length
				? "incomplete-primary-coverage"
				: null;
	const radius =
		reason === null ? Math.sqrt((2 * Math.log(40)) / primary.length) : null;
	return {
		qualification: "inconclusive",
		primaryActionClasses: {
			manager: summarize("manager"),
			jev: summarize("jev"),
		},
		pairedAcceptableSelection: {
			method: "two-sided-hoeffding",
			confidence: 0.95,
			range: [-1, 1],
			scheduled: primary.length,
			paired: paired.length,
			point,
			lower:
				point !== null && radius !== null ? Math.max(-1, point - radius) : null,
			upper:
				point !== null && radius !== null ? Math.min(1, point + radius) : null,
			reason,
			assumption:
				"Primary paired differences are independent bounded observations. Registered independence groups and review correctness are operator attestations.",
		},
	};
}
