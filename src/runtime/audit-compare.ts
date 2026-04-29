import type { AuditReport } from "../audit/schema";
import type { StoredAuditReport } from "./audit-history";
import { loadAuditReport } from "./audit-history";

type AuditDepthComparison = {
	requestedChanged: boolean;
	achievedChanged: boolean;
	leftRequestedDepth: AuditReport["requestedDepth"];
	rightRequestedDepth: AuditReport["requestedDepth"];
	leftAchievedDepth: AuditReport["achievedDepth"];
	rightAchievedDepth: AuditReport["achievedDepth"];
};

type AuditCoverageComparison = {
	discoveredSurfaceCountDelta: number;
	reviewedSurfaceCountDelta: number;
	unreviewedSurfaceCountDelta: number;
	fullAuditEligibleChanged: boolean;
	leftFullAuditEligible: boolean;
	rightFullAuditEligible: boolean;
	blockingReasonsAdded: string[];
	blockingReasonsRemoved: string[];
};

type AuditSurfaceSnapshot = AuditReport["discoveredSurfaces"][number];
type AuditFindingSnapshot = AuditReport["findings"][number];
type AuditValidationSnapshot = AuditReport["validationRun"][number];
type AuditMatchStrategy = "exact_key" | "heuristic_match";
type AuditMatchMetadata = {
	matchStrategy: AuditMatchStrategy;
	matchReason: string;
};

type AuditSurfaceComparison = {
	added: AuditSurfaceSnapshot[];
	removed: AuditSurfaceSnapshot[];
	changed: Array<
		{
			name: string;
			fieldChanges: string[];
			left: AuditSurfaceSnapshot;
			right: AuditSurfaceSnapshot;
		} & AuditMatchMetadata
	>;
};

type AuditFindingComparison = {
	added: AuditFindingSnapshot[];
	removed: AuditFindingSnapshot[];
	changed: Array<
		{
			key: string;
			fieldChanges: string[];
			left: AuditFindingSnapshot;
			right: AuditFindingSnapshot;
		} & AuditMatchMetadata
	>;
};

type AuditValidationComparison = {
	added: AuditValidationSnapshot[];
	removed: AuditValidationSnapshot[];
	changed: Array<
		{
			command: string;
			fieldChanges: string[];
			left: AuditValidationSnapshot;
			right: AuditValidationSnapshot;
		} & AuditMatchMetadata
	>;
};

export type AuditReportComparison = {
	left: StoredAuditReport;
	right: StoredAuditReport;
	depth: AuditDepthComparison;
	coverage: AuditCoverageComparison;
	surfaces: AuditSurfaceComparison;
	findings: AuditFindingComparison;
	validation: AuditValidationComparison;
	nextStepsAdded: string[];
	nextStepsRemoved: string[];
	summary: string;
};

export type AuditReportComparisonLookup = {
	leftReportId: string;
	rightReportId: string;
	left: StoredAuditReport | null;
	right: StoredAuditReport | null;
	comparison: AuditReportComparison | null;
};

function listDiff(left: string[], right: string[]) {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	return {
		added: [...rightSet].filter((value) => !leftSet.has(value)).sort(),
		removed: [...leftSet].filter((value) => !rightSet.has(value)).sort(),
	};
}

