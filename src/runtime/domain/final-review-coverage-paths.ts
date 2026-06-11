type FinalReviewSurfaceTag =
	| "changed_files"
	| "docs_and_prompts"
	| "tooling_and_config"
	| "operator_surfaces"
	| "release_surface"
	| "tests"
	| "shared_surfaces"
	| "integration_points"
	| "validation_evidence";

type PathRule = {
	exact?: readonly string[];
	prefixes?: readonly string[];
	includes?: readonly string[];
	suffixes?: readonly string[];
};

type SurfacePathRule = PathRule & { surface: FinalReviewSurfaceTag };
type AreaPathRule = PathRule & {
	area: string;
	surface?: FinalReviewSurfaceTag;
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

const REVIEW_SURFACE_PATH_RULES: readonly SurfacePathRule[] = [
	{
		surface: "docs_and_prompts",
		exact: ["README.md"],
		prefixes: ["docs/", "src/prompts/", "src/audit/prompts/"],
	},
	{
		surface: "tooling_and_config",
		exact: [
			"src/adapters/opencode/tools.ts",
			"src/adapters/opencode/tool-guidance.generated.ts",
			"src/config.ts",
			"src/config-shared.ts",
			"src/audit/config.ts",
			"package.json",
			"bun.lock",
			"tsconfig.json",
			"biome.json",
		],
		prefixes: [".github/", "scripts/", "src/adapters/opencode/tool-surface/"],
	},
	{
		surface: "release_surface",
		exact: [
			"CHANGELOG.md",
			".github/workflows/release.yml",
			"src/cli.ts",
			"src/distribution/skill-sync.ts",
			"src/distribution/uninstall.ts",
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
	{
		area: "tools",
		exact: ["src/adapters/opencode/tools.ts"],
		prefixes: ["src/adapters/opencode/tool-surface/"],
	},
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
	surface: FinalReviewSurfaceTag,
): boolean {
	return REVIEW_SURFACE_PATH_RULES.some(
		(rule) => rule.surface === surface && matchesPathRule(path, rule),
	);
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

export function normalizeArtifactPath(path: string): string {
	let normalized = path.trim().replaceAll("\\", "/");
	while (normalized.startsWith("./")) {
		normalized = normalized.slice(2);
	}
	return normalized;
}

const REVIEW_ARTIFACT_REF_LINE_SUFFIX = /:(?:\d+)(?:-\d+)?$/;

export function pathForReviewArtifactRef(ref: string): string {
	const trimmed = ref.trim();
	const suffixMatch = REVIEW_ARTIFACT_REF_LINE_SUFFIX.exec(trimmed);
	const pathPart = suffixMatch ? trimmed.slice(0, suffixMatch.index) : trimmed;
	return normalizeArtifactPath(pathPart);
}

export function normalizeReviewArtifactRef(ref: string): string {
	const trimmed = ref.trim();
	const suffixMatch = REVIEW_ARTIFACT_REF_LINE_SUFFIX.exec(trimmed);
	const normalizedPath = pathForReviewArtifactRef(trimmed);
	return suffixMatch ? `${normalizedPath}${suffixMatch[0]}` : normalizedPath;
}

export function isSafeReviewArtifactPath(path: string): boolean {
	const normalized = normalizeArtifactPath(path);
	if (
		normalized.length === 0 ||
		normalized.startsWith("/") ||
		/^[A-Za-z]:\//.test(normalized)
	) {
		return false;
	}
	return normalized
		.split("/")
		.every(
			(segment) => segment.length > 0 && segment !== "." && segment !== "..",
		);
}

export function isSafeReviewArtifactRef(ref: string): boolean {
	const normalizedPath = pathForReviewArtifactRef(ref);
	return isSafeReviewArtifactPath(normalizedPath);
}

export function normalizeSafeReviewArtifactPath(path: string): string {
	const normalized = normalizeArtifactPath(path);
	return isSafeReviewArtifactPath(normalized) ? normalized : "";
}

export function isDocsAndPromptsPath(path: string): boolean {
	return pathMatchesSurface(path, "docs_and_prompts");
}

export function isToolingAndConfigPath(path: string): boolean {
	return pathMatchesSurface(path, "tooling_and_config");
}

export function isReleaseSurfacePath(path: string): boolean {
	return pathMatchesSurface(path, "release_surface");
}

export function isOperatorSurfacePath(path: string): boolean {
	return pathMatchesSurface(path, "operator_surfaces");
}

export function isTestPath(path: string): boolean {
	return pathMatchesSurface(path, "tests");
}

export function sharedAreaForPath(path: string): string | null {
	return areaForPath(path, SHARED_AREA_PATH_RULES);
}

export function integrationAreaForPath(path: string): string | null {
	return areaForPath(path, INTEGRATION_AREA_PATH_RULES);
}
