#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const result = spawnSync(
	"bun",
	[
		"test",
		"tests/runtime/worker-result-contracts.test.ts",
		"tests/runtime/final-completion-gates.test.ts",
		"tests/runtime/final-review-contracts.test.ts",
		"tests/runtime/plan-and-tool-schema-contracts.test.ts",
		"tests/completion-gates.test.ts",
		"tests/runtime/semantic-invariants.test.ts",
		"tests/runtime-tools.test.ts",
		"tests/runtime.test.ts",
	],
	{
		cwd: repoRoot,
		stdio: "inherit",
	},
);

process.exit(result.status ?? 1);
