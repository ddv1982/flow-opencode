import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function run(accept: boolean) {
	const directory = await mkdtemp(join(tmpdir(), "flow-replay-capability-"));
	const fixture = JSON.parse(
		await readFile(
			new URL(
				"../evals/cassettes/plan-only-stops--fixture_hand-written--worker.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const path = join(directory, "native-required.json");
	const original = `${JSON.stringify({ ...fixture, scenario: "delivery-summary-deferred", fidelity: [] }, null, 2)}\n`;
	await writeFile(path, original);
	try {
		const child = Bun.spawn(
			[
				process.execPath,
				"evals/replay-run.ts",
				"--from",
				directory,
				...(accept ? ["--accept"] : []),
			],
			{ cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" },
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return {
			exitCode,
			stdout,
			stderr,
			unchanged: (await readFile(path, "utf8")) === original,
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("old empty fidelity cannot gate a checker requiring native host provenance", async () => {
	const result = await run(false);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain("UNSUPPORTED");
	expect(result.stdout).toContain("native-host-provenance-unreplayed");
	expect(result.stdout).toContain("0/0 gated cassette(s) reproduced");
	expect(result.unchanged).toBe(true);
});

test("accept refuses unavailable native evidence and preserves original bytes", async () => {
	const result = await run(true);
	expect(result.exitCode).toBe(1);
	expect(result.stdout).toContain("refused");
	expect(result.unchanged).toBe(true);
});
