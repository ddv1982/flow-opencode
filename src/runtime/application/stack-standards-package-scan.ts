import { join } from "node:path";
import { readJson } from "../json/json-like";
import type { StackProfile, StandardsProfile } from "../schema";
import {
	addRule,
	addSignal,
	relativeRef,
} from "./stack-standards-profile-helpers";
import {
	DEPENDENCY_SIGNALS,
	SCRIPT_TOOL_SIGNALS,
} from "./stack-standards-signals";

type PackageJson = {
	packageManager?: unknown;
	scripts?: Record<string, unknown>;
	dependencies?: Record<string, unknown>;
	devDependencies?: Record<string, unknown>;
	peerDependencies?: Record<string, unknown>;
};

export async function scanPackageJson(
	root: string,
	workspaceRoot: string,
	stackProfile: StackProfile,
	standardsProfile: StandardsProfile,
) {
	const path = join(root, "package.json");
	const ref = relativeRef(workspaceRoot, path);
	const packageJson = await readJson<PackageJson>(path);
	if (!packageJson) {
		return;
	}

	addSignal(stackProfile, "runtimes", "Node.js", ref, "medium");
	addSignal(stackProfile, "languages", "JavaScript", ref, "medium");
	for (const [dependency, signal] of Object.entries(DEPENDENCY_SIGNALS)) {
		if (hasDependency(packageJson, dependency)) {
			addSignal(stackProfile, signal.bucket, signal.name, ref, "high");
		}
	}

	for (const command of Object.values(packageJson.scripts ?? {})) {
		if (typeof command !== "string") {
			continue;
		}
		for (const [pattern, name] of SCRIPT_TOOL_SIGNALS) {
			if (pattern.test(command)) {
				addSignal(
					stackProfile,
					name === "Bun" ? "runtimes" : "tools",
					name,
					ref,
					"medium",
				);
			}
		}
	}

	if (packageJson.scripts && Object.keys(packageJson.scripts).length > 0) {
		for (const [name, command] of Object.entries(packageJson.scripts)) {
			if (typeof command !== "string") {
				continue;
			}
			if (/^build(?::|$)/u.test(name)) {
				addRule(
					standardsProfile,
					`Use package.json script '${name}' for build validation when applicable.`,
					[ref],
					"local",
				);
			}
			if (/^(lint|check)(?::|$)/u.test(name)) {
				addRule(
					standardsProfile,
					`Use package.json script '${name}' for lint/static checks when applicable.`,
					[ref],
					"local",
				);
			}
			if (/^test(?::|$)/u.test(name)) {
				addRule(
					standardsProfile,
					`Use package.json script '${name}' for tests when applicable.`,
					[ref],
					"local",
				);
			}
		}
		addRule(
			standardsProfile,
			"Use existing package.json scripts for build, lint, test, and validation before inventing raw commands.",
			[ref],
			"local",
		);
	}
}

function hasDependency(packageJson: PackageJson, dependency: string): boolean {
	return Boolean(
		packageJson.dependencies?.[dependency] ??
			packageJson.devDependencies?.[dependency] ??
			packageJson.peerDependencies?.[dependency],
	);
}
