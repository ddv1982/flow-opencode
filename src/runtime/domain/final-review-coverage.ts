import { FINAL_REVIEW_SURFACES } from "../constants";
import type { Session, WorkerResultArgs } from "../schema";
import { finalReviewPolicyForPlan } from "./workflow-policy";

export type FinalReviewSurface = NonNullable<
	NonNullable<WorkerResultArgs["finalReview"]>["reviewedSurfaces"]
>[number];

export type FinalReviewCoverageTarget = {
	reviewDepth: string;
	reviewedSurfaces: string[];
	evidenceSummary?: string | undefined;
	validationAssessment?: string | undefined;
	evidenceRefs?:
		| {
				changedArtifacts: string[];
				validationCommands: string[];
		  }
		| undefined;
	integrationChecks?: string[] | undefined;
	regressionChecks?: string[] | undefined;
};

export type DetailedFinalReviewRequirementFailure =
	| "too_few_surfaces"
	| "missing_validation_evidence"
	| "missing_cross_feature_surface"
	| "missing_integration_checks"
	| "missing_regression_checks";

type DetailedFinalReviewTarget = Pick<
	FinalReviewCoverageTarget,
	"reviewDepth" | "reviewedSurfaces" | "integrationChecks" | "regressionChecks"
>;

type FinalReviewWorkerEvidence = {
	artifactsChanged: Array<{ path: string }>;
	validationRun: Array<{ command: string }>;
};

export function finalReviewDepthMatchesPolicy(
	session: Session,
	reviewDepth: string | undefined,
): boolean {
	return reviewDepth === finalReviewPolicyForPlan(session.plan);
}

function normalizeArtifactPath(path: string): string {
	let normalized = path.trim().replaceAll("\\", "/");
	while (normalized.startsWith("./")) {
		normalized = normalized.slice(2);
	}
	return normalized;
}

type PathRule = {
	exact?: readonly string[];
	prefixes?: readonly string[];
	includes?: readonly string[];
	suffixes?: readonly string[];
};

type SurfacePathRule = PathRule & { surface: FinalReviewSurface };
type AreaPathRule = PathRule & {
	area: string;
	surface?: FinalReviewSurface;
};

const TEST_PATH_SUFFIXES = [
	".test.ts",
	".test.tsx",
	".test.js",
	".test.jsx",
	".spec.ts",
	".spec.tsx",
	".spec.js",
	".spec.jsx",
] as const;

const DETAILED_FINAL_REVIEW_CROSS_FEATURE_SURFACES: readonly FinalReviewSurface[] =
	[
		"integration_points",
		"shared_surfaces",
		"tooling_and_config",
		"release_surface",
	] as const;

export function isKnownFinalReviewSurface(
	surface: string,
): surface is FinalReviewSurface {
	return FINAL_REVIEW_SURFACES.includes(
		surface as (typeof FINAL_REVIEW_SURFACES)[number],
	);
}

export function detailedFinalReviewRequirementFailures(
	review: DetailedFinalReviewTarget,
): DetailedFinalReviewRequirementFailure[] {
	if (review.reviewDepth !== "detailed") {
		return [];
	}

	const failures: DetailedFinalReviewRequirementFailure[] = [];
	const reviewedSurfaceSet = new Set(review.reviewedSurfaces);

	if (review.reviewedSurfaces.length < 2) {
		failures.push("too_few_surfaces");
	}
	if (!reviewedSurfaceSet.has("validation_evidence")) {
		failures.push("missing_validation_evidence");
	}
	if (
		!DETAILED_FINAL_REVIEW_CROSS_FEATURE_SURFACES.some((surface) =>
			reviewedSurfaceSet.has(surface),
		)
	) {
		failures.push("missing_cross_feature_surface");
	}
	if (!review.integrationChecks?.length) {
		failures.push("missing_integration_checks");
	}
	if (!review.regressionChecks?.length) {
		failures.push("missing_regression_checks");
	}

	return failures;
}

const REVIEW_SURFACE_PATH_RULES: readonly SurfacePathRule[] = [
	{
		surface: "docs_and_prompts",
		exact: ["README.md"],
		prefixes: ["docs/", "src/prompts/", "src/audit/prompts/"],
	},
	{
		surface: "tooling_and_config",
		exact: [
			"src/tools.ts",
			"src/config.ts",
			"src/config-shared.ts",
			"src/tool-definition-guidance.ts",
			"src/audit/config.ts",
			"package.json",
			"bun.lock",
			"tsconfig.json",
			"biome.json",
		],
		prefixes: [".github/", "scripts/", "src/tools/"],
	},
	{
		surface: "release_surface",
		exact: [
			"CHANGELOG.md",
			".github/workflows/release.yml",
			"src/install-opencode.ts",
			"src/uninstall-opencode.ts",
			"src/installer.ts",
		],
		prefixes: ["dist/", "docs/releases/", "scripts/release-"],
	},
	{
		surface: "operator_surfaces",
		exact: [
			"src/index.ts",
			"src/prompt-system-context.ts",
			"src/prompts/commands.ts",
			"src/audit/prompts/commands.ts",
		],
		prefixes: ["src/runtime/application/", "src/runtime/transitions/"],
	},
	{
		surface: "tests",
		prefixes: ["tests/", "test/", "spec/"],
		includes: ["/__tests__/"],
		suffixes: TEST_PATH_SUFFIXES,
	},
];

