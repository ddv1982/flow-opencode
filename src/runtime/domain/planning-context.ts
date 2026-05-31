import type {
	PlanningContext,
	ReviewFindingPlanningContext,
	Session,
} from "../schema";
import type { EvidencePacket } from "../schema-evidence-packets";

function mergeUniqueStrings(
	current: readonly string[] = [],
	next?: readonly string[],
): string[] {
	return [...new Set([...current, ...(next ?? [])])];
}

function mergeUniqueBySerialized<T>(
	current: readonly T[] = [],
	next?: readonly T[],
): T[] {
	const seen = new Set<string>();
	const merged: T[] = [];
	for (const item of [...current, ...(next ?? [])]) {
		const key = JSON.stringify(item);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(item);
	}
	return merged;
}

function mergeEvidencePackets(
	current?: readonly EvidencePacket[],
	next?: readonly EvidencePacket[],
): EvidencePacket[] | undefined {
	if (!current && !next) {
		return undefined;
	}

	const byId = new Map<string, EvidencePacket>();
	for (const packet of current ?? []) {
		byId.set(packet.id, packet);
	}
	for (const packet of next ?? []) {
		// Same-id packets are refreshed wholesale so obsolete source refs,
		// selected/excluded context, and validation evidence can be retracted.
		byId.set(packet.id, packet);
	}
	return [...byId.values()];
}

function mergeReviewFindings(
	current: readonly ReviewFindingPlanningContext[] = [],
	next?: readonly ReviewFindingPlanningContext[],
): ReviewFindingPlanningContext[] {
	if (next && next.length === 0) {
		return [];
	}
	const byRef = new Map<string, ReviewFindingPlanningContext>();
	for (const finding of current) {
		byRef.set(finding.findingRef, finding);
	}
	for (const finding of next ?? []) {
		byRef.set(finding.findingRef, finding);
	}
	return [...byRef.values()];
}

function normalizeFindingRefs(
	findings: readonly ReviewFindingPlanningContext[],
): string[] {
	return findings.map((finding) => finding.findingRef.trim()).filter(Boolean);
}

export function describeReviewFindingsMutationFailure(
	session: Pick<Session, "plan" | "planning">,
	nextPlanning: Partial<PlanningContext>,
): string | null {
	if (session.plan?.goalMode !== "review_and_fix") {
		return null;
	}
	if (!nextPlanning.reviewFindings) {
		return null;
	}

	const existingFindingRefs = normalizeFindingRefs(
		session.planning.reviewFindings,
	);
	if (existingFindingRefs.length === 0) {
		return null;
	}

	const nextFindingRefs = new Set(
		normalizeFindingRefs(nextPlanning.reviewFindings),
	);
	const missingFindingRefs = existingFindingRefs.filter(
		(findingRef) => !nextFindingRefs.has(findingRef),
	);
	if (missingFindingRefs.length === 0) {
		return null;
	}

	return `Planning context update cannot remove review_and_fix findings while the active plan depends on them. Missing retained findingRefs: ${missingFindingRefs.join(", ")}.`;
}

export function mergePlanningContext(
	current: PlanningContext,
	next: Partial<PlanningContext> = {},
): PlanningContext {
	return {
		repoProfile: mergeUniqueStrings(current.repoProfile, next.repoProfile),
		packageManager: next.packageManager ?? current.packageManager,
		packageManagerAmbiguous:
			next.packageManagerAmbiguous ?? current.packageManagerAmbiguous,
		stackProfile: next.stackProfile ?? current.stackProfile,
		standardsProfile: next.standardsProfile ?? current.standardsProfile,
		research: mergeUniqueStrings(current.research, next.research),
		implementationApproach:
			next.implementationApproach ?? current.implementationApproach,
		decisionLog: next.decisionLog ?? current.decisionLog,
		replanLog: mergeUniqueBySerialized(current.replanLog, next.replanLog),
		reviewFindings: mergeReviewFindings(
			current.reviewFindings,
			next.reviewFindings,
		),
		evidencePackets: mergeEvidencePackets(
			current.evidencePackets,
			next.evidencePackets,
		),
	};
}
