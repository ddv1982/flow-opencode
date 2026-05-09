import { FINAL_REVIEW_SURFACES } from "../constants";
import {
	integrationAreaForPath,
	isDocsAndPromptsPath,
	isOperatorSurfacePath,
	isReleaseSurfacePath,
	isTestPath,
	isToolingAndConfigPath,
	normalizeArtifactPath,
	normalizeSafeReviewArtifactPath,
	sharedAreaForPath,
} from "./final-review-coverage-paths";

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

type ReviewContextGroundingGraph = Pick<
	ReviewContextPack,
	"changedFiles" | "relationships"
>;

const REVIEW_DISCOVERY_REASON_SURFACES: Record<
	ReviewDiscoveryReason,
	readonly ReviewDiscoverySurface[]
> = {
	changed_file: ["changed_files"],
	imported_dependency: ["shared_surfaces"],
	caller: ["integration_points"],
	callee: ["integration_points"],
	state_owner: ["shared_surfaces"],
	lifecycle_owner: ["operator_surfaces"],
	architectural_neighbor: ["integration_points", "shared_surfaces"],
	test_evidence: ["tests"],
	validation_evidence: ["validation_evidence"],
};

export function normalizeReviewDiscoveryReason(
	reason: string,
): ReviewDiscoveryReason | null {
	const normalized = reason === "test_oracle" ? "test_evidence" : reason;
	return REVIEW_DISCOVERY_REASONS.includes(normalized as ReviewDiscoveryReason)
		? (normalized as ReviewDiscoveryReason)
		: null;
}

function normalizeNonEmptyString(value: string): string {
	return value.trim();
}

