import type { PlanningContext } from "../schema";
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

export function mergeEvidencePackets(
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
		evidencePackets: mergeEvidencePackets(
			current.evidencePackets,
			next.evidencePackets,
		),
	};
}
