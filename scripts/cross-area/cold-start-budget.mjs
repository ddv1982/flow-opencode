import {
	copyFileSync,
	cpSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const thresholdMs = 150;
const iterations = 7;
// Measured locally before rebuilding dist for Item 9 on 2026-06-01 from the
// existing 2.0.52 package artifact in this worktree. This is informational:
// the hard release gate remains thresholdMs. The comparison fields are named
// as local recorded measurements because CI runners may have different timing.
const localRecordedPreRebuildMainMedianMs = 32.66;
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

	const bundledEntry = path.join(packageDir, "index.js");
	copyFileSync(distEntry, bundledEntry);

	const peerDir = path.join(
		packageDir,
		"node_modules",
		"@opencode-ai",
		"plugin",
	);
	cpSync(
		path.join(projectRoot, "node_modules", "@opencode-ai", "plugin"),
		peerDir,
		{
			recursive: true,
		},
	);
	const zodDir = path.join(packageDir, "node_modules", "zod");
	cpSync(path.join(projectRoot, "node_modules", "zod"), zodDir, {
		recursive: true,
	});

	const startedAt = performance.now();
	await import(`file://${bundledEntry}?cold-start=${uniqueSuffix}`);
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
	const medianRounded = Number(medianMs.toFixed(2));
	const result = {
		iterations,
		thresholdMs,
		localRecordedPreRebuildMainMedianMs,
		medianMs: medianRounded,
		deltaFromLocalRecordedPreRebuildMainMs: Number(
			(medianMs - localRecordedPreRebuildMainMedianMs).toFixed(2),
		),
		improvedFromLocalRecordedPreRebuildMain:
			medianMs < localRecordedPreRebuildMainMedianMs,
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
