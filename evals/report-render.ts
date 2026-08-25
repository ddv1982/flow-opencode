import { analyzePairs, analyzeReviewer } from "./analysis.js";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import type { ValidatedCaseCatalog } from "./catalog.js";
import type { AttemptRecordV2, ValidatedReport } from "./report.js";

export type WilsonInterval = readonly [number, number] | null;
export type EvidenceCard = {
	readonly caseId: string;
	readonly caseVersion: number;
	readonly scheduled: number;
	readonly attempted: number;
	readonly missing: number;
	readonly products: number;
	readonly passed: number;
	readonly failedProducts: number;
	readonly operationalFailures: number;
	readonly unscored: number;
	readonly passRate: number | null;
	readonly interval95: WilsonInterval;
};
export type EvidenceRender = {
	readonly cards: readonly EvidenceCard[];
	readonly completion: ValidatedReport["completion"];
	readonly artifacts: readonly AttemptRecordV2["artifact"][];
	readonly evaluatorDigests: readonly string[];
	readonly reviewer: ReturnType<typeof analyzeReviewer>;
	readonly paired: ReturnType<typeof analyzePairs>;
};
export type ComparisonKey = {
	readonly sha256: string;
	readonly semantics: unknown;
};
export type CaseDelta = {
	readonly caseId: string;
	readonly caseVersion: number;
	readonly baselineRate: number | null;
	readonly candidateRate: number | null;
	readonly delta: number | null;
};
export type ReportComparison = {
	readonly compatible: boolean;
	readonly reason: string | null;
	readonly passDelta: number | null;
	readonly cases: readonly CaseDelta[];
};

function wilson(passed: number, total: number): WilsonInterval {
	if (total === 0) return null;
	const z = 1.959963984540054;
	const rate = passed / total;
	const square = z * z;
	const denominator = 1 + square / total;
	const center = (rate + square / (2 * total)) / denominator;
	const margin =
		(z / denominator) *
		Math.sqrt((rate * (1 - rate) + square / (4 * total)) / total);
	return [center - margin, center + margin];
}

function activeCells(report: ValidatedReport) {
	const reserves = new Set(report.completion.activatedReserveCellIds);
	return report.plan.cells.filter(
		(cell) =>
			cell.schedule === "primary" ||
			(cell.schedule === "replacement-reserve" && reserves.has(cell.cellId)),
	);
}

function caseKey(input: {
	readonly caseId: string;
	readonly caseVersion: number;
}): string {
	return `${input.caseId}\u0000${input.caseVersion}`;
}

export function renderEvidence(report: ValidatedReport): EvidenceRender {
	const cards = new Map<string, EvidenceCard>();
	for (const cell of activeCells(report)) {
		const key = caseKey(cell);
		const prior = cards.get(key) ?? {
			caseId: cell.caseId,
			caseVersion: cell.caseVersion,
			scheduled: 0,
			attempted: 0,
			missing: 0,
			products: 0,
			passed: 0,
			failedProducts: 0,
			operationalFailures: 0,
			unscored: 0,
			passRate: null,
			interval95: null,
		};
		cards.set(key, { ...prior, scheduled: prior.scheduled + 1 });
	}
	for (const attempt of report.attempts) {
		const key = caseKey(attempt);
		const prior = cards.get(key);
		if (!prior) throw new Error("Validated attempt lacks a scheduled case.");
		if (attempt.outcome.kind === "product") {
			cards.set(key, {
				...prior,
				attempted: prior.attempted + 1,
				products: prior.products + 1,
				passed: prior.passed + Number(attempt.outcome.passed),
				failedProducts: prior.failedProducts + Number(!attempt.outcome.passed),
			});
		} else if (attempt.outcome.kind === "failure") {
			cards.set(key, {
				...prior,
				attempted: prior.attempted + 1,
				operationalFailures: prior.operationalFailures + 1,
			});
		} else {
			cards.set(key, {
				...prior,
				attempted: prior.attempted + 1,
				unscored: prior.unscored + 1,
			});
		}
	}
	const rendered = [...cards.values()]
		.map((card) => ({
			...card,
			missing: Math.max(0, card.scheduled - card.attempted),
			passRate: card.products === 0 ? null : card.passed / card.products,
			interval95: wilson(card.passed, card.products),
		}))
		.sort(
			(left, right) =>
				left.caseId.localeCompare(right.caseId) ||
				left.caseVersion - right.caseVersion,
		);
	const artifacts = new Map<string, AttemptRecordV2["artifact"]>();
	for (const attempt of report.attempts) {
		artifacts.set(canonicalJson(attempt.artifact), attempt.artifact);
	}
	return {
		cards: rendered,
		completion: report.completion,
		artifacts: [...artifacts.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([, artifact]) => artifact),
		evaluatorDigests: [
			...new Set(
				report.attempts.map((attempt) =>
					canonicalSha256("flow-render-evaluator-v1", {
						caseCatalogSha256: attempt.evaluator.caseCatalogSha256,
						policyCatalogSha256: attempt.evaluator.policyCatalogSha256,
						graderBundleSha256: attempt.evaluator.graderBundleSha256,
					}),
				),
			),
		].sort(),
		reviewer: analyzeReviewer(report),
		paired: analyzePairs(report),
	};
}

