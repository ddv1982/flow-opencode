#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const result = spawnSync(
	"bun",
	[
		"test",
		"tests/runtime-completion-contracts.test.ts",
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
