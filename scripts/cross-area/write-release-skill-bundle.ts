#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveFlowSkillBundleFiles } from "../../src/adapters/opencode/skill-bundle";

const outputRoot = process.argv[2];

if (!outputRoot) {
	throw new Error("Usage: write-release-skill-bundle.ts <output-root>");
}

const resolvedOutputRoot = resolve(outputRoot);
for (const file of resolveFlowSkillBundleFiles(resolvedOutputRoot)) {
	await mkdir(dirname(file.absolutePath), { recursive: true });
	await writeFile(file.absolutePath, file.content, "utf8");
}
