#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const tests = [
	"tests/runtime/plan-and-tool-schema-contracts.test.ts",
	"tests/config/prompt-contracts.test.ts",
];

const result = spawnSync("bun", ["test", ...tests], {
	cwd: repoRoot,
	stdio: "inherit",
});

if ((result.status ?? 1) !== 0) {
	console.warn(
		"[boundary-report] Boundary checks reported violations (report-only in Phase 0).",
	);
	console.warn(
		"[boundary-report] TODO(Track B): promote this report to an enforcing CI gate.",
	);
}

process.exit(0);
