import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deriveRetainedFailure,
	RetainedScenarioEvidenceSchema,
} from "../evals/grader-input.js";
import { EvalReportV2Schema } from "../evals/report.js";

test("real campaign fallback preserves replayable native abort proof after auxiliary reporting throws", async () => {
	const root = await mkdtemp(join(tmpdir(), "flow-abort-fallback-"));
	try {
		const child = Bun.spawn(
			[
				process.execPath,
				join(import.meta.dir, "fixtures", "eval-abort-fallback-child.ts"),
				root,
			],
			{
				cwd: root,
				env: {
					PATH: process.env.PATH,
					HOME: root,
					XDG_CONFIG_HOME: join(root, "config"),
					XDG_DATA_HOME: join(root, "data"),
					XDG_CACHE_HOME: join(root, "cache"),
					FLOW_EVAL_NO_AUTH_COPY: "1",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(code, stdout).toBe(0);
		const receipt = JSON.parse(
			await readFile(join(root, "fixture-result.json"), "utf8"),
		);
		expect(receipt.auxiliaryThrows).toBe(1);
		expect(receipt.elapsedMs).toBe(182_000);
		const results = join(root, "evals", "results");
		const directory = (await readdir(results)).find((name) =>
			name.endsWith(".v2"),
		);
		if (!directory) throw new Error("Missing real campaign report.");
		const report = EvalReportV2Schema.parse(
			JSON.parse(
				await readFile(join(results, directory, "report.json"), "utf8"),
			),
		);
		expect(report.attempts.length).toBe(1);
		const attempt = report.attempts[0];
		if (!attempt?.transcript)
			throw new Error("Missing real retained campaign transcript.");
		const retained = RetainedScenarioEvidenceSchema.parse(
			JSON.parse(
				await readFile(
					join(results, directory, attempt.transcript.artifact),
					"utf8",
				),
			),
		);
		expect(attempt.outcome).toEqual({
			kind: "failure",
			origin: "host",
			code: "command-aborted",
			retryable: true,
		});
		expect(deriveRetainedFailure(retained)).toEqual(retained.failure);
		expect(retained.failure?.retryable).toBe(true);
		expect(retained.gradeInput.allCalls[0]?.status).toBe("error");
		expect(
			retained.gradeInput.allCalls[0]?.metadata.interrupted,
		).toBeUndefined();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 20_000);
