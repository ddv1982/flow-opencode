import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	cwd: directory,
	encoding: "utf8",
}).trim();
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repositoryRoot, encoding: "buffer" });
const read = (name: string) => readFile(new URL(name, import.meta.url));
const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const assert = (condition: unknown, label: string) => {
	if (!condition) throw new Error(`Unit receipt invalid: ${label}`);
};

const receiptBytes = await read("receipt.json");
const receiptSha256 =
	"6776e94e5f773afe9e28235fdc23ee2fd16a8c728fce9100c4bddea63a43ae92";
assert(sha(receiptBytes) === receiptSha256, "pinned unit receipt root");
const receipt = JSON.parse(receiptBytes.toString("utf8"));
const measuredPaths = [
	"src",
	"skills",
	"evals",
	"scripts",
	"tests",
	"package.json",
	"bun.lock",
	"tsconfig.json",
	"tsconfig.types.json",
];
assert(
	receipt.schemaVersion === 1 &&
		receipt.classification === "exact-code-head-unit-only" &&
		receipt.qualification === "unit-only-live-interaction-performance-open" &&
		receipt.bunVersion === Bun.version &&
		receipt.sourceHead === "39c144b193606456a6f5413ba86ecd1f9190608b" &&
		git("rev-parse", `${receipt.sourceHead}^{tree}`).toString("utf8").trim() ===
			receipt.sourceTreeOid &&
		spawnSync(
			"git",
			["diff", "--quiet", receipt.sourceHead, "HEAD", "--", ...measuredPaths],
			{ cwd: repositoryRoot },
		).status === 0 &&
		git(
			"status",
			"--porcelain",
			"--untracked-files=all",
			"--",
			...measuredPaths,
		)
			.toString("utf8")
			.trim() === "",
	"measured source identity",
);
const expectedPaths = [
	"tests/recovery-policy.test.ts",
	"tests/jev-decision-provider.test.ts",
	"tests/runtime-gates.test.ts",
	"tests/auto-drive.test.ts",
	"tests/auto-drive-decision.test.ts",
	"tests/domain-transitions.test.ts",
	"bun.lock",
	"package.json",
];
assert(
	JSON.stringify(Object.keys(receipt.sourceDigests).sort()) ===
		JSON.stringify(expectedPaths.sort()),
	"complete focused source list",
);
for (const [path, digest] of Object.entries(receipt.sourceDigests))
	assert(
		sha(git("show", `${receipt.sourceHead}:${path}`)) === digest,
		`${path} digest`,
	);

const expected = [
	{
		phase: "JEV-2",
		log: "jev2.log",
		command:
			"bun test tests/recovery-policy.test.ts tests/jev-decision-provider.test.ts tests/runtime-gates.test.ts tests/auto-drive.test.ts tests/auto-drive-decision.test.ts",
		passed: 113,
		expectCalls: 1016,
		sentinels: [
			"shadow advice does not mint a pending mutation",
			"source drift after advice refuses the existing grant",
			"ambiguous save replays exact accepted operation",
			"first automatic reset followed by exact start remains available with shadow enabled",
			"restart refuses unconsumed recovery operations",
		],
	},
	{
		phase: "JEV-3",
		log: "jev3.log",
		command:
			"bun test tests/recovery-policy.test.ts tests/auto-drive.test.ts tests/auto-drive-decision.test.ts tests/runtime-gates.test.ts tests/domain-transitions.test.ts",
		passed: 142,
		expectCalls: 1169,
		sentinels: [
			"replays only the exact operation and rejects stale or conflicting mutations",
			"requires explicit retries while independent untouched work continues",
			"cancellation fences original manager lineage",
			"concurrent identical proposals buy one assessment and duplicate mutation replays",
			"old reset replay cannot mint fresh first-retry permission",
		],
	},
] as const;
assert(receipt.runs.length === expected.length, "two required commands");
for (const [index, spec] of expected.entries()) {
	const row = receipt.runs[index];
	const bytes = await read(spec.log);
	const text = bytes.toString("utf8");
	const passes = text.split("\n").filter((line) => line.startsWith("(pass) "));
	assert(
		row.phase === spec.phase &&
			row.command === spec.command &&
			row.log === spec.log &&
			row.logSha256 === sha(bytes) &&
			row.passed === spec.passed &&
			row.failed === 0 &&
			row.files === 5 &&
			row.expectCalls === spec.expectCalls &&
			passes.length === spec.passed &&
			text.includes(` ${spec.passed} pass`) &&
			text.includes(" 0 fail") &&
			text.includes(`${spec.expectCalls} expect() calls`) &&
			spec.sentinels.every((name) => text.includes(name)),
		`${spec.phase} focused unit run`,
	);
}
console.log(
	JSON.stringify({
		verdict: "verified-unit-only",
		measuredHead: receipt.sourceHead,
		jev2Pass: expected[0].passed,
		jev3Pass: expected[1].passed,
		liveAndPerformance: "open",
	}),
);
