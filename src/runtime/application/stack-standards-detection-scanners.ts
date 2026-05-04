import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathExists } from "../json/json-like";
import type { StackProfile, StandardsProfile } from "../schema";
import {
	addRule,
	addSignal,
	relativeRef,
} from "./stack-standards-profile-helpers";
import { GUIDELINE_FILES } from "./stack-standards-signals";

export async function scanDirectorySignals(
	root: string,
	workspaceRoot: string,
	stackProfile: StackProfile,
) {
	let entries: string[];
	try {
		entries = await readdir(root);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.endsWith(".csproj")) {
			const ref = relativeRef(workspaceRoot, join(root, entry));
			addSignal(stackProfile, "languages", "C#", ref, "high");
			addSignal(stackProfile, "frameworks", ".NET", ref, "high");
			addSignal(stackProfile, "tools", "dotnet", ref, "high");
		}
	}
}

export async function scanGuidelineFiles(
	root: string,
	workspaceRoot: string,
	standardsProfile: StandardsProfile,
) {
	for (const file of GUIDELINE_FILES) {
		const absolutePath = join(root, file);
		if (!(await pathExists(absolutePath))) {
			continue;
		}
		const reference = relativeRef(workspaceRoot, absolutePath);
		standardsProfile.localGuidelines.push({
			title: basename(file),
			sourceType: "local",
			reference,
			confidence: "high",
		});
		addRule(
			standardsProfile,
			`Honor local project guidance from ${reference}.`,
			[reference],
			"local",
		);
	}
}
