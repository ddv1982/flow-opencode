import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { canonicalJson } from "../evals/canonical-json.js";
import { samePackedArtifact } from "../evals/provenance.js";
import type { ArtifactIdentity } from "../evals/report.js";
import {
	assertPatchPaths,
	PatchReleaseSchema,
	releaseGit,
} from "./patch-release.js";
import { assertStrictReleaseEvidence } from "./release-metadata.js";

/**
 * Every offline feature release is measured against this baseline, the last
 * release with a live multi-provider campaign and canary. Offline releases do
 * not become baselines: chaining one onto another would let the newest measured
 * evidence silently recede while each record still claimed a qualified parent.
 */
export const OFFLINE_FEATURE_BASELINE = "8.3.0";

export const REVIEWER_PICKER_COMMIT =
	"ff605d9bb7e814cddd4d22f7e55ca251f8de60bc";
export const REVIEWER_PICKER_FILES = [
	"skills/flow-run/SKILL.md",
	"package.json",
	"tsconfig.types.json",
	"scripts/lib/package-surface.ts",
	"src/config-shared.ts",
	"src/platform/opencode/config.ts",
	"src/platform/opencode/plugin.ts",
	"src/platform/opencode/sdk.ts",
	"src/platform/opencode/tools.ts",
	"src/platform/opencode/reviewer-picker.ts",
	"src/tui.ts",
] as const;

export const PLANNING_MODELS_COMMIT =
	"c0064dc68cb7f8424ed4d5673b3faad9580d1dac";
export const PLANNING_MODELS_FILES = [
	"skills/flow-plan/SKILL.md",
	"skills/flow-run/SKILL.md",
	"package.json",
	"tsconfig.types.json",
	"scripts/lib/package-surface.ts",
	"src/config-shared.ts",
	"src/prompt-surfaces.ts",
	"src/platform/opencode/config.ts",
	"src/platform/opencode/model-picker.ts",
	"src/platform/opencode/plugin.ts",
	"src/platform/opencode/sdk.ts",
	"src/platform/opencode/tools.ts",
	"src/tui.ts",
] as const;

/**
 * 8.6.0 announces the `/flow-reviewer` deprecation so 9.0.0 may remove it: the
 * cadence rule requires one release to carry the notice first. The frozen
 * surface is the same picker code 8.5.0 froze, so this entry reuses that list
 * and only advances the reviewed commit.
 */
export const REVIEWER_DEPRECATION_COMMIT =
	"4c59cdd3d6a0065f3fc79fabc5e19df3f9004c80";

/**
 * 9.0.0 removes `/flow-reviewer`, which 8.6.0 announced as deprecated. The
 * frozen surface is again the same picker code, so this entry reuses that list
 * and only advances the reviewed commit.
 */
export const REVIEWER_REMOVAL_COMMIT =
	"f2d92b80f9caab422646235e3d3eb7e7e319c361";

/**
 * 9.0.1 ships the runtime refactor (#88-#92): the application, persistence
 * and auto-drive layers split by responsibility with no new surface. It cannot
 * reuse an earlier list because the refactor touched most of the runtime, so
 * this entry freezes every `src/` file that differs from the 8.3.0 baseline.
 * That is the widest frozen scope any offline release has claimed.
 */
export const RUNTIME_REFACTOR_COMMIT =
	"8d275b7b02708e1a2a9cde65c03029a0f074f373";
