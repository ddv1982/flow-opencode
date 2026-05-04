import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
	PackageManagerSchema,
	type PlanningContext,
	StackProfileSchema,
	StandardsProfileSchema,
} from "../schema";
import {
	buildProfileFingerprint,
	type StackStandardsFingerprint,
} from "./stack-standards-fingerprint";
import {
	cacheHasExpiredExternalGuidance,
	cacheStartDirectoryKey,
	type PackageManagerHint,
	packageManagerHintsEqual,
	stackStandardsProfileCachePath,
} from "./stack-standards-profile-cache-helpers";

const STACK_STANDARDS_PROFILE_CACHE_SCHEMA_VERSION = 3;

const StackStandardsProfileCacheSchema = z
	.object({
		schemaVersion: z.literal(STACK_STANDARDS_PROFILE_CACHE_SCHEMA_VERSION),
		generatedAt: z.string().datetime(),
		workspaceRoot: z.string().min(1),
		startDirectory: z.string().min(1),
		packageManagerHint: z
			.object({
				packageManager: PackageManagerSchema.optional(),
				ambiguous: z.boolean(),
			})
			.strict(),
		fingerprint: z
			.object({
				algorithm: z.literal("sha256"),
				hash: z.string().min(1),
				files: z.array(z.string().min(1)),
			})
			.strict(),
		profile: z
			.object({
				stackProfile: StackProfileSchema.optional(),
				standardsProfile: StandardsProfileSchema.optional(),
			})
			.strict(),
	})
	.strict();

type StackStandardsProfileCache = z.infer<
	typeof StackStandardsProfileCacheSchema
>;

export type StackStandardsProfileCacheValue = Pick<
	PlanningContext,
	"stackProfile" | "standardsProfile"
>;

type CacheLookupContext = {
	workspaceRoot: string;
	startDirectory: string;
	sourceStartDirectory?: string | undefined;
	packageManagerHint?: PackageManagerHint | undefined;
	cachePath: string;
};

type CacheContext = CacheLookupContext & {
	fingerprint: StackStandardsFingerprint;
};

export async function buildCacheContext(
	workspaceRoot: string,
	startDirectory: string | undefined,
	packageManagerHint?: PackageManagerHint,
): Promise<CacheContext> {
	const lookupContext = buildCacheLookupContext(
		workspaceRoot,
		startDirectory,
		packageManagerHint,
	);
	return {
		...lookupContext,
		fingerprint: await buildProfileFingerprint(
			lookupContext.workspaceRoot,
			lookupContext.sourceStartDirectory,
		),
	};
}

export function buildCacheLookupContext(
	workspaceRoot: string,
	startDirectory: string | undefined,
	packageManagerHint?: PackageManagerHint,
): CacheLookupContext {
	const resolvedRoot = resolve(workspaceRoot);
	return {
		workspaceRoot: resolvedRoot,
		startDirectory: cacheStartDirectoryKey(resolvedRoot, startDirectory),
		sourceStartDirectory: startDirectory,
		packageManagerHint,
		cachePath: stackStandardsProfileCachePath(resolvedRoot),
	};
}

export async function readValidStackStandardsProfileCacheForContext(
	context: CacheLookupContext,
): Promise<StackStandardsProfileCacheValue | null> {
	let cache: StackStandardsProfileCache;
	try {
		cache = StackStandardsProfileCacheSchema.parse(
			JSON.parse(await readFile(context.cachePath, "utf8")),
		);
	} catch {
		return null;
	}

	if (
		cache.workspaceRoot !== context.workspaceRoot ||
		cache.startDirectory !== context.startDirectory
	) {
		return null;
	}

	if (
		context.packageManagerHint &&
		!packageManagerHintsEqual(
			cache.packageManagerHint,
			context.packageManagerHint,
		)
	) {
		return null;
	}

	const ttlCheckProfile = cache.profile.standardsProfile
		? {
				standardsProfile: {
					externalGuidance: cache.profile.standardsProfile.externalGuidance,
					rules: cache.profile.standardsProfile.rules,
				},
			}
		: {};
	if (
		cacheHasExpiredExternalGuidance({
			generatedAt: cache.generatedAt,
			profile: ttlCheckProfile,
		})
	) {
		return null;
	}

	const fingerprint = await buildProfileFingerprint(
		context.workspaceRoot,
		context.sourceStartDirectory,
	);
	if (
		cache.fingerprint.algorithm !== fingerprint.algorithm ||
		cache.fingerprint.hash !== fingerprint.hash
	) {
		return null;
	}

	return cache.profile;
}

export async function writeStackStandardsProfileCacheForContext(
	context: CacheContext,
	profile: StackStandardsProfileCacheValue,
): Promise<void> {
	const cache: StackStandardsProfileCache = {
		schemaVersion: STACK_STANDARDS_PROFILE_CACHE_SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		workspaceRoot: context.workspaceRoot,
		startDirectory: context.startDirectory,
		packageManagerHint: context.packageManagerHint ?? { ambiguous: false },
		fingerprint: context.fingerprint,
		profile,
	};

	try {
		await mkdir(dirname(context.cachePath), { recursive: true });
		await writeJsonAtomically(context.cachePath, cache);
	} catch {
		// The cache is an optimization. Planning must keep working if writing it fails.
	}
}

async function writeJsonAtomically(
	targetPath: string,
	value: StackStandardsProfileCache,
): Promise<void> {
	const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		await rename(tempPath, targetPath);
	} catch (error) {
		await rm(tempPath, { force: true });
		throw error;
	}
}
