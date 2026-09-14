import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { canonicalJson } from "../evals/canonical-json.js";
import { samePackedArtifact } from "../evals/provenance.js";
import {
	type ArtifactIdentity,
	ArtifactIdentitySchema,
} from "../evals/report.js";
import { assertStrictReleaseEvidence } from "./release-metadata.js";

const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Commit = z.string().regex(/^[a-f0-9]{40}$/);
const Text = z.string().trim().min(1).max(4096);
export const PatchReleaseSchema = z
	.object({
		schemaVersion: z.literal(1),
		kind: z.literal("baseline-qualified-patch"),
		version: z.string().regex(/^\d+\.\d+\.\d+$/),
		baseline: z
			.object({
				commit: Commit,
				artifact: ArtifactIdentitySchema.extend({ sourceCommit: Commit }),
				canary: Text,
				bundleSha256: Hash,
			})
			.strict(),
		artifact: ArtifactIdentitySchema.omit({
			sourceCommit: true,
			sourceTreeSha256: true,
		}),
		guidance: z
			.array(
				z
					.object({
						path: z.literal("skills/flow-run/SKILL.md"),
						sha256: Hash,
						rationale: Text,
					})
					.strict(),
			)
			.max(1),
		approvedBy: Text,
		rationale: Text,
	})
	.strict();
export type PatchRelease = z.infer<typeof PatchReleaseSchema>;
const hash = (bytes: Uint8Array) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Scope is intentionally conservative. Unknown paths require full qualification. */
export function assertPatchScope(input: {
	baselineVersion: string;
	version: string;
	baselinePackage: Record<string, unknown>;
	package: Record<string, unknown>;
	changedPaths: readonly string[];
	guidance: PatchRelease["guidance"];
}) {
	const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
	const base = input.baselineVersion.match(version);
	const next = input.version.match(version);
	if (
		!base ||
		!next ||
		base[1] !== next[1] ||
		base[2] !== next[2] ||
		BigInt(next[3] ?? "-1") <= BigInt(base[3] ?? "-1")
	)
		throw new Error("Patch must advance within the baseline major/minor.");
	const { version: oldVersion, ...oldPackage } = input.baselinePackage;
	const { version: newVersion, ...newPackage } = input.package;
	if (
		oldVersion !== input.baselineVersion ||
		newVersion !== input.version ||
		canonicalJson(oldPackage) !== canonicalJson(newPackage)
	)
		throw new Error(
			"Patch package metadata may change only version; dependencies and build settings must match.",
		);
	assertPatchPaths(input);
}

export function assertPatchPaths(input: {
	changedPaths: readonly string[];
	guidance: readonly { readonly path: string }[];
}) {
	const guides = new Set<string>(input.guidance.map((entry) => entry.path));
	if (guides.size !== input.guidance.length)
		throw new Error("Duplicate guidance approval.");
	for (const path of input.changedPaths) {
		if (guides.has(path)) continue;
		if (/^(?:docs\/|tests\/|evals\/|\.agents\/plans\/)/.test(path)) continue;
		if (
			[
				"package.json",
				"biome.json",
				"README.md",
				"CHANGELOG.md",
				".gitignore",
				".github/workflows/evals.yml",
				".github/workflows/ci.yml",
				".github/workflows/release.yml",
			].includes(path)
		)
			continue;
		if (
			/^scripts\/(?:release(?:-metadata|-publish)?|patch-release|feature-release|qualify-release|eval-canary|canary-run|paid-budget)\.ts$/.test(
				path,
			) ||
			path === "scripts/lib/exclusive-json.ts"
		)
			continue;
		throw new Error(`Full qualification required for changed path: ${path}`);
	}
	for (const guide of guides)
		if (!input.changedPaths.includes(guide))
			throw new Error("Guidance approval does not name a changed guide.");
}