const SHARED_AREA_PATH_RULES: readonly AreaPathRule[] = [
	{ area: "runtime", prefixes: ["src/runtime/"] },
	{ area: "prompts", prefixes: ["src/prompts/"] },
	{ area: "audit", prefixes: ["src/audit/"] },
	{ area: "tools", exact: ["src/tools.ts"], prefixes: ["src/tools/"] },
	{ area: "source", prefixes: ["src/"] },
	{ area: "tooling", surface: "tooling_and_config" },
	{ area: "docs", surface: "docs_and_prompts" },
	{ area: "tests", surface: "tests" },
	{ area: "release", surface: "release_surface" },
	{ area: "operator", surface: "operator_surfaces" },
];

const INTEGRATION_AREA_PATH_RULES: readonly AreaPathRule[] = [
	{ area: "runtime", prefixes: ["src/runtime/"] },
	{ area: "prompting", prefixes: ["src/prompts/", "src/audit/prompts/"] },
	{ area: "tooling", surface: "tooling_and_config" },
	{ area: "docs", surface: "docs_and_prompts" },
	{ area: "tests", surface: "tests" },
	{ area: "release", surface: "release_surface" },
	{ area: "operator", surface: "operator_surfaces" },
];

function matchesPathRule(path: string, rule: PathRule): boolean {
	return Boolean(
		rule.exact?.includes(path) ||
			rule.prefixes?.some((prefix) => path.startsWith(prefix)) ||
			rule.includes?.some((segment) => path.includes(segment)) ||
			rule.suffixes?.some((suffix) => path.endsWith(suffix)),
	);
}

function pathMatchesSurface(
	path: string,
	surface: FinalReviewSurface,
): boolean {
	return REVIEW_SURFACE_PATH_RULES.some(
		(rule) => rule.surface === surface && matchesPathRule(path, rule),
	);
}

function isDocsAndPromptsPath(path: string): boolean {
	return pathMatchesSurface(path, "docs_and_prompts");
}

function isToolingAndConfigPath(path: string): boolean {
	return pathMatchesSurface(path, "tooling_and_config");
}

function isReleaseSurfacePath(path: string): boolean {
	return pathMatchesSurface(path, "release_surface");
}

function isOperatorSurfacePath(path: string): boolean {
	return pathMatchesSurface(path, "operator_surfaces");
}

function isTestPath(path: string): boolean {
	return pathMatchesSurface(path, "tests");
}

function areaForPath(
	path: string,
	rules: readonly AreaPathRule[],
): string | null {
	for (const rule of rules) {
		if (
			matchesPathRule(path, rule) ||
			(rule.surface ? pathMatchesSurface(path, rule.surface) : false)
		) {
			return rule.area;
		}
	}
	return null;
}

function sharedAreaForPath(path: string): string | null {
	return areaForPath(path, SHARED_AREA_PATH_RULES);
}

function integrationAreaForPath(path: string): string | null {
	return areaForPath(path, INTEGRATION_AREA_PATH_RULES);
}

function artifactPathsForWorker(worker: FinalReviewWorkerEvidence): string[] {
	return worker.artifactsChanged
		.map((artifact) => normalizeArtifactPath(artifact.path))
		.filter((path) => path.length > 0);
}

function validationCommandsForWorker(
	worker: FinalReviewWorkerEvidence,
): string[] {
	return worker.validationRun
		.map((item) => item.command.trim())
		.filter((command) => command.length > 0);
}