export const RUNTIME_REFACTOR_FILES = [
	"skills/flow-plan/SKILL.md",
	"skills/flow-run/SKILL.md",
	"package.json",
	"tsconfig.types.json",
	"scripts/lib/package-surface.ts",
	"src/application/delivery.ts",
	"src/application/flow-service.ts",
	"src/application/prepare-validation.ts",
	"src/application/session-close.ts",
	"src/application/session-projection.ts",
	"src/config-shared.ts",
	"src/domain/operation.ts",
	"src/domain/review-readiness.ts",
	"src/domain/session-invariants.ts",
	"src/domain/session-queries.ts",
	"src/domain/transitions.ts",
	"src/domain/validation.ts",
	"src/infrastructure/fs/managed-fs.ts",
	"src/infrastructure/fs/session-lock.ts",
	"src/infrastructure/fs/session-repository.ts",
	"src/infrastructure/fs/source-identity.ts",
	"src/infrastructure/fs/workspace-paths.ts",
	"src/infrastructure/fs/workspace.ts",
	"src/platform/opencode/auto-drive-decision.ts",
	"src/platform/opencode/auto-drive.ts",
	"src/platform/opencode/command-hook.ts",
	"src/platform/opencode/config.ts",
	"src/platform/opencode/model-picker.ts",
	"src/platform/opencode/plugin.ts",
	"src/platform/opencode/sdk.ts",
	"src/platform/opencode/tool-guard.ts",
	"src/platform/opencode/tools.ts",
	"src/prompt-surfaces.ts",
	"src/tui.ts",
] as const;

export type OfflineFeature = Readonly<{
	version: string;
	feature: string;
	reviewedCommit: string;
	files: readonly string[];
	guidance: readonly string[];
	/**
	 * The baseline seal retained for this release. The grader closure covers
	 * prompt surfaces and guides, so a feature that edits them invalidates every
	 * earlier seal. Each entry therefore keeps its own regrade of the same
	 * original 8.3.0 evidence, and the directory is code-owned so no record or
	 * command-line override can redirect a release to another seal.
	 */
	baselines: string;
}>;

/**
 * The individually reviewed features authorized to release offline. Each entry
 * names one version, one reviewed commit and the exact code frozen to it.
 * Adding an entry is a source change that needs review and merge; this is not a
 * configurable allowlist, and a record naming anything absent here is refused.
 */
export const OFFLINE_FEATURES: readonly OfflineFeature[] = [
	{
		version: "8.4.0",
		feature: "reviewer-picker-v1",
		reviewedCommit: REVIEWER_PICKER_COMMIT,
		files: REVIEWER_PICKER_FILES,
		guidance: ["skills/flow-run/SKILL.md"],
		baselines: ".agents/plans/08-reviewer-picker-release/baselines",
	},
	{
		version: "8.5.0",
		feature: "planning-models-v1",
		reviewedCommit: PLANNING_MODELS_COMMIT,
		files: PLANNING_MODELS_FILES,
		guidance: ["skills/flow-plan/SKILL.md", "skills/flow-run/SKILL.md"],
		baselines: ".agents/plans/09-planning-models/baselines",
	},
	{
		version: "8.6.0",
		feature: "reviewer-command-deprecation-v1",
		reviewedCommit: REVIEWER_DEPRECATION_COMMIT,
		files: PLANNING_MODELS_FILES,
		guidance: ["skills/flow-plan/SKILL.md", "skills/flow-run/SKILL.md"],
		baselines: ".agents/plans/11-reviewer-deprecation-release/baselines",
	},
	{
		version: "9.0.0",
		feature: "reviewer-command-removal-v1",
		reviewedCommit: REVIEWER_REMOVAL_COMMIT,
		files: PLANNING_MODELS_FILES,
		guidance: ["skills/flow-plan/SKILL.md", "skills/flow-run/SKILL.md"],
		baselines: ".agents/plans/12-reviewer-removal-release/baselines",
	},
	{
		version: "9.0.1",
		feature: "runtime-refactor-v1",
		reviewedCommit: RUNTIME_REFACTOR_COMMIT,
		files: RUNTIME_REFACTOR_FILES,
		guidance: ["skills/flow-plan/SKILL.md", "skills/flow-run/SKILL.md"],
		baselines: ".agents/plans/14-runtime-refactor-release/baselines",
	},
];

