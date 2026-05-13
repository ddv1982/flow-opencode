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
import type { ReviewContextPack } from "./review-content-discovery";
import type { ReviewScopeTarget } from "./review-scope-targets";

const UNSUPPORTED_GLOB_PATTERN = /[[\]{}]/;

export function reviewContextPackPaths(
	pack: ReviewContextPack | undefined,
): string[] {
	if (!pack) {
		return [];
	}
	return [
		...pack.changedFiles,
		...pack.includedContext.map((context) => context.path),
		...pack.relationships.flatMap((relationship) => [
			relationship.from,
			relationship.to,
		]),
	];
}

function escapeRegExp(value: string): string {
	return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function globPatternMatchesPath(pattern: string, path: string): boolean {
	if (UNSUPPORTED_GLOB_PATTERN.test(pattern)) {
		return false;
	}
	const doubleStarSlashToken = "\0DOUBLE_STAR_SLASH\0";
	const doubleStarToken = "\0DOUBLE_STAR\0";
	const regexSource = escapeRegExp(pattern)
		.replaceAll("**/", doubleStarSlashToken)
		.replaceAll("**", doubleStarToken)
		.replaceAll("*", "[^/]*")
		.replaceAll("\\?", "[^/]")
		.replaceAll(doubleStarSlashToken, "(?:.*/)?")
		.replaceAll(doubleStarToken, ".*");
	return new RegExp(`^${regexSource}$`).test(path);
}

function pathMatchesPathLikeScopeTarget(target: string, path: string): boolean {
	const normalizedTarget = normalizeArtifactPath(target);
	if (!normalizedTarget.includes("/")) {
		return false;
	}
	return (
		path === normalizedTarget ||
		path.startsWith(`${normalizedTarget.replace(/\/$/, "")}/`)
	);
}

function pathMatchesDomainScopeTarget(target: string, path: string): boolean {
	if (pathMatchesPathLikeScopeTarget(target, path)) {
		return true;
	}
	const targetTokens = target.toLowerCase().split(/[^a-z0-9]+/);
	return [sharedAreaForPath(path), integrationAreaForPath(path)].some(
		(area) => area !== null && targetTokens.includes(area),
	);
}

function pathMatchesSurfaceScopeTarget(target: string, path: string): boolean {
	const normalizedTarget = normalizeArtifactPath(target).toLowerCase();
	switch (normalizedTarget) {
		case "changed_files":
			return true;
		case "docs_and_prompts":
		case "docs":
			return isDocsAndPromptsPath(path);
		case "tooling_and_config":
		case "tooling":
			return isToolingAndConfigPath(path);
		case "operator_surfaces":
		case "operator":
			return isOperatorSurfacePath(path);
		case "release_surface":
		case "release":
			return isReleaseSurfacePath(path);
		case "tests":
			return isTestPath(path);
		case "shared_surfaces":
			return sharedAreaForPath(path) !== null;
		case "integration_points":
			return integrationAreaForPath(path) !== null;
		default:
			return pathMatchesPathLikeScopeTarget(target, path);
	}
}

export function reviewScopeTargetGroundsRef(
	scope: ReviewScopeTarget,
	_pathRef: string,
	path: string,
): boolean {
	const normalizedTarget = normalizeArtifactPath(scope.target);
	if (scope.kind === "file") {
		return path === normalizedTarget;
	}
	if (scope.kind === "glob") {
		return globPatternMatchesPath(normalizedTarget, path);
	}
	if (scope.kind === "domain") {
		return pathMatchesDomainScopeTarget(normalizedTarget, path);
	}
	if (scope.kind === "surface") {
		return pathMatchesSurfaceScopeTarget(normalizedTarget, path);
	}
	return pathMatchesPathLikeScopeTarget(normalizedTarget, path);
}
