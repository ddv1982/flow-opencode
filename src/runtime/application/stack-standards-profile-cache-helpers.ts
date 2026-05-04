import { join, relative } from "node:path";
import { getFlowDir } from "../paths";
import type { PackageManager, StackProfile } from "../schema";
import { resolveWorkspaceStartDirectory } from "./workspace-boundaries";

const STACK_STANDARDS_PROFILE_CACHE_FILE = "standards-profile.json";
const EXTERNAL_GUIDANCE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type PackageManagerHint = {
	packageManager?: PackageManager | undefined;
	ambiguous: boolean;
};

export function cacheStartDirectoryKey(
	resolvedRoot: string,
	startDirectory?: string,
): string {
	const resolvedStart = resolveWorkspaceStartDirectory(
		resolvedRoot,
		startDirectory,
	);
	const key = relative(resolvedRoot, resolvedStart);
	return key.length > 0 ? key : ".";
}

export function stackStandardsProfileCachePath(workspaceRoot: string): string {
	return join(getFlowDir(workspaceRoot), STACK_STANDARDS_PROFILE_CACHE_FILE);
}

export function packageManagerHintsEqual(
	left: PackageManagerHint,
	right: PackageManagerHint,
): boolean {
	return (
		left.packageManager === right.packageManager &&
		left.ambiguous === right.ambiguous
	);
}

export function cacheHasExpiredExternalGuidance(cache: {
	generatedAt: string;
	profile: {
		standardsProfile?: {
			externalGuidance: unknown[];
			rules: Array<{ priority?: string }>;
		};
	};
}): boolean {
	const standardsProfile = cache.profile.standardsProfile;
	if (!standardsProfile) {
		return false;
	}
	const hasExternalGuidance = standardsProfile.externalGuidance.length > 0;
	const hasExternalPriorityRule = standardsProfile.rules.some(
		(rule) => rule.priority === "official" || rule.priority === "external",
	);
	if (!hasExternalGuidance && !hasExternalPriorityRule) {
		return false;
	}
	const generatedAt = Date.parse(cache.generatedAt);
	return (
		Number.isNaN(generatedAt) ||
		Date.now() - generatedAt > EXTERNAL_GUIDANCE_CACHE_TTL_MS
	);
}

export function emptyStackProfile(): StackProfile {
	return {
		languages: [],
		frameworks: [],
		runtimes: [],
		packageManagers: [],
		tools: [],
	};
}
