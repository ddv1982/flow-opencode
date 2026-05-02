import { createHash, randomUUID } from "node:crypto";
import {
	access,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { getFlowDir } from "../paths";
import {
	type PackageManager,
	PackageManagerSchema,
	type PlanningContext,
	type StackProfile,
	StackProfileSchema,
	type StandardsProfile,
	StandardsProfileSchema,
} from "../schema";
import {
	candidateWorkspaceDirectories,
	resolveWorkspaceStartDirectory,
} from "./workspace-boundaries";

type PackageManagerHint = {
	packageManager?: PackageManager | undefined;
	ambiguous: boolean;
};

type PackageJson = {
	packageManager?: unknown;
	scripts?: Record<string, unknown>;
	dependencies?: Record<string, unknown>;
	devDependencies?: Record<string, unknown>;
	peerDependencies?: Record<string, unknown>;
};

type StackBucket = keyof StackProfile;
type StandardsPriority = "user" | "local" | "official" | "external";

const STACK_STANDARDS_PROFILE_CACHE_SCHEMA_VERSION = 1;
const STACK_STANDARDS_PROFILE_CACHE_FILE = "standards-profile.json";
const CACHE_FINGERPRINT_ALGORITHM = "sha256";
const EXTERNAL_GUIDANCE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const GUIDELINE_FILES = [
	"AGENTS.md",
	"README.md",
	"CONTRIBUTING.md",
	".github/copilot-instructions.md",
	"docs/development.md",
	"docs/maintainer-contract.md",
	"docs/contributor-map.md",
	"biome.json",
	"eslint.config.js",
	"eslint.config.mjs",
	".eslintrc",
	".eslintrc.json",
	".prettierrc",
	"prettier.config.js",
	".editorconfig",
	"ruff.toml",
	".ruff.toml",
	"mypy.ini",
	".mypy.ini",
	"pytest.ini",
	"rustfmt.toml",
	"clippy.toml",
	".golangci.yml",
	".golangci.yaml",
	"checkstyle.xml",
	"Directory.Build.props",
] as const;

const PACKAGE_MANAGER_EVIDENCE_FILES = [
	"package.json",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
] as const;

const CONFIG_SIGNALS: Array<{
	file: string;
	bucket: StackBucket;
	name: string;
}> = [
	{ file: "tsconfig.json", bucket: "languages", name: "TypeScript" },
	{ file: "jsconfig.json", bucket: "languages", name: "JavaScript" },
	{ file: "bun.lock", bucket: "runtimes", name: "Bun" },
	{ file: "bun.lockb", bucket: "runtimes", name: "Bun" },
	{ file: "bunfig.toml", bucket: "runtimes", name: "Bun" },
	{ file: "deno.json", bucket: "runtimes", name: "Deno" },
	{ file: "deno.jsonc", bucket: "runtimes", name: "Deno" },
	{ file: "vite.config.ts", bucket: "tools", name: "Vite" },
	{ file: "vite.config.js", bucket: "tools", name: "Vite" },
	{ file: "vitest.config.ts", bucket: "tools", name: "Vitest" },
	{ file: "vitest.config.js", bucket: "tools", name: "Vitest" },
	{ file: "jest.config.ts", bucket: "tools", name: "Jest" },
	{ file: "jest.config.js", bucket: "tools", name: "Jest" },
	{ file: "playwright.config.ts", bucket: "tools", name: "Playwright" },
	{ file: "playwright.config.js", bucket: "tools", name: "Playwright" },
	{ file: "biome.json", bucket: "tools", name: "Biome" },
	{ file: "eslint.config.js", bucket: "tools", name: "ESLint" },
	{ file: "eslint.config.mjs", bucket: "tools", name: "ESLint" },
	{ file: ".prettierrc", bucket: "tools", name: "Prettier" },
	{ file: "next.config.js", bucket: "frameworks", name: "Next.js" },
	{ file: "next.config.mjs", bucket: "frameworks", name: "Next.js" },
	{ file: "svelte.config.js", bucket: "frameworks", name: "Svelte" },
	{ file: "astro.config.mjs", bucket: "frameworks", name: "Astro" },
	{ file: "pyproject.toml", bucket: "languages", name: "Python" },
	{ file: "requirements.txt", bucket: "languages", name: "Python" },
	{ file: "requirements-dev.txt", bucket: "languages", name: "Python" },
	{ file: "uv.lock", bucket: "packageManagers", name: "uv" },
	{ file: "poetry.lock", bucket: "packageManagers", name: "Poetry" },
	{ file: "ruff.toml", bucket: "tools", name: "Ruff" },
	{ file: ".ruff.toml", bucket: "tools", name: "Ruff" },
	{ file: "mypy.ini", bucket: "tools", name: "MyPy" },
	{ file: ".mypy.ini", bucket: "tools", name: "MyPy" },
	{ file: "pytest.ini", bucket: "tools", name: "pytest" },
	{ file: "Cargo.toml", bucket: "languages", name: "Rust" },
	{ file: "Cargo.toml", bucket: "tools", name: "Cargo" },
	{ file: "Cargo.lock", bucket: "tools", name: "Cargo" },
	{ file: "rustfmt.toml", bucket: "tools", name: "rustfmt" },
	{ file: "clippy.toml", bucket: "tools", name: "Clippy" },
	{ file: "go.mod", bucket: "languages", name: "Go" },
	{ file: "go.mod", bucket: "tools", name: "Go" },
	{ file: ".golangci.yml", bucket: "tools", name: "golangci-lint" },
	{ file: ".golangci.yaml", bucket: "tools", name: "golangci-lint" },
	{ file: "pom.xml", bucket: "languages", name: "Java" },
	{ file: "pom.xml", bucket: "tools", name: "Maven" },
	{ file: "build.gradle", bucket: "tools", name: "Gradle" },
	{ file: "build.gradle.kts", bucket: "tools", name: "Gradle" },
	{ file: "build.gradle.kts", bucket: "languages", name: "Kotlin" },
	{ file: "settings.gradle", bucket: "tools", name: "Gradle" },
	{ file: "settings.gradle.kts", bucket: "tools", name: "Gradle" },
	{ file: "Directory.Build.props", bucket: "tools", name: "MSBuild" },
];

const TEXT_SIGNALS: Array<{
	file: string;
	pattern: RegExp;
	bucket: StackBucket;
	name: string;
}> = [
	{
		file: "pyproject.toml",
		pattern: /\bfastapi\b/iu,
		bucket: "frameworks",
		name: "FastAPI",
	},
	{
		file: "pyproject.toml",
		pattern: /\bdjango\b/iu,
		bucket: "frameworks",
		name: "Django",
	},
	{
		file: "pyproject.toml",
		pattern: /\bpytest\b/iu,
		bucket: "tools",
		name: "pytest",
	},
	{
		file: "pyproject.toml",
		pattern: /\bruff\b/iu,
		bucket: "tools",
		name: "Ruff",
	},
	{
		file: "pyproject.toml",
		pattern: /\bmypy\b/iu,
		bucket: "tools",
		name: "MyPy",
	},
	{
		file: "pyproject.toml",
		pattern: /\bpoetry\b/iu,
		bucket: "packageManagers",
		name: "Poetry",
	},
	{
		file: "pyproject.toml",
		pattern: /\buv\b/iu,
		bucket: "packageManagers",
		name: "uv",
	},
	{
		file: "requirements.txt",
		pattern: /\bfastapi\b/iu,
		bucket: "frameworks",
		name: "FastAPI",
	},
	{
		file: "requirements.txt",
		pattern: /\bdjango\b/iu,
		bucket: "frameworks",
		name: "Django",
	},
	{
		file: "Cargo.toml",
		pattern: /\baxum\b/iu,
		bucket: "frameworks",
		name: "Axum",
	},
	{
		file: "Cargo.toml",
		pattern: /\bactix-web\b/iu,
		bucket: "frameworks",
		name: "Actix Web",
	},
	{
		file: "Cargo.toml",
		pattern: /\btokio\b/iu,
		bucket: "frameworks",
		name: "Tokio",
	},
	{
		file: "go.mod",
		pattern: /\bgin-gonic\/gin\b/iu,
		bucket: "frameworks",
		name: "Gin",
	},
	{
		file: "go.mod",
		pattern: /\blabstack\/echo\b/iu,
		bucket: "frameworks",
		name: "Echo",
	},
	{
		file: "pom.xml",
		pattern: /\bspring-boot\b/iu,
		bucket: "frameworks",
		name: "Spring Boot",
	},
	{
		file: "build.gradle",
		pattern: /\bspring-boot\b/iu,
		bucket: "frameworks",
		name: "Spring Boot",
	},
	{
		file: "build.gradle.kts",
		pattern: /\bspring-boot\b/iu,
		bucket: "frameworks",
		name: "Spring Boot",
	},
];

const DEPENDENCY_SIGNALS: Record<
	string,
	{ bucket: StackBucket; name: string }
> = {
	"@angular/core": { bucket: "frameworks", name: "Angular" },
	"@biomejs/biome": { bucket: "tools", name: "Biome" },
	"@playwright/test": { bucket: "tools", name: "Playwright" },
	"@sveltejs/kit": { bucket: "frameworks", name: "SvelteKit" },
	"@vitejs/plugin-react": { bucket: "tools", name: "Vite" },
	"@vue/runtime-core": { bucket: "frameworks", name: "Vue" },
	astro: { bucket: "frameworks", name: "Astro" },
	bun: { bucket: "runtimes", name: "Bun" },
	cypress: { bucket: "tools", name: "Cypress" },
	eslint: { bucket: "tools", name: "ESLint" },
	express: { bucket: "frameworks", name: "Express" },
	fastify: { bucket: "frameworks", name: "Fastify" },
	hono: { bucket: "frameworks", name: "Hono" },
	jest: { bucket: "tools", name: "Jest" },
	next: { bucket: "frameworks", name: "Next.js" },
	prettier: { bucket: "tools", name: "Prettier" },
	react: { bucket: "frameworks", name: "React" },
	svelte: { bucket: "frameworks", name: "Svelte" },
	typescript: { bucket: "languages", name: "TypeScript" },
	vite: { bucket: "tools", name: "Vite" },
	vitest: { bucket: "tools", name: "Vitest" },
	vue: { bucket: "frameworks", name: "Vue" },
};

const SCRIPT_TOOL_SIGNALS: Array<[RegExp, string]> = [
	[/\bbiome\b/u, "Biome"],
	[/\beslint\b/u, "ESLint"],
	[/\bprettier\b/u, "Prettier"],
	[/\btsc\b/u, "TypeScript"],
	[/\bvitest\b/u, "Vitest"],
	[/\bjest\b/u, "Jest"],
	[/\bplaywright\b/u, "Playwright"],
	[/\bcypress\b/u, "Cypress"],
	[/\bbun\b/u, "Bun"],
	[/\bpytest\b/u, "pytest"],
	[/\bruff\b/u, "Ruff"],
	[/\bmypy\b/u, "MyPy"],
	[/\bcargo\b/u, "Cargo"],
	[/\bgo test\b/u, "Go"],
	[/\bgolangci-lint\b/u, "golangci-lint"],
	[/\bmvn\b/u, "Maven"],
	[/\bgradle\b/u, "Gradle"],
	[/\bdotnet\b/u, ".NET"],
];

const CACHE_FINGERPRINT_FILES = [
	...new Set([
		...GUIDELINE_FILES,
		...PACKAGE_MANAGER_EVIDENCE_FILES,
		...CONFIG_SIGNALS.map((signal) => signal.file),
		...TEXT_SIGNALS.map((signal) => signal.file),
	]),
] as const;

const StackStandardsProfileCacheSchema = z
	.object({
		schemaVersion: z.literal(STACK_STANDARDS_PROFILE_CACHE_SCHEMA_VERSION),
		generatedAt: z.string().datetime(),
		workspaceRoot: z.string().min(1),
		startDirectory: z.string().min(1),
		packageManagerHint: z
			.object({
				packageManager: PackageManagerSchema.optional(),
				ambiguous: z.boolean(),
			})
			.strict(),
		fingerprint: z
			.object({
				algorithm: z.literal(CACHE_FINGERPRINT_ALGORITHM),
				hash: z.string().min(1),
				files: z.array(z.string().min(1)),
			})
			.strict(),
		profile: z
			.object({
				stackProfile: StackProfileSchema.optional(),
				standardsProfile: StandardsProfileSchema.optional(),
			})
			.strict(),
	})
	.strict();

type StackStandardsProfileCache = z.infer<
	typeof StackStandardsProfileCacheSchema
>;

export type StackStandardsProfileCacheValue = Pick<
	PlanningContext,
	"stackProfile" | "standardsProfile"
>;

export async function detectStackAndStandardsProfile(
	workspaceRoot: string,
	startDirectory: string | undefined,
	packageManagerHint: PackageManagerHint,
): Promise<StackStandardsProfileCacheValue> {
	const cacheContext = await buildCacheContext(
		workspaceRoot,
		startDirectory,
		packageManagerHint,
	);
	const cachedProfile =
		await readValidStackStandardsProfileCacheForContext(cacheContext);
	if (cachedProfile) {
		return cachedProfile;
	}

	const roots = candidateWorkspaceDirectories(workspaceRoot, startDirectory);
	const stackProfile = emptyStackProfile();
	const standardsProfile: StandardsProfile = {
		localGuidelines: [],
		externalGuidance: [],
		rules: [],
		gaps: [],
		precedence: [],
	};

	if (packageManagerHint.packageManager) {
		addSignal(
			stackProfile,
			"packageManagers",
			packageManagerHint.packageManager,
			"flow_plan_start package-manager detection",
			"high",
		);
	}
	if (packageManagerHint.ambiguous) {
		addRule(
			standardsProfile,
			"Package-manager evidence is ambiguous; prefer existing package.json scripts over guessed manager-specific commands.",
			["flow_plan_start package-manager detection"],
			"local",
		);
	}

	for (const root of roots) {
		await scanPackageJson(root, workspaceRoot, stackProfile, standardsProfile);
		await scanConfigSignals(
			root,
			workspaceRoot,
			stackProfile,
			standardsProfile,
		);
		await scanTextSignals(root, workspaceRoot, stackProfile, standardsProfile);
		await scanDirectorySignals(root, workspaceRoot, stackProfile);
		await scanGuidelineFiles(root, workspaceRoot, standardsProfile);
	}

	const dedupedStackProfile = dedupeStackProfile(stackProfile);
	const dedupedStandardsProfile = dedupeStandardsProfile(standardsProfile);
	const standardsWithGaps = addResearchGaps(
		dedupedStandardsProfile,
		dedupedStackProfile,
	);

	const profile = {
		...(hasStackSignals(dedupedStackProfile)
			? { stackProfile: dedupedStackProfile }
			: {}),
		...(hasStandardsSignals(standardsWithGaps)
			? { standardsProfile: withStandardsPrecedence(standardsWithGaps) }
			: {}),
	};
	await writeStackStandardsProfileCacheForContext(cacheContext, profile);
	return profile;
}

export async function readValidStackStandardsProfileCache(
	workspaceRoot: string,
	startDirectory?: string,
	packageManagerHint?: PackageManagerHint,
): Promise<StackStandardsProfileCacheValue | null> {
	const cacheContext = buildCacheLookupContext(
		workspaceRoot,
		startDirectory,
		packageManagerHint,
	);
	return readValidStackStandardsProfileCacheForContext(cacheContext);
}

export async function writeStackStandardsProfileCache(
	workspaceRoot: string,
	startDirectory: string | undefined,
	packageManagerHint: PackageManagerHint,
	profile: StackStandardsProfileCacheValue,
): Promise<void> {
	const cacheContext = await buildCacheContext(
		workspaceRoot,
		startDirectory,
		packageManagerHint,
	);
	await writeStackStandardsProfileCacheForContext(cacheContext, profile);
}

type CacheLookupContext = {
	workspaceRoot: string;
	startDirectory: string;
	sourceStartDirectory?: string | undefined;
	packageManagerHint?: PackageManagerHint | undefined;
	cachePath: string;
};

type CacheContext = CacheLookupContext & {
	fingerprint: StackStandardsProfileCache["fingerprint"];
};

function buildCacheLookupContext(
	workspaceRoot: string,
	startDirectory: string | undefined,
	packageManagerHint?: PackageManagerHint,
): CacheLookupContext {
	const resolvedRoot = resolve(workspaceRoot);
	return {
		workspaceRoot: resolvedRoot,
		startDirectory: cacheStartDirectoryKey(resolvedRoot, startDirectory),
		sourceStartDirectory: startDirectory,
		packageManagerHint,
		cachePath: stackStandardsProfileCachePath(resolvedRoot),
	};
}

async function buildCacheContext(
	workspaceRoot: string,
	startDirectory: string | undefined,
	packageManagerHint?: PackageManagerHint,
): Promise<CacheContext> {
	const lookupContext = buildCacheLookupContext(
		workspaceRoot,
		startDirectory,
		packageManagerHint,
	);
	return {
		...lookupContext,
		fingerprint: await buildProfileFingerprint(
			lookupContext.workspaceRoot,
			lookupContext.sourceStartDirectory,
		),
	};
}

async function readValidStackStandardsProfileCacheForContext(
	context: CacheLookupContext,
): Promise<StackStandardsProfileCacheValue | null> {
	let cache: StackStandardsProfileCache;
	try {
		cache = StackStandardsProfileCacheSchema.parse(
			JSON.parse(await readFile(context.cachePath, "utf8")),
		);
	} catch {
		return null;
	}

	if (
		cache.workspaceRoot !== context.workspaceRoot ||
		cache.startDirectory !== context.startDirectory
	) {
		return null;
	}

	if (
		context.packageManagerHint &&
		!packageManagerHintsEqual(
			cache.packageManagerHint,
			context.packageManagerHint,
		)
	) {
		return null;
	}

	if (cacheHasExpiredExternalGuidance(cache)) {
		return null;
	}

	const fingerprint = await buildProfileFingerprint(
		context.workspaceRoot,
		context.sourceStartDirectory,
	);
	if (
		cache.fingerprint.algorithm !== fingerprint.algorithm ||
		cache.fingerprint.hash !== fingerprint.hash
	) {
		return null;
	}

	return cache.profile;
}

async function writeStackStandardsProfileCacheForContext(
	context: CacheContext,
	profile: StackStandardsProfileCacheValue,
): Promise<void> {
	const cache: StackStandardsProfileCache = {
		schemaVersion: STACK_STANDARDS_PROFILE_CACHE_SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		workspaceRoot: context.workspaceRoot,
		startDirectory: context.startDirectory,
		packageManagerHint: context.packageManagerHint ?? { ambiguous: false },
		fingerprint: context.fingerprint,
		profile,
	};

	try {
		await mkdir(dirname(context.cachePath), { recursive: true });
		await writeJsonAtomically(context.cachePath, cache);
	} catch {
		// The cache is an optimization. Planning must keep working if writing it fails.
	}
}

async function writeJsonAtomically(
	targetPath: string,
	value: StackStandardsProfileCache,
): Promise<void> {
	const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		await rename(tempPath, targetPath);
	} catch (error) {
		await rm(tempPath, { force: true });
		throw error;
	}
}

