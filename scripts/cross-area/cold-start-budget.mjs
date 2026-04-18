import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { tmpdir } from "node:os";

const thresholdMs = 150;
const iterations = 7;
const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const distEntry = path.join(projectRoot, "dist", "index.js");
const tempRoots = [];

function makeTempRoot(prefix) {
	const dir = mkdtempSync(path.join(tmpdir(), prefix));
	tempRoots.push(dir);
	return dir;
}

async function importBuiltPlugin(uniqueSuffix) {
	const packageDir = makeTempRoot("flow-cold-start-package-");
	writeFileSync(
		path.join(packageDir, "package.json"),
		JSON.stringify({ type: "module" }, null, 2),
	);

	const peerDir = path.join(packageDir, "node_modules", "@opencode-ai", "plugin");
	mkdirSync(peerDir, { recursive: true });
	writeFileSync(
		path.join(peerDir, "package.json"),
		JSON.stringify(
			{
				name: "@opencode-ai/plugin",
				version: "0.0.0-test",
				type: "module",
				exports: "./index.js",
			},
			null,
			2,
		),
	);
	writeFileSync(
		path.join(peerDir, "index.js"),
		[
			"export function tool(definition) {",
			"  return definition;",
			"}",
			"tool.schema = {",
			"  string: (options = {}) => ({ type: 'string', ...options }),",
			"  number: (options = {}) => ({ type: 'number', ...options }),",
			"  boolean: (options = {}) => ({ type: 'boolean', ...options }),",
			"  enum: (values, options = {}) => ({ type: 'enum', values, ...options }),",
			"  array: (item, options = {}) => ({ type: 'array', item, ...options }),",
			"  object: (shape, options = {}) => ({ type: 'object', shape, ...options }),",
			"};",
		].join("\n"),
	);

	const startedAt = performance.now();
	await import(`file://${distEntry}?cold-start=${uniqueSuffix}`);
	return performance.now() - startedAt;
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

try {
	const durations = [];
	for (let index = 0; index < iterations; index += 1) {
		durations.push(await importBuiltPlugin(`${Date.now()}-${index}`));
	}

	const medianMs = median(durations);
	const result = {
		iterations,
		thresholdMs,
		medianMs: Number(medianMs.toFixed(2)),
		durationsMs: durations.map((value) => Number(value.toFixed(2))),
	};

	if (medianMs >= thresholdMs) {
		console.error(JSON.stringify(result, null, 2));
		process.exit(1);
	}

	console.log(JSON.stringify(result, null, 2));
} finally {
	for (const dir of tempRoots) {
		rmSync(dir, { recursive: true, force: true });
	}
}
