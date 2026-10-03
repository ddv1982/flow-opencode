import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
async function step(job: string, name: string): Promise<string> {
	const workflow = Workflow.parse(
		parse(await readFile(".github/workflows/release.yml", "utf8")),
	);
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
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --out) output="$2"; shift 2 ;;
        --repository-root) shift 2 ;;
        *) exit 80 ;;
      esac
    done
    [[ -n "$output" ]]
    printf qualified-9.4.0 > "$output"
    ;;
  scripts/restore-exact-release-artifact.ts)
    case "$4" in
      sha256:0af07377229cd23d5f1ec7fd666666bc58ffda94348fce4d0070af0a05d6f80b) printf qualified-9.2.0 > "$2" ;;
      sha256:5635502fd5f56ff160edcb78bc8b1d34fb2545e3aaf20fac4f25272f7cdbed9f) printf qualified-9.3.0 > "$2" ;;
      *) exit 80 ;;
    esac
    ;;
  release:metadata)
    if [[ " $* " == *' --tag '* ]]; then printf 'METADATA VERIFIED\\n'; else printf 'METADATA INCONCLUSIVE\\n'; fi
    ;;
  eval:canary)
    if [[ " $* " == *' --mode strict '* ]]; then printf 'CANARY VERIFIED\\n'; else printf 'CANARY DRY RUN\\n'; fi
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
		},
	});
}
for (const [job, name] of [
	["verify-main-and-tag", "Rebuild release candidate"],
	["release", "Prepare package"],
] as const) {
	for (const [version, recovery, expected] of [
		["9.4.0", "", "qualified-9.4.0"],
		["9.5.0", "", "generic-9.5.0"],
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
