import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertPatchReleaseEvidence,
	assertPatchScope,
	type PatchRelease,
} from "../scripts/patch-release.js";
import type { ReleaseEvidenceSummary } from "../scripts/release-metadata.js";

const hash = (text: string) =>
	`sha256:${createHash("sha256").update(text).digest("hex")}`;
const metadata = {
	name: "test",
	version: "8.3.0",
	scripts: { build: "fixed" },
	dependencies: { test: "1.0.0" },
};
const scope = {
	baselineVersion: "8.3.0",
	version: "8.3.1",
	baselinePackage: metadata,
	package: { ...metadata, version: "8.3.1" },
	changedPaths: ["package.json", "scripts/release.ts"],
	guidance: [],
};
test("patch scope preserves core source, dependency and build boundaries", () => {
	expect(() => assertPatchScope(scope)).not.toThrow();
	for (const path of [
		"src/domain/transitions.ts",
		"bun.lock",
		"tsconfig.json",
		"scripts/clean-dist.ts",
		"skills/flow-review/SKILL.md",
		"unknown-file",
	]) {
		expect(() => assertPatchScope({ ...scope, changedPaths: [path] })).toThrow(
			"Full qualification",
		);
	}
	expect(() =>
		assertPatchScope({
			...scope,
			package: { ...scope.package, dependencies: { test: "2" } },
		}),
	).toThrow("metadata");
	for (const version of ["8.4.0", "9.0.0", "8.3.0", "8.3.1-beta"])
		expect(() => assertPatchScope({ ...scope, version })).toThrow();
	expect(() =>
		assertPatchScope({ ...scope, changedPaths: ["skills/flow-run/SKILL.md"] }),
	).toThrow();
});

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
async function git(root: string, ...args: string[]) {
	const child = Bun.spawn(["git", "-C", root, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code) throw new Error(err);
	return out.trim();
}
async function fixture(startup = false) {
	const parent = await mkdtemp(join(tmpdir(), "flow-patch-"));
	roots.push(parent);
	const root = join(parent, "repo");
	await mkdir(root);
	await git(root, "init");
	await git(root, "config", "user.email", "test@example.invalid");
	await git(root, "config", "user.name", "Test");
	await mkdir(join(root, "src"));
	await mkdir(join(root, "skills/flow-run"), { recursive: true });
	const baselineVersion = startup ? "10.0.2" : "8.3.0";
	const version = startup ? "10.0.3" : "8.3.1";
	const baselinePackage = startup
		? {
				...metadata,
				version: baselineVersion,
				scripts: {
					...metadata.scripts,
					"smoke:live":
						"FLOW_LIVE_SMOKE=1 bun test tests/live-opencode-smoke.test.ts",
				},
			}
		: metadata;
	await writeFile(join(root, "package.json"), JSON.stringify(baselinePackage));
	const startupFiles: NonNullable<PatchRelease["startup"]>["files"] = [
		{
			path: "src/infrastructure/fs/workspace-paths.ts",
			baselineSha256: hash("before\n"),
			sha256: hash("after\n"),
		},
		{
			path: "src/platform/opencode/plugin-composition.ts",
			baselineSha256: hash("before\n"),
			sha256: hash("after\n"),
		},
	];
	if (startup)
		for (const file of startupFiles) {
			await mkdir(join(root, file.path, ".."), { recursive: true });
			await writeFile(join(root, file.path), "before\n");
		}
	await writeFile(
		join(root, "biome.json"),
		JSON.stringify({ files: { includes: ["**"] } }),
	);
	await writeFile(join(root, "src/index.ts"), "export const fixed = true;\n");
	await writeFile(join(root, "skills/flow-run/SKILL.md"), "original");
	await git(root, "add", ".");
	await git(root, "commit", "-m", "full baseline");
	const commit = await git(root, "rev-parse", "HEAD");
	await git(root, "tag", `v${baselineVersion}`);
	await writeFile(
		join(root, "package.json"),
		JSON.stringify(
			startup
				? {
						...baselinePackage,
						version,
						scripts: {
							...baselinePackage.scripts,
							"smoke:live":
								"FLOW_LIVE_SMOKE=1 bun test tests/live-opencode-smoke.test.ts tests/plugin-startup-live.test.ts",
						},
					}
				: scope.package,
		),
	);
	if (startup)
		for (const file of startupFiles)
			await writeFile(join(root, file.path), "after\n");
	else await writeFile(join(root, "skills/flow-run/SKILL.md"), "clarification");
	await git(root, "add", ".");
	await git(root, "commit", "-m", "patch");
	const baselineArtifact = {
		packageVersion: baselineVersion,
		sourceCommit: commit,
		sourceTreeSha256: hash("tree"),
		tarballSha256: hash("baseline"),
		unpackedManifestSha256: hash("manifest"),
	};
	const candidate = {
		...baselineArtifact,
		packageVersion: version,
		tarballSha256: hash("candidate"),
	};
	const record: PatchRelease = {
		schemaVersion: 1,
		kind: "baseline-qualified-patch",
		version,
		baseline: {
			commit,
			artifact: baselineArtifact,
			canary: "baseline.json",
			bundleSha256: hash("bundle"),
		},
		artifact: {
			packageVersion: candidate.packageVersion,
			tarballSha256: candidate.tarballSha256,
			unpackedManifestSha256: candidate.unpackedManifestSha256,
		},
		guidance: startup
			? []
			: [
					{
						path: "skills/flow-run/SKILL.md",
						sha256: hash("clarification"),
						rationale: "Clarify existing handoff",
					},
				],
		approvedBy: "test operator",
		rationale: "No core guarantees changed",
		...(startup
			? {
					startup: {
						kind: "home-directory-startup-10.0.3" as const,
						files: startupFiles,
					},
				}
			: {}),
	};
	const path = join(parent, "patch.json");
	await writeFile(path, JSON.stringify(record));
	let calls = 0;
	const verify = async () => {
		calls++;
		return {
			bundleSha256: hash("bundle"),
			summary: {
				schemaVersion: 1,
				packageVersion: baselineVersion,
				reportId: "baseline-report",
				verdict: "VERIFIED",
				bundleSha256: hash("bundle"),
				artifact: baselineArtifact,
				canarySha256: hash("canary"),
				totals: { scheduled: 76, passed: 76, scored: 76 },
				providers: (startup ? ["openai"] : ["openai", "xai"]).map(
					(provider) => ({
						provider,
						scheduled: 38,
						scored: 38,
						passed: 38,
						passRate: 1,
					}),
				),
			} as ReleaseEvidenceSummary,
		};
	};
	const input = {
		path,
		expectedArtifact: candidate,
		bundlesDirectory: "unused",
		repositoryRoot: root,
	};
	return {
		root,
		record,
		input,
		verify,
		calls: () => calls,
		writeRecord: async () => writeFile(path, JSON.stringify(record)),
	};
}

test("eligible patch verifies baseline and discloses prior-only evidence", async () => {
	const f = await fixture();
	const result = await assertPatchReleaseEvidence(f.input, f.verify);
	expect(f.calls()).toBe(1);
	expect(result.notes).toContain("No live model evals or canary");
	expect(result.notes).toContain("not measurements of this candidate");
	expect(result.bundleSha256).toBe(hash(await readFile(f.input.path, "utf8")));
});
test("exact startup patch verifies the retained OpenAI baseline without claiming a new measurement", async () => {
	const f = await fixture(true);
	const result = await assertPatchReleaseEvidence(f.input, f.verify);
	expect(f.calls()).toBe(1);
	expect(result.notes).toContain("No live model evals or canary were run");
	expect(result.notes).toContain("Prior measured version: 10.0.2");
	await expect(
		assertPatchReleaseEvidence(f.input, async () => {
			const verified = await f.verify();
			return {
				...verified,
				summary: {
					...verified.summary,
					providers: verified.summary.providers.map((row) => ({
						...row,
						provider: "fixture",
					})),
				},
			};
		}),
	).rejects.toThrow("two-provider baseline");
});
test("startup approval rejects changed baseline or candidate code, extra runtime paths and script edits", async () => {
	const f = await fixture(true);
	const startup = f.record.startup;
	if (!startup) throw new Error("Missing fixture approval");
	for (const field of ["baselineSha256", "sha256"] as const) {
		const prior = startup.files[0][field];
		startup.files[0][field] = hash("substituted");
		await f.writeRecord();
		await expect(assertPatchReleaseEvidence(f.input, f.verify)).rejects.toThrow(
			"startup content changed",
		);
		startup.files[0][field] = prior;
	}
	await f.writeRecord();
	await writeFile(join(f.root, "src/index.ts"), "other runtime change");
	await git(f.root, "add", ".");
	await git(f.root, "commit", "-m", "unapproved runtime");
	await expect(assertPatchReleaseEvidence(f.input, f.verify)).rejects.toThrow(
		"Full qualification",
	);
	expect(f.calls()).toBe(0);
});
test("startup scope cannot extend to other versions, guides, dependencies or smoke bypasses", () => {
	const startup = {
		kind: "home-directory-startup-10.0.3" as const,
		files: [
			{
				path: "src/infrastructure/fs/workspace-paths.ts" as const,
				baselineSha256: hash("a"),
				sha256: hash("b"),
			},
			{
				path: "src/platform/opencode/plugin-composition.ts" as const,
				baselineSha256: hash("a"),
				sha256: hash("b"),
			},
		] as NonNullable<PatchRelease["startup"]>["files"],
	};
	const before = {
		...metadata,
		version: "10.0.2",
		scripts: {
			build: "fixed",
			"smoke:live":
				"FLOW_LIVE_SMOKE=1 bun test tests/live-opencode-smoke.test.ts",
		},
	};
	const after = {
		...before,
		version: "10.0.3",
		scripts: {
			...before.scripts,
			"smoke:live": `${before.scripts["smoke:live"]} tests/plugin-startup-live.test.ts`,
		},
	};
	const input = {
		...scope,
		baselineVersion: "10.0.2",
		version: "10.0.3",
		baselinePackage: before,
		package: after,
		changedPaths: startup.files.map((file) => file.path),
		startup,
	};
	expect(() => assertPatchScope(input)).not.toThrow();
	for (const version of ["10.0.4", "10.1.0", "11.0.0"])
		expect(() =>
			assertPatchScope({ ...input, version, package: { ...after, version } }),
		).toThrow();
	expect(() =>
		assertPatchScope({ ...input, baselineVersion: "10.0.1" }),
	).toThrow();
	expect(() => assertPatchScope({ ...input, startup: undefined })).toThrow();
	expect(() =>
		assertPatchScope({
			...input,
			package: { ...after, dependencies: { test: "2.0" } },
		}),
	).toThrow("metadata");
	expect(() =>
		assertPatchScope({
			...input,
			package: { ...after, scripts: { ...after.scripts, build: "changed" } },
		}),
	).toThrow("metadata");
	expect(() =>
		assertPatchScope({
			...input,
			package: {
				...after,
				scripts: { ...after.scripts, "smoke:live": "echo passed" },
			},
		}),
	).toThrow("declared native startup smoke");
	expect(() =>
		assertPatchScope({
			...input,
			guidance: [
				{
					path: "skills/flow-run/SKILL.md",
					sha256: hash("guide"),
					rationale: "extra",
				},
			],
		}),
	).toThrow("without guide changes");
});
test("refuses a one-provider release as a patch baseline", async () => {
	const f = await fixture();
	await expect(
		assertPatchReleaseEvidence(f.input, async () => ({
			bundleSha256: hash("bundle"),
			summary: {
				...(await f.verify()).summary,
				providers: [
					{
						provider: "openai",
						scheduled: 38,
						scored: 38,
						passed: 38,
						passRate: 1,
					},
				],
			},
		})),
	).rejects.toThrow("two-provider baseline");
});
test("reads the baseline seal as retained evidence, not as a fresh measurement", async () => {
	const f = await fixture();
	let freshness: string | undefined;
	// A patch cites a baseline it explicitly does not claim to have re-measured,
	// so the baseline's canary window must not decide whether the patch ships.
	await assertPatchReleaseEvidence(f.input, async (request) => {
		freshness = request.freshness;
		return f.verify();
	});
	expect(freshness).toBe("retained");
});

test("candidate substitution and stale guide approval fail before baseline verification", async () => {
	const f = await fixture();
	await expect(
		assertPatchReleaseEvidence(
			{
				...f.input,
				expectedArtifact: {
					...f.input.expectedArtifact,
					tarballSha256: hash("other"),
				},
			},
			f.verify,
		),
	).rejects.toThrow("exact candidate");
	const guide = f.record.guidance[0];
	if (!guide) throw new Error("Missing test guide");
	guide.sha256 = hash("other");
	await f.writeRecord();
	await expect(assertPatchReleaseEvidence(f.input, f.verify)).rejects.toThrow(
		"guidance content",
	);
	expect(f.calls()).toBe(0);
});
test("dirty checkout, changed runtime, and moved baseline tag fail closed", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "src/index.ts"), "changed");
	await expect(assertPatchReleaseEvidence(f.input, f.verify)).rejects.toThrow(
		"clean checkout",
	);
	await git(f.root, "add", ".");
	await git(f.root, "commit", "-m", "runtime change");
	await expect(assertPatchReleaseEvidence(f.input, f.verify)).rejects.toThrow(
		"Full qualification",
	);
	await git(f.root, "tag", "-f", "v8.3.0");
	await expect(assertPatchReleaseEvidence(f.input, f.verify)).rejects.toThrow(
		"tag/commit",
	);
	expect(f.calls()).toBe(0);
});
test("expired or invalid baseline evidence and changed seals remain fatal", async () => {
	const f = await fixture();
	await expect(
		assertPatchReleaseEvidence(f.input, async () => {
			throw new Error("Canary is expired.");
		}),
	).rejects.toThrow("expired");
	f.record.baseline.bundleSha256 = hash("other");
	await f.writeRecord();
	await expect(assertPatchReleaseEvidence(f.input, f.verify)).rejects.toThrow(
		"bundle changed",
	);
});

test("permits only the exact sealed-data formatter exclusion", async () => {
	const f = await fixture();
	await writeFile(
		join(f.root, "biome.json"),
		JSON.stringify({
			files: { includes: ["**", "!evals/qualification/patch-baselines"] },
		}),
	);
	await git(f.root, "add", ".");
	await git(f.root, "commit", "-m", "exclude sealed bytes");
	await assertPatchReleaseEvidence(f.input, f.verify);
	await writeFile(
		join(f.root, "biome.json"),
		JSON.stringify({ files: { includes: ["**", "!src"] } }),
	);
	await git(f.root, "add", ".");
	await git(f.root, "commit", "-m", "alter lint coverage");
	await expect(assertPatchReleaseEvidence(f.input, f.verify)).rejects.toThrow(
		"formatter exclusion",
	);
});
