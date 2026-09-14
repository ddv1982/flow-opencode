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

// This one reviewed feature is authorized; this is not a configurable allowlist.
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
export const ReviewerPickerReleaseSchema = PatchReleaseSchema.extend({
	kind: z.literal("reviewed-offline-feature"),
	feature: z.literal("reviewer-picker-v1"),
	version: z.literal("8.4.0"),
	reviewedCommit: z.literal(REVIEWER_PICKER_COMMIT),
});

export function assertReviewerPickerScope(input: {
	changedPaths: readonly string[];
	guidance: z.infer<typeof ReviewerPickerReleaseSchema>["guidance"];
	baselinePackage: Record<string, unknown>;
	package: Record<string, unknown>;
	reviewedEntries: Readonly<Record<string, string>>;
	candidateEntries: Readonly<Record<string, string>>;
}) {
	if (
		input.baselinePackage.version !== "8.3.0" ||
		input.package.version !== "8.4.0"
	)
		throw new Error(
			"This feature exception only covers 8.4.0 from the fully qualified 8.3.0 baseline.",
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
	for (const path of REVIEWER_PICKER_FILES) {
		const reviewed = input.reviewedEntries[path];
		if (
			!reviewed?.startsWith("100644 blob ") ||
			reviewed !== input.candidateEntries[path]
		)
			throw new Error(`Candidate differs from reviewed picker code: ${path}`);
	}
	const approved = new Set<string>(REVIEWER_PICKER_FILES);
	assertPatchPaths({
		changedPaths: input.changedPaths.filter(
			(path) => !approved.has(path) || path === "skills/flow-run/SKILL.md",
		),
		guidance: input.guidance,
	});
}

export async function assertReviewerPickerReleaseEvidence(input: {
	path: string;
	expectedArtifact: ArtifactIdentity;
	bundlesDirectory: string;
	repositoryRoot?: string;
}) {
	const root = resolve(input.repositoryRoot ?? process.cwd());
	const bytes = await readFile(input.path);
	const record = ReviewerPickerReleaseSchema.parse(
		JSON.parse(bytes.toString("utf8")),
	);
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
	if (base.packageVersion !== "8.3.0")
		throw new Error("Feature requires the fully qualified 8.3.0 baseline.");
	if (
		(
			await releaseGit(root, ["rev-parse", "refs/tags/v8.3.0^{commit}"])
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
		REVIEWER_PICKER_COMMIT,
	]);
	await releaseGit(root, [
		"merge-base",
		"--is-ancestor",
		REVIEWER_PICKER_COMMIT,
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
				REVIEWER_PICKER_FILES.map(async (path) => [
					path,
					await releaseGit(root, ["ls-tree", revision, "--", path]),
				]),
			),
		);
	assertReviewerPickerScope({
		changedPaths,
		guidance: record.guidance,
		baselinePackage: JSON.parse(
			await releaseGit(root, ["show", `${base.sourceCommit}:package.json`]),
		),
		package: JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
		reviewedEntries: await entries(REVIEWER_PICKER_COMMIT),
		candidateEntries: await entries("HEAD"),
	});
	// The formatter configuration was already reviewed with the 8.3.1 policy.
	if (
		(
			await releaseGit(root, [
				"diff",
				REVIEWER_PICKER_COMMIT,
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
		bundlesDirectory: input.bundlesDirectory,
	});
	if (baseline.bundleSha256 !== record.baseline.bundleSha256)
		throw new Error("Baseline seal mismatch.");
	const recordHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
	return {
		bundleSha256: recordHash,
		notes: [
			"## Reviewed offline feature qualification",
			"",
			`Policy: reviewer-picker-v1, for 8.4.0 only. Reviewed code: ${REVIEWER_PICKER_COMMIT}.`,
			`Candidate artifact: ${record.artifact.tarballSha256}. Qualification record: ${recordHash}.`,
			"No live model evals or canary were run for 8.4.0. Reviewed code, deterministic checks, replay and provider-free OpenCode UI/configuration checks support this feature release; they do not establish its live model behavior.",
			`Prior measured artifact (8.3.0): ${base.tarballSha256}.`,
			`Prior bundle: ${baseline.bundleSha256}. Prior canary: ${baseline.summary.canarySha256}.`,
			`Prior results only: ${baseline.summary.totals.passed}/${baseline.summary.totals.scored}. These are not measurements of 8.4.0.`,
			`Scope approval: ${record.approvedBy}. ${record.rationale}`,
		].join("\n"),
	};
}
