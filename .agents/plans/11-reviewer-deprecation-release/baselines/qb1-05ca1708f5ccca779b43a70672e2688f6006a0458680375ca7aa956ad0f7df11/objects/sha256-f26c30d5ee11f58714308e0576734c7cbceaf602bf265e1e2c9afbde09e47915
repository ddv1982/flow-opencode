import type { FeatureId, ReviewFinding, Session } from "./session.js";

/**
 * `<feature-id>.R<assignment-createdRevision>-<NN>`.
 *
 * This grammar used to live only in reviewer prose, hand-assembled into each
 * finding summary, with no code that produced or read it. Recurrence tracking
 * therefore depended entirely on a model reproducing a string convention. The
 * runtime now issues and checks these ids.
 */
export const FINDING_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.R\d+-\d{2,4}$/;
export const FINDING_ID_MESSAGE =
	"Finding ids look like 'feature-id.R12-01'; omit the field for a new issue and the runtime assigns one.";

export function findingIdPrefix(
	featureId: FeatureId,
	createdRevision: number,
): string {
	return `${featureId}.R${createdRevision}`;
}

function sequence(index: number): string {
	return String(index).padStart(2, "0");
}

/**
 * Fills in an id for every finding that does not carry one, continuing after the
 * highest sequence already used under this prefix so a reused prior id can never
 * collide with a freshly issued one.
 */
export function assignFindingIds(
	findings: readonly ReviewFinding[],
	prefix: string,
): ReviewFinding[] {
	let next = findings.reduce((highest, finding) => {
		if (!finding.findingId?.startsWith(`${prefix}-`)) return highest;
		const used = Number(finding.findingId.slice(prefix.length + 1));
		return Number.isSafeInteger(used) && used > highest ? used : highest;
	}, 0);
	return findings.map((finding) => {
		if (finding.findingId) return { ...finding };
		next += 1;
		return { ...finding, findingId: `${prefix}-${sequence(next)}` };
	});
}

/** A live prior finding, carrying the text the next reviewer has to re-check. */
export type LivePriorFinding = Readonly<{
	findingId: string;
	severity: ReviewFinding["severity"];
	summary: string;
	evidence?: string | undefined;
}>;

/**
 * Prior findings this feature must still carry forward.
 *
 * A failed review keeps every finding already live and adds its own. A passing
 * review proves the repair of anything it does not repeat, so only what it
 * reports stays live. Where a later review restates a live id, its wording and
 * severity win, because that is the disposition the next reviewer must check.
 * Nothing here depends on the manager restating history in prose.
 */
export function livePriorFindings(
	session: Session,
	featureId: FeatureId,
): LivePriorFinding[] {
	let live: LivePriorFinding[] = [];
	for (const run of session.runs) {
		if (run.featureId !== featureId) continue;
		for (const review of run.reviews) {
			const result = review.result;
			if (!result) continue;
			const reported = result.findings.flatMap((finding) =>
				finding.findingId
					? [
							{
								findingId: finding.findingId,
								severity: finding.severity,
								summary: finding.summary,
								evidence: finding.evidence,
							},
						]
					: [],
			);
			if (result.verdict !== "failed") {
				live = reported;
				continue;
			}
			const restated = new Map(
				reported.map((finding) => [finding.findingId, finding]),
			);
			live = [
				...live.map((finding) => restated.get(finding.findingId) ?? finding),
				...reported.filter(
					(finding) =>
						!live.some((held) => held.findingId === finding.findingId),
				),
			];
		}
	}
	return live;
}

/** Live prior finding ids, in the order they first became live. */
export function liveFindingIds(
	session: Session,
	featureId: FeatureId,
): string[] {
	return livePriorFindings(session, featureId).map(
		(finding) => finding.findingId,
	);
}

/** Live prior ids missing from a submitted failed result. */
export function droppedFindingIds(
	session: Session,
	featureId: FeatureId,
	findings: readonly ReviewFinding[],
): string[] {
	const submitted = new Set(
		findings.flatMap((finding) =>
			finding.findingId ? [finding.findingId] : [],
		),
	);
	return liveFindingIds(session, featureId).filter((id) => !submitted.has(id));
}
