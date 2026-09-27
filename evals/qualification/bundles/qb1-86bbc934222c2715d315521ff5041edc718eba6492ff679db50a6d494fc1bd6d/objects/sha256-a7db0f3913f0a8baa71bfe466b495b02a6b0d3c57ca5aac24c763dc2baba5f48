import { liveFindingIds } from "../domain/review-findings.js";
import type { ReviewFinding, Session } from "../domain/session.js";

type FindingsDigestRow = Readonly<{
	featureId: string;
	findingId: string;
	severity: ReviewFinding["severity"];
	summary: string;
	evidence?: string | undefined;
	attempt: number;
	verdict: "passed" | "failed";
	live: boolean;
}>;

export type FindingsDigest = ReadonlyArray<FindingsDigestRow>;

function plannedFeatureIds(session: Session): string[] {
	if (session.plan) return session.plan.features.map((feature) => feature.id);
	const ids: string[] = [];
	for (const run of session.runs) {
		if (ids.includes(run.featureId)) continue;
		ids.push(run.featureId);
	}
	return ids;
}

/**
 * Every finding that has an id, across every attempt of every planned feature.
 *
 * Last statement wins for text and verdict. `live` is the carry-forward set
 * `livePriorFindings` already computes: a later pass that omits an id keeps the
 * row with `live: false`. No persist. No closure required.
 */
export function findingsDigest(session: Session): FindingsDigest {
	const rows: FindingsDigestRow[] = [];
	const indexById = new Map<string, number>();
	for (const featureId of plannedFeatureIds(session)) {
		for (const run of session.runs) {
			if (run.featureId !== featureId) continue;
			for (const review of run.reviews) {
				const result = review.result;
				if (!result) continue;
				for (const finding of result.findings) {
					if (!finding.findingId) continue;
					const row: FindingsDigestRow = {
						featureId,
						findingId: finding.findingId,
						severity: finding.severity,
						summary: finding.summary,
						attempt: run.attempt,
						verdict: result.verdict,
						live: false,
						...(finding.evidence === undefined
							? {}
							: { evidence: finding.evidence }),
					};
					const existing = indexById.get(finding.findingId);
					if (existing === undefined) {
						indexById.set(finding.findingId, rows.length);
						rows.push(row);
					} else {
						rows[existing] = row;
					}
				}
			}
		}
	}
	return rows.map((row) => ({
		...row,
		live: liveFindingIds(session, row.featureId).includes(row.findingId),
	}));
}

export function digestReportLines(digest: FindingsDigest): string[] {
	if (digest.length === 0) return ["Findings digest: none"];
	const line = (row: FindingsDigestRow, kind: "live" | "historical") =>
		`- ${kind} ${row.featureId} ${row.findingId} ${row.severity}: ${row.summary}`;
	return [
		"Findings digest:",
		...digest.filter((row) => row.live).map((row) => line(row, "live")),
		...digest.filter((row) => !row.live).map((row) => line(row, "historical")),
	];
}
