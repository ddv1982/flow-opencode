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
async function fixture() {
	const parent = await mkdtemp(join(tmpdir(), "flow-patch-"));
	roots.push(parent);
	const root = join(parent, "repo");
	await mkdir(root);
	await git(root, "init");
	await git(root, "config", "user.email", "test@example.invalid");
	await git(root, "config", "user.name", "Test");
	await mkdir(join(root, "src"));
	await mkdir(join(root, "skills/flow-run"), { recursive: true });
	await writeFile(join(root, "package.json"), JSON.stringify(metadata));
	await writeFile(
		join(root, "biome.json"),
		JSON.stringify({ files: { includes: ["**"] } }),
	);
	await writeFile(join(root, "src/index.ts"), "export const fixed = true;\n");
	await writeFile(join(root, "skills/flow-run/SKILL.md"), "original");
	await git(root, "add", ".");
	await git(root, "commit", "-m", "full baseline");
	const commit = await git(root, "rev-parse", "HEAD");
	await git(root, "tag", "v8.3.0");
	await writeFile(join(root, "package.json"), JSON.stringify(scope.package));
	await writeFile(join(root, "skills/flow-run/SKILL.md"), "clarification");
	await git(root, "add", ".");
	await git(root, "commit", "-m", "patch");
	const baselineArtifact = {
		packageVersion: "8.3.0",
		sourceCommit: commit,
		sourceTreeSha256: hash("tree"),
		tarballSha256: hash("baseline"),
		unpackedManifestSha256: hash("manifest"),
	};
	const candidate = {
		...baselineArtifact,
		packageVersion: "8.3.1",
		tarballSha256: hash("candidate"),
	};
	const record: PatchRelease = {
		schemaVersion: 1,
		kind: "baseline-qualified-patch",
		version: "8.3.1",
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
		guidance: [
			{
				path: "skills/flow-run/SKILL.md",
				sha256: hash("clarification"),
				rationale: "Clarify existing handoff",
			},
		],
		approvedBy: "test operator",
		rationale: "No core guarantees changed",
	};
	const path = join(parent, "patch.json");
	await writeFile(path, JSON.stringify(record));
	let calls = 0;
	const verify = async () => {
		calls++;
		return {
			bundleSha256: hash("bundle"),
			summary: {
				canarySha256: hash("canary"),
				totals: { passed: 76, scored: 76 },
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
