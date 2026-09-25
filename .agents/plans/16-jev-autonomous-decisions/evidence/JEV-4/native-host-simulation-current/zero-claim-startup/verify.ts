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
const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const assert = (condition: unknown, reason: string) => {
	if (!condition)
		throw new Error(`Startup simulation receipt invalid: ${reason}`);
};
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
			"tests",
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
	["tests/recovery-live-host.test.ts", "testFileSha256"],
	["tests/recovery-live-host-child.ts", "childTestSha256"],
	["evals/harness.ts", "harnessSha256"],
] as const)
	assert(
		sha(git("show", `${receipt.sourceHead}:${path}`)) === receipt[field],
		`${path} digest`,
	);
const log = await read("smoke.log");
assert(sha(log) === receipt.logSha256, "log digest");
const text = log.toString("utf8");
assert(
	receipt.passed === 3 &&
		receipt.failed === 0 &&
		text.includes(" 3 pass") &&
		text.includes(" 0 fail") &&
		text.includes("(pass) isolated live host native without inference"),
	"three no-inference host tests",
);
const reportBytes = await read("sanitized-report.json");
assert(
	sha(reportBytes) === receipt.sanitizedReportSha256,
	"sanitized report digest",
);
const report = JSON.parse(reportBytes.toString("utf8"));
assert(
	receipt.trustedExecutableVersion === "1.18.31" &&
		/^[a-f0-9]{64}$/.test(receipt.trustedExecutableSha256) &&
		receipt.versionObservation === "post-run-same-sha256-local-binary--version",
	"pinned executable identity",
);
const expected = [
	["openai/gpt-5.6-terra", "manager-only"],
	["openai/gpt-5.6-terra", "manager-plus-jev"],
	["xai/grok-4.6", "manager-only"],
	["xai/grok-4.6", "manager-plus-jev"],
];
assert(
	report.classification === "synthetic-startup-zero-claims-only" &&
		report.records.length === 4 &&
		receipt.arms === 4 &&
		receipt.zeroClaimArms === 4 &&
		report.records.every(
			(
				row: {
					managerModel: string;
					arm: string;
					origin: string;
					zeroClaims: boolean;
					opencodeVersion: string;
					observedOpenCodeVersion: string;
					hostArtifacts: unknown;
				},
				index: number,
			) => {
				const artifacts = HostArtifactsSchema.parse(row.hostArtifacts);
				return (
					row.managerModel === expected[index]?.[0] &&
					row.arm === expected[index]?.[1] &&
					row.origin === "live" &&
					row.zeroClaims === true &&
					row.opencodeVersion === receipt.trustedExecutableVersion &&
					row.observedOpenCodeVersion === receipt.trustedExecutableVersion &&
					artifacts.opencode.version === receipt.trustedExecutableVersion &&
					artifacts.opencode.bytes.sha256 === receipt.trustedExecutableSha256 &&
					artifacts.opencode.bytes.executable === true &&
					artifacts.packageCache === null
				);
			},
		),
	"four distinct zero-claim arms",
);
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
	`${JSON.stringify({ verdict: localBinaryVerified ? "verified-zero-claim-simulation" : "verified-captured-host-identity", head: receipt.sourceHead, arms: report.records.length, opencodeSha256: receipt.trustedExecutableSha256 })}\n`,
);
