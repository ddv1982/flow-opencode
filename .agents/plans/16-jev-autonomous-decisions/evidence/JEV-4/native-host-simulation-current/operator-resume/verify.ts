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
const sha = (value: Uint8Array) =>
	createHash("sha256").update(value).digest("hex");
const assert = (condition: unknown, label: string) => {
	if (!condition)
		throw new Error(`Operator simulation receipt invalid: ${label}`);
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
	sha(await read("verify.ts")) === receipt.verifySha256,
	"verifier digest",
);
process.stdout.write(
	`${JSON.stringify({ verdict: "verified-operator-simulation", head: receipt.sourceHead, cases: cases.length })}\n`,
);
