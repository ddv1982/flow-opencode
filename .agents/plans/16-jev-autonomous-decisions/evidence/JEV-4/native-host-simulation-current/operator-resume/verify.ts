import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	cwd: fileURLToPath(new URL(".", import.meta.url)),
	encoding: "utf8",
}).trim();
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repositoryRoot, encoding: "buffer" });
const read = (name: string) => readFile(new URL(name, import.meta.url));
const sha = (value: Uint8Array) =>
	createHash("sha256").update(value).digest("hex");
const assert = (condition: unknown, label: string) => {
	if (!condition)
		throw new Error(`Operator simulation receipt invalid: ${label}`);
};
const { datasetDigest } = await import(
	pathToFileURL(join(repositoryRoot, "evals/recovery-decisions/schema.ts")).href
);
const { HostArtifactsSchema } = await import(
	pathToFileURL(join(repositoryRoot, "evals/host-artifacts.ts")).href
);
const receipt = JSON.parse(await read("receipt.json"));
assert(/^[a-f0-9]{40}$/.test(receipt.sourceHead), "source commit");
assert(
	spawnSync(
		"git",
		[
			"diff",
			"--quiet",
			receipt.sourceHead,
			"HEAD",
			"--",
			"src",
			"skills",
			"evals",
			"scripts",
			"tests/recovery-operator-host.test.ts",
			"tests/recovery-operator-support.ts",
			"package.json",
			"bun.lock",
			"tsconfig.json",
			"tsconfig.types.json",
		],
		{ cwd: repositoryRoot },
	).status === 0,
	"current runtime differs from measured head",
);
for (const [path, field] of [
	["tests/recovery-operator-host.test.ts", "testFileSha256"],
	["tests/recovery-operator-support.ts", "supportFileSha256"],
	["evals/harness.ts", "harnessSha256"],
	["bun.lock", "lockSha256"],
] as const)
	assert(
		sha(git("show", `${receipt.sourceHead}:${path}`)) === receipt[field],
		`${path} digest`,
	);
const log = await read("smoke.log");
assert(sha(log) === receipt.logSha256, "log digest");
const text = log.toString("utf8");
const cases = text
	.split("\n")
	.filter((line) => line.startsWith("(pass) "))
	.map((line) => line.slice(7).replace(/ \[[^\]]+\]$/, ""));
const expected = [
	"real openai/gpt-5.6-terra operator episode resumes",
	"real openai/gpt-5.6-terra operator episode cancels",
	"real xai/grok-4.6 operator episode resumes",
	"real xai/grok-4.6 operator episode cancels",
];
assert(
	receipt.classification ===
		"current-head-real-host-operator-simulation-only" &&
		receipt.hostVersion === "1.18.31" &&
		receipt.passed === 4 &&
		receipt.failed === 0 &&
		text.includes(" 4 pass") &&
		text.includes(" 0 fail") &&
		JSON.stringify(cases) === JSON.stringify(expected) &&
		JSON.stringify(receipt.scenarios) === JSON.stringify(expected),
	"four operator simulation outcomes",
);
assert(
	receipt.trustedExecutableVersion === "1.18.31" &&
		/^[a-f0-9]{64}$/.test(receipt.trustedExecutableSha256) &&
		receipt.hostArtifactCaptures?.length === 4,
	"pinned native executable identity",
);
let previousStart = Number.NEGATIVE_INFINITY;
for (const [index, row] of receipt.hostArtifactCaptures.entries()) {
	const name = `capture-${String(index + 1).padStart(2, "0")}.json`;
	assert(row.file === name, "ordered artifact capture");
	const bytes = await read(`host-artifacts/${name}`);
	assert(sha(bytes) === row.sha256, `${name} digest`);
	const capture = JSON.parse(bytes.toString("utf8"));
	const artifacts = HostArtifactsSchema.parse(capture.hostArtifacts);
	const started = Date.parse(capture.headerStartedAt);
	assert(
		capture.captureOrdinal === index + 1 &&
			capture.arm === "manager-only" &&
			capture.declaredOrigin === "simulation" &&
			/^[a-f0-9]{64}$/.test(capture.headerSha256) &&
			Number.isFinite(started) &&
			started >= previousStart &&
			artifacts.opencode.version === receipt.trustedExecutableVersion &&
			artifacts.opencode.bytes.sha256 === receipt.trustedExecutableSha256 &&
			artifacts.opencode.bytes.executable === true &&
			artifacts.packageCache === null &&
			capture.artifactVerification.method ===
				"copied-files-and-linux-process" &&
			capture.artifactVerification.manifestDigest === datasetDigest(artifacts),
		`${name} process artifact attestation`,
	);
	previousStart = started;
}
const executable = process.env.FLOW_RECOVERY_OPENCODE_EXECUTABLE;
let localBinaryVerified = false;
if (executable) {
	const path = await realpath(executable);
	const version = spawnSync(path, ["--version"], { encoding: "utf8" });
	assert(
		sha(await readFile(path)) === receipt.trustedExecutableSha256 &&
			version.status === 0 &&
			version.stdout.trim() === receipt.trustedExecutableVersion,
		"local pinned executable differs",
	);
	localBinaryVerified = true;
}
assert(
	sha(await read("verify.ts")) === receipt.verifySha256,
	"verifier digest",
);
process.stdout.write(
	`${JSON.stringify({ verdict: localBinaryVerified ? "verified-operator-simulation" : "verified-captured-host-identity", head: receipt.sourceHead, cases: cases.length, opencodeSha256: receipt.trustedExecutableSha256 })}\n`,
);