function uniqueNormalizedStrings(
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

function normalizeIncludedContext(
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

function normalizeRelationships(
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

function normalizeValidationEvidence(
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

export function surfacesForReviewDiscoveryReason(
	reason: ReviewDiscoveryReason,
): ReviewDiscoverySurface[] {
	return [...REVIEW_DISCOVERY_REASON_SURFACES[reason]];
}

export function deriveReviewContextPackSurfaces(
	pack: Pick<
		ReviewContextPack,
		"changedFiles" | "includedContext" | "validationEvidence"
	>,
): ReviewDiscoverySurface[] {
	const surfaces = new Set<ReviewDiscoverySurface>();
	if (pack.changedFiles.length > 0) {
		surfaces.add("changed_files");
	}
	if (pack.validationEvidence.length > 0) {
		surfaces.add("validation_evidence");
	}
	for (const context of pack.includedContext) {
		if (context.surface) {
			surfaces.add(context.surface);
		}
		for (const surface of surfacesForReviewDiscoveryReason(context.reason)) {
			surfaces.add(surface);
		}
	}
	return FINAL_REVIEW_SURFACES.filter((surface) => surfaces.has(surface));
}

function groundedReviewContextPaths(
	pack: ReviewContextGroundingGraph,
	evidence: ReviewContextPackGroundingEvidence = {},
): Set<string> {
	const grounded = new Set([
		...pack.changedFiles,
		...uniqueNormalizedStrings(
			evidence.changedArtifacts,
			normalizeArtifactPath,
		),
	]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const relationship of pack.relationships) {
			if (grounded.has(relationship.from) && !grounded.has(relationship.to)) {
				grounded.add(relationship.to);
				changed = true;
			}
			if (grounded.has(relationship.to) && !grounded.has(relationship.from)) {
				grounded.add(relationship.from);
				changed = true;
			}
		}
	}
	return grounded;
}

function collectMatchedAreas(
	paths: Iterable<string>,
	resolver: (path: string) => string | null,
): Set<string> {
	const areas = new Set<string>();
	for (const path of paths) {
		const area = resolver(path);
		if (area) {
			areas.add(area);
		}
	}
	return areas;
}

function hasRelationshipEvidenceForContext(
	contextPath: string,
	pack: ReviewContextPack,
	groundedPaths: ReadonlySet<string>,
): boolean {
	return pack.relationships.some(
		(relationship) =>
			(relationship.from === contextPath &&
				groundedPaths.has(relationship.to)) ||
			(relationship.to === contextPath && groundedPaths.has(relationship.from)),
	);
}

function groundedPathsHaveSurfaceEvidence(
	pack: ReviewContextPack,
	surface: ReviewDiscoverySurface,
	groundedPaths: ReadonlySet<string>,
): boolean {
	const paths = [...groundedPaths];
	if (surface === "docs_and_prompts") {
		return paths.some(isDocsAndPromptsPath);
	}
	if (surface === "tooling_and_config") {
		return paths.some(isToolingAndConfigPath);
	}
	if (surface === "operator_surfaces") {
		return paths.some(isOperatorSurfacePath);
	}
	if (surface === "release_surface") {
		return paths.some(isReleaseSurfacePath);
	}
	if (surface === "tests") {
		return paths.some(isTestPath);
	}
	if (surface === "shared_surfaces") {
		return paths.some((path) => sharedAreaForPath(path) !== null);
	}
	if (surface === "integration_points") {
		const integrationAreas = collectMatchedAreas(paths, integrationAreaForPath);
		if (integrationAreas.size >= 2) {
			return true;
		}
		const changedFileSet = new Set(pack.changedFiles);
		return pack.includedContext.some(
			(context) =>
				groundedPaths.has(context.path) &&
				!changedFileSet.has(context.path) &&
				["caller", "callee", "architectural_neighbor"].includes(
					context.reason,
				) &&
				hasRelationshipEvidenceForContext(context.path, pack, groundedPaths),
		);
	}
	return false;
}

export function reviewContextPackHasSurfaceEvidence(
	pack: ReviewContextPack,
	surface: ReviewDiscoverySurface,
	evidence: ReviewContextPackGroundingEvidence = {},
): boolean {
	if (surface === "changed_files") {
		return (
			pack.changedFiles.length > 0 &&
			uniqueNormalizedStrings(evidence.changedArtifacts, normalizeArtifactPath)
				.length > 0 &&
			describeReviewContextPackGroundingFailure(pack, evidence) === null
		);
	}
	if (surface === "validation_evidence") {
		const validationCommandSet = new Set(
			uniqueNormalizedStrings(
				evidence.validationCommands,
				normalizeNonEmptyString,
			),
		);
		return pack.validationEvidence.some((item) =>
			validationCommandSet.has(item.command),
		);
	}
	const groundedPaths = groundedReviewContextPaths(pack, evidence);
	return groundedPathsHaveSurfaceEvidence(pack, surface, groundedPaths);
}

export function buildReviewContextPack(
	input: ReviewContextPackInput,
): ReviewContextPack {
	const changedFiles = uniqueNormalizedStrings(
		input.changedFiles,
		normalizeSafeReviewArtifactPath,
	);
	const includedContext = normalizeIncludedContext(
		input.includedContext,
		changedFiles,
	);
	const validationEvidence = normalizeValidationEvidence(
		input.validationEvidence,
	);
	const derivedSurfaces = deriveReviewContextPackSurfaces({
		changedFiles,
		includedContext,
		validationEvidence,
	});
	const reviewedSurfaceSet = new Set<ReviewDiscoverySurface>([
		...derivedSurfaces,
		...(input.reviewedSurfaces ?? []),
	]);

	return {
		task: input.task.trim(),
		...(input.compareBase?.trim()
			? { compareBase: input.compareBase.trim() }
			: {}),
		changedFiles,
		includedContext,
		relationships: normalizeRelationships(input.relationships),
		validationEvidence,
		suggestedValidation: uniqueNormalizedStrings(
			input.suggestedValidation,
			normalizeNonEmptyString,
		),
		coverageGaps: uniqueNormalizedStrings(
			input.coverageGaps,
			normalizeNonEmptyString,
		),
		reviewedSurfaces: FINAL_REVIEW_SURFACES.filter((surface) =>
			reviewedSurfaceSet.has(surface),
		),
	};
}

export function describeReviewContextPackGroundingFailure(
	pack: ReviewContextPack,
	evidence: ReviewContextPackGroundingEvidence,
): string | null {
	const reasons: string[] = [];
	const changedArtifactSet = new Set(
		uniqueNormalizedStrings(evidence.changedArtifacts, normalizeArtifactPath),
	);
	if (pack.changedFiles.length > 0 && changedArtifactSet.size === 0) {
		reasons.push(
			"reviewContextPack changedFiles require matching worker artifacts",
		);
	}
	if (changedArtifactSet.size > 0) {
		const unknownChangedFiles = pack.changedFiles.filter(
			(path) => !changedArtifactSet.has(path),
		);
		if (unknownChangedFiles.length > 0) {
			reasons.push(
				`reviewContextPack changedFiles are not backed by worker artifacts: ${unknownChangedFiles.join(", ")}`,
			);
		}
	}

	const groundedPaths = groundedReviewContextPaths(pack, evidence);
	const ungroundedContextPaths = pack.includedContext
		.filter(
			(context) =>
				context.reason !== "changed_file" && !groundedPaths.has(context.path),
		)
		.map((context) => context.path);
	if (ungroundedContextPaths.length > 0) {
		reasons.push(
			`reviewContextPack includedContext entries are not grounded by changed files or relationships: ${ungroundedContextPaths.join(", ")}`,
		);
	}

	const validationCommandSet = new Set(
		uniqueNormalizedStrings(
			evidence.validationCommands,
			normalizeNonEmptyString,
		),
	);
	if (pack.validationEvidence.length > 0 && validationCommandSet.size === 0) {
		reasons.push(
			"reviewContextPack validationEvidence require matching worker validationRun",
		);
	}
	if (validationCommandSet.size > 0) {
		const unknownValidationCommands = pack.validationEvidence
			.map((item) => item.command)
			.filter((command) => !validationCommandSet.has(command));
		if (unknownValidationCommands.length > 0) {
			reasons.push(
				`reviewContextPack validationEvidence commands are not backed by worker validationRun: ${unknownValidationCommands.join(", ")}`,
			);
		}
	}

	return reasons.length > 0 ? reasons.join("; ") : null;
}
