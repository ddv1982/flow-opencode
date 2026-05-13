import { FINAL_REVIEW_SURFACES } from "../constants";
import {
	integrationAreaForPath,
	isDocsAndPromptsPath,
	isOperatorSurfacePath,
	isReleaseSurfacePath,
	isTestPath,
	isToolingAndConfigPath,
	normalizeArtifactPath,
	sharedAreaForPath,
} from "./final-review-coverage-paths";
import {
	normalizeNonEmptyString,
	type ReviewContextPack,
	type ReviewContextPackGroundingEvidence,
	type ReviewDiscoveryReason,
	type ReviewDiscoverySurface,
	uniqueNormalizedStrings,
} from "./review-context-normalization";

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
