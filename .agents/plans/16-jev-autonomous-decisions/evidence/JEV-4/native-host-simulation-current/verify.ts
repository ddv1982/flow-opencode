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
const assert = (condition: unknown, reason: string) => {
	if (!condition) throw new Error(`Host simulation receipt invalid: ${reason}`);
};
const receipt = JSON.parse(await read("receipt.json"));
assert(/^[a-f0-9]{40}$/.test(receipt.sourceHead), "source commit");
assert(
	git("rev-parse", `${receipt.sourceHead}^{tree}`).toString("utf8").trim() ===
		receipt.sourceTreeOid,
	"source tree",
);
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
for (const [path, key] of [
	["tests/recovery-treatment-host.test.ts", "testFileSha256"],
	["evals/harness.ts", "testHelperSha256"],
	["bun.lock", "lockSha256"],
] as const)
	assert(
		sha(git("show", `${receipt.sourceHead}:${path}`)) === receipt[key],
		`${path} digest`,
	);
const logBytes = await read("smoke.log");
assert(sha(logBytes) === receipt.logSha256, "log digest");
const log = logBytes.toString("utf8");
const cases = log
	.split("\n")
	.filter((line) => line.startsWith("(pass) "))
	.map((line) => line.slice(7).replace(/ \[[^\]]+\]$/, ""));
assert(
	cases.length === 10 &&
		receipt.passed === 10 &&
		receipt.failed === 0 &&
		log.includes(" 10 pass") &&
		log.includes(" 0 fail") &&
		JSON.stringify(cases) === JSON.stringify(receipt.scenarios),
	"ten retained host simulation results",
);
assert(
	cases.some((name) => name.includes("openai/gpt-5.6-terra")) &&
		cases.some((name) => name.includes("xai/grok-4.6")) &&
		cases.filter((name) => name.includes("stop revokes delayed")).length === 2,
	"both manager routes and delayed stop",
);
assert(
	sha(await read("verify.ts")) === receipt.verifySha256,
	"verifier digest",
);
process.stdout.write(
	`${JSON.stringify({ verdict: "verified-simulation-only", head: receipt.sourceHead, cases: cases.length })}\n`,
);
