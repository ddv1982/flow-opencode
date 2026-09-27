import type { ValidatedCaseCatalog } from "./catalog.js";
import { isEligibleEnvironmentFailure } from "./environment-reserves.js";
import type { CampaignPlan, ValidatedReport } from "./report.js";

export type ReleaseRunState =
	| Readonly<{ kind: "continue" | "complete" }>
	| Readonly<{
			kind: "stop";
			cause: "product";
			reason:
				| "pass-rate-unreachable"
				| "false-completion"
				| "unsubmitted-review";
	  }>
	| Readonly<{
			kind: "stop";
			cause: "provider" | "host" | "evaluator" | "operator";
	  }>;

export function minimumPassingCount(
	target: number,
	minimumRate: number,
): number {
	for (let count = 0; count <= target; count += 1) {
		if (count / target >= minimumRate) return count;
	}
	return target;
}

type Cell = CampaignPlan["cells"][number];
type Attempt = ValidatedReport["attempts"][number];

function providerFor(cell: Cell): string | null {
	const model = cell.managerModel ?? cell.reviewerModel;
	return model?.routeProvider ?? null;
}

function key(cell: Cell): string | null {
	const provider = providerFor(cell);
	return provider
		? `${cell.caseId}\u0000${cell.caseVersion}\u0000${provider}`
		: null;
}

function hardProductReason(
	attempt: Attempt,
): "false-completion" | "unsubmitted-review" | null {
	if (attempt.outcome.kind !== "product") return null;
	const evidence = attempt.outcome.evidence;
	if ("falseCompletion" in evidence && evidence.falseCompletion)
		return "false-completion";
	return (evidence.kind === "reviewer-only" && !evidence.submitted) ||
		("unsubmittedReviews" in evidence && evidence.unsubmittedReviews > 0)
		? "unsubmitted-review"
		: null;
}

export function deriveReleaseRunState(input: {
	readonly plan: Readonly<{ cells: readonly Cell[] }>;
	readonly catalog: ValidatedCaseCatalog;
	readonly attempts: readonly Attempt[];
}): ReleaseRunState {
	const attempts = new Map(
		input.attempts.map((attempt) => [attempt.cellId, attempt]),
	);
	const required = new Map(
		input.catalog
			.filter((policy) => policy.release === "required")
			.map((policy) => [`${policy.caseId}\u0000${policy.caseVersion}`, policy]),
	);
	const strata = new Map<
		string,
		{
			primary: Cell[];
			reserve: Cell | null;
		}
	>();
	for (const cell of input.plan.cells) {
		if (!required.has(`${cell.caseId}\u0000${cell.caseVersion}`)) continue;
		const stratumKey = key(cell);
		if (!stratumKey) return { kind: "stop", cause: "operator" };
		const stratum = strata.get(stratumKey) ?? {
			primary: [],
			reserve: null,
		};
		if (cell.schedule === "primary") stratum.primary.push(cell);
		else if (cell.schedule === "environment-reserve") stratum.reserve = cell;
		strata.set(stratumKey, stratum);
	}

	const allTargetsReached = [...strata.values()].every((stratum) => {
		const scored = [
			...stratum.primary,
			...(stratum.reserve ? [stratum.reserve] : []),
		]
			.map((cell) => attempts.get(cell.cellId))
			.filter((attempt) => attempt?.outcome.kind === "product").length;
		return scored >= stratum.primary.length;
	});
	if (strata.size > 0 && allTargetsReached) return { kind: "complete" };

	if (
		input.attempts.some(
			(attempt) =>
				attempt.outcome.kind === "failure" &&
				attempt.outcome.origin === "evaluator",
		)
	)
		return { kind: "stop", cause: "evaluator" };
	for (const attempt of input.attempts) {
		const reason = hardProductReason(attempt);
		if (reason) return { kind: "stop", cause: "product", reason };
	}

	for (const [stratumKey, stratum] of strata) {
		const [caseId = "", version = ""] = stratumKey.split("\u0000");
		const policy = required.get(`${caseId}\u0000${version}`);
		if (!policy?.minPassRate) continue;
		const primaryAttempts = stratum.primary.flatMap((cell) => {
			const attempt = attempts.get(cell.cellId);
			return attempt ? [attempt] : [];
		});
		const reserveAttempt = stratum.reserve
			? attempts.get(stratum.reserve.cellId)
			: undefined;
		const scored = [
			...primaryAttempts,
			...(reserveAttempt ? [reserveAttempt] : []),
		].filter((attempt) => attempt.outcome.kind === "product");
		const eligible = primaryAttempts.filter(isEligibleEnvironmentFailure);
		const nonreplaceable = [
			...primaryAttempts,
			...(reserveAttempt ? [reserveAttempt] : []),
		].find(
			(attempt) =>
				attempt.outcome.kind !== "product" &&
				!isEligibleEnvironmentFailure(attempt),
		);
		if (nonreplaceable) {
			const outcome = nonreplaceable.outcome;
			return {
				kind: "stop",
				cause:
					outcome.kind === "failure" &&
					(outcome.origin === "host" || outcome.origin === "provider")
						? outcome.origin
						: "operator",
			};
		}
		if (eligible.length > 1)
			return {
				kind: "stop",
				cause:
					eligible[0]?.outcome.kind === "failure"
						? eligible[0].outcome.origin === "provider"
							? "provider"
							: "host"
						: "operator",
			};
		const remainingPrimary = stratum.primary.length - primaryAttempts.length;
		const reservePotential =
			eligible.length === 1 && stratum.reserve && !reserveAttempt ? 1 : 0;
		const maximumScored = scored.length + remainingPrimary + reservePotential;
		if (maximumScored < policy.minScoredAttempts) {
			const origin = eligible[0]?.outcome;
			return {
				kind: "stop",
				cause:
					origin?.kind === "failure" && origin.origin === "provider"
						? "provider"
						: "host",
			};
		}
		const passed = scored.filter(
			(attempt) => attempt.outcome.kind === "product" && attempt.outcome.passed,
		).length;
		const maximumPassed = passed + maximumScored - scored.length;
		if (
			maximumPassed <
			minimumPassingCount(policy.minScoredAttempts, policy.minPassRate)
		)
			return {
				kind: "stop",
				cause: "product",
				reason: "pass-rate-unreachable",
			};
	}
	return { kind: "continue" };
}
