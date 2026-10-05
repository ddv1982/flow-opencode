import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function run(
	accept: boolean,
	diverge = false,
	scenario = "delivery-summary-deferred",
) {
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
	if (diverge) fixture.events[0].observed.status = "error";
	const path = join(directory, "native-required.json");
	const original = `${JSON.stringify({ ...fixture, scenario, fidelity: [] }, null, 2)}\n`;
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

for (const scenario of [
	"delivery-summary-completed",
	"delivery-summary-deferred",
	"delivery-summary-observed-failure",
	"delivery-full-detail-followup",
	"delivery-idle-after-close",
])
	test(`${scenario} cannot gate native checking through empty legacy fidelity`, async () => {
		const result = await run(false, false, scenario);
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

test("unsupported report fidelity still displays runtime handler divergence", async () => {
	const result = await run(false, true);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain("UNSUPPORTED");
	expect(result.stdout).toContain("recorded error, replayed ok");
	expect(result.unchanged).toBe(true);
});

test("accept refuses a missing checker without rewriting its expectation", async () => {
	const result = await run(true, false, "missing-scenario");
	expect(result.exitCode).toBe(1);
	expect(result.stdout).toContain("NO-SCENARIO");
	expect(result.stdout).toContain("refused");
	expect(result.unchanged).toBe(true);
});
