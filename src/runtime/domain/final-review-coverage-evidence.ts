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
export type FinalReviewSurface = (typeof FINAL_REVIEW_SURFACES)[number];

export type FinalReviewWorkerEvidence = {
	artifactsChanged: Array<{ path: string }>;
	validationRun: Array<{ command: string }>;
};

function normalizeNonEmptyStrings(
	values: readonly string[],
	normalize: (value: string) => string,
): string[] {
	return values.map(normalize).filter((value) => value.length > 0);
}

export function artifactPathsForWorker(
	worker: FinalReviewWorkerEvidence,
): string[] {
	return normalizeNonEmptyStrings(
		worker.artifactsChanged.map((artifact) => artifact.path),
		normalizeArtifactPath,
	);
}

export function validationCommandsForWorker(
	worker: FinalReviewWorkerEvidence,
): string[] {
	return normalizeNonEmptyStrings(
		worker.validationRun.map((item) => item.command),
		(command) => command.trim(),
	);
}

function collectMatchedAreas(
	artifactPaths: readonly string[],
	ruleResolver: (path: string) => string | null,
): Set<string> {
	return new Set(
		artifactPaths
			.map((path) => ruleResolver(path))
			.filter((area): area is string => area !== null),
	);
}

export function deriveRequiredFinalReviewSurfaces(
	hasLastValidationRun: boolean,
	worker: FinalReviewWorkerEvidence,
): FinalReviewSurface[] {
	const required = new Set<FinalReviewSurface>();
	const artifactPaths = artifactPathsForWorker(worker);

	if (artifactPaths.length > 0) {
		required.add("changed_files");
	}
	if (worker.validationRun.length > 0 || hasLastValidationRun) {
		required.add("validation_evidence");
	}
	if (artifactPaths.some(isTestPath)) {
		required.add("tests");
	}
	if (artifactPaths.some(isDocsAndPromptsPath)) {
		required.add("docs_and_prompts");
	}
	if (artifactPaths.some(isToolingAndConfigPath)) {
		required.add("tooling_and_config");
	}
	if (artifactPaths.some(isReleaseSurfacePath)) {
		required.add("release_surface");
	}
	if (artifactPaths.some(isOperatorSurfacePath)) {
		required.add("operator_surfaces");
	}

	const sharedAreas = collectMatchedAreas(artifactPaths, sharedAreaForPath);
	if (sharedAreas.size > 0) {
		required.add("shared_surfaces");
	}

	const integrationAreas = collectMatchedAreas(
		artifactPaths,
		integrationAreaForPath,
	);
	if (integrationAreas.size >= 2) {
		required.add("integration_points");
	}

	return FINAL_REVIEW_SURFACES.filter((surface) => required.has(surface));
}

const SURFACE_ARTIFACT_EVIDENCE_RULES: Record<
	FinalReviewSurface,
	(artifactRefs: readonly string[]) => boolean
> = {
	changed_files: (artifactRefs) => artifactRefs.length > 0,
	docs_and_prompts: (artifactRefs) => artifactRefs.some(isDocsAndPromptsPath),
	tooling_and_config: (artifactRefs) =>
		artifactRefs.some(isToolingAndConfigPath),
	operator_surfaces: (artifactRefs) => artifactRefs.some(isOperatorSurfacePath),
	release_surface: (artifactRefs) => artifactRefs.some(isReleaseSurfacePath),
	tests: (artifactRefs) => artifactRefs.some(isTestPath),
	shared_surfaces: (artifactRefs) =>
		artifactRefs.some((path) => sharedAreaForPath(path) !== null),
	integration_points: (artifactRefs) =>
		collectMatchedAreas(artifactRefs, integrationAreaForPath).size >= 2,
	validation_evidence: () => false,
};

export function surfaceHasArtifactEvidence(
	surface: FinalReviewSurface,
	artifactRefs: string[],
): boolean {
	return SURFACE_ARTIFACT_EVIDENCE_RULES[surface](artifactRefs);
}
