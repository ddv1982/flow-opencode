import type { FINAL_REVIEW_SURFACES } from "../constants";
import { normalizeSafeReviewArtifactPath } from "./final-review-coverage-paths";

export const REVIEW_DISCOVERY_REASONS = [
	"changed_file",
	"imported_dependency",
	"caller",
	"callee",
	"state_owner",
	"lifecycle_owner",
	"architectural_neighbor",
	"test_evidence",
	"validation_evidence",
] as const;

export type ReviewDiscoveryReason = (typeof REVIEW_DISCOVERY_REASONS)[number];

export type ReviewDiscoverySurface = (typeof FINAL_REVIEW_SURFACES)[number];

export type ReviewIncludedContext = {
	path: string;
	reason: ReviewDiscoveryReason;
	surface?: ReviewDiscoverySurface | undefined;
	summary?: string | undefined;
};

export type ReviewIncludedContextInput = Omit<
	ReviewIncludedContext,
	"reason"
> & {
	reason: string;
};

export type ReviewContextRelationship = {
	from: string;
	to: string;
	kind: string;
	summary: string;
};

export type ReviewValidationEvidence = {
	command: string;
	status?: string | undefined;
	summary?: string | undefined;
};

export type ReviewContextPack = {
	task: string;
	compareBase?: string | undefined;
	changedFiles: string[];
	includedContext: ReviewIncludedContext[];
	relationships: ReviewContextRelationship[];
	validationEvidence: ReviewValidationEvidence[];
	suggestedValidation: string[];
	coverageGaps: string[];
	reviewedSurfaces: ReviewDiscoverySurface[];
};

export type ReviewContextPackInput = {
	task: string;
	compareBase?: string | undefined;
	changedFiles?: readonly string[] | undefined;
	includedContext?: readonly ReviewIncludedContextInput[] | undefined;
	relationships?: readonly ReviewContextRelationship[] | undefined;
	validationEvidence?: readonly ReviewValidationEvidence[] | undefined;
	suggestedValidation?: readonly string[] | undefined;
	coverageGaps?: readonly string[] | undefined;
	reviewedSurfaces?: readonly ReviewDiscoverySurface[] | undefined;
};

export type ReviewContextPackGroundingEvidence = {
	changedArtifacts?: readonly string[] | undefined;
	validationCommands?: readonly string[] | undefined;
};

function normalizeReviewDiscoveryReason(
	reason: string,
): ReviewDiscoveryReason | null {
	return REVIEW_DISCOVERY_REASONS.includes(reason as ReviewDiscoveryReason)
		? (reason as ReviewDiscoveryReason)
		: null;
}

export function normalizeNonEmptyString(value: string): string {
	return value.trim();
}

export function uniqueNormalizedStrings(
	values: readonly string[] | undefined,
	normalize: (value: string) => string,
): string[] {
	const seen = new Set<string>();
	const normalizedValues: string[] = [];
	for (const value of values ?? []) {
		const normalized = normalize(value);
		if (normalized.length === 0 || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		normalizedValues.push(normalized);
	}
	return normalizedValues;
}

export function normalizeIncludedContext(
	input: readonly ReviewIncludedContextInput[] | undefined,
	changedFiles: readonly string[],
): ReviewIncludedContext[] {
	const contextByPathAndReason = new Map<string, ReviewIncludedContext>();

	for (const path of changedFiles) {
		contextByPathAndReason.set(`${path}\u0000changed_file`, {
			path,
			reason: "changed_file",
			surface: "changed_files",
		});
	}

	for (const context of input ?? []) {
		const path = normalizeSafeReviewArtifactPath(context.path);
		const reason = normalizeReviewDiscoveryReason(context.reason);
		if (path.length === 0) {
			continue;
		}
		if (!reason) {
			continue;
		}
		const summary = context.summary?.trim();
		const key = `${path}\u0000${reason}`;
		contextByPathAndReason.set(key, {
			path,
			reason,
			...(context.surface ? { surface: context.surface } : {}),
			...(summary ? { summary } : {}),
		});
	}

	return Array.from(contextByPathAndReason.values());
}

export function normalizeRelationships(
	input: readonly ReviewContextRelationship[] | undefined,
): ReviewContextRelationship[] {
	const seen = new Set<string>();
	const relationships: ReviewContextRelationship[] = [];
	for (const relationship of input ?? []) {
		const from = normalizeSafeReviewArtifactPath(relationship.from);
		const to = normalizeSafeReviewArtifactPath(relationship.to);
		const kind = relationship.kind.trim();
		const summary = relationship.summary.trim();
		if (!from || !to || !kind || !summary) {
			continue;
		}
		const key = `${from}\u0000${to}\u0000${kind}\u0000${summary}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		relationships.push({ from, to, kind, summary });
	}
	return relationships;
}

export function normalizeValidationEvidence(
	input: readonly ReviewValidationEvidence[] | undefined,
): ReviewValidationEvidence[] {
	const seen = new Set<string>();
	const evidence: ReviewValidationEvidence[] = [];
	for (const item of input ?? []) {
		const command = item.command.trim();
		if (!command) {
			continue;
		}
		const status = item.status?.trim();
		const summary = item.summary?.trim();
		const key = `${command}\u0000${status ?? ""}\u0000${summary ?? ""}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		evidence.push({
			command,
			...(status ? { status } : {}),
			...(summary ? { summary } : {}),
		});
	}
	return evidence;
}
