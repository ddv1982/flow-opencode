#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.env.FLOW_ARCH_METRICS_ROOT
	? path.resolve(process.env.FLOW_ARCH_METRICS_ROOT)
	: path.resolve(import.meta.dirname, "..", "..");

const sourceOwners = [
	"shared",
	"runtime",
	"distribution",
	"adapters",
	"entrypoints",
	"unclassified",
];

function toPosix(filePath) {
	return filePath.split(path.sep).join("/");
}

function parseArgs(argv) {
	const options = { json: false, output: null };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--output") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--output requires a path.");
			}
			options.output = path.resolve(value);
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function walkFiles(root, predicate = () => true) {
	if (!existsSync(root)) return [];
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
			if (predicate(absolute)) files.push(absolute);
		}
	}
	return files.sort();
}

function sourceOwner(filePath) {
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
	if (relative.startsWith("src/runtime/")) return "runtime";
	if (relative.startsWith("src/distribution/")) return "distribution";
	if (relative.startsWith("src/adapters/")) return "adapters";
	return "unclassified";
}

function countLines(filePath) {
	const content = readFileSync(filePath, "utf8");
	if (content.length === 0) return 0;
	return content.split(/\r?\n/).length;
}

function run(command, args, options = {}) {
	return spawnSync(command, args, {
		cwd: repoRoot,
		encoding: "utf8",
		...options,
	});
}

function stringArrayConst(content, constName) {
	const start = content.indexOf(`export const ${constName} = [`);
	if (start === -1) return [];
	const rest = content.slice(start);
	const end = rest.indexOf("] as const");
	const block = end === -1 ? rest : rest.slice(0, end);
	return [...block.matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function recordConstKeys(content, constName) {
	const start = content.indexOf(`export const ${constName} = {`);
	if (start === -1) return [];
	const rest = content.slice(start);
	const end = rest.indexOf("} satisfies");
	const block = end === -1 ? rest : rest.slice(0, end);
	const keys = [];
	const keyPattern = /\n\s*"([^"]+)":\s*\{/g;
	let match = keyPattern.exec(block);
	while (match) {
		keys.push(match[1]);
		match = keyPattern.exec(block);
	}
	return keys;
}

function seamViolationCount() {
	const result = run("node", [
		path.join(repoRoot, "scripts", "cross-area", "architecture-seams.mjs"),
	]);
	const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
	const match = output.match(/Detected (\d+) blocked cross-layer import/);
	return {
		status: result.status ?? 1,
		count: match ? Number(match[1]) : 0,
	};
}

function testFileSummary() {
	const files = walkFiles(path.join(repoRoot, "tests"), (file) =>
		/\.test(-d)?\.ts$/.test(file),
	);
	return {
		files: files.length,
	};
}

function packageSize() {
	const distIndex = path.join(repoRoot, "dist", "index.js");
	const distCli = path.join(repoRoot, "dist", "cli.js");
	return {
		distIndexBytes: existsSync(distIndex) ? statSync(distIndex).size : null,
		distCliBytes: existsSync(distCli) ? statSync(distCli).size : null,
	};
}

