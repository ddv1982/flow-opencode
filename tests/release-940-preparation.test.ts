import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
const Workflow = z.object({
	jobs: z.record(
		z.string(),
		z.object({
			steps: z.array(
				z.object({ name: z.string().optional(), run: z.string().optional() }),
			),
		}),
	),
});
async function step(
	job: string,
	name: string,
	file = ".github/workflows/release.yml",
): Promise<string> {
	const workflow = Workflow.parse(parse(await readFile(file, "utf8")));
	const run = workflow.jobs[job]?.steps.find(
		(entry) => entry.name === name,
	)?.run;
	if (!run) throw new Error(`Missing release step ${job}/${name}`);
	return run;
}
async function fixture(version: string) {
	const root = await mkdtemp(join(tmpdir(), "flow-release-step-"));
	temporary.push(root);
	const bin = join(root, "bin");
	await mkdir(bin);
	await writeFile(join(root, "package.json"), JSON.stringify({ version }));
	await writeFile(
		join(bin, "bun"),
		`#!/bin/bash
set -euo pipefail
if [[ "$1" == run ]]; then shift; fi
case "$1" in
  pm)
    [[ "$2" == pack ]]
    printf 'generic-%s' "$FLOW_TEST_VERSION" > "opencode-plugin-flow-$FLOW_TEST_VERSION.tgz"
    ;;
  scripts/prepare-qualified-release-940.ts)
    [[ "$FLOW_TEST_VERSION" == 9.4.0 ]]
    shift
    output=''
    repository=''
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --out) output="$2"; shift 2 ;;
        --repository-root) repository="$2"; shift 2 ;;
        *) exit 80 ;;
      esac
    done
    [[ -n "$output" ]]
    if [[ -n "$repository" ]]; then
      [[ "$(cat "$repository/README.md")" == 'qualified source' ]]
      printf '%s' "$repository" > .prepared-repository
    fi
    printf qualified-9.4.0 > "$output"
    printf '%s' "$output" > .prepared-path
    cat "$output"
    ;;
  scripts/materialize-qualification.ts)
    printf '%s/qualified-bundle' "$RUNNER_TEMP"
    ;;
  scripts/restore-exact-release-artifact.ts)
    case "$4" in
      sha256:0af07377229cd23d5f1ec7fd666666bc58ffda94348fce4d0070af0a05d6f80b) printf qualified-9.2.0 > "$2" ;;
      sha256:5635502fd5f56ff160edcb78bc8b1d34fb2545e3aaf20fac4f25272f7cdbed9f) printf qualified-9.3.0 > "$2" ;;
      sha256:03970e413588b9b32fb2c38ab859352c8c56c8a1937c64c6ca5d440cc96371cd) printf qualified-9.5.0 > "$2" ;;
      *) exit 80 ;;
    esac
    ;;
  release:metadata)
    if [[ " $* " == *' --tag '* ]]; then printf 'METADATA VERIFIED\\n'; else printf 'METADATA INCONCLUSIVE\\n'; fi
    ;;
  eval:canary)
    if [[ " $* " == *' --mode strict '* ]]; then printf 'CANARY VERIFIED\\n'; else printf 'CANARY DRY RUN\\n'; fi
    ;;
  install)
    [[ "$2" == --frozen-lockfile ]]
    ;;
  -e)
    source="$(cat README.md)"
    [[ "$source" == 'qualified source' || "$source" == 'candidate source' ]]
    printf '%s' "$source" > "$FLOW_TEST_REGRADE_LOG"
    printf 'RETAINED\\n'
    ;;
  *) exit 80 ;;
esac
`,
		{ mode: 0o700 },
	);
	return { root, bin };
}
function execute(
	run: string,
	f: { root: string; bin: string },
	version: string,
	recovery = "",
) {
	return spawnSync("bash", ["-c", run], {
		cwd: f.root,
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${f.bin}:${process.env.PATH}`,
			FLOW_TEST_VERSION: version,
			FLOW_RELEASE_RECOVERY_TAG: recovery,
			FLOW_TEST_REGRADE_LOG: join(f.root, ".regraded-source"),
			GITHUB_WORKSPACE: f.root,
			RUNNER_TEMP: f.root,
		},
	});
}
for (const [job, name] of [
	["verify-main-and-tag", "Rebuild release candidate"],
	["release", "Prepare package"],
] as const) {
	for (const [version, recovery, expected] of [
		["9.4.0", "", "qualified-9.4.0"],
		["9.5.0", "", "qualified-9.5.0"],
		["9.5.0", "v9.5.0", "qualified-9.5.0"],
		["9.2.0", "v9.2.0", "qualified-9.2.0"],
		["9.3.0", "v9.3.0", "qualified-9.3.0"],
	] as const) {
		test(`${job} emits ${expected} through its actual ${version} shell branch`, async () => {
			const run = await step(job, name),
				f = await fixture(version);
			const result = execute(run, f, version, recovery);
			expect(result.status, result.stderr).toBe(0);
			expect(
				await readFile(
					join(f.root, `opencode-plugin-flow-${version}.tgz`),
					"utf8",
				),
			).toBe(expected);
			if (version === "9.4.0")
				expect(
					run.match(/scripts\/prepare-qualified-release-940\.ts/g) ?? [],
				).toHaveLength(1);
		});
	}
}

async function createReleaseTag(f: { root: string }) {
	await writeFile(join(f.root, "README.md"), "qualified source");
	for (const args of [
		["init"],
		["config", "user.name", "Local Fixture"],
		["config", "user.email", "fixture@example.invalid"],
		["add", "."],
		["-c", "commit.gpgsign=false", "commit", "-m", "released source"],
		["tag", "v9.4.0"],
	]) {
		const result = spawnSync("git", args, { cwd: f.root, encoding: "utf8" });
		expect(result.status, result.stderr).toBe(0);
	}
}

test("CI rebuilds the released tag while leaving changed PR source untouched", async () => {
	const f = await fixture("9.4.0");
	await mkdir(join(f.root, "evals/qualification/archives"), {
		recursive: true,
	});
	await writeFile(
		join(f.root, "evals/qualification/archives/9.4.0.json"),
		"{}",
	);
	await createReleaseTag(f);
	await writeFile(join(f.root, "README.md"), "changed PR source");
	const run = await step(
		"check",
		"Rebuild qualified 9.4.0 artifact without providers",
		".github/workflows/ci.yml",
	);
	const result = execute(run, f, "9.4.0");
	expect(result.status, result.stderr).toBe(0);
	const repository = await readFile(
		join(f.root, ".prepared-repository"),
		"utf8",
	);
	expect(repository).not.toBe(f.root);
	expect(await readFile(join(f.root, "README.md"), "utf8")).toBe(
		"changed PR source",
	);
	const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], {
		cwd: f.root,
		encoding: "utf8",
	});
	expect(worktrees.status, worktrees.stderr).toBe(0);
	expect(worktrees.stdout).not.toContain(repository);
});

for (const [version, tagged, expected] of [
	["9.4.0", true, "qualified source"],
	["9.5.0", false, "candidate source"],
] as const) {
	test(`CI regrades ${tagged ? "released" : "candidate"} ${version} with its matching verifier source`, async () => {
		const f = await fixture(version);
		const archives = join(f.root, "evals/qualification/archives");
		await mkdir(archives, { recursive: true });
		await writeFile(join(archives, `${version}.json`), "{}");
		if (tagged) await createReleaseTag(f);
		await writeFile(
			join(f.root, "README.md"),
			tagged ? "changed PR source" : expected,
		);
		const run = await step(
			"check",
			"Regrade retained qualification archive without providers",
			".github/workflows/ci.yml",
		);
		const result = execute(run, f, version);
		expect(result.status, result.stderr).toBe(0);
		expect(await readFile(join(f.root, ".regraded-source"), "utf8")).toBe(
			expected,
		);
		expect(await readFile(join(f.root, "README.md"), "utf8")).toBe(
			tagged ? "changed PR source" : expected,
		);
	});
}

test("9.4.0 archive readiness emits strict current-time metadata and canary verdicts", async () => {
	const f = await fixture("9.4.0");
	await mkdir(join(f.root, "evals/qualification/archives"), {
		recursive: true,
	});
	await writeFile(
		join(f.root, "evals/qualification/archives/9.4.0.json"),
		"{}",
	);
	await writeFile(
		join(f.root, "opencode-plugin-flow-9.4.0.tgz"),
		"qualified-9.4.0",
	);
	const run = await step(
		"verify-main-and-tag",
		"Report release evidence readiness without publishing",
	);
	const result = execute(run, f, "9.4.0");
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout).toBe(
		"METADATA INCONCLUSIVE\nMETADATA VERIFIED\nCANARY VERIFIED\n",
	);
	expect(run).not.toContain("--freshness retained");
});

async function guardFixture(version = "9.4.0", corruptArchive = false) {
	const root = await mkdtemp(join(tmpdir(), "flow-qualified-guard-"));
	temporary.push(root);
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ version, packageManager: "bun@1.4.0" }),
	);
	await writeFile(join(root, "README.md"), "source baseline");
	if (corruptArchive) {
		const archives = join(root, "evals/qualification/archives");
		await mkdir(archives, { recursive: true });
		await writeFile(join(archives, "9.4.0.tar.gz"), "corrupt archive bytes");
		await writeFile(
			join(archives, "9.4.0.json"),
			JSON.stringify({
				schemaVersion: 1,
				packageVersion: "9.4.0",
				archive: "9.4.0.tar.gz",
				archiveSha256: `sha256:${"0".repeat(64)}`,
				bundleId: `qb1-${"0".repeat(64)}`,
				bundleSha256: `sha256:${"0".repeat(64)}`,
			}),
		);
	}
	for (const args of [
		["init"],
		["config", "user.name", "Local Fixture"],
		["config", "user.email", "fixture@example.invalid"],
		["add", "."],
		["-c", "commit.gpgsign=false", "commit", "-m", "fixture"],
	]) {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		expect(result.status, result.stderr).toBe(0);
	}
	return { root, outputPath: join(root, "opencode-plugin-flow-9.4.0.tgz") };
}
function prepareCLI(repositoryRoot: string, outputPath: string) {
	return spawnSync(
		process.execPath,
		[
			resolve("scripts/prepare-qualified-release-940.ts"),
			"--repository-root",
			repositoryRoot,
			"--out",
			outputPath,
		],
		{ encoding: "utf8" },
	);
}
for (const [variant, expectedError] of [
	["version", /requires package version 9\.4\.0/],
	["dirty-source", /clean Git checkout/],
	["existing-output", /output already exists/],
	["archive-digest", /Archive digest mismatch/],
	["output-name", /Output must be named/],
] as const) {
	test(`real preparation CLI rejects ${variant} before build and preserves caller files`, async () => {
		const f = await guardFixture(
			variant === "version" ? "9.3.0" : "9.4.0",
			variant === "archive-digest",
		);
		if (variant === "dirty-source")
			await writeFile(join(f.root, "README.md"), "uncommitted source change");
		if (variant === "existing-output")
			await writeFile(f.outputPath, "retained artifact");
		const output =
			variant === "output-name" ? join(f.root, "README.md") : f.outputPath;
		const result = prepareCLI(f.root, output);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(expectedError);
		if (variant === "existing-output")
			expect(await readFile(output, "utf8")).toBe("retained artifact");
		else
			await expect(readFile(f.outputPath)).rejects.toMatchObject({
				code: "ENOENT",
			});
		expect(await readFile(join(f.root, "README.md"), "utf8")).toBe(
			variant === "dirty-source"
				? "uncommitted source change"
				: "source baseline",
		);
	});
}

for (const [version, archived, expected] of [
	["9.4.0", true, "qualified-9.4.0"],
	["9.5.0", true, "No qualified 9.4.0 artifact rebuild declared.\n"],
	["9.4.0", false, "No qualified 9.4.0 artifact rebuild declared.\n"],
] as const) {
	test(`PR CI ${version} archive=${archived} executes its maintained preparation branch`, async () => {
		const f = await fixture(version);
		if (archived) {
			const directory = join(f.root, "evals/qualification/archives");
			await mkdir(directory, { recursive: true });
			await writeFile(join(directory, `${version}.json`), "{}");
		}
		if (version === "9.4.0" && archived) await createReleaseTag(f);
		const run = await step(
			"check",
			"Rebuild qualified 9.4.0 artifact without providers",
			".github/workflows/ci.yml",
		);
		const result = execute(run, f, version);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe(expected);
		if (version === "9.4.0" && archived) {
			const output = await readFile(join(f.root, ".prepared-path"), "utf8");
			await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
		} else
			await expect(
				readFile(join(f.root, ".prepared-path")),
			).rejects.toMatchObject({ code: "ENOENT" });
	});
}

test("exact restoration accepts permission differences and rejects changed file contents", async () => {
	const root = await mkdtemp(join(tmpdir(), "flow-release-metadata-"));
	temporary.push(root);
	const packageDirectory = join(root, "package");
	await mkdir(packageDirectory);
	const file = join(packageDirectory, "README.md");
	await writeFile(file, "qualified contents");
	await chmod(file, 0o664);
	const sealed = join(root, "sealed.tgz"),
		rebuilt = join(root, "rebuilt.tgz");
	const pack = (output: string) => {
		const result = spawnSync("tar", ["-czf", output, "-C", root, "package"], {
			encoding: "utf8",
		});
		expect(result.status, result.stderr).toBe(0);
	};
	pack(sealed);
	const bytes = await readFile(sealed);
	const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
	await chmod(file, 0o644);
	pack(rebuilt);
	expect(await readFile(rebuilt)).not.toEqual(bytes);
	const restore = () =>
		spawnSync(
			process.execPath,
			[
				resolve("scripts/restore-exact-release-artifact.ts"),
				rebuilt,
				sealed,
				digest,
			],
			{ encoding: "utf8" },
		);
	expect(restore().status).toBe(0);
	expect(await readFile(rebuilt)).toEqual(bytes);
	await writeFile(file, "changed contents");
	pack(rebuilt);
	const changed = await readFile(rebuilt);
	const rejected = restore();
	expect(rejected.status).not.toBe(0);
	expect(rejected.stderr).toContain("Rebuilt package contents differ");
	expect(await readFile(rebuilt)).toEqual(changed);
});