export async function releaseGit(root: string, args: string[]) {
	const process = Bun.spawn(["git", "-C", root, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, error, code] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (code !== 0)
		throw new Error(`Patch Git verification failed: ${error.trim()}`);
	return out;
}

export async function assertPatchReleaseEvidence(
	input: {
		path: string;
		expectedArtifact: ArtifactIdentity;
		bundlesDirectory: string;
		repositoryRoot?: string;
	},
	verifyBaseline = assertStrictReleaseEvidence,
) {
	const root = resolve(input.repositoryRoot ?? process.cwd());
	const bytes = await readFile(input.path);
	const record = PatchReleaseSchema.parse(JSON.parse(bytes.toString("utf8")));
	if (
		record.version !== record.artifact.packageVersion ||
		!samePackedArtifact(record.artifact, input.expectedArtifact)
	)
		throw new Error("Patch record does not match exact candidate artifact.");
	if (
		(
			await releaseGit(root, ["status", "--porcelain", "--untracked-files=all"])
		).trim()
	)
		throw new Error("Patch verification requires a clean checkout.");
	const tagCommit = (
		await releaseGit(root, [
			"rev-parse",
			`refs/tags/v${record.baseline.artifact.packageVersion}^{commit}`,
		])
	).trim();
	if (tagCommit !== record.baseline.commit)
		throw new Error("Baseline tag/commit mismatch.");
	await releaseGit(root, [
		"merge-base",
		"--is-ancestor",
		record.baseline.commit,
		"HEAD",
	]);
	await releaseGit(root, [
		"merge-base",
		"--is-ancestor",
		record.baseline.artifact.sourceCommit,
		record.baseline.commit,
	]);
	const changedPaths = (
		await releaseGit(root, [
			"diff",
			"--name-only",
			"--no-renames",
			"-z",
			record.baseline.artifact.sourceCommit,
			"HEAD",
		])
	)
		.split("\0")
		.filter(Boolean);
	assertPatchScope({
		baselineVersion: record.baseline.artifact.packageVersion,
		version: record.version,
		baselinePackage: JSON.parse(
			await releaseGit(root, [
				"show",
				`${record.baseline.artifact.sourceCommit}:package.json`,
			]),
		),
		package: JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
		changedPaths,
		guidance: record.guidance,
	});
	if (changedPaths.includes("biome.json")) {
		const oldConfig = JSON.parse(
			await releaseGit(root, [
				"show",
				`${record.baseline.artifact.sourceCommit}:biome.json`,
			]),
		);
		const newConfig = JSON.parse(
			await readFile(resolve(root, "biome.json"), "utf8"),
		);
		newConfig.files.includes = newConfig.files.includes.filter(
			(path: string) => path !== "!evals/qualification/patch-baselines",
		);
		if (canonicalJson(oldConfig) !== canonicalJson(newConfig))
			throw new Error(
				"Only the sealed patch baseline formatter exclusion may change.",
			);
	}
	for (const entry of record.guidance) {
		for (const revision of [record.baseline.artifact.sourceCommit, "HEAD"]) {
			if (
				!(
					await releaseGit(root, ["ls-tree", revision, "--", entry.path])
				).startsWith("100644 blob ")
			)
				throw new Error("Guidance must remain a regular non-executable file.");
		}
		if (hash(await readFile(resolve(root, entry.path))) !== entry.sha256)
			throw new Error("Reviewed guidance content changed.");
	}
	const baseline = await verifyBaseline({
		version: record.baseline.artifact.packageVersion,
		expectedArtifact: record.baseline.artifact,
		canaryPath: record.baseline.canary,
		bundlesDirectory: input.bundlesDirectory,
	});
	if (baseline.bundleSha256 !== record.baseline.bundleSha256)
		throw new Error("Baseline qualification bundle changed.");
	return {
		bundleSha256: hash(bytes),
		notes: [
			"## Patch qualification",
			"",
			`Policy: baseline-qualified-patch v1. Record: ${hash(bytes)}.`,
			`Candidate ${record.version}: ${record.artifact.tarballSha256}.`,
			"No live model evals or canary were run for this candidate. Offline checks and reviewed change scope support this patch release.",
			`Prior measured version: ${record.baseline.artifact.packageVersion}; artifact: ${record.baseline.artifact.tarballSha256}.`,
			`Prior qualification bundle: ${baseline.bundleSha256}; prior canary: ${baseline.summary.canarySha256}.`,
			`Prior results only: ${baseline.summary.totals.passed}/${baseline.summary.totals.scored} passed. These are not measurements of this candidate.`,
			`Scope approval: ${record.approvedBy}. ${record.rationale}`,
		].join("\n"),
	};
}