function collectMetrics() {
	const packageJson = JSON.parse(
		readFileSync(path.join(repoRoot, "package.json"), "utf8"),
	);
	const srcFiles = walkFiles(path.join(repoRoot, "src"), (file) =>
		/\.[mc]?[tj]sx?$/.test(file),
	);
	const ownerStats = Object.fromEntries(
		sourceOwners.map((owner) => [
			owner,
			{ files: 0, lines: 0, largestFiles: [] },
		]),
	);
	const allLargest = [];
	for (const filePath of srcFiles) {
		const owner = sourceOwner(filePath);
		const lines = countLines(filePath);
		const relative = toPosix(path.relative(repoRoot, filePath));
		ownerStats[owner].files += 1;
		ownerStats[owner].lines += lines;
		ownerStats[owner].largestFiles.push({ path: relative, lines });
		allLargest.push({ path: relative, lines, owner });
	}
	for (const stats of Object.values(ownerStats)) {
		stats.largestFiles = stats.largestFiles
			.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
			.slice(0, 5);
	}

	const skills = walkFiles(path.join(repoRoot, "skills"), (file) =>
		file.endsWith("SKILL.md"),
	).map((file) => toPosix(path.relative(repoRoot, file)));
	const configShared = readFileSync(
		path.join(repoRoot, "src", "config-shared.ts"),
		"utf8",
	);
	const runtimeConstants = readFileSync(
		path.join(repoRoot, "src", "runtime", "constants.ts"),
		"utf8",
	);
	const commands = recordConstKeys(configShared, "FLOW_CORE_COMMANDS");
	const agents = recordConstKeys(configShared, "FLOW_CORE_AGENTS");
	const tools = stringArrayConst(
		runtimeConstants,
		"CANONICAL_RUNTIME_TOOL_NAMES",
	);

	return {
		package: {
			name: packageJson.name,
			version: packageJson.version,
		},
		source: {
			totalFiles: srcFiles.length,
			totalLines: srcFiles.reduce((sum, file) => sum + countLines(file), 0),
			byOwner: ownerStats,
			largestFiles: allLargest
				.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
				.slice(0, 10),
		},
		surface: {
			skills: skills.length,
			skillFiles: skills,
			commands: commands.length,
			commandNames: commands.sort(),
			agents: agents.length,
			agentNames: agents.sort(),
			tools: tools.length,
			toolNames: tools.sort(),
		},
		seams: seamViolationCount(),
		tests: testFileSummary(),
		bundle: packageSize(),
	};
}

function renderMarkdown(metrics) {
	const lines = [
		"# Flow architecture metrics",
		"",
		`Package: ${metrics.package.name}@${metrics.package.version}`,
		"",
		"## Source owners",
		"",
		"| Owner | Files | Lines |",
		"| --- | ---: | ---: |",
	];
	for (const owner of sourceOwners) {
		const stats = metrics.source.byOwner[owner];
		lines.push(`| ${owner} | ${stats.files} | ${stats.lines} |`);
	}
	lines.push(
		"",
		`Total source files: ${metrics.source.totalFiles}`,
		`Total source lines: ${metrics.source.totalLines}`,
		"",
		"## Largest source files",
		"",
		"| Lines | Owner | Path |",
		"| ---: | --- | --- |",
	);
	for (const file of metrics.source.largestFiles) {
		lines.push(`| ${file.lines} | ${file.owner} | ${file.path} |`);
	}
	lines.push(
		"",
		"## Public workflow surface",
		"",
		`- Skills: ${metrics.surface.skills} (${metrics.surface.skillFiles.join(", ")})`,
		`- Commands: ${metrics.surface.commands} (${metrics.surface.commandNames.join(", ")})`,
		`- Agents: ${metrics.surface.agents} (${metrics.surface.agentNames.join(", ")})`,
		`- Tools: ${metrics.surface.tools} (${metrics.surface.toolNames.join(", ")})`,
		"",
		"## Guardrails",
		"",
		`- Architecture seam violations: ${metrics.seams.count}`,
		`- Test files: ${metrics.tests.files}`,
		`- dist/index.js bytes: ${metrics.bundle.distIndexBytes ?? "not built"}`,
		`- dist/cli.js bytes: ${metrics.bundle.distCliBytes ?? "not built"}`,
		"",
	);
	return `${lines.join("\n")}`;
}

const options = parseArgs(process.argv.slice(2));
const metrics = collectMetrics();
const rendered = options.json
	? `${JSON.stringify(metrics, null, 2)}\n`
	: renderMarkdown(metrics);
if (options.output) {
	writeFileSync(options.output, rendered);
}
process.stdout.write(rendered);
