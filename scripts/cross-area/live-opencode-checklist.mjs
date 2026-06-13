#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const defaultOutput = path.join(
	repoRoot,
	".release-artifacts",
	"release-smoke",
	"manual-live-opencode-checklist.md",
);

function parseArgs(argv) {
	const options = { output: defaultOutput, version: null, tarball: null };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--output") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--output requires a path.");
			}
			options.output = path.resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--version") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--version requires a value.");
			}
			options.version = value;
			index += 1;
			continue;
		}
		if (arg === "--tarball") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--tarball requires a path.");
			}
			options.tarball = path.resolve(value);
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function packageVersion() {
	const manifest = JSON.parse(
		readFileSync(path.join(repoRoot, "package.json"), "utf8"),
	);
	return manifest.version;
}

function renderChecklist({ version, tarball }) {
	const installSpec = tarball ? tarball : `opencode-plugin-flow@${version}`;
	return [
		"# Manual live OpenCode validation checklist",
		"",
		"This checklist is evidence scaffolding only. It is not proof of live validation until a maintainer fills in the observed results from a real OpenCode host.",
		"",
		`Version under test: ${version}`,
		`Install spec: ${installSpec}`,
		"",
		"## Setup",
		"",
		"- [ ] Use a disposable project/worktree.",
		"- [ ] Add the install spec above to that project's `opencode.json` `plugin` array.",
		"- [ ] Restart OpenCode once so the plugin installs and syncs skills, commands, and the reviewer agent.",
		"- [ ] Restart OpenCode a second time if this is a first install or update and freshly synced files need discovery.",
		"",
		"## Checks",
		"",
		"- [ ] `/flow-status` is available and reports the expected plugin version.",
		"- [ ] `/flow-plan Live smoke: verify Flow can create a plan in OpenCode` creates a persisted Flow session under the disposable project.",
		"- [ ] `/flow-status` reports the active session and suggested next step.",
		"- [ ] Ask for Flow history; `flow_session` can read the active session/history without direct `.flow/**` edits.",
		"- [ ] Close the session as abandoned through the Flow session surface.",
		"- [ ] Run `bunx opencode-plugin-flow uninstall` or equivalent against the tested install and remove the plugin entry.",
		"",
		"## Evidence to record",
		"",
		"- OpenCode version:",
		"- Flow version shown by `/flow-status`:",
		"- Disposable project path:",
		"- Commands observed:",
		"- Tools observed or exercised:",
		"- Session path created:",
		"- Uninstall result:",
		"- Errors, warnings, or residual risk:",
		"",
	].join("\n");
}

const options = parseArgs(process.argv.slice(2));
const version = options.version ?? packageVersion();
const checklist = renderChecklist({ version, tarball: options.tarball });
mkdirSync(path.dirname(options.output), { recursive: true });
writeFileSync(options.output, checklist);
console.log(`Manual live OpenCode checklist written to ${options.output}`);
