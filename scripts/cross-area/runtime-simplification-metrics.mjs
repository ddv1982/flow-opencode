#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const runtimeRoot = path.join(repoRoot, "src", "runtime");
const windowDays = Number.parseInt(process.env.FLOW_SIMPLIFICATION_WINDOW_DAYS ?? "30", 10);
const sinceArg = `${windowDays}.days`;

function toPosix(filePath) {
	return filePath.split(path.sep).join("/");
}

function listTsFiles(root) {
	if (!existsSync(root)) return [];
	const stack = [root];
	const files = [];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		for (const entry of readdirSync(current).sort((a, b) => a.localeCompare(b))) {
			const absolute = path.join(current, entry);
			const stats = statSync(absolute);
			if (stats.isDirectory()) {
				stack.push(absolute);
				continue;
			}
			if (entry.endsWith(".ts") || entry.endsWith(".tsx") || entry.endsWith(".mts")) {
				files.push(absolute);
			}
		}
	}
	return files.sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function countLines(filePath) {
	const content = readFileSync(filePath, "utf8");
	if (content.length === 0) return 0;
	return content.split(/\r?\n/).length;
}

function getRuntimeChurnByFile() {
	const output = execSync(
		`git log --since='${sinceArg}' --name-only --pretty=format: -- src/runtime`,
		{ cwd: repoRoot, encoding: "utf8" },
	);
	const counts = new Map();
	for (const line of output.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("src/runtime/")) continue;
		counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
	}
	return counts;
}

function getSeamViolationCount() {
	const output = execSync("bun run check:architecture-seams", {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const match = output.match(/Detected\s+(\d+)\s+blocked cross-layer import/);
	if (!match) return 0;
	return Number.parseInt(match[1], 10);
}

function runtimeSubdomainForFile(file) {
	const relativeRuntimePath = file.replace(/^src\/runtime\//, "");
	const [firstSegment] = relativeRuntimePath.split("/");
	return relativeRuntimePath === firstSegment ? "root" : firstSegment;
}

function summarizeSubdomains(runtimeFiles, largeFileThreshold) {
	const summaries = new Map();
	for (const entry of runtimeFiles) {
		const subdomain = runtimeSubdomainForFile(entry.file);
		const summary = summaries.get(subdomain) ?? {
			fileCount: 0,
			loc: 0,
			largeFileCount: 0,
		};
		summary.fileCount += 1;
		summary.loc += entry.loc;
		if (entry.loc >= largeFileThreshold) {
			summary.largeFileCount += 1;
		}
		summaries.set(subdomain, summary);
	}

	return Object.fromEntries(
		[...summaries.entries()].sort(([a], [b]) => a.localeCompare(b)),
	);
}

function main() {
	const runtimeFiles = listTsFiles(runtimeRoot).map((filePath) => {
		const rel = toPosix(path.relative(repoRoot, filePath));
		const loc = countLines(filePath);
		return { file: rel, loc };
	});

	const totalRuntimeLoc = runtimeFiles.reduce((sum, entry) => sum + entry.loc, 0);
	const largeFileThreshold = 300;
	const largeFiles = runtimeFiles.filter((entry) => entry.loc >= largeFileThreshold);
	const largest = [...runtimeFiles]
		.sort((a, b) => b.loc - a.loc || a.file.localeCompare(b.file))
		.slice(0, 5);
	const subdomains = summarizeSubdomains(runtimeFiles, largeFileThreshold);
	const top5Loc = largest.reduce((sum, entry) => sum + entry.loc, 0);
	const top5LocShare = totalRuntimeLoc === 0 ? 0 : Number(((top5Loc / totalRuntimeLoc) * 100).toFixed(1));

	const churn = getRuntimeChurnByFile();
	const topChurn = [...churn.entries()]
		.map(([file, changes]) => ({ file, changes }))
		.sort((a, b) => b.changes - a.changes || a.file.localeCompare(b.file))
		.slice(0, 5);

	const output = {
		capturedAt: new Date().toISOString(),
		windowDays,
		seamViolationCount: getSeamViolationCount(),
		runtime: {
			fileCount: runtimeFiles.length,
			totalLoc: totalRuntimeLoc,
			largeFileThreshold,
			largeFileCount: largeFiles.length,
			top5LocSharePercent: top5LocShare,
			largestFiles: largest,
			topChurnFiles: topChurn,
			subdomains,
		},
	};

	console.log(JSON.stringify(output, null, 2));
}

main();