/** The authorized feature for this record, or a refusal when none exists. */
export function offlineFeature(input: {
	version: unknown;
	feature: unknown;
}): OfflineFeature {
	const entry = OFFLINE_FEATURES.find(
		(candidate) =>
			candidate.version === input.version &&
			candidate.feature === input.feature,
	);
	if (!entry)
		throw new Error(
			"No reviewed offline feature authorizes this release version.",
		);
	return entry;
}

const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Text = z.string().trim().min(1).max(4096);

export function offlineFeatureSchema(entry: OfflineFeature) {
	const paths = entry.guidance as readonly [string, ...string[]];
	return PatchReleaseSchema.extend({
		kind: z.literal("reviewed-offline-feature"),
		feature: z.literal(entry.feature),
		version: z.literal(entry.version),
		reviewedCommit: z.literal(entry.reviewedCommit),
		guidance: z
			.array(
				z
					.object({
						path: z.enum(paths),
						sha256: Hash,
						rationale: Text,
					})
					.strict(),
			)
			.max(entry.guidance.length),
	});
}

export function assertOfflineFeatureScope(input: {
	entry: OfflineFeature;
	changedPaths: readonly string[];
	guidance: readonly { readonly path: string }[];
	baselinePackage: Record<string, unknown>;
	package: Record<string, unknown>;
	reviewedEntries: Readonly<Record<string, string>>;
	candidateEntries: Readonly<Record<string, string>>;
}) {
	if (
		input.baselinePackage.version !== OFFLINE_FEATURE_BASELINE ||
		input.package.version !== input.entry.version
	)
		throw new Error(
			`This feature exception only covers ${input.entry.version} from the fully qualified ${OFFLINE_FEATURE_BASELINE} baseline.`,
		);
	for (const key of [
		"name",
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"overrides",
		"engines",
		"packageManager",
	]) {
		if (
			canonicalJson(input.baselinePackage[key] ?? null) !==
			canonicalJson(input.package[key] ?? null)
		)
			throw new Error(`Feature exception cannot change ${key}.`);
	}
	for (const path of input.entry.files) {
		const reviewed = input.reviewedEntries[path];
		if (
			!reviewed?.startsWith("100644 blob ") ||
			reviewed !== input.candidateEntries[path]
		)
			throw new Error(`Candidate differs from reviewed feature code: ${path}`);
	}
	const approved = new Set<string>(input.entry.files);
	const guides = new Set<string>(input.entry.guidance);
	assertPatchPaths({
		changedPaths: input.changedPaths.filter(
			(path) => !approved.has(path) || guides.has(path),
		),
		guidance: input.guidance,
	});
}

