#!/usr/bin/env node

// Release smoke: builds the distributable artifacts, then runs the npm install
// smoke against a freshly packed tarball and stores the evidence files.

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultEvidenceDir = join(
	projectRoot,
	".release-artifacts",
	"release-smoke",
);

function parseArgs(argv) {
	const options = { evidenceDir: defaultEvidenceDir, skipBuild: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--output-dir" || arg === "--evidence-dir") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error(`${arg} requires a path.`);
			}
			options.evidenceDir = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--skip-build") {
			options.skipBuild = true;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function run(cmd, args) {
	const result = spawnSync(cmd, args, {
		cwd: projectRoot,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		throw new Error(`${cmd} ${args.join(" ")} failed (${result.status}).`);
	}
}

const options = parseArgs(process.argv.slice(2));
if (!options.skipBuild) {
	run("bun", ["run", "build"]);
}
run("node", [
	join(projectRoot, "scripts", "cross-area", "opencode-smoke.mjs"),
	"--evidence-dir",
	options.evidenceDir,
]);
console.log(`Release smoke evidence written to ${options.evidenceDir}`);
