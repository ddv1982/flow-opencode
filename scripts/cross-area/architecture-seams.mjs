#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.env.FLOW_ARCH_SEAMS_ROOT
	? path.resolve(process.env.FLOW_ARCH_SEAMS_ROOT)
	: path.resolve(import.meta.dirname, "..", "..");
const enforce =
	process.env.FLOW_ARCH_SEAMS_MODE === "enforce" ||
	process.env.FLOW_ARCH_SEAMS_ENFORCE === "1";

const sourceRoots = [path.join(repoRoot, "src")];
const moduleFileExtensions = [
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
];

const deniedEdges = new Set([
	"shared->workflow",
	"shared->runtime",
	"shared->distribution",
	"shared->adapters",
	"shared->entrypoints",
	"core->shared",
	"core->workflow",
	"core->runtime",
	"core->distribution",
	"core->adapters",
	"core->entrypoints",
	"workflow->shared",
	"workflow->runtime",
	"workflow->distribution",
	"workflow->adapters",
	"workflow->entrypoints",
	"runtime->distribution",
	"runtime->adapters",
	"runtime->entrypoints",
	"distribution->runtime",
	"distribution->adapters",
	"distribution->entrypoints",
	"adapters->entrypoints",
]);

function toPosix(filePath) {
	return filePath.split(path.sep).join("/");
}

function listTsFiles(root) {
	if (!existsSync(root)) {
		return [];
	}
	const pending = [root];
	const files = [];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) continue;
		for (const entry of readdirSync(current)) {
			const absolute = path.join(current, entry);
			const stats = statSync(absolute);
			if (stats.isDirectory()) {
				pending.push(absolute);
				continue;
			}
			if (
				entry.endsWith(".ts") ||
				entry.endsWith(".tsx") ||
				entry.endsWith(".mts")
			) {
				files.push(absolute);
			}
		}
	}
	return files;
}

function layerFromPath(filePath) {
	const relative = toPosix(path.relative(repoRoot, filePath));
	const withoutExtension = relative.replace(/\.[mc]?[tj]sx?$/, "");
	if (withoutExtension === "src/config-shared") return "shared";
	if (
		withoutExtension === "src/index" ||
		withoutExtension === "src/config" ||
		withoutExtension === "src/cli"
	) {
		return "entrypoints";
	}
	if (relative.startsWith("src/core/")) return "core";
	if (relative.startsWith("src/workflow/")) return "workflow";
	if (relative.startsWith("src/runtime/")) return "runtime";
	if (relative.startsWith("src/distribution/")) return "distribution";
	if (relative.startsWith("src/adapters/")) return "adapters";
	return null;
}

function collectModuleSpecifiers(content) {
	const specifiers = [];
	const importExportPattern =
		/(?:import|export)\s+(?:type\s+)?[^;]*?from\s+["']([^"']+)["']/g;
	const sideEffectPattern = /import\s+["']([^"']+)["']/g;
	const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

	for (const pattern of [
		importExportPattern,
		sideEffectPattern,
		dynamicImportPattern,
	]) {
		let match = pattern.exec(content);
		while (match) {
			specifiers.push(match[1]);
			match = pattern.exec(content);
		}
	}
	return specifiers;
}

function resolveRelativeImport(sourceFile, specifier) {
	if (!specifier.startsWith(".")) {
		return null;
	}
	const resolved = path.resolve(path.dirname(sourceFile), specifier);
	return resolveModulePath(resolved);
}

function candidateModulePaths(resolved) {
	const extension = path.extname(resolved);
	const paths = [];
	if (extension) {
		paths.push(resolved);
		const withoutExtension = resolved.slice(0, -extension.length);
		for (const candidateExtension of moduleFileExtensions) {
			paths.push(`${withoutExtension}${candidateExtension}`);
		}
	} else {
		paths.push(resolved);
		for (const candidateExtension of moduleFileExtensions) {
			paths.push(`${resolved}${candidateExtension}`);
		}
		for (const candidateExtension of moduleFileExtensions) {
			paths.push(path.join(resolved, `index${candidateExtension}`));
		}
	}
	return paths;
}

function resolveModulePath(resolved) {
	for (const candidate of candidateModulePaths(resolved)) {
		if (!existsSync(candidate)) continue;
		const stats = statSync(candidate);
		if (stats.isFile()) {
			return candidate;
		}
	}
	return resolved;
}

function checkSeams() {
	const files = sourceRoots.flatMap((root) => listTsFiles(root));
	const violations = [];

	for (const filePath of files) {
		const sourceLayer = layerFromPath(filePath);
		if (!sourceLayer) continue;

		const content = readFileSync(filePath, "utf8");
		const specifiers = collectModuleSpecifiers(content);

		for (const specifier of specifiers) {
			const resolved = resolveRelativeImport(filePath, specifier);
			if (!resolved) continue;

			const targetLayer = layerFromPath(resolved);
			if (!targetLayer) continue;

			if (sourceLayer === targetLayer) continue;
			const edge = `${sourceLayer}->${targetLayer}`;
			if (!deniedEdges.has(edge)) continue;

			violations.push({
				edge,
				source: toPosix(path.relative(repoRoot, filePath)),
				target: toPosix(path.relative(repoRoot, resolved)),
				specifier,
			});
		}
	}

	return violations;
}

function printSummary(violations) {
	if (violations.length === 0) {
		console.log(
			`Architecture seams OK (${enforce ? "enforce" : "report"} mode): no blocked cross-layer imports detected.`,
		);
		return;
	}

	const heading = enforce
		? "Architecture seam contract violations detected."
		: "Architecture seam contract report (report-only mode).";
	console.log(heading);
	console.log(
		`Detected ${violations.length} blocked cross-layer import${violations.length === 1 ? "" : "s"}.`,
	);
	for (const violation of violations) {
		console.log(
			`- [${violation.edge}] ${violation.source} imports ${violation.specifier} (targets ${violation.target})`,
		);
	}
	if (!enforce) {
		console.log(
			"Report-only mode does not fail CI. Set FLOW_ARCH_SEAMS_MODE=enforce (or FLOW_ARCH_SEAMS_ENFORCE=1) to hard-fail.",
		);
	}
}

function main() {
	const violations = checkSeams();
	printSummary(violations);
	if (enforce && violations.length > 0) {
		process.exit(1);
	}
}

main();
