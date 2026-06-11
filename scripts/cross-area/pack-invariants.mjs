#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const EXPECTED_PACK_FILES = [
	"CHANGELOG.md",
	"LICENSE",
	"README.md",
	"dist/cli.js",
	"dist/index.js",
	"dist/index.js.map",
	"package.json",
];
const EXPECTED_PACKAGE_MAIN = "dist/index.js";
const EXPECTED_PACKAGE_EXPORTS = { ".": "./dist/index.js" };

function resolveRepoPath(filePath) {
	return path.resolve(import.meta.dirname, "..", "..", filePath);
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function loadPackJson(repoRoot) {
	const overridePath = process.env.FLOW_PACK_INVARIANTS_PACK_JSON_PATH;
	if (overridePath) {
		return readJson(overridePath);
	}

	const npmCacheDir =
		process.env.npm_config_cache ?? path.join(tmpdir(), "flow-npm-cache");
	mkdirSync(npmCacheDir, { recursive: true });

	const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
		cwd: repoRoot,
		encoding: "utf8",
		env: {
			...process.env,
			npm_config_cache: npmCacheDir,
		},
	});
	return JSON.parse(output);
}

function extractPackPaths(packJson) {
	if (!Array.isArray(packJson) || packJson.length === 0) {
		throw new Error(
			"npm pack --dry-run --json did not return a package entry.",
		);
	}

	const [entry] = packJson;
	if (!entry || !Array.isArray(entry.files)) {
		throw new Error(
			"npm pack --dry-run --json output is missing the files array.",
		);
	}

	return entry.files
		.map((file) => file?.path)
		.filter((value) => typeof value === "string")
		.sort();
}

function readPackageJson() {
	const packageJsonPath =
		process.env.FLOW_PACK_INVARIANTS_PACKAGE_JSON_PATH ??
		resolveRepoPath("package.json");
	return { packageJson: readJson(packageJsonPath), packageJsonPath };
}

function readPackageVersion(packageJson, packageJsonPath) {
	if (
		typeof packageJson.version !== "string" ||
		packageJson.version.length === 0
	) {
		throw new Error(`No valid version found in ${packageJsonPath}.`);
	}
	return packageJson.version;
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function validatePackagePublicSurface(packageJson) {
	const errors = [];
	if (packageJson.main !== EXPECTED_PACKAGE_MAIN) {
		errors.push(
			`package.json main must remain ${EXPECTED_PACKAGE_MAIN}; got ${JSON.stringify(packageJson.main)}.`,
		);
	}
	if (!sameJson(packageJson.exports, EXPECTED_PACKAGE_EXPORTS)) {
		errors.push(
			`package.json exports must expose only the plugin root entry ${JSON.stringify(EXPECTED_PACKAGE_EXPORTS)}; got ${JSON.stringify(packageJson.exports)}.`,
		);
	}
	return errors;
}

function readTopChangelogVersion() {
	const changelogPath =
		process.env.FLOW_PACK_INVARIANTS_CHANGELOG_PATH ??
		resolveRepoPath("CHANGELOG.md");
	const changelog = readFileSync(changelogPath, "utf8");
	const match =
		changelog.match(/^## \[([0-9]+\.[0-9]+\.[0-9]+(?:-[^\]\s]+)?)\]/m) ??
		changelog.match(/^## ([0-9]+\.[0-9]+\.[0-9]+(?:-[^\s]+)?)/m);
	if (!match) {
		throw new Error(
			`Could not find a top-level version header in ${changelogPath}.`,
		);
	}
	return match[1];
}

function diffPackFiles(actualPaths) {
	const expected = new Set(EXPECTED_PACK_FILES);
	const actual = new Set(actualPaths);

	const missing = EXPECTED_PACK_FILES.filter((file) => !actual.has(file));
	const forbidden = actualPaths.filter((file) => !expected.has(file));

	return { missing, forbidden };
}

function fail(lines) {
	console.error(lines.join("\n"));
	process.exit(1);
}

function main() {
	const repoRoot = resolveRepoPath(".");
	const actualPaths = extractPackPaths(loadPackJson(repoRoot));
	const { missing, forbidden } = diffPackFiles(actualPaths);
	const { packageJson, packageJsonPath } = readPackageJson();
	const packageVersion = readPackageVersion(packageJson, packageJsonPath);
	const changelogVersion = readTopChangelogVersion();

	const errors = [...validatePackagePublicSurface(packageJson)];
	if (missing.length > 0) {
		errors.push("Missing pack files:", ...missing.map((file) => `- ${file}`));
	}
	if (forbidden.length > 0) {
		errors.push(
			"Forbidden pack files:",
			...forbidden.map((file) => `- ${file}`),
		);
	}
	if (packageVersion !== changelogVersion) {
		errors.push(
			`package.json version ${packageVersion} does not match top CHANGELOG version ${changelogVersion}.`,
		);
	}

	if (errors.length > 0) {
		fail(["Pack invariants failed.", ...errors]);
	}

	console.log(
		`Pack invariants OK: ${EXPECTED_PACK_FILES.length} expected files and version ${packageVersion}.`,
	);
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	fail(["Pack invariants failed.", message]);
}
