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

function isDocsAndPromptsPath(path: string): boolean {
	return (
		path === "README.md" ||
		path.startsWith("docs/") ||
		path.startsWith("src/prompts/") ||
		path.startsWith("src/audit/prompts/")
	);
}

function isToolingAndConfigPath(path: string): boolean {
	return (
		path.startsWith(".github/") ||
		path.startsWith("scripts/") ||
		path.startsWith("src/tools/") ||
		path === "src/tools.ts" ||
		path === "src/config.ts" ||
		path === "src/config-shared.ts" ||
		path === "src/tool-definition-guidance.ts" ||
		path === "src/audit/config.ts" ||
		path === "package.json" ||
		path === "bun.lock" ||
		path === "tsconfig.json" ||
		path === "biome.json"
	);
}

function isReleaseSurfacePath(path: string): boolean {
	return (
		path === "CHANGELOG.md" ||
		path.startsWith("dist/") ||
		path.startsWith("docs/releases/") ||
		path.startsWith("scripts/release-") ||
		path === ".github/workflows/release.yml" ||
		path === "src/install-opencode.ts" ||
		path === "src/uninstall-opencode.ts" ||
		path === "src/installer.ts"
	);
}

function isOperatorSurfacePath(path: string): boolean {
	return (
		path === "src/index.ts" ||
		path === "src/prompt-system-context.ts" ||
		path === "src/prompts/commands.ts" ||
		path === "src/audit/prompts/commands.ts" ||
		path.startsWith("src/runtime/application/") ||
		path.startsWith("src/runtime/transitions/")
	);
}

function isTestPath(path: string): boolean {
	return (
		path.startsWith("tests/") ||
		path.startsWith("test/") ||
		path.startsWith("spec/") ||
		path.includes("/__tests__/") ||
		path.endsWith(".test.ts") ||
		path.endsWith(".test.tsx") ||
		path.endsWith(".test.js") ||
		path.endsWith(".test.jsx") ||
		path.endsWith(".spec.ts") ||
		path.endsWith(".spec.tsx") ||
		path.endsWith(".spec.js") ||
		path.endsWith(".spec.jsx")
	);
}

function sharedAreaForPath(path: string): string | null {
	if (path.startsWith("src/runtime/")) {
		return "runtime";
	}
	if (path.startsWith("src/prompts/")) {
		return "prompts";
	}
	if (path.startsWith("src/audit/")) {
		return "audit";
	}
	if (path.startsWith("src/tools/") || path === "src/tools.ts") {
		return "tools";
	}
	if (path.startsWith("src/")) {
		return "source";
	}
	if (isToolingAndConfigPath(path)) {
		return "tooling";
	}
	if (isDocsAndPromptsPath(path)) {
		return "docs";
	}
	if (isTestPath(path)) {
		return "tests";
	}
	if (isReleaseSurfacePath(path)) {
		return "release";
	}
	if (isOperatorSurfacePath(path)) {
		return "operator";
	}
	return null;
}

function integrationAreaForPath(path: string): string | null {
	if (path.startsWith("src/runtime/")) {
		return "runtime";
	}
	if (
		path.startsWith("src/prompts/") ||
		path.startsWith("src/audit/prompts/")
	) {
		return "prompting";
	}
	if (isToolingAndConfigPath(path)) {
		return "tooling";
	}
	if (isDocsAndPromptsPath(path)) {
		return "docs";
	}
	if (isTestPath(path)) {
		return "tests";
	}
	if (isReleaseSurfacePath(path)) {
		return "release";
	}
	if (isOperatorSurfacePath(path)) {
		return "operator";
	}
	return null;
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

	if (review.reviewDepth === "detailed") {
		const reviewedSurfaceSet = new Set(review.reviewedSurfaces);
		const coversValidationEvidence = reviewedSurfaceSet.has(
			"validation_evidence",
		);
		const coversCrossFeatureSurface = [
			"integration_points",
			"shared_surfaces",
			"tooling_and_config",
			"release_surface",
		].some((surface) => reviewedSurfaceSet.has(surface));
		if (review.reviewedSurfaces.length < 2) {
			reasons.push("must cover at least two reviewedSurfaces");
		}
		if (!coversValidationEvidence) {
			reasons.push("must include validation_evidence");
		}
		if (!coversCrossFeatureSurface) {
			reasons.push("must include at least one cross-feature surface");
		}
		if (!review.integrationChecks?.length) {
			reasons.push("must include integrationChecks");
		}
		if (!review.regressionChecks?.length) {
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
