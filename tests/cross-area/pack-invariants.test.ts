import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");

const scriptPath = join(
	import.meta.dir,
	"..",
	"..",
	"scripts",
	"cross-area",
	"pack-invariants.mjs",
);

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-pack-invariants-"));
	tempDirs.push(dir);
	return dir;
}

function runPackInvariants(
	packJson: unknown,
	changelogText: string,
	packageVersion = "1.0.14",
) {
	const directory = makeTempDir();
	const packJsonPath = join(directory, "pack.json");
	const changelogPath = join(directory, "CHANGELOG.md");
	const packageJsonPath = join(directory, "package.json");

	writeFileSync(packJsonPath, JSON.stringify(packJson, null, 2));
	writeFileSync(changelogPath, changelogText);
	writeFileSync(
		packageJsonPath,
		JSON.stringify({ name: "opencode-plugin-flow", version: packageVersion }),
	);

	return Bun.spawn({
		cmd: ["node", scriptPath],
		cwd: repoRoot,
		env: {
			...process.env,
			FLOW_PACK_INVARIANTS_PACK_JSON_PATH: packJsonPath,
			FLOW_PACK_INVARIANTS_CHANGELOG_PATH: changelogPath,
			FLOW_PACK_INVARIANTS_PACKAGE_JSON_PATH: packageJsonPath,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("pack invariants script", () => {
	const expectedPaths = [
		"CHANGELOG.md",
		"LICENSE",
		"README.md",
		"dist/index.js",
		"dist/index.js.map",
		"package.json",
	];

	test("passes when the pack file set and changelog version match", async () => {
		const process = runPackInvariants(
			[
				{
					files: expectedPaths.map((path) => ({ path })),
				},
			],
			readFileSync(resolve(repoRoot, "CHANGELOG.md"), "utf8"),
		);
		expect(await process.exited).toBe(0);
		expect(await new Response(process.stdout).text()).toContain(
			"Pack invariants OK",
		);
	});

	test("fails with missing and forbidden files listed", async () => {
		const process = runPackInvariants(
			[
				{
					files: [
						{ path: "package.json" },
						{ path: "dist/index.js" },
						{ path: "LICENSE" },
						{ path: "README.md" },
						{ path: "docs/extra.md" },
					],
				},
			],
			"## [1.2.3] - 2026-04-18\n",
			"1.0.9",
		);
		expect(await process.exited).toBe(1);
		const stderr = await new Response(process.stderr).text();
		expect(stderr).toContain("Missing pack files:");
		expect(stderr).toContain("- CHANGELOG.md");
		expect(stderr).toContain("- dist/index.js.map");
		expect(stderr).toContain("Forbidden pack files:");
		expect(stderr).toContain("- docs/extra.md");
	});

	test("fails when the changelog top version does not match package.json", async () => {
		const process = runPackInvariants(
			[
				{
					files: expectedPaths.map((path) => ({ path })),
				},
			],
			"## [1.2.3] - 2026-04-18\n",
			"1.0.11",
		);
		expect(await process.exited).toBe(1);
		expect(await new Response(process.stderr).text()).toContain(
			"package.json version 1.0.11 does not match top CHANGELOG version 1.2.3",
		);
	});
});
