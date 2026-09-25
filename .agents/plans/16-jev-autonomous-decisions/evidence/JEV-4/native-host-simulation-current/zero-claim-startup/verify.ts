import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
				},
				index: number,
			) =>
				row.managerModel === expected[index]?.[0] &&
				row.arm === expected[index]?.[1] &&
				row.origin === "live" &&
				row.zeroClaims === true &&
				row.opencodeVersion === "1.18.31",
		),
	"four distinct zero-claim arms",
);
assert(
	sha(await read("verify.ts")) === receipt.verifySha256,
	"verifier digest",
);
process.stdout.write(
	`${JSON.stringify({ verdict: "verified-zero-claim-simulation", head: receipt.sourceHead, arms: report.records.length })}\n`,
);