function arraysEqual(left: string[], right: string[]) {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function evidenceOverlapCount(left: string[], right: string[]) {
	const rightSet = new Set(right);
	return [...new Set(left)].filter((value) => rightSet.has(value)).length;
}

function pullBestFallbackMatch<T>(
	leftValue: T,
	candidates: T[],
	scoreCandidate: (left: T, right: T) => number,
	tieBreakKey: (value: T) => string,
) {
	let bestIndex = -1;
	let bestScore = -1;
	let bestTieBreak = "";
	for (const [index, candidate] of candidates.entries()) {
		const score = scoreCandidate(leftValue, candidate);
		const candidateTieBreak = tieBreakKey(candidate);
		if (score > bestScore) {
			bestIndex = index;
			bestScore = score;
			bestTieBreak = candidateTieBreak;
			continue;
		}
		if (
			score === bestScore &&
			score > 0 &&
			(bestIndex === -1 || candidateTieBreak < bestTieBreak)
		) {
			bestIndex = index;
			bestTieBreak = candidateTieBreak;
		}
	}
	if (bestIndex === -1 || bestScore <= 0) {
		return null;
	}
	const [match] = candidates.splice(bestIndex, 1);
	if (!match) {
		return null;
	}
	return {
		match,
		score: bestScore,
	};
}

function compareByKey<T, Key extends string>(
	left: T[],
	right: T[],
	getKey: (value: T) => Key,
	getFieldChanges: (left: T, right: T) => string[],
	scoreFallbackCandidate?: (left: T, right: T) => number,
	describeMatch?: (
		left: T,
		right: T,
		matchStrategy: AuditMatchStrategy,
		score?: number,
	) => AuditMatchMetadata,
	getTieBreakKey: (value: T) => string = (value) =>
		`${getKey(value)}:${JSON.stringify(value)}`,
) {
	const leftBuckets = new Map<Key, T[]>();
	const rightBuckets = new Map<Key, T[]>();
	for (const value of left) {
		const key = getKey(value);
		leftBuckets.set(key, [...(leftBuckets.get(key) ?? []), value]);
	}
	for (const value of right) {
		const key = getKey(value);
		rightBuckets.set(key, [...(rightBuckets.get(key) ?? []), value]);
	}
	const unmatchedLeft: T[] = [];
	const changed: Array<{
		key: Key;
		fieldChanges: string[];
		left: T;
		right: T;
		matchStrategy: AuditMatchStrategy;
		matchReason: string;
	}> = [];

	for (const [key, leftValues] of leftBuckets) {
		const rightValues = rightBuckets.get(key) ?? [];
		const pairCount = Math.min(leftValues.length, rightValues.length);
		for (let index = 0; index < pairCount; index += 1) {
			const leftValue = leftValues[index];
			const rightValue = rightValues[index];
			if (!leftValue || !rightValue) {
				continue;
			}
			const fieldChanges = getFieldChanges(leftValue, rightValue);
			if (fieldChanges.length > 0) {
				changed.push({
					key,
					fieldChanges,
					left: leftValue,
					right: rightValue,
					...(describeMatch
						? describeMatch(leftValue, rightValue, "exact_key")
						: {
								matchStrategy: "exact_key",
								matchReason: `Matched by identical key '${key}'.`,
							}),
				});
			}
		}
		if (leftValues.length > pairCount) {
			unmatchedLeft.push(...leftValues.slice(pairCount));
		}
		if (rightValues.length > pairCount) {
			rightBuckets.set(key, rightValues.slice(pairCount));
			continue;
		}
		rightBuckets.delete(key);
	}

	const unmatchedRight = [...rightBuckets.values()].flat();
	const added: T[] = [];
	const removed: T[] = [];

	if (scoreFallbackCandidate) {
		const rightCandidates = [...unmatchedRight].sort((leftValue, rightValue) =>
			getTieBreakKey(leftValue).localeCompare(getTieBreakKey(rightValue)),
		);
		for (const leftValue of unmatchedLeft) {
			const fallback = pullBestFallbackMatch(
				leftValue,
				rightCandidates,
				scoreFallbackCandidate,
				getTieBreakKey,
			);
			if (!fallback) {
				removed.push(leftValue);
				continue;
			}
			const fieldChanges = getFieldChanges(leftValue, fallback.match);
			if (fieldChanges.length > 0) {
				changed.push({
					key: getKey(leftValue),
					fieldChanges,
					left: leftValue,
					right: fallback.match,
					...(describeMatch
						? describeMatch(
								leftValue,
								fallback.match,
								"heuristic_match",
								fallback.score,
							)
						: {
								matchStrategy: "heuristic_match",
								matchReason: `Matched heuristically with score ${fallback.score}.`,
							}),
				});
			}
		}
		added.push(...rightCandidates);
	} else {
		removed.push(...unmatchedLeft);
		added.push(...unmatchedRight);
	}

	return { added, removed, changed };
}

function surfaceFieldChanges(
	left: AuditSurfaceSnapshot,
	right: AuditSurfaceSnapshot,
) {
	const changes: string[] = [];
	if (left.name !== right.name) {
		changes.push("name");
	}
	if (left.category !== right.category) {
		changes.push("category");
	}
	if (left.reviewStatus !== right.reviewStatus) {
		changes.push("reviewStatus");
	}
	if (!arraysEqual(left.evidence, right.evidence)) {
		changes.push("evidence");
	}
	if ((left.reason ?? null) !== (right.reason ?? null)) {
		changes.push("reason");
	}
	return changes;
}

function surfaceFallbackScore(
	left: AuditSurfaceSnapshot,
	right: AuditSurfaceSnapshot,
) {
	if (left.category !== right.category) {
		return -1;
	}
	const overlap = evidenceOverlapCount(left.evidence, right.evidence);
	if (overlap > 0) {
		return 10 + overlap;
	}
	if (
		left.evidence.length === 0 &&
		right.evidence.length === 0 &&
		left.reviewStatus === right.reviewStatus &&
		(left.reason ?? null) === (right.reason ?? null)
	) {
		return 1;
	}
	return -1;
}

function describeSurfaceMatch(
	left: AuditSurfaceSnapshot,
	right: AuditSurfaceSnapshot,
	matchStrategy: AuditMatchStrategy,
	score?: number,
): AuditMatchMetadata {
	if (matchStrategy === "exact_key") {
		return {
			matchStrategy,
			matchReason: `Matched by identical surface name '${left.name}'.`,
		};
	}
	const overlap = evidenceOverlapCount(left.evidence, right.evidence);
	return {
		matchStrategy,
		matchReason:
			overlap > 0
				? `Matched heuristically by shared category '${left.category}' and ${overlap} overlapping evidence entr${overlap === 1 ? "y" : "ies"} (score ${score ?? overlap}).`
				: `Matched heuristically by identical category '${left.category}' and equivalent unreviewed-state metadata (score ${score ?? 0}).`,
	};
}

function findingFieldChanges(
	left: AuditFindingSnapshot,
	right: AuditFindingSnapshot,
) {
	const changes: string[] = [];
	if (left.title !== right.title) {
		changes.push("title");
	}
	if (left.category !== right.category) {
		changes.push("category");
	}
	if (left.confidence !== right.confidence) {
		changes.push("confidence");
	}
	if ((left.severity ?? null) !== (right.severity ?? null)) {
		changes.push("severity");
	}
	if (left.impact !== right.impact) {
		changes.push("impact");
	}
	if ((left.remediation ?? null) !== (right.remediation ?? null)) {
		changes.push("remediation");
	}
	if (!arraysEqual(left.evidence, right.evidence)) {
		changes.push("evidence");
	}
	return changes;
}

function findingFallbackScore(
	left: AuditFindingSnapshot,
	right: AuditFindingSnapshot,
) {
	if (left.category !== right.category) {
		return -1;
	}
	let score = 0;
	if (left.impact === right.impact) {
		score += 3;
	}
	score += evidenceOverlapCount(left.evidence, right.evidence) * 2;
	if (
		left.remediation &&
		right.remediation &&
		left.remediation === right.remediation
	) {
		score += 1;
	}
	if ((left.severity ?? null) === (right.severity ?? null) && left.severity) {
		score += 1;
	}
	if (left.confidence === right.confidence) {
		score += 1;
	}
	return score >= 3 ? score : -1;
}

function describeFindingMatch(
	left: AuditFindingSnapshot,
	right: AuditFindingSnapshot,
	matchStrategy: AuditMatchStrategy,
	score?: number,
): AuditMatchMetadata {
	if (matchStrategy === "exact_key") {
		return {
			matchStrategy,
			matchReason: `Matched by identical finding key '${left.category}:${left.title}'.`,
		};
	}
	const overlap = evidenceOverlapCount(left.evidence, right.evidence);
	const reasons: string[] = [`shared category '${left.category}'`];
	if (left.impact === right.impact) {
		reasons.push("identical impact");
	}
	if (overlap > 0) {
		reasons.push(
			`${overlap} overlapping evidence entr${overlap === 1 ? "y" : "ies"}`,
		);
	}
	if (
		left.remediation &&
		right.remediation &&
		left.remediation === right.remediation
	) {
		reasons.push("identical remediation");
	}
	return {
		matchStrategy,
		matchReason: `Matched heuristically by ${reasons.join(", ")} (score ${score ?? 0}).`,
	};
}

function validationFieldChanges(
	left: AuditValidationSnapshot,
	right: AuditValidationSnapshot,
) {
	const changes: string[] = [];
	if (left.status !== right.status) {
		changes.push("status");
	}
	if (left.summary !== right.summary) {
		changes.push("summary");
	}
	return changes;
}

function describeValidationMatch(
	left: AuditValidationSnapshot,
	_right: AuditValidationSnapshot,
	matchStrategy: AuditMatchStrategy,
): AuditMatchMetadata {
	return {
		matchStrategy,
		matchReason: `Matched by identical validation command '${left.command}'.`,
	};
}

function buildAuditComparisonSummary(
	comparison: Omit<AuditReportComparison, "summary">,
) {
	const summaryParts = [
		`${comparison.surfaces.added.length + comparison.surfaces.removed.length + comparison.surfaces.changed.length} surface change${comparison.surfaces.added.length + comparison.surfaces.removed.length + comparison.surfaces.changed.length === 1 ? "" : "s"}`,
		`${comparison.findings.added.length + comparison.findings.removed.length + comparison.findings.changed.length} finding change${comparison.findings.added.length + comparison.findings.removed.length + comparison.findings.changed.length === 1 ? "" : "s"}`,
		`${comparison.validation.added.length + comparison.validation.removed.length + comparison.validation.changed.length} validation change${comparison.validation.added.length + comparison.validation.removed.length + comparison.validation.changed.length === 1 ? "" : "s"}`,
	];
	if (
		comparison.depth.requestedChanged ||
		comparison.depth.achievedChanged ||
		comparison.coverage.fullAuditEligibleChanged
	) {
		summaryParts.unshift("depth or eligibility changed");
	}
	return `Compared audit coverage and findings: ${summaryParts.join(", ")}.`;
}

export function compareStoredAuditReports(
	left: StoredAuditReport,
	right: StoredAuditReport,
): AuditReportComparison {
	const coverageBlockingReasons = listDiff(
		left.report.coverageRubric.blockingReasons,
		right.report.coverageRubric.blockingReasons,
	);
	const surfaces = compareByKey(
		left.report.discoveredSurfaces,
		right.report.discoveredSurfaces,
		(surface) => surface.name,
		surfaceFieldChanges,
		surfaceFallbackScore,
		describeSurfaceMatch,
	);
	const findings = compareByKey(
		left.report.findings,
		right.report.findings,
		(finding) => `${finding.category}:${finding.title}`,
		findingFieldChanges,
		findingFallbackScore,
		describeFindingMatch,
	);
	const validation = compareByKey(
		left.report.validationRun,
		right.report.validationRun,
		(entry) => entry.command,
		validationFieldChanges,
		undefined,
		describeValidationMatch,
	);
	const nextSteps = listDiff(
		left.report.nextSteps ?? [],
		right.report.nextSteps ?? [],
	);
	const comparisonWithoutSummary = {
		left,
		right,
		depth: {
			requestedChanged:
				left.report.requestedDepth !== right.report.requestedDepth,
			achievedChanged: left.report.achievedDepth !== right.report.achievedDepth,
			leftRequestedDepth: left.report.requestedDepth,
			rightRequestedDepth: right.report.requestedDepth,
			leftAchievedDepth: left.report.achievedDepth,
			rightAchievedDepth: right.report.achievedDepth,
		},
		coverage: {
			discoveredSurfaceCountDelta:
				right.report.coverageSummary.discoveredSurfaceCount -
				left.report.coverageSummary.discoveredSurfaceCount,
			reviewedSurfaceCountDelta:
				right.report.coverageSummary.reviewedSurfaceCount -
				left.report.coverageSummary.reviewedSurfaceCount,
			unreviewedSurfaceCountDelta:
				right.report.coverageSummary.unreviewedSurfaceCount -
				left.report.coverageSummary.unreviewedSurfaceCount,
			fullAuditEligibleChanged:
				left.report.coverageRubric.fullAuditEligible !==
				right.report.coverageRubric.fullAuditEligible,
			leftFullAuditEligible: left.report.coverageRubric.fullAuditEligible,
			rightFullAuditEligible: right.report.coverageRubric.fullAuditEligible,
			blockingReasonsAdded: coverageBlockingReasons.added,
			blockingReasonsRemoved: coverageBlockingReasons.removed,
		},
		surfaces: {
			added: surfaces.added,
			removed: surfaces.removed,
			changed: surfaces.changed.map((entry) => ({
				name: entry.key,
				fieldChanges: entry.fieldChanges,
				left: entry.left,
				right: entry.right,
				matchStrategy: entry.matchStrategy,
				matchReason: entry.matchReason,
			})),
		},
		findings: {
			added: findings.added,
			removed: findings.removed,
			changed: findings.changed,
		},
		validation: {
			added: validation.added,
			removed: validation.removed,
			changed: validation.changed.map((entry) => ({
				command: entry.key,
				fieldChanges: entry.fieldChanges,
				left: entry.left,
				right: entry.right,
				matchStrategy: entry.matchStrategy,
				matchReason: entry.matchReason,
			})),
		},
		nextStepsAdded: nextSteps.added,
		nextStepsRemoved: nextSteps.removed,
	};

	return {
		...comparisonWithoutSummary,
		summary: buildAuditComparisonSummary(comparisonWithoutSummary),
	};
}

export async function compareAuditReports(
	worktree: string,
	leftReportId: string,
	rightReportId: string,
): Promise<AuditReportComparisonLookup> {
	const [left, right] = await Promise.all([
		loadAuditReport(worktree, leftReportId),
		loadAuditReport(worktree, rightReportId),
	]);
	return {
		leftReportId,
		rightReportId,
		left,
		right,
		comparison: left && right ? compareStoredAuditReports(left, right) : null,
	};
}
