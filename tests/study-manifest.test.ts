import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BENCHMARK_CASES } from "../evals/benchmarks.js";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { EvalHost, preparePackageCache } from "../evals/harness.js";
import { exactPackageVersion } from "../evals/provenance.js";
import { ArtifactIdentitySchema } from "../evals/report-identities.js";
import { prepareStudyManifest } from "../evals/study-manifest.js";
import { runStudyCommand } from "../evals/study-runner.js";
import packageJson from "../package.json" with { type: "json" };
import { studyArtifact, studyManifest } from "./study-support.js";

describe("paired-study manifest", () => {
	test("execution versions are exact SemVer while legacy identity decoding remains permissive", () => {
		for (const version of ["0.0.0", "8.2.1", "1.0.0-rc.1+build.01"])
			expect(exactPackageVersion(version)).toBe(version);
		for (const version of [
			"latest",
			"^1.0.0",
			"v1.0.0",
			"01.0.0",
			"1.0.0-01",
			"1.0.0\n",
			"1.0.0/../../outside",
			"1.0.0\\..",
			`1.0.0+${"a".repeat(256)}`,
		])
			expect(() => exactPackageVersion(version)).toThrow(
				"bounded exact SemVer",
			);
		expect(
			ArtifactIdentitySchema.safeParse({
				packageVersion: "latest",
				sourceCommit: "historical",
				sourceTreeSha256: `sha256:${"a".repeat(64)}`,
				tarballSha256: `sha256:${"b".repeat(64)}`,
				unpackedManifestSha256: `sha256:${"c".repeat(64)}`,
			}).success,
		).toBe(true);
	});
	for (const version of ["latest", "1.0.0/../../../../outside-cache"]) {
		test(`rejects ${version} before manifest execution, cache writes, or host setup`, async () => {
			const directory = await mkdtemp(join(tmpdir(), "study-invalid-version-"));
			try {
				const artifact = await studyArtifact(directory, "invalid", version);
				const manifest = studyManifest();
				manifest.arms.baseline.artifact = artifact;
				await expect(prepareStudyManifest(manifest, directory)).rejects.toThrow(
					"bounded exact SemVer",
				);
				const before = await readdir(directory);
				const toolchain = currentBunToolchain(packageJson.packageManager);
				await expect(
					preparePackageCache(
						artifact.path,
						join(directory, "cache"),
						toolchain,
					),
				).rejects.toThrow("bounded exact SemVer");
				await expect(
					EvalHost.start({
						toolchain,
						packageCache: "unused",
						packageVersion: version,
						opencodeVersion: "1.18.6",
						files: {},
					}),
				).rejects.toThrow("bounded exact SemVer");
				expect(await readdir(directory)).toEqual(before);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		});
	}
	test("requires an explicit total-effect label when more than the declared factor changes", async () => {
		const manifest = studyManifest();
		manifest.comparison = "artifact";
		manifest.arms.candidate.manager.variant = "high";
		await expect(prepareStudyManifest(manifest, ".")).rejects.toThrow(
			"exceed the declared comparison",
		);
		manifest.comparison = "total-effect";
		expect((await prepareStudyManifest(manifest, ".")).policy.comparison).toBe(
			"total-effect",
		);
	});
	test("dry-run validates local inputs without starting a host or copying credentials", async () => {
		const directory = await mkdtemp(join(tmpdir(), "study-dry-run-"));
		const start = spyOn(EvalHost, "start").mockImplementation(async () => {
			throw new Error("Dry run started a host.");
		});
		let output = "";
		const write = spyOn(process.stdout, "write").mockImplementation((value) => {
			output += String(value);
			return true;
		});
		try {
			const manifest = studyManifest();
			const benchmark = BENCHMARK_CASES[0];
			if (!benchmark) throw new Error("Missing development case.");
			manifest.cases = [
				{ caseId: benchmark.id, caseVersion: benchmark.caseVersion },
			];
			const path = join(directory, "manifest.json");
			await writeFile(path, JSON.stringify(manifest));
			await runStudyCommand(["--manifest", path, "--dry-run"]);
			const summary = JSON.parse(output);
			expect(summary).toMatchObject({
				primaryPairs: 1,
				primaryAttempts: 2,
				reservePairs: 1,
				possibleAttempts: 4,
				providerCalls: 0,
			});
			expect(summary.budgetSemantics).toContain("not a guaranteed invoice cap");
			expect(start).not.toHaveBeenCalled();
		} finally {
			write.mockRestore();
			start.mockRestore();
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("rejects unsupported host accounting and unfunded fixed samples locally", async () => {
		const manifest = studyManifest();
		await expect(
			prepareStudyManifest({ ...manifest, opencodeVersion: "1.19.0" }, "."),
		).rejects.toThrow("verified only for OpenCode 1.18.6");
		await expect(
			prepareStudyManifest(
				{
					...manifest,
					accounting: { ...manifest.accounting, maxGeneratedOutputTokens: 19 },
				},
				".",
			),
		).rejects.toThrow("cannot cover the fixed primary sample");
		await expect(
			prepareStudyManifest(
				{ ...manifest, budget: { ...manifest.budget, maxUsd: 10 } },
				".",
			),
		).rejects.toThrow("cannot cover the fixed primary sample");
		await expect(
			prepareStudyManifest(
				{
					...manifest,
					accounting: { ...manifest.accounting, maxGeneratedOutputTokens: 0 },
				},
				".",
			),
		).rejects.toThrow();
	});

	test("names the confirmatory method and preserves its 265-pair admission requirement", async () => {
		const manifest = studyManifest();
		const confirmatory = {
			...manifest,
			purpose: "confirmatory",
			method: "legacy-fixed-task-bounded-pair-v1",
			targetPower: 0.8,
			minimumDetectableEffect: 0.2,
		};
		await expect(prepareStudyManifest(confirmatory, ".")).rejects.toThrow(
			"requires 265 pairs",
		);
		await expect(
			prepareStudyManifest(
				{ ...confirmatory, method: "equal-task-cluster-bootstrap-v1" },
				".",
			),
		).rejects.toThrow("purpose and method disagree");
		const prepared = await prepareStudyManifest(
			{
				...confirmatory,
				repetitions: 265,
				reservePairsPerBlock: 0,
				budget: { ...manifest.budget, maxAttempts: 530 },
			},
			".",
		);
		expect(prepared.summary.primaryPairs).toBe(265);
		expect(prepared.policy.purpose).toBe("confirmatory");
	});

	test("rejects artifact substitution and uses digest-separated real package caches", async () => {
		const directory = await mkdtemp(join(tmpdir(), "study-cache-"));
		try {
			const old = await studyArtifact(directory, "old", "8.1.0");
			const newer = await studyArtifact(directory, "new", "8.1.0");
			const manifest = studyManifest();
			manifest.arms.baseline.artifact = old;
			manifest.arms.candidate.artifact = newer;
			const prepared = await prepareStudyManifest(manifest, directory);
			expect(prepared.policy.arms.baseline.artifact).toEqual(old.identity);
			const changed = structuredClone(manifest);
			changed.arms.baseline.artifact = { ...old, path: newer.path };
			await expect(prepareStudyManifest(changed, directory)).rejects.toThrow(
				"differ from their declared identity",
			);
			const toolchain = currentBunToolchain(packageJson.packageManager);
			const before = await preparePackageCache(old.path, directory, toolchain);
			const after = await preparePackageCache(newer.path, directory, toolchain);
			expect(before).not.toBe(after);
			expect(before).toContain(old.identity.tarballSha256.slice(7));
			expect(after).toContain(newer.identity.tarballSha256.slice(7));
			expect(
				JSON.parse(
					await readFile(
						join(
							before,
							"node_modules",
							"opencode-plugin-flow",
							"package.json",
						),
						"utf8",
					),
				).version,
			).toBe("8.1.0");
			expect(
				await readFile(
					join(before, "node_modules", "opencode-plugin-flow", "index.js"),
					"utf8",
				),
			).not.toBe(
				await readFile(
					join(after, "node_modules", "opencode-plugin-flow", "index.js"),
					"utf8",
				),
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);
});