function deriveRequiredFinalReviewSurfaces(
	session: Session,
	worker: FinalReviewWorkerEvidence,
): FinalReviewSurface[] {
	const required = new Set<FinalReviewSurface>();
	const artifactPaths = artifactPathsForWorker(worker);

	if (artifactPaths.length > 0) {
		required.add("changed_files");
	}
	if (
		worker.validationRun.length > 0 ||
		session.execution.lastValidationRun.length > 0
	) {
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

	const sharedAreas = new Set(
		artifactPaths
			.map((path) => sharedAreaForPath(path))
			.filter((area): area is string => area !== null),
	);
	if (sharedAreas.size > 0) {
		required.add("shared_surfaces");
	}

	const integrationAreas = new Set(
		artifactPaths
			.map((path) => integrationAreaForPath(path))
			.filter((area): area is string => area !== null),
	);
	if (integrationAreas.size >= 2) {
		required.add("integration_points");
	}

	return FINAL_REVIEW_SURFACES.filter((surface) => required.has(surface));
}

function surfaceHasArtifactEvidence(
	surface: FinalReviewSurface,
	artifactRefs: string[],
): boolean {
	if (surface === "changed_files") {
		return artifactRefs.length > 0;
	}
	if (surface === "docs_and_prompts") {
		return artifactRefs.some(isDocsAndPromptsPath);
	}
	if (surface === "tooling_and_config") {
		return artifactRefs.some(isToolingAndConfigPath);
	}
	if (surface === "operator_surfaces") {
		return artifactRefs.some(isOperatorSurfacePath);
	}
	if (surface === "release_surface") {
		return artifactRefs.some(isReleaseSurfacePath);
	}
	if (surface === "tests") {
		return artifactRefs.some(isTestPath);
	}
	if (surface === "shared_surfaces") {
		return artifactRefs.some((path) => sharedAreaForPath(path) !== null);
	}
	if (surface === "integration_points") {
		return (
			new Set(
				artifactRefs
					.map((path) => integrationAreaForPath(path))
					.filter((area): area is string => area !== null),
			).size >= 2
		);
	}
	return false;
}

function finalReviewCoverageFailureReasons(
	session: Session,
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewCoverageTarget,
): string[] {
	const reasons: string[] = [];
	const artifactPaths = artifactPathsForWorker(worker);
	const validationCommands = validationCommandsForWorker(worker);
	const evidenceRefs = review.evidenceRefs;
	const artifactRefPaths = (evidenceRefs?.changedArtifacts ?? []).map(
		normalizeArtifactPath,
	);
	const validationCommandRefs = (evidenceRefs?.validationCommands ?? []).map(
		(command) => command.trim(),
	);
	const actualArtifactSet = new Set(artifactPaths);
	const actualValidationCommandSet = new Set(validationCommands);

	if (review.reviewedSurfaces.length === 0) {
		reasons.push("must list reviewedSurfaces");
	}
	if (!review.evidenceSummary?.trim()) {
		reasons.push("must include an evidenceSummary");
	}
	if (!review.validationAssessment?.trim()) {
		reasons.push("must include a validationAssessment");
	}
	if (!evidenceRefs) {
		reasons.push("must include evidenceRefs");
	}

	const invalidArtifactRefs = artifactRefPaths.filter(
		(path) => !actualArtifactSet.has(path),
	);
	if (invalidArtifactRefs.length > 0) {
		reasons.push(
			`references unknown changed artifacts: ${invalidArtifactRefs.join(", ")}`,
		);
	}

	const invalidValidationCommandRefs = validationCommandRefs.filter(
		(command) => !actualValidationCommandSet.has(command),
	);
	if (invalidValidationCommandRefs.length > 0) {
		reasons.push(
			`references unknown validation commands: ${invalidValidationCommandRefs.join(", ")}`,
		);
	}

	for (const failure of detailedFinalReviewRequirementFailures(review)) {
		if (failure === "too_few_surfaces") {
			reasons.push("must cover at least two reviewedSurfaces");
		}
		if (failure === "missing_validation_evidence") {
			reasons.push("must include validation_evidence");
		}
		if (failure === "missing_cross_feature_surface") {
			reasons.push("must include at least one cross-feature surface");
		}
		if (failure === "missing_integration_checks") {
			reasons.push("must include integrationChecks");
		}
		if (failure === "missing_regression_checks") {
			reasons.push("must include regressionChecks");
		}
	}

	const requiredSurfaces = deriveRequiredFinalReviewSurfaces(session, worker);
	const missingRequiredSurfaces = requiredSurfaces.filter(
		(surface) => !review.reviewedSurfaces.includes(surface),
	);
	if (missingRequiredSurfaces.length > 0) {
		reasons.push(
			`must cover derived required review surfaces: ${missingRequiredSurfaces.join(", ")}`,
		);
	}

	if (
		review.reviewedSurfaces.includes("validation_evidence") &&
		validationCommandRefs.length === 0
	) {
		reasons.push("must reference validation commands for validation_evidence");
	}

	const claimedArtifactBackedSurfaces = review.reviewedSurfaces.filter(
		(surface): surface is FinalReviewSurface =>
			surface !== "validation_evidence",
	);
	const unsupportedClaimedArtifactSurfaces =
		claimedArtifactBackedSurfaces.filter(
			(surface) => !surfaceHasArtifactEvidence(surface, artifactRefPaths),
		);
	if (unsupportedClaimedArtifactSurfaces.length > 0) {
		reasons.push(
			`claimed reviewed surfaces are not backed by evidenceRefs.changedArtifacts: ${unsupportedClaimedArtifactSurfaces.join(", ")}`,
		);
	}

	const requiredArtifactBackedSurfaces = requiredSurfaces.filter(
		(surface) => surface !== "validation_evidence",
	);
	const missingArtifactEvidenceSurfaces = requiredArtifactBackedSurfaces.filter(
		(surface) => !surfaceHasArtifactEvidence(surface, artifactRefPaths),
	);
	if (missingArtifactEvidenceSurfaces.length > 0) {
		reasons.push(
			`must reference changed artifacts covering: ${missingArtifactEvidenceSurfaces.join(", ")}`,
		);
	}

	return reasons;
}

export function describeFinalReviewCoverageFailure(
	session: Session,
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewCoverageTarget,
): string | null {
	const reasons = finalReviewCoverageFailureReasons(session, worker, review);
	return reasons.length > 0 ? reasons.join("; ") : null;
}
