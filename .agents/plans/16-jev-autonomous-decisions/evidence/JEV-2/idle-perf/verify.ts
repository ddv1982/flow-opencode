import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

type SampleRow = {
	kind: string;
	samplesUs: number[];
	p95Us: number;
	promptTotal: number;
	readTotal: number;
	warningTotal: number;
	proposalLookupTotal: number;
};
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	cwd: fileURLToPath(new URL(".", import.meta.url)),
	encoding: "utf8",
}).trim();
const read = async (name: string) => readFile(new URL(name, import.meta.url));
const sha = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex");
const assert = (ok: unknown, reason: string) => {
	if (!ok) throw new Error(`Idle performance receipt invalid: ${reason}`);
};
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repositoryRoot, encoding: "buffer" });
const ancestor = (older: string, newer: string) => {
	const result = spawnSync(
		"git",
		["merge-base", "--is-ancestor", older, newer],
		{ cwd: repositoryRoot },
	);
	assert(result.status === 0 || result.status === 1, "git ancestry probe");
	return result.status === 0;
};
const percentile = (samples: number[], fraction: number) => {
	const sorted = samples.toSorted((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
};
const round = (value: number) => Number(value.toFixed(3));
const receipt = JSON.parse(await read("receipt.json"));
for (const value of [
	receipt.baselineCommit,
	receipt.headCommit,
	receipt.introductionCommit,
])
	assert(/^[a-f0-9]{40}$/.test(value), "commit identity");
assert(
	!ancestor(receipt.introductionCommit, receipt.baselineCommit) &&
		ancestor(receipt.introductionCommit, receipt.headCommit),
	"baseline precedes JEV-2 introduction",
);
assert(sha(await read("probe.ts")) === receipt.probeSha256, "probe hash");
assert(sha(await read("verify.ts")) === receipt.verifySha256, "verifier hash");
const data = [];
for (const name of ["baseline", "head"]) {
	const compressed = await read(`${name}.json.gz`);
	assert(
		sha(compressed) === receipt.rawFiles[`${name}.json.gz`],
		`${name} gzip hash`,
	);
	const expanded = gunzipSync(compressed);
	assert(
		sha(expanded) === receipt.expandedSha256[`${name}.json`],
		`${name} expanded hash`,
	);
	data.push(JSON.parse(expanded.toString("utf8")));
}
const [baseline, head] = data;
assert(baseline && head, "raw pair");
const expectedFixture = {
	scenarios: [
		"no-lease",
		"ready-continuation",
		"blocked-handback",
		"recovery-checkpoint",
		"inactive",
	],
	warmupPerScenario: 300,
	samplesPerScenario: 1500,
	hostSessionId: "host-1",
	initialRevision: 11,
	nextRevision: 12,
};
assert(
	baseline.fixtureDigest === head.fixtureDigest &&
		baseline.fixtureDigest === receipt.fixtureDigest &&
		sha(JSON.stringify(expectedFixture)) === receipt.fixtureDigest &&
		JSON.stringify(baseline.fixture) === JSON.stringify(expectedFixture) &&
		JSON.stringify(head.fixture) === JSON.stringify(expectedFixture),
	"frozen identical fixture",
);
assert(
	baseline.results.length === expectedFixture.scenarios.length &&
		head.results.length === expectedFixture.scenarios.length,
	"required idle routes",
);
assert(
	JSON.stringify(baseline.runtime) === JSON.stringify(head.runtime) &&
		JSON.stringify(head.runtime) === JSON.stringify(receipt.runtime),
	"same runtime",
);
function sourceTreeAt(commit: string) {
	const files = git("ls-tree", "-r", "-z", "--name-only", commit, "src")
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.sort();
	assert(files.length > 0, "nonempty source tree");
	const hash = createHash("sha256");
	for (const path of files) {
		const bytes = git("show", `${commit}:${path}`);
		const length = Buffer.alloc(8);
		length.writeBigUInt64BE(BigInt(bytes.length));
		hash.update(path).update("\0").update(length).update(bytes);
	}
	return { digest: hash.digest("hex"), fileCount: files.length };
}
function runtimeInputsAt(commit: string) {
	const files = git(
		"ls-tree",
		"-r",
		"-z",
		"--name-only",
		commit,
		"src",
		"skills",
		"package.json",
		"bun.lock",
	)
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.sort();
	assert(
		files.includes("package.json") && files.includes("bun.lock"),
		"runtime manifests",
	);
	const hash = createHash("sha256");
	for (const path of files) {
		const bytes = git("show", `${commit}:${path}`);
		const length = Buffer.alloc(8);
		length.writeBigUInt64BE(BigInt(bytes.length));
		hash.update(path).update("\0").update(length).update(bytes);
	}
	return { digest: hash.digest("hex"), fileCount: files.length };
}
const sourceTree = {
	baseline: sourceTreeAt(receipt.baselineCommit),
	head: sourceTreeAt(receipt.headCommit),
};
const runtimeInputs = {
	baseline: runtimeInputsAt(receipt.baselineCommit),
	head: runtimeInputsAt(receipt.headCommit),
};
assert(
	sourceTree.baseline.digest !== sourceTree.head.digest &&
		spawnSync(
			"git",
			[
				"diff",
				"--quiet",
				receipt.headCommit,
				"HEAD",
				"--",
				"src",
				"skills",
				"package.json",
				"bun.lock",
			],
			{
				cwd: repositoryRoot,
			},
		).status === 0,
	"current candidate source tree differs from measured head",
);
for (const [name, row, commit] of [
	["baseline", baseline, receipt.baselineCommit],
	["head", head, receipt.headCommit],
] as const) {
	assert(row.fetchCalls === 0 && row.providerCalls === 0, `${name} call count`);
	const source = git("show", `${commit}:src/platform/opencode/auto-drive.ts`);
	assert(sha(source) === row.moduleSha256, `${name} auto-drive source`);
	assert(
		row.sourceTreeDigest === sourceTree[name].digest &&
			row.sourceFileCount === sourceTree[name].fileCount &&
			row.sourceTreeDigest === receipt[`${name}SourceTreeDigest`] &&
			row.sourceFileCount === receipt[`${name}SourceFileCount`],
		`${name} transitive source tree`,
	);
	assert(
		row.runtimeInputDigest === runtimeInputs[name].digest &&
			row.runtimeInputFileCount === runtimeInputs[name].fileCount &&
			row.runtimeInputDigest === receipt[`${name}RuntimeInputDigest`] &&
			row.runtimeInputFileCount === receipt[`${name}RuntimeInputFileCount`],
		`${name} external runtime inputs`,
	);
}
assert(
	baseline.moduleSha256 === receipt.baselineModuleSha256 &&
		head.moduleSha256 === receipt.headModuleSha256 &&
		baseline.moduleSha256 !== head.moduleSha256,
	"changed routing source",
);
assert(
	sha(
		git("show", `${receipt.headCommit}:src/application/recovery-policy.ts`),
	) === head.recoverySha256 &&
		head.recoverySha256 === receipt.headRecoverySha256,
	"head recovery policy source",
);
assert(
	sha(git("show", "HEAD:src/platform/opencode/auto-drive.ts")) ===
		head.moduleSha256 &&
		sha(git("show", "HEAD:src/application/recovery-policy.ts")) ===
			head.recoverySha256,
	"current candidate runtime differs from measured head",
);
assert(
	baseline.recoverySha256 === null &&
		receipt.fetchCalls === 0 &&
		receipt.providerCalls === 0,
	"disabled provider",
);
const rows = (baseline.results as SampleRow[]).map((earlier, index) => {
	const later = (head.results as SampleRow[])[index];
	if (!later)
		throw new Error("Idle performance receipt invalid: missing head route");
	assert(
		earlier.kind === expectedFixture.scenarios[index] &&
			later.kind === expectedFixture.scenarios[index],
		"pinned route order",
	);
	const expectedPrompts =
		earlier.kind === "ready-continuation" ||
		earlier.kind === "blocked-handback" ||
		earlier.kind === "recovery-checkpoint"
			? baseline.fixture.samplesPerScenario
			: 0;
	const expectedReads =
		earlier.kind === "no-lease" ? 0 : baseline.fixture.samplesPerScenario;
	const expectedHeadLookups =
		earlier.kind === "recovery-checkpoint"
			? baseline.fixture.samplesPerScenario
			: 0;
	for (const row of [earlier, later]) {
		assert(
			row.samplesUs.length === baseline.fixture.samplesPerScenario,
			"fixture sample count",
		);
		assert(
			row.promptTotal === expectedPrompts &&
				row.readTotal === expectedReads &&
				row.warningTotal === 0,
			"expected route counts",
		);
	}
	assert(
		earlier.promptTotal === later.promptTotal &&
			earlier.readTotal === later.readTotal &&
			earlier.warningTotal === later.warningTotal,
		"route and prompt counts",
	);
	assert(
		earlier.proposalLookupTotal === 0 &&
			later.proposalLookupTotal === expectedHeadLookups,
		"inactive recovery proposal path coverage",
	);
	const baselineRawP95Us = percentile(earlier.samplesUs, 0.95);
	const headRawP95Us = percentile(later.samplesUs, 0.95);
	assert(
		Math.abs(earlier.p95Us - baselineRawP95Us) < 1e-9 &&
			Math.abs(later.p95Us - headRawP95Us) < 1e-9,
		"stored p95 differs from samples",
	);
	const baselineP95Us = round(baselineRawP95Us);
	const headP95Us = round(headRawP95Us);
	return {
		scenario: earlier.kind,
		baselineP95Us,
		headP95Us,
		addedP95Us: round(headRawP95Us - baselineRawP95Us),
		callsAndRoutesMatch: true,
		baselineProposalLookups: earlier.proposalLookupTotal,
		headProposalLookups: later.proposalLookupTotal,
	};
});
assert(
	JSON.stringify(rows) === JSON.stringify(receipt.results),
	"recomputed p95 rows",
);
assert(
	Math.max(...rows.map((row: { addedP95Us: number }) => row.addedP95Us)) ===
		receipt.maxAddedP95Us,
	"maximum p95 delta",
);
const mib = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(2));
const rssMiB = {
	baselineAfterImports: mib(baseline.rssAfterImportsBytes),
	headAfterImports: mib(head.rssAfterImportsBytes),
	baselineAfterProbe: mib(baseline.rssAfterBytes),
	headAfterProbe: mib(head.rssAfterBytes),
};
assert(
	JSON.stringify(rssMiB) === JSON.stringify(receipt.rssMiB),
	"recomputed RSS summary",
);
const readme = (await read("README.md")).toString("utf8");
assert(
	readme.includes(receipt.baselineCommit) &&
		readme.includes(receipt.headCommit) &&
		readme.includes(`${receipt.maxAddedP95Us.toFixed(3)} microseconds`) &&
		readme.includes("across the five routes") &&
		readme.includes(
			`${rssMiB.headAfterImports.toFixed(2)} MiB versus ${rssMiB.baselineAfterImports.toFixed(2)} MiB`,
		) &&
		readme.includes(
			`${rssMiB.headAfterProbe.toFixed(2)} versus ${rssMiB.baselineAfterProbe.toFixed(2)} MiB`,
		),
	"README summary differs from verified receipt",
);
assert(
	receipt.maxAddedP95Us < 5000,
	"diagnostic exceeds the proposed 5 ms overhead limit",
);
process.stdout.write(
	`${JSON.stringify({ verdict: "verified-diagnostic", baseline: receipt.baselineCommit, head: receipt.headCommit, maxAddedP95Us: receipt.maxAddedP95Us })}\n`,
);
