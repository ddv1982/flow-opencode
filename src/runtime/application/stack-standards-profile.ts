import type { StandardsProfile } from "../schema";
import {
	scanDirectorySignals,
	scanGuidelineFiles,
} from "./stack-standards-detection-scanners";
import { scanPackageJson } from "./stack-standards-package-scan";
import {
	emptyStackProfile,
	type PackageManagerHint,
} from "./stack-standards-profile-cache-helpers";
import {
	buildCacheContext,
	buildCacheLookupContext,
	readValidStackStandardsProfileCacheForContext,
	type StackStandardsProfileCacheValue,
	writeStackStandardsProfileCacheForContext,
} from "./stack-standards-profile-cache-store";
import {
	addResearchGaps,
	addRule,
	addSignal,
	dedupeStackProfile,
	dedupeStandardsProfile,
	hasStackSignals,
	hasStandardsSignals,
	withStandardsPrecedence,
} from "./stack-standards-profile-helpers";
import {
	scanConfigSignals,
	scanTextSignals,
} from "./stack-standards-signal-scan";
import { candidateWorkspaceDirectories } from "./workspace-boundaries";

export type { StackStandardsProfileCacheValue } from "./stack-standards-profile-cache-store";

export async function detectStackAndStandardsProfile(
	workspaceRoot: string,
	startDirectory: string | undefined,
	packageManagerHint: PackageManagerHint,
): Promise<StackStandardsProfileCacheValue> {
	const cacheContext = await buildCacheContext(
		workspaceRoot,
		startDirectory,
		packageManagerHint,
	);
	const cachedProfile =
		await readValidStackStandardsProfileCacheForContext(cacheContext);
	if (cachedProfile) {
		return cachedProfile;
	}

	const roots = candidateWorkspaceDirectories(workspaceRoot, startDirectory);
	const stackProfile = emptyStackProfile();
	const standardsProfile: StandardsProfile = {
		localGuidelines: [],
		externalGuidance: [],
		rules: [],
		gaps: [],
		precedence: [],
	};

	if (packageManagerHint.packageManager) {
		addSignal(
			stackProfile,
			"packageManagers",
			packageManagerHint.packageManager,
			"flow_plan_start package-manager detection",
			"high",
		);
	}
	if (packageManagerHint.ambiguous) {
		addRule(
			standardsProfile,
			"Package-manager evidence is ambiguous; prefer existing package.json scripts over guessed manager-specific commands.",
			["flow_plan_start package-manager detection"],
			"local",
		);
	}

	for (const root of roots) {
		await scanPackageJson(root, workspaceRoot, stackProfile, standardsProfile);
		await scanConfigSignals(
			root,
			workspaceRoot,
			stackProfile,
			standardsProfile,
		);
		await scanTextSignals(root, workspaceRoot, stackProfile, standardsProfile);
		await scanDirectorySignals(root, workspaceRoot, stackProfile);
		await scanGuidelineFiles(root, workspaceRoot, standardsProfile);
	}

	const dedupedStackProfile = dedupeStackProfile(stackProfile);
	const dedupedStandardsProfile = dedupeStandardsProfile(standardsProfile);
	const standardsWithGaps = addResearchGaps(
		dedupedStandardsProfile,
		dedupedStackProfile,
	);

	const profile = {
		...(hasStackSignals(dedupedStackProfile)
			? { stackProfile: dedupedStackProfile }
			: {}),
		...(hasStandardsSignals(standardsWithGaps)
			? { standardsProfile: withStandardsPrecedence(standardsWithGaps) }
			: {}),
	};
	await writeStackStandardsProfileCacheForContext(cacheContext, profile);
	return profile;
}

export async function readValidStackStandardsProfileCache(
	workspaceRoot: string,
	startDirectory?: string,
	packageManagerHint?: PackageManagerHint,
): Promise<StackStandardsProfileCacheValue | null> {
	const cacheContext = buildCacheLookupContext(
		workspaceRoot,
		startDirectory,
		packageManagerHint,
	);
	return readValidStackStandardsProfileCacheForContext(cacheContext);
}

export async function writeStackStandardsProfileCache(
	workspaceRoot: string,
	startDirectory: string | undefined,
	packageManagerHint: PackageManagerHint,
	profile: StackStandardsProfileCacheValue,
): Promise<void> {
	const cacheContext = await buildCacheContext(
		workspaceRoot,
		startDirectory,
		packageManagerHint,
	);
	await writeStackStandardsProfileCacheForContext(cacheContext, profile);
}
