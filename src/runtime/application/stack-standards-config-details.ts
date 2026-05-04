import { readJsonLike } from "../json/json-like";
import type { StandardsProfile } from "../schema";
import { addRule, objectRecord } from "./stack-standards-profile-helpers";

export async function scanKnownStandardsConfigDetails(
	filename: string,
	absolutePath: string,
	ref: string,
	standardsProfile: StandardsProfile,
): Promise<void> {
	if (filename === "tsconfig.json") {
		const tsconfig = await readJsonLike<Record<string, unknown>>(absolutePath);
		const compilerOptions = objectRecord(tsconfig?.compilerOptions);
		const strictFlags = [
			"strict",
			"noUncheckedIndexedAccess",
			"exactOptionalPropertyTypes",
			"noImplicitOverride",
			"noFallthroughCasesInSwitch",
		]
			.filter((key) => compilerOptions?.[key] === true)
			.join(", ");
		if (strictFlags.length > 0) {
			addRule(
				standardsProfile,
				`Preserve TypeScript strictness from ${ref}: ${strictFlags}.`,
				[ref],
				"local",
			);
		}
		return;
	}

	if (filename === "biome.json") {
		const biome = await readJsonLike<Record<string, unknown>>(absolutePath);
		const formatter = objectRecord(biome?.formatter);
		const linter = objectRecord(biome?.linter);
		const linterRules = objectRecord(linter?.rules);
		const topLevelRules = objectRecord(biome?.rules);
		const suspicious =
			objectRecord(linterRules?.suspicious) ??
			objectRecord(topLevelRules?.suspicious);
		if (formatter?.enabled === true) {
			addRule(
				standardsProfile,
				`Use Biome formatter settings from ${ref}; do not introduce competing formatting tools without explicit approval.`,
				[ref],
				"local",
			);
		}
		if (
			linter?.enabled === true ||
			linter?.recommended === true ||
			linterRules?.recommended === true
		) {
			addRule(
				standardsProfile,
				`Use Biome lint settings from ${ref}, including recommended rules when enabled.`,
				[ref],
				"local",
			);
		}
		if (suspicious?.noConsole === "error") {
			addRule(
				standardsProfile,
				`Treat console usage as release-sensitive because ${ref} sets suspicious.noConsole to error unless an override applies.`,
				[ref],
				"local",
			);
		}
	}
}
