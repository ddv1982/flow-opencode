#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

const scanExtensions = new Set([
	".json",
	".md",
	".mjs",
	".sh",
	".ts",
	".yaml",
	".yml",
]);

const excludedDirectories = new Set([
	".git",
	".flow",
	".omx",
	"dist",
	"node_modules",
]);

const excludedFiles = new Set([
	"CHANGELOG.md",
	"bun.lock",
	"release-notes.md",
	"scripts/cross-area/fresh-surface-terminology.mjs",
]);

const excludedPrefixes = [
	"docs/plans/",
	"docs/releases/",
	"docs/investigations/",
];

const forbiddenPatterns = [
	{ label: "legacy", regex: /\blegacy\b/gi },
	{ label: "deprecated", regex: /\bdeprecated\b/gi },
	{ label: "compatibility", regex: /\b(?:in)?compatib(?:le|ility|ilities)\b/gi },
	{ label: "dead-code", regex: /\bdead[- ]code\b/gi },
	{ label: "shim", regex: /\bshims?\b/gi },
];

function toPosixPath(filePath) {
	return filePath.split(path.sep).join("/");
}

function extensionOf(filePath) {
	const extension = path.extname(filePath);
	return extension.length > 0 ? extension : "";
}

function shouldExclude(relativePath) {
	if (excludedFiles.has(relativePath)) {
		return true;
	}
	return excludedPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function collectFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory)) {
		if (excludedDirectories.has(entry)) {
			continue;
		}

		const absolutePath = path.join(directory, entry);
		const relativePath = toPosixPath(path.relative(repoRoot, absolutePath));
		const stat = statSync(absolutePath);
		if (stat.isDirectory()) {
			files.push(...collectFiles(absolutePath));
			continue;
		}
		if (!stat.isFile() || shouldExclude(relativePath)) {
			continue;
		}
		if (scanExtensions.has(extensionOf(relativePath))) {
			files.push(relativePath);
		}
	}
	return files;
}

function lineAndColumn(text, index) {
	const prefix = text.slice(0, index);
	const lines = prefix.split("\n");
	return {
		line: lines.length,
		column: (lines.at(-1)?.length ?? 0) + 1,
	};
}

function findViolations(relativePath) {
	const text = readFileSync(path.join(repoRoot, relativePath), "utf8");
	const violations = [];

	for (const pattern of forbiddenPatterns) {
		pattern.regex.lastIndex = 0;
		for (const match of text.matchAll(pattern.regex)) {
			const index = match.index ?? 0;
			const location = lineAndColumn(text, index);
			violations.push({
				path: relativePath,
				line: location.line,
				column: location.column,
				label: pattern.label,
				match: match[0],
			});
		}
	}

	return violations;
}

function main() {
	if (!existsSync(repoRoot)) {
		throw new Error(`Repository root does not exist: ${repoRoot}`);
	}

	const violations = collectFiles(repoRoot).flatMap(findViolations);
	if (violations.length === 0) {
		return;
	}

	const details = violations
		.map(
			(violation) =>
				`${violation.path}:${violation.line}:${violation.column} ${violation.label}: ${violation.match}`,
		)
		.join("\n");
	throw new Error(
		`Active surfaces must use fresh-architecture wording. Historical release/investigation docs are excluded.\n${details}`,
	);
}

main();