export async function assertOfflineFeatureReleaseEvidence(input: {
	path: string;
	expectedArtifact: ArtifactIdentity;
	repositoryRoot?: string;
}) {
	const root = resolve(input.repositoryRoot ?? process.cwd());
	const bytes = await readFile(input.path);
	const parsed = JSON.parse(bytes.toString("utf8")) as {
		version?: unknown;
		feature?: unknown;
	};
	const entry = offlineFeature({
		version: parsed.version,
		feature: parsed.feature,
	});
	const record = offlineFeatureSchema(entry).parse(parsed);
	if (
		record.artifact.packageVersion !== record.version ||
		!samePackedArtifact(record.artifact, input.expectedArtifact)
	)
		throw new Error("Feature record does not match exact candidate artifact.");
	if (
		(
			await releaseGit(root, ["status", "--porcelain", "--untracked-files=all"])
		).trim()
	)
		throw new Error("Feature qualification requires a clean checkout.");
	const base = record.baseline.artifact;
	if (base.packageVersion !== OFFLINE_FEATURE_BASELINE)
		throw new Error(
			`Feature requires the fully qualified ${OFFLINE_FEATURE_BASELINE} baseline.`,
		);
	if (
		(
			await releaseGit(root, [
				"rev-parse",
				`refs/tags/v${OFFLINE_FEATURE_BASELINE}^{commit}`,
			])
		).trim() !== record.baseline.commit
	)
		throw new Error("Baseline tag/commit mismatch.");
	await releaseGit(root, [
		"merge-base",
		"--is-ancestor",
		base.sourceCommit,
		record.baseline.commit,
	]);
	await releaseGit(root, [
		"merge-base",
		"--is-ancestor",
		record.baseline.commit,
		entry.reviewedCommit,
	]);
	await releaseGit(root, [
		"merge-base",
		"--is-ancestor",
		entry.reviewedCommit,
		"HEAD",
	]);
	const changedPaths = (
		await releaseGit(root, [
			"diff",
			"--name-only",
			"--no-renames",
			"-z",
			base.sourceCommit,
			"HEAD",
		])
	)
		.split("\0")
		.filter(Boolean);
	const entries = async (revision: string) =>
		Object.fromEntries(
			await Promise.all(
				entry.files.map(async (path) => [
					path,
					await releaseGit(root, ["ls-tree", revision, "--", path]),
				]),
			),
		);
	assertOfflineFeatureScope({
		entry,
		changedPaths,
		guidance: record.guidance,
		baselinePackage: JSON.parse(
			await releaseGit(root, ["show", `${base.sourceCommit}:package.json`]),
		),
		package: JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
		reviewedEntries: await entries(entry.reviewedCommit),
		candidateEntries: await entries("HEAD"),
	});
	// The formatter configuration was already reviewed with the 8.3.1 policy.
	if (
		(
			await releaseGit(root, [
				"diff",
				entry.reviewedCommit,
				"HEAD",
				"--",
				"biome.json",
			])
		).trim()
	)
		throw new Error("Feature exception cannot change formatter policy.");
	for (const guide of record.guidance) {
		if (
			(await releaseGit(root, ["ls-tree", "HEAD", "--", guide.path])).slice(
				0,
				12,
			) !== "100644 blob "
		)
			throw new Error("Guidance must remain a regular file.");
		const digest = `sha256:${createHash("sha256")
			.update(await readFile(resolve(root, guide.path)))
			.digest("hex")}`;
		if (digest !== guide.sha256) throw new Error("Reviewed guidance changed.");
	}
	const baseline = await assertStrictReleaseEvidence({
		version: base.packageVersion,
		expectedArtifact: base,
		canaryPath: record.baseline.canary,
		bundlesDirectory: resolve(root, entry.baselines),
		// Retained: the same citation the patch path makes. The notes below say
		// plainly that these are not measurements of this candidate.
		freshness: "retained",
	});
	if (baseline.bundleSha256 !== record.baseline.bundleSha256)
		throw new Error("Baseline seal mismatch.");
	const recordHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
	return {
		bundleSha256: recordHash,
		notes: [
			"## Reviewed offline feature qualification",
			"",
			`Policy: ${entry.feature}, for ${entry.version} only. Reviewed code: ${entry.reviewedCommit}.`,
			`Candidate artifact: ${record.artifact.tarballSha256}. Qualification record: ${recordHash}.`,
			`No live model evals or canary were run for ${entry.version}. Reviewed code, deterministic checks, replay and provider-free OpenCode UI/configuration checks support this feature release; they do not establish its live model behavior.`,
			`Prior measured artifact (${OFFLINE_FEATURE_BASELINE}): ${base.tarballSha256}.`,
			`Prior bundle: ${baseline.bundleSha256}. Prior canary: ${baseline.summary.canarySha256}.`,
			`Prior results only: ${baseline.summary.totals.passed}/${baseline.summary.totals.scored}. These are not measurements of ${entry.version}, and no release after ${OFFLINE_FEATURE_BASELINE} has been measured live.`,
			`Scope approval: ${record.approvedBy}. ${record.rationale}`,
		].join("\n"),
	};
}

/** The code-owned baseline seal directory this record's feature must use. */
export async function offlineFeatureBaselines(path: string): Promise<string> {
	const parsed = JSON.parse(await readFile(path, "utf8")) as {
		version?: unknown;
		feature?: unknown;
	};
	return offlineFeature({
		version: parsed.version,
		feature: parsed.feature,
	}).baselines;
}
