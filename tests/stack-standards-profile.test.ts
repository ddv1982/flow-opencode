import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { detectStackAndStandardsProfile } from "../src/runtime/application/stack-standards-profile";
import { createTempDirRegistry } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

async function writeWorkspaceFile(
	worktree: string,
	filename: string,
	contents: string,
): Promise<void> {
	const absolutePath = join(worktree, filename);
	mkdirSync(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, contents, "utf8");
}

describe("stack and standards profile detection", () => {
	test("detects TypeScript, Bun, Biome, package scripts, local guidelines, and config rules", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"package.json",
			JSON.stringify({
				name: "fixture",
				packageManager: "bun@1.2.0",
				scripts: {
					build: "bun build ./src/index.ts",
					lint: "biome check src",
					test: "bun test",
				},
				dependencies: { react: "^19.0.0" },
				devDependencies: { typescript: "^6.0.0", "@biomejs/biome": "^2.0.0" },
			}),
		);
		await writeWorkspaceFile(
			worktree,
			"tsconfig.json",
			`{
				// JSONC is common in tsconfig.json.
				"compilerOptions": {
					/* Block comments should parse as whitespace, not disappear. */
					"strict": true,
					"noUncheckedIndexedAccess": true,
					"exactOptionalPropertyTypes": true,
				},
			}`,
		);
		await writeWorkspaceFile(
			worktree,
			"biome.json",
			JSON.stringify({
				formatter: { enabled: true },
				linter: {
					enabled: true,
					rules: {
						recommended: true,
						suspicious: { noConsole: "error" },
					},
				},
			}),
		);
		await writeWorkspaceFile(worktree, "AGENTS.md", "Use repo rules.");

		const profile = await detectStackAndStandardsProfile(worktree, undefined, {
			packageManager: "bun",
			ambiguous: false,
		});

		expect(profile.stackProfile?.languages.map((item) => item.name)).toContain(
			"TypeScript",
		);
		expect(profile.stackProfile?.frameworks.map((item) => item.name)).toContain(
			"React",
		);
		expect(profile.stackProfile?.runtimes.map((item) => item.name)).toContain(
			"Bun",
		);
		expect(profile.stackProfile?.tools.map((item) => item.name)).toContain(
			"Biome",
		);
		expect(
			profile.stackProfile?.packageManagers.map((item) => item.name),
		).toContain("bun");
		expect(
			profile.standardsProfile?.localGuidelines.map((item) => item.reference),
		).toEqual(expect.arrayContaining(["AGENTS.md", "biome.json"]));
		const rules = profile.standardsProfile?.rules
			.map((item) => item.summary)
			.join("\n");
		expect(rules).toContain("Use existing package.json scripts");
		expect(rules).toContain("Preserve TypeScript strictness");
		expect(rules).toContain("Use Biome lint settings");
		expect(rules).toContain("suspicious.noConsole");
	});

	test("ignores malformed JSONC instead of accepting block-comment-stripped configs", async () => {
		const malformedConfigs = [
			`{
				"compilerOptions": {
					"strict": tr/* invalid token splice */ue,
				},
			}`,
			`{
				"compilerOptions": {
					"strict": true
				}
			} /* unterminated trailing comment`,
		];

		for (const contents of malformedConfigs) {
			const worktree = makeTempDir();
			await writeWorkspaceFile(worktree, "tsconfig.json", contents);

			const profile = await detectStackAndStandardsProfile(
				worktree,
				undefined,
				{
					ambiguous: false,
				},
			);
			const rules = profile.standardsProfile?.rules
				.map((item) => item.summary)
				.join("\n");

			expect(
				profile.stackProfile?.languages.map((item) => item.name),
			).toContain("TypeScript");
			expect(rules).not.toContain("Preserve TypeScript strictness");
		}
	});

	test("detects plugin validation dependencies and emits tool-aware research gaps", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"package.json",
			JSON.stringify({
				name: "fixture",
				dependencies: { zod: "4.1.8" },
				devDependencies: { "@opencode-ai/plugin": "^1.3.10" },
			}),
		);

		const profile = await detectStackAndStandardsProfile(worktree, undefined, {
			ambiguous: false,
		});

		expect(profile.stackProfile?.tools.map((item) => item.name)).toEqual(
			expect.arrayContaining(["OpenCode Plugin SDK", "Zod"]),
		);
		expect(
			profile.standardsProfile?.gaps.find(
				(gap) => gap.stackItem === "OpenCode Plugin SDK",
			)?.suggestedResearch,
		).toEqual(
			expect.arrayContaining([
				"Ref MCP: official OpenCode plugin custom tools and MCP server documentation",
				"Exa: current OpenCode plugin SDK TypeScript and Zod tool argument examples",
				"Websearch fallback: official OpenCode plugin documentation",
			]),
		);
		expect(
			profile.standardsProfile?.gaps
				.find((gap) => gap.stackItem === "Zod")
				?.suggestedResearch.join("\n"),
		).toContain("verify OpenCode plugin SDK tool argument behavior");
	});

	test("records package-manager ambiguity as a local standards rule", async () => {
		const worktree = makeTempDir();

		const profile = await detectStackAndStandardsProfile(worktree, undefined, {
			ambiguous: true,
		});

		expect(
			profile.standardsProfile?.rules.some((rule) =>
				rule.summary.includes("Package-manager evidence is ambiguous"),
			),
		).toBe(true);
	});

	test("detects Python tooling and emits bounded research gaps for framework standards", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"pyproject.toml",
			`
[project]
dependencies = ["fastapi", "pytest"]

[tool.ruff]
line-length = 88

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
		);

		const profile = await detectStackAndStandardsProfile(worktree, undefined, {
			ambiguous: false,
		});

		expect(profile.stackProfile?.languages.map((item) => item.name)).toContain(
			"Python",
		);
		expect(profile.stackProfile?.frameworks.map((item) => item.name)).toContain(
			"FastAPI",
		);
		expect(profile.stackProfile?.tools.map((item) => item.name)).toEqual(
			expect.arrayContaining(["Ruff", "pytest"]),
		);
		expect(
			profile.standardsProfile?.rules.some((rule) =>
				rule.summary.includes("Ruff configuration"),
			),
		).toBe(true);
		expect(
			profile.standardsProfile?.gaps.some(
				(gap) =>
					gap.stackItem === "FastAPI" &&
					gap.suggestedResearch.some((query) =>
						query.includes("official FastAPI"),
					),
			),
		).toBe(true);
	});

	test("detects Rust and Go ecosystems with framework-specific gaps", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"Cargo.toml",
			`
[package]
name = "api"
version = "0.1.0"

[dependencies]
axum = "0.7"
`,
		);
		await writeWorkspaceFile(worktree, "rustfmt.toml", 'edition = "2021"');
		await writeWorkspaceFile(
			worktree,
			"services/go/go.mod",
			`
module example.com/service

require github.com/gin-gonic/gin v1.10.0
`,
		);

		const profile = await detectStackAndStandardsProfile(
			worktree,
			"services/go",
			{ ambiguous: false },
		);

		expect(profile.stackProfile?.languages.map((item) => item.name)).toEqual(
			expect.arrayContaining(["Go", "Rust"]),
		);
		expect(profile.stackProfile?.frameworks.map((item) => item.name)).toEqual(
			expect.arrayContaining(["Axum", "Gin"]),
		);
		expect(profile.stackProfile?.tools.map((item) => item.name)).toEqual(
			expect.arrayContaining(["Cargo", "Go", "rustfmt"]),
		);
		expect(profile.standardsProfile?.gaps.map((gap) => gap.stackItem)).toEqual(
			expect.arrayContaining(["Axum", "Gin"]),
		);
	});

	test("detects .NET projects from csproj files and suggests official research", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"src/App/App.csproj",
			`<Project Sdk="Microsoft.NET.Sdk.Web"></Project>`,
		);

		const profile = await detectStackAndStandardsProfile(worktree, "src/App", {
			ambiguous: false,
		});

		expect(profile.stackProfile?.languages.map((item) => item.name)).toContain(
			"C#",
		);
		expect(profile.stackProfile?.frameworks.map((item) => item.name)).toContain(
			".NET",
		);
		expect(profile.stackProfile?.tools.map((item) => item.name)).toContain(
			"dotnet",
		);
		expect(
			profile.standardsProfile?.gaps.some((gap) => gap.stackItem === ".NET"),
		).toBe(true);
	});

	test("refreshes old detector-version caches even when source evidence is unchanged", async () => {
		const worktree = makeTempDir();
		const packageJson = JSON.stringify({
			name: "fixture",
			dependencies: { zod: "4.1.8" },
		});
		await writeWorkspaceFile(worktree, "package.json", packageJson);
		const staleCacheHash = createHash("sha256");
		staleCacheHash.update("package.json");
		staleCacheHash.update("\0");
		staleCacheHash.update(
			createHash("sha256").update(packageJson).digest("hex"),
		);
		staleCacheHash.update("\0");
		await writeWorkspaceFile(
			worktree,
			".flow/standards-profile.json",
			JSON.stringify({
				schemaVersion: 2,
				generatedAt: new Date().toISOString(),
				workspaceRoot: worktree,
				startDirectory: ".",
				packageManagerHint: { ambiguous: false },
				fingerprint: {
					algorithm: "sha256",
					hash: staleCacheHash.digest("hex"),
					files: ["package.json"],
				},
				profile: {
					stackProfile: {
						languages: [],
						frameworks: [],
						runtimes: [],
						packageManagers: [],
						tools: [],
					},
				},
			}),
		);

		const profile = await detectStackAndStandardsProfile(worktree, undefined, {
			ambiguous: false,
		});
		const cache = JSON.parse(
			await readFile(join(worktree, ".flow", "standards-profile.json"), "utf8"),
		);

		expect(cache.schemaVersion).toBe(3);
		expect(profile.stackProfile?.tools.map((item) => item.name)).toContain(
			"Zod",
		);
	});

	test("refreshes stale external standards evidence even when source evidence is unchanged", async () => {
		const staleCacheCases = [
			{
				name: "official rule",
				externalGuidance: [],
				rules: [
					{
						summary: "Cached official guidance that must age out.",
						sourceRefs: [],
						priority: "official" as const,
					},
				],
			},
			{
				name: "external rule",
				externalGuidance: [],
				rules: [
					{
						summary: "Cached external guidance that must age out.",
						sourceRefs: [],
						priority: "external" as const,
					},
				],
			},
			{
				name: "external source",
				externalGuidance: [
					{
						title: "Cached external source",
						sourceType: "external" as const,
						reference: "https://example.test/standards",
						confidence: "medium" as const,
					},
				],
				rules: [],
			},
		];

		for (const staleCacheCase of staleCacheCases) {
			const worktree = makeTempDir();
			const packageJson = JSON.stringify({
				name: "fixture",
				dependencies: { zod: "4.1.8" },
			});
			await writeWorkspaceFile(worktree, "package.json", packageJson);
			const cacheHash = createHash("sha256");
			cacheHash.update("package.json");
			cacheHash.update("\0");
			cacheHash.update(createHash("sha256").update(packageJson).digest("hex"));
			cacheHash.update("\0");
			await writeWorkspaceFile(
				worktree,
				".flow/standards-profile.json",
				JSON.stringify({
					schemaVersion: 3,
					generatedAt: new Date(
						Date.now() - 31 * 24 * 60 * 60 * 1000,
					).toISOString(),
					workspaceRoot: worktree,
					startDirectory: ".",
					packageManagerHint: { ambiguous: false },
					fingerprint: {
						algorithm: "sha256",
						hash: cacheHash.digest("hex"),
						files: ["package.json"],
					},
					profile: {
						stackProfile: {
							languages: [],
							frameworks: [],
							runtimes: [],
							packageManagers: [],
							tools: [],
						},
						standardsProfile: {
							localGuidelines: [],
							externalGuidance: staleCacheCase.externalGuidance,
							rules: staleCacheCase.rules,
							gaps: [],
							precedence: [],
						},
					},
				}),
			);

			const profile = await detectStackAndStandardsProfile(
				worktree,
				undefined,
				{
					ambiguous: false,
				},
			);

			expect(
				profile.stackProfile?.tools.map((item) => item.name),
				staleCacheCase.name,
			).toContain("Zod");
			expect(
				profile.standardsProfile?.rules.map((rule) => rule.summary),
				staleCacheCase.name,
			).not.toContain(staleCacheCase.rules[0]?.summary ?? "");
		}
	});

	test("writes a fingerprinted cache and refreshes it when source evidence changes", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"pyproject.toml",
			`[project]\ndependencies = ["fastapi"]\n`,
		);

		const first = await detectStackAndStandardsProfile(worktree, undefined, {
			ambiguous: false,
		});
		const cachePath = join(worktree, ".flow", "standards-profile.json");
		const cache = JSON.parse(await readFile(cachePath, "utf8"));

		expect(cache.schemaVersion).toBe(3);
		expect(cache.fingerprint.files).toContain("pyproject.toml");
		expect(first.stackProfile?.frameworks.map((item) => item.name)).toContain(
			"FastAPI",
		);

		await writeWorkspaceFile(
			worktree,
			"pyproject.toml",
			`[project]\ndependencies = ["django"]\n`,
		);

		const refreshed = await detectStackAndStandardsProfile(
			worktree,
			undefined,
			{ ambiguous: false },
		);

		expect(
			refreshed.stackProfile?.frameworks.map((item) => item.name),
		).toContain("Django");
		expect(
			refreshed.stackProfile?.frameworks.map((item) => item.name),
		).not.toContain("FastAPI");
	});
});