function sortedByCanonical<T>(values: readonly T[]): readonly T[] {
	return [...values].sort((left, right) =>
		canonicalJson(left).localeCompare(canonicalJson(right)),
	);
}

export function comparisonKey(input: {
	readonly report: ValidatedReport;
	readonly catalog: ValidatedCaseCatalog;
}): ComparisonKey {
	const cells = input.report.plan.cells.map((cell) => ({
		caseId: cell.caseId,
		caseVersion: cell.caseVersion,
		repetition: cell.repetition,
		schedule: cell.schedule,
		managerModel: cell.managerModel,
		reviewerModel: cell.reviewerModel,
	}));
	const rows = input.report.attempts.map((attempt) => ({
		caseId: attempt.caseId,
		caseVersion: attempt.caseVersion,
		repetition: attempt.repetition,
		schedule: input.report.plan.cells.find(
			(cell) => cell.cellId === attempt.cellId,
		)?.schedule,
		hostConfigSha256: attempt.hostConfigSha256,
		actors: sortedByCanonical(
			attempt.actors.map((actor) => ({
				role: actor.role,
				requestedModel: actor.requestedModel,
			})),
		),
		instructions: [...attempt.instructions].sort(
			(left, right) => left.sequence - right.sequence,
		),
		evaluator: {
			caseCatalogSha256: attempt.evaluator.caseCatalogSha256,
			policyCatalogSha256: attempt.evaluator.policyCatalogSha256,
			graderBundleSha256: attempt.evaluator.graderBundleSha256,
		},
	}));
	const semantics = {
		cells: sortedByCanonical(cells),
		policy: {
			analysis: input.report.plan.analysis,
			stoppingRule: input.report.plan.stoppingRule,
			abortPolicy: input.report.plan.abortPolicy,
			budget: input.report.plan.budget,
		},
		catalog: sortedByCanonical(
			input.catalog.map((entry) => ({
				caseId: entry.caseId,
				caseVersion: entry.caseVersion,
				evidenceClass: entry.evidenceClass,
				oracle: entry.oracle,
				release: entry.release,
				minProviders: entry.minProviders,
				minScoredAttempts: entry.minScoredAttempts,
				minPassRate: entry.minPassRate,
				reviewerPromotionRecordSha256: entry.reviewerPromotionRecordSha256,
			})),
		),
		rows: sortedByCanonical(rows),
	};
	return {
		semantics,
		sha256: canonicalSha256("flow-report-comparison-key-v1", semantics),
	};
}

function cardRates(report: ValidatedReport): Map<string, EvidenceCard> {
	return new Map(
		renderEvidence(report).cards.map((card) => [caseKey(card), card]),
	);
}

export function compareReports(input: {
	readonly baseline: ValidatedReport;
	readonly candidate: ValidatedReport;
	readonly baselineCatalog: ValidatedCaseCatalog;
	readonly candidateCatalog: ValidatedCaseCatalog;
}): ReportComparison {
	if (
		input.baseline.completion.status !== "complete" ||
		input.candidate.completion.status !== "complete"
	) {
		return {
			compatible: false,
			reason: "Comparable trends require complete reports.",
			passDelta: null,
			cases: [],
		};
	}
	const baselineKey = comparisonKey({
		report: input.baseline,
		catalog: input.baselineCatalog,
	});
	const candidateKey = comparisonKey({
		report: input.candidate,
		catalog: input.candidateCatalog,
	});
	if (baselineKey.sha256 !== candidateKey.sha256) {
		return {
			compatible: false,
			reason: "Comparison semantics differ.",
			passDelta: null,
			cases: [],
		};
	}
	const baselineCards = cardRates(input.baseline);
	const candidateCards = cardRates(input.candidate);
	const cases = [...baselineCards.entries()].map(([key, baseline]) => {
		const candidate = candidateCards.get(key);
		if (!candidate) throw new Error("Compatible report lost a case card.");
		return {
			caseId: baseline.caseId,
			caseVersion: baseline.caseVersion,
			baselineRate: baseline.passRate,
			candidateRate: candidate.passRate,
			delta:
				baseline.passRate === null || candidate.passRate === null
					? null
					: candidate.passRate - baseline.passRate,
		};
	});
	const totals = (cards: ReadonlyMap<string, EvidenceCard>) => {
		const values = [...cards.values()];
		const products = values.reduce((sum, card) => sum + card.products, 0);
		const passed = values.reduce((sum, card) => sum + card.passed, 0);
		return products === 0 ? null : passed / products;
	};
	const baselineRate = totals(baselineCards);
	const candidateRate = totals(candidateCards);
	return {
		compatible: true,
		reason: null,
		passDelta:
			baselineRate === null || candidateRate === null
				? null
				: candidateRate - baselineRate,
		cases,
	};
}

export function compareTrend(
	points: readonly {
		readonly report: ValidatedReport;
		readonly catalog: ValidatedCaseCatalog;
	}[],
): {
	readonly compatible: boolean;
	readonly comparisons: readonly ReportComparison[];
} {
	const comparisons = points.slice(1).map((point, index) => {
		const prior = points[index];
		if (!prior) throw new Error("Trend predecessor is missing.");
		return compareReports({
			baseline: prior.report,
			candidate: point.report,
			baselineCatalog: prior.catalog,
			candidateCatalog: point.catalog,
		});
	});
	return {
		compatible: comparisons.every((comparison) => comparison.compatible),
		comparisons,
	};
}
