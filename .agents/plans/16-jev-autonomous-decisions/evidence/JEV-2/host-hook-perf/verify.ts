import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const read = (name: string) => readFile(new URL(name, import.meta.url));
const sha = (bytes: string | Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const assert = (condition: unknown, label: string) => {
	if (!condition) throw new Error(`Host hook diagnostic invalid: ${label}`);
};
const git = (...args: string[]) =>
	execFileSync("git", args, { encoding: "buffer" });
const gitStatus = (...args: string[]) => spawnSync("git", args).status;
const percentile = (samples: number[], fraction: number) => {
	const sorted = samples.toSorted((a, b) => a - b);
	return sorted[Math.ceil(fraction * sorted.length) - 1];
};
const round = (value: number) => Number(value.toFixed(3));
const mib = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(2));
const receipt = JSON.parse(await read("receipt.json"));
for (const commit of [
	receipt.trunkCommit,
	receipt.headCommit,
	receipt.introductionCommit,
])
	assert(/^[a-f0-9]{40}$/.test(commit), "commit identity");
assert(
	gitStatus(
		"merge-base",
		"--is-ancestor",
		receipt.introductionCommit,
		receipt.trunkCommit,
	) === 1 &&
		gitStatus(
			"merge-base",
			"--is-ancestor",
			receipt.introductionCommit,
			receipt.headCommit,
		) === 0,
	"pre-JEV-2 trunk and current candidate ancestry",
);
assert(
	gitStatus("diff", "--quiet", receipt.headCommit, "HEAD", "--", "src") === 0,
	"current candidate source differs from measured head",
);
assert(sha(await read("probe.ts")) === receipt.probeSha256, "probe hash");
assert(sha(await read("verify.ts")) === receipt.verifySha256, "verifier hash");
assert(receipt.runs.length === 3, "three paired runs");
const sourceHash = {
	trunk: sha(
		git("show", `${receipt.trunkCommit}:src/platform/opencode/plugin.ts`),
	),
	head: sha(
		git("show", `${receipt.headCommit}:src/platform/opencode/plugin.ts`),
	),
};
assert(sourceHash.trunk !== sourceHash.head, "different plugin sources");
const fixture = {
	event: "session.idle",
	command: "flow-auto",
	workflow: "idle-workspace-initial-prompt",
	warmup: 300,
	samples: 1500,
	hostSessionId: "host-1",
};
assert(sha(JSON.stringify(fixture)) === receipt.fixtureDigest, "fixed fixture");
let firstRuntime: string | null = null;
const rows = [];
for (const [index, pair] of receipt.runs.entries()) {
	const measured: Record<string, { p95Us: number; rssAfterProbeMiB: number }> =
		{};
	for (const arm of ["trunk", "head"] as const) {
		const retained = pair[arm];
		const name = `${arm}-${index + 1}.json.gz`;
		assert(retained.file === name, "ordered raw artifact");
		const compressed = await read(name);
		assert(sha(compressed) === retained.gzipSha256, `${name} gzip hash`);
		const expanded = gunzipSync(compressed);
		assert(sha(expanded) === retained.expandedSha256, `${name} raw hash`);
		const raw = JSON.parse(expanded.toString("utf8"));
		assert(
			raw.fixtureDigest === receipt.fixtureDigest &&
				JSON.stringify(raw.fixture) === JSON.stringify(fixture),
			`${name} fixture`,
		);
		assert(
			raw.moduleSha256 === sourceHash[arm] &&
				raw.moduleSha256 === retained.moduleSha256,
			`${name} source`,
		);
		const runtime = JSON.stringify(raw.runtime);
		if (firstRuntime === null) firstRuntime = runtime;
		assert(runtime === firstRuntime, `${name} runtime`);
		assert(
			raw.fetchCalls === 0 &&
				raw.promptCalls === fixture.warmup + fixture.samples &&
				raw.samplesUs.length === fixture.samples &&
				raw.samplesUs.every(
					(value: number) => Number.isFinite(value) && value >= 0,
				),
			`${name} completed route without network`,
		);
		const p50Us = percentile(raw.samplesUs, 0.5);
		const p95Us = percentile(raw.samplesUs, 0.95);
		assert(
			Math.abs(p50Us - raw.p50Us) < 1e-9 &&
				Math.abs(p95Us - raw.p95Us) < 1e-9 &&
				round(p95Us) === retained.p95Us,
			`${name} recomputed latency`,
		);
		const rssAfterProbeMiB = mib(raw.rssAfterProbeBytes);
		assert(
			rssAfterProbeMiB === retained.rssAfterProbeMiB,
			`${name} recomputed RSS`,
		);
		measured[arm] = { p95Us, rssAfterProbeMiB };
	}
	const addedP95Us = round(measured.head.p95Us - measured.trunk.p95Us);
	assert(addedP95Us === pair.addedP95Us, "paired p95 delta");
	rows.push(addedP95Us);
}
assert(
	Math.max(...rows) === receipt.maxAddedP95Us && receipt.maxAddedP95Us < 5000,
	"maximum p95 overhead",
);
const readme = (await read("README.md")).toString("utf8");
assert(
	readme.includes(receipt.trunkCommit) &&
		readme.includes(receipt.headCommit) &&
		readme.includes(`${receipt.maxAddedP95Us.toFixed(3)} microseconds`) &&
		receipt.runs.every(
			(
				pair: {
					trunk: { p95Us: number };
					head: { p95Us: number };
					addedP95Us: number;
				},
				index: number,
			) =>
				readme.includes(
					`| ${index + 1} | ${pair.trunk.p95Us.toFixed(3)} | ${pair.head.p95Us.toFixed(3)} | ${pair.addedP95Us >= 0 ? "+" : ""}${pair.addedP95Us.toFixed(3)} |`,
				),
		),
	"README identity and summary",
);
process.stdout.write(
	`${JSON.stringify({ verdict: "verified-diagnostic", pairs: rows.length, maxAddedP95Us: receipt.maxAddedP95Us })}\n`,
);
