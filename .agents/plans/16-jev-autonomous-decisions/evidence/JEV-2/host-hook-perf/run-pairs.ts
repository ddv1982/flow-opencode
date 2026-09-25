import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [trunkRoot, headRoot, outputRoot] = process.argv.slice(2);
if (!trunkRoot || !headRoot || !outputRoot)
	throw new Error("Expected pinned trunk, head, and output directories.");
const probe = fileURLToPath(new URL("probe.ts", import.meta.url));
const receipt = JSON.parse(await readFile(new URL("receipt.json", import.meta.url)));
const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const revision = (root: string) =>
	execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
if (
	revision(trunkRoot) !== receipt.trunkCommit ||
	revision(headRoot) !== receipt.headCommit
)
	throw new Error("Benchmark worktree revisions differ from the receipt.");
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const order = [
	["trunk", 1, trunkRoot],
	["head", 1, headRoot],
	["head", 2, headRoot],
	["trunk", 2, trunkRoot],
	["trunk", 3, trunkRoot],
	["head", 3, headRoot],
] as const;
const processes = [];
for (const [ordinal, [arm, pair, root]] of order.entries()) {
	const output = join(outputRoot, `${arm}-${pair}.json`);
	const startedAt = new Date().toISOString();
	const child = Bun.spawnSync({
		cmd: [
			process.execPath,
			probe,
			join(root, "src/platform/opencode/plugin.ts"),
			output,
			arm,
			String(pair),
			String(ordinal + 1),
		],
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitedAt = new Date().toISOString();
	if (child.exitCode !== 0)
		throw new Error(
			`Benchmark ${arm}-${pair} failed: ${Buffer.from(child.stderr).toString("utf8")}`,
		);
	processes.push({
		arm,
		pair,
		ordinal: ordinal + 1,
		startedAt,
		exitedAt,
		outputSha256: sha(await readFile(output)),
	});
}
await writeFile(
	join(outputRoot, "processes.json"),
	`${JSON.stringify({ schemaVersion: 1, processes }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ completed: processes.length })}\n`);