async function buildProfileFingerprint(
	workspaceRoot: string,
	startDirectory?: string,
): Promise<StackStandardsProfileCache["fingerprint"]> {
	const files = await collectFingerprintFiles(workspaceRoot, startDirectory);
	const hash = createHash(CACHE_FINGERPRINT_ALGORITHM);
	for (const file of files) {
		hash.update(file.reference);
		hash.update("\0");
		hash.update(
			createHash(CACHE_FINGERPRINT_ALGORITHM)
				.update(file.contents)
				.digest("hex"),
		);
		hash.update("\0");
	}
	return {
		algorithm: CACHE_FINGERPRINT_ALGORITHM,
		hash: hash.digest("hex"),
		files: files.map((file) => file.reference),
	};
}

async function collectFingerprintFiles(
	workspaceRoot: string,
	startDirectory?: string,
): Promise<Array<{ reference: string; contents: Buffer }>> {
	const paths = new Set<string>();
	for (const root of candidateWorkspaceDirectories(
		workspaceRoot,
		startDirectory,
	)) {
		for (const file of CACHE_FINGERPRINT_FILES) {
			paths.add(join(root, file));
		}
		for (const file of await collectDirectoryFiles(root, (entry) =>
			entry.endsWith(".csproj"),
		)) {
			paths.add(file);
		}
		for (const file of await collectDirectoryFiles(
			join(root, ".github", "workflows"),
			(entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"),
		)) {
			paths.add(file);
		}
	}

	const files: Array<{ reference: string; contents: Buffer }> = [];
	for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
		try {
			files.push({
				reference: relativeRef(workspaceRoot, path),
				contents: await readFile(path),
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}
	return files;
}

async function collectDirectoryFiles(
	root: string,
	include: (entry: string) => boolean,
): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && include(entry.name))
			.map((entry) => join(root, entry.name));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

function cacheStartDirectoryKey(
	resolvedRoot: string,
	startDirectory?: string,
): string {
	const resolvedStart = resolveWorkspaceStartDirectory(
		resolvedRoot,
		startDirectory,
	);
	const key = relative(resolvedRoot, resolvedStart);
	return key.length > 0 ? key : ".";
}

function stackStandardsProfileCachePath(workspaceRoot: string): string {
	return join(getFlowDir(workspaceRoot), STACK_STANDARDS_PROFILE_CACHE_FILE);
}

function packageManagerHintsEqual(
	left: PackageManagerHint,
	right: PackageManagerHint,
): boolean {
	return (
		left.packageManager === right.packageManager &&
		left.ambiguous === right.ambiguous
	);
}

function cacheHasExpiredExternalGuidance(
	cache: StackStandardsProfileCache,
): boolean {
	if ((cache.profile.standardsProfile?.externalGuidance.length ?? 0) === 0) {
		return false;
	}
	const generatedAt = Date.parse(cache.generatedAt);
	return (
		Number.isNaN(generatedAt) ||
		Date.now() - generatedAt > EXTERNAL_GUIDANCE_CACHE_TTL_MS
	);
}

function emptyStackProfile(): StackProfile {
	return {
		languages: [],
		frameworks: [],
		runtimes: [],
		packageManagers: [],
		tools: [],
	};
}

async function scanPackageJson(
	root: string,
	workspaceRoot: string,
	stackProfile: StackProfile,
	standardsProfile: StandardsProfile,
) {
	const path = join(root, "package.json");
	const ref = relativeRef(workspaceRoot, path);
	const packageJson = await readJson<PackageJson>(path);
	if (!packageJson) {
		return;
	}

	addSignal(stackProfile, "runtimes", "Node.js", ref, "medium");
	addSignal(stackProfile, "languages", "JavaScript", ref, "medium");
	for (const [dependency, signal] of Object.entries(DEPENDENCY_SIGNALS)) {
		if (hasDependency(packageJson, dependency)) {
			addSignal(stackProfile, signal.bucket, signal.name, ref, "high");
		}
	}

	for (const command of Object.values(packageJson.scripts ?? {})) {
		if (typeof command !== "string") {
			continue;
		}
		for (const [pattern, name] of SCRIPT_TOOL_SIGNALS) {
			if (pattern.test(command)) {
				const bucket: StackBucket = name === "Bun" ? "runtimes" : "tools";
				addSignal(stackProfile, bucket, name, ref, "medium");
			}
		}
	}

	if (packageJson.scripts && Object.keys(packageJson.scripts).length > 0) {
		for (const [name, command] of Object.entries(packageJson.scripts)) {
			if (typeof command !== "string") {
				continue;
			}
			if (/^build(?::|$)/u.test(name)) {
				addRule(
					standardsProfile,
					`Use package.json script '${name}' for build validation when applicable.`,
					[ref],
					"local",
				);
			}
			if (/^(lint|check)(?::|$)/u.test(name)) {
				addRule(
					standardsProfile,
					`Use package.json script '${name}' for lint/static checks when applicable.`,
					[ref],
					"local",
				);
			}
			if (/^test(?::|$)/u.test(name)) {
				addRule(
					standardsProfile,
					`Use package.json script '${name}' for tests when applicable.`,
					[ref],
					"local",
				);
			}
		}
		addRule(
			standardsProfile,
			"Use existing package.json scripts for build, lint, test, and validation before inventing raw commands.",
			[ref],
			"local",
		);
	}
}

async function scanTextSignals(
	root: string,
	workspaceRoot: string,
	stackProfile: StackProfile,
	standardsProfile: StandardsProfile,
) {
	for (const signal of TEXT_SIGNALS) {
		const absolutePath = join(root, signal.file);
		const contents = await readText(absolutePath);
		if (contents && signal.pattern.test(contents)) {
			const ref = relativeRef(workspaceRoot, absolutePath);
			addSignal(stackProfile, signal.bucket, signal.name, ref, "high");
			if (signal.bucket === "tools" || signal.bucket === "packageManagers") {
				addRule(
					standardsProfile,
					`Use ${signal.name} configuration from ${ref} when applicable.`,
					[ref],
					"local",
				);
			}
		}
	}
}

async function scanDirectorySignals(
	root: string,
	workspaceRoot: string,
	stackProfile: StackProfile,
) {
	let entries: string[];
	try {
		entries = await readdir(root);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.endsWith(".csproj")) {
			const ref = relativeRef(workspaceRoot, join(root, entry));
			addSignal(stackProfile, "languages", "C#", ref, "high");
			addSignal(stackProfile, "frameworks", ".NET", ref, "high");
			addSignal(stackProfile, "tools", "dotnet", ref, "high");
		}
	}
}

async function scanConfigSignals(
	root: string,
	workspaceRoot: string,
	stackProfile: StackProfile,
	standardsProfile: StandardsProfile,
) {
	for (const signal of CONFIG_SIGNALS) {
		const absolutePath = join(root, signal.file);
		if (await pathExists(absolutePath)) {
			const ref = relativeRef(workspaceRoot, absolutePath);
			addSignal(stackProfile, signal.bucket, signal.name, ref, "high");
			if (signal.bucket === "tools") {
				addRule(
					standardsProfile,
					`Use ${signal.name} configuration from ${ref} when applicable.`,
					[ref],
					"local",
				);
			}
		}
	}
}

async function scanGuidelineFiles(
	root: string,
	workspaceRoot: string,
	standardsProfile: StandardsProfile,
) {
	for (const file of GUIDELINE_FILES) {
		const absolutePath = join(root, file);
		if (!(await pathExists(absolutePath))) {
			continue;
		}
		const reference = relativeRef(workspaceRoot, absolutePath);
		standardsProfile.localGuidelines.push({
			title: basename(file),
			sourceType: "local",
			reference,
			confidence: "high",
		});
		addRule(
			standardsProfile,
			`Honor local project guidance from ${reference}.`,
			[reference],
			"local",
		);
	}
}

function hasDependency(packageJson: PackageJson, dependency: string): boolean {
	return Boolean(
		packageJson.dependencies?.[dependency] ??
			packageJson.devDependencies?.[dependency] ??
			packageJson.peerDependencies?.[dependency],
	);
}

function addSignal(
	profile: StackProfile,
	bucket: StackBucket,
	name: string,
	evidenceRef: string,
	confidence: "low" | "medium" | "high",
) {
	profile[bucket].push({
		name,
		evidenceRefs: [evidenceRef],
		confidence,
	});
}

function addRule(
	profile: StandardsProfile,
	summary: string,
	sourceRefs: string[],
	priority: StandardsPriority,
) {
	profile.rules.push({ summary, sourceRefs, priority });
}

function addGap(
	profile: StandardsProfile,
	stackItem: string,
	reason: string,
	suggestedResearch: string[],
) {
	profile.gaps.push({ stackItem, reason, suggestedResearch });
}

function dedupeStackProfile(profile: StackProfile): StackProfile {
	return Object.fromEntries(
		Object.entries(profile).map(([bucket, items]) => [
			bucket,
			dedupeEntries(items),
		]),
	) as StackProfile;
}

function dedupeEntries<T extends { name: string; evidenceRefs: string[] }>(
	items: T[],
): T[] {
	const byName = new Map<string, T>();
	for (const item of items) {
		const existing = byName.get(item.name);
		if (!existing) {
			byName.set(item.name, {
				...item,
				evidenceRefs: [...new Set(item.evidenceRefs)],
			});
			continue;
		}
		existing.evidenceRefs = [
			...new Set([...existing.evidenceRefs, ...item.evidenceRefs]),
		];
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function dedupeStandardsProfile(profile: StandardsProfile): StandardsProfile {
	return {
		localGuidelines: dedupeByReference(profile.localGuidelines),
		externalGuidance: dedupeByReference(profile.externalGuidance),
		rules: dedupeRules(profile.rules),
		gaps: dedupeGaps(profile.gaps),
		precedence: [...new Set(profile.precedence)],
	};
}

function addResearchGaps(
	profile: StandardsProfile,
	stackProfile: StackProfile,
): StandardsProfile {
	if (!hasStackSignals(stackProfile)) {
		return profile;
	}
	const knownLocalRefs = new Set([
		...profile.localGuidelines.map((item) => item.reference),
		...profile.rules.flatMap((item) => item.sourceRefs),
	]);
	const nextProfile = { ...profile, gaps: [...profile.gaps] };
	for (const item of [
		...stackProfile.languages,
		...stackProfile.frameworks,
		...stackProfile.tools,
	]) {
		if (hasSpecificLocalRule(profile, item.name, knownLocalRefs)) {
			continue;
		}
		addGap(
			nextProfile,
			item.name,
			"No local standards were found for this detected stack item.",
			researchQueriesFor(item.name),
		);
	}
	return nextProfile;
}

function hasSpecificLocalRule(
	profile: StandardsProfile,
	stackItem: string,
	knownLocalRefs: Set<string>,
): boolean {
	const normalizedStackItem = stackItem.toLocaleLowerCase();
	return profile.rules.some(
		(rule) =>
			rule.priority === "local" &&
			rule.summary.toLocaleLowerCase().includes(normalizedStackItem) &&
			rule.sourceRefs.some((ref) => knownLocalRefs.has(ref)),
	);
}

function hasStackSignals(profile: StackProfile): boolean {
	return Object.values(profile).some((items) => items.length > 0);
}

function hasStandardsSignals(profile: StandardsProfile): boolean {
	return (
		profile.localGuidelines.length > 0 ||
		profile.externalGuidance.length > 0 ||
		profile.rules.length > 0 ||
		profile.gaps.length > 0
	);
}

function withStandardsPrecedence(profile: StandardsProfile): StandardsProfile {
	return {
		...profile,
		rules: [
			{
				summary:
					"Apply direct user instructions first, then repo-local guideline files and configs, then official docs, then broader external standards.",
				sourceRefs: [],
				priority: "user",
			},
			...profile.rules,
		],
		precedence: [
			"direct user instructions",
			"repo-local guideline files and tool configs",
			"official documentation via Ref/MCP or webfetch",
			"broader Exa/websearch guidance",
			...profile.precedence,
		],
	};
}

function dedupeByReference<T extends { reference: string }>(items: T[]): T[] {
	return [
		...new Map(items.map((item) => [item.reference, item])).values(),
	].sort((a, b) => a.reference.localeCompare(b.reference));
}

function dedupeRules<T extends { summary: string; sourceRefs: string[] }>(
	items: T[],
): T[] {
	const bySummary = new Map<string, T>();
	for (const item of items) {
		const existing = bySummary.get(item.summary);
		if (!existing) {
			bySummary.set(item.summary, {
				...item,
				sourceRefs: [...new Set(item.sourceRefs)],
			});
			continue;
		}
		existing.sourceRefs = [
			...new Set([...existing.sourceRefs, ...item.sourceRefs]),
		];
	}
	return [...bySummary.values()];
}

function dedupeGaps<
	T extends { stackItem: string; suggestedResearch: string[] },
>(items: T[]): T[] {
	const byItem = new Map<string, T>();
	for (const item of items) {
		const existing = byItem.get(item.stackItem);
		if (!existing) {
			byItem.set(item.stackItem, {
				...item,
				suggestedResearch: [...new Set(item.suggestedResearch)],
			});
			continue;
		}
		existing.suggestedResearch = [
			...new Set([...existing.suggestedResearch, ...item.suggestedResearch]),
		];
	}
	return [...byItem.values()].sort((a, b) =>
		a.stackItem.localeCompare(b.stackItem),
	);
}

function researchQueriesFor(stackItem: string): string[] {
	return [
		`official ${stackItem} coding standards documentation`,
		`official ${stackItem} testing best practices documentation`,
	];
}

async function readText(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return null;
	}
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
}

function relativeRef(workspaceRoot: string, absolutePath: string): string {
	const pathFromRoot = relative(workspaceRoot, absolutePath);
	return pathFromRoot === "" || pathFromRoot.startsWith("..")
		? absolutePath
		: pathFromRoot;
}
