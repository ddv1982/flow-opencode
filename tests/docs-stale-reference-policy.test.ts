import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const policyTestPath = "tests/docs-stale-reference-policy.test.ts";

const staleReferences = [
	"IMPLEMENTATION_PLAN.md",
	"docs/current-truth.md",
	"current-truth.md",
	"docs/architecture/v2-boundaries.md",
	"v2-boundaries.md",
	"docs/migration/v2-tool-contract.md",
	"v2-tool-contract.md",
	"tests/config.test.ts",
	"runtime-completion-contracts.test.ts",
	"docs/factory-taxonomy.md",
	"factory-taxonomy.md",
	".factory",
] as const;

const historicalPrefixes = ["docs/releases/", "docs/investigations/"] as const;

const historicalFiles = new Set([
	"CHANGELOG.md",
	"release-notes.md", // Generated from CHANGELOG.md by the hosted release workflow.
]);

const successorBreadcrumbFiles = new Set([
	"tests/config/plugin-surface.test.ts",
	"tests/config/prompt-contracts.test.ts",
	"tests/config/tool-schemas.test.ts",
	"tests/runtime/final-completion-gates.test.ts",
	"tests/runtime/final-review-contracts.test.ts",
	"tests/runtime/plan-and-tool-schema-contracts.test.ts",
	"tests/runtime/worker-result-contracts.test.ts",
]);

const scannableExtensions = new Set([
	".json",
	".md",
	".mjs",
	".sh",
	".ts",
	".yaml",
	".yml",
]);

function extensionOf(path: string): string {
	const index = path.lastIndexOf(".");
	return index === -1 ? "" : path.slice(index);
}

function isAllowedHistoricalReferencePath(path: string): boolean {
	return (
		path === policyTestPath ||
		historicalFiles.has(path) ||
		successorBreadcrumbFiles.has(path) ||
		historicalPrefixes.some((prefix) => path.startsWith(prefix))
	);
}

function trackedPaths(): string[] {
	const output = execFileSync("git", ["ls-files"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	return output.split("\n").filter((path) => path.length > 0);
}

function isScannable(path: string): boolean {
	return scannableExtensions.has(extensionOf(path));
}

function scannablePolicyPaths(): string[] {
	const paths = trackedPaths();
	if (existsSync(join(repoRoot, "release-notes.md"))) {
		paths.push("release-notes.md");
	}
	return paths.filter(isScannable);
}

describe("docs stale reference policy", () => {
	test("retired path references stay confined to historical artifacts or successor breadcrumbs", () => {
		const violations: string[] = [];

		for (const path of scannablePolicyPaths()) {
			const text = readFileSync(join(repoRoot, path), "utf8");
			const matchedReferences = staleReferences.filter((reference) =>
				text.includes(reference),
			);
			if (
				matchedReferences.length === 0 ||
				isAllowedHistoricalReferencePath(path)
			) {
				continue;
			}

			violations.push(`${path}: ${matchedReferences.join(", ")}`);
		}

		expect(violations).toEqual([]);
	});

	test("retired process artifact tree is not tracked", () => {
		expect(
			trackedPaths().filter(
				(path) => path === ".factory" || path.startsWith(".factory/"),
			),
		).toEqual([]);
	});
});
