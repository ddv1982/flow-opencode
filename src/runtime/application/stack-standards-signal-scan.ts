import { join } from "node:path";
import { pathExists, readText } from "../json/json-like";
import type { StackProfile, StandardsProfile } from "../schema";
import { scanKnownStandardsConfigDetails } from "./stack-standards-config-details";
import {
	addRule,
	addSignal,
	relativeRef,
} from "./stack-standards-profile-helpers";
import { CONFIG_SIGNALS, TEXT_SIGNALS } from "./stack-standards-signals";

export async function scanTextSignals(
	root: string,
	workspaceRoot: string,
	stackProfile: StackProfile,
	standardsProfile: StandardsProfile,
) {
	for (const signal of TEXT_SIGNALS) {
		const absolutePath = join(root, signal.file);
		const contents = await readText(absolutePath);
		if (contents && signal.pattern.test(contents)) {
			const ref = relativeRef(workspaceRoot, absolutePath);
			addSignal(stackProfile, signal.bucket, signal.name, ref, "high");
			if (signal.bucket === "tools" || signal.bucket === "packageManagers") {
				addRule(
					standardsProfile,
					`Use ${signal.name} configuration from ${ref} when applicable.`,
					[ref],
					"local",
				);
			}
		}
	}
}

export async function scanConfigSignals(
	root: string,
	workspaceRoot: string,
	stackProfile: StackProfile,
	standardsProfile: StandardsProfile,
) {
	for (const signal of CONFIG_SIGNALS) {
		const absolutePath = join(root, signal.file);
		if (await pathExists(absolutePath)) {
			const ref = relativeRef(workspaceRoot, absolutePath);
			addSignal(stackProfile, signal.bucket, signal.name, ref, "high");
			if (signal.bucket === "tools") {
				addRule(
					standardsProfile,
					`Use ${signal.name} configuration from ${ref} when applicable.`,
					[ref],
					"local",
				);
			}
			await scanKnownStandardsConfigDetails(
				signal.file,
				absolutePath,
				ref,
				standardsProfile,
			);
		}
	}
}
