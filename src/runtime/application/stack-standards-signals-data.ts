export type StackSignalBucket =
	| "languages"
	| "frameworks"
	| "runtimes"
	| "packageManagers"
	| "tools";

export type ConfigSignal = {
	file: string;
	bucket: StackSignalBucket;
	name: string;
};

export type TextSignal = {
	file: string;
	pattern: RegExp;
	bucket: StackSignalBucket;
	name: string;
};

export const GUIDELINE_FILES = [
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

export const PACKAGE_MANAGER_EVIDENCE_FILES = [
	"package.json",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
] as const;

export const CONFIG_SIGNALS: ConfigSignal[] = [
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

export const TEXT_SIGNALS: TextSignal[] = [
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

export const DEPENDENCY_SIGNALS: Record<
	string,
	{ bucket: StackSignalBucket; name: string }
> = {
	"@angular/core": { bucket: "frameworks", name: "Angular" },
	"@biomejs/biome": { bucket: "tools", name: "Biome" },
	"@opencode-ai/plugin": { bucket: "tools", name: "OpenCode Plugin SDK" },
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
	zod: { bucket: "tools", name: "Zod" },
};

export const SCRIPT_TOOL_SIGNALS: Array<[RegExp, string]> = [
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

export const CACHE_FINGERPRINT_FILES = [
	...new Set([
		...GUIDELINE_FILES,
		...PACKAGE_MANAGER_EVIDENCE_FILES,
		...CONFIG_SIGNALS.map((signal) => signal.file),
		...TEXT_SIGNALS.map((signal) => signal.file),
	]),
] as const;
