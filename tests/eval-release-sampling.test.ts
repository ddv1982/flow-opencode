import { describe, expect, test } from "bun:test";
import { RELEASE_CASE_SAMPLING } from "../evals/release-policy.js";
import {
	campaignPlanFor,
	caseCatalogFor,
	type EvalSampling,
	jobsFor,
	releaseScenarios,
} from "../evals/run.js";
import { SCENARIOS } from "../evals/scenarios.js";

describe("release eval sampling", () => {
	test("gives 90 percent cases ten attempts and 100 percent cases three", () => {
		for (const policy of Object.values(RELEASE_CASE_SAMPLING)) {
			expect(policy.attemptsPerModel).toBe(policy.minPassRate === 0.9 ? 10 : 3);
		}
	});

	test("freezes mixed release counts without changing ordinary repeats", () => {
		const scenarios = SCENARIOS.filter((scenario) =>
			["happy-path", "unprovable-claim-refused"].includes(scenario.id),
		);
		const release = campaignPlanFor({
			models: ["xai/grok-4.6"],
			scenarios,
			sampling: { kind: "release" },
			opencodeVersion: "1.18.6",
		});
		expect(release.cells).toHaveLength(13);
		expect(
			release.cells.filter((cell) => cell.caseId === "happy-path"),
		).toHaveLength(3);
		expect(
			release.cells.filter(
				(cell) => cell.caseId === "unprovable-claim-refused",
			),
		).toHaveLength(10);
		expect(release.stoppingRule.count).toBe(13);
		expect(release.budget.maxAttempts).toBe(13);

		const ordinarySampling: EvalSampling = { kind: "ordinary", repeat: 2 };
		const ordinary = campaignPlanFor({
			models: ["xai/grok-4.6"],
			scenarios,
			sampling: ordinarySampling,
			opencodeVersion: "1.18.6",
		});
		expect(ordinary.cells).toHaveLength(4);
		expect(ordinary.cells[0]?.cellId).toBe(
			"cell-4a19664cd1b31276a1229d7d37387cb27e3caf9861fb78f00e15782c230fb2de",
		);
		expect(ordinary.randomizationSeed).toBe(
			"sha256:647ef4f649e660cae94154da571c2508a1a4d0a1ad8171cc9ba654c6bfa8b0bf",
		);
		expect(ordinary.planSha256).toBe(
			"sha256:b1b9aca59f2c74f6a74b86e42924183d320fdd929225a11d7f25fa00ffcb101c",
		);
	});

	test("schedules exactly the required 70-cell two-provider release", () => {
		const scenarios = releaseScenarios();
		expect(scenarios.map((scenario) => scenario.id).sort()).toEqual(
			Object.keys(RELEASE_CASE_SAMPLING).sort(),
		);
		const plan = campaignPlanFor({
			models: ["xai/grok-4.6", "openai/gpt-5.6-sol"],
			scenarios,
			sampling: { kind: "release" },
			opencodeVersion: "1.18.6",
		});
		expect(plan.cells).toHaveLength(70);
		expect(plan.stoppingRule.count).toBe(70);
		expect(plan.budget.maxAttempts).toBe(70);
		for (const policy of caseCatalogFor(scenarios)) {
			expect(policy.minScoredAttempts).toBe(
				RELEASE_CASE_SAMPLING[
					policy.caseId as keyof typeof RELEASE_CASE_SAMPLING
				].attemptsPerModel,
			);
		}
		const jobs = jobsFor(["xai/grok-4.6", "openai/gpt-5.6-sol"], scenarios, {
			kind: "release",
		}).flat();
		expect(
			jobs.map((job) => [job.slot, job.scenario.id, job.attempt - 1]),
		).toEqual(
			plan.cells.map((cell, slot) => [slot, cell.caseId, cell.repetition]),
		);
	});

	test("rejects release sampling overrides", async () => {
		for (const override of [
			["--repeat", "3"],
			["--scenario", "happy-path"],
			["--repeat"],
			["--scenario"],
		]) {
			const child = Bun.spawn(
				[
					"bun",
					"run",
					"evals/run.ts",
					"--model",
					"xai/grok-4.6",
					"--release",
					...override,
				],
				{ cwd: new URL("..", import.meta.url).pathname, stderr: "pipe" },
			);
			const [exitCode, stderr] = await Promise.all([
				child.exited,
				new Response(child.stderr).text(),
			]);
			expect(exitCode).toBe(2);
			expect(stderr).toContain(
				"--release cannot be combined with --repeat or --scenario",
			);
		}
	});

	test("rejects a release with fewer than two route providers", async () => {
		const child = Bun.spawn(
			[
				"bun",
				"run",
				"evals/run.ts",
				"--model",
				"xai/not-a-real-model-a",
				"--model",
				"xai/not-a-real-model-b",
				"--release",
			],
			{ cwd: new URL("..", import.meta.url).pathname, stderr: "pipe" },
		);
		const [exitCode, stderr] = await Promise.all([
			child.exited,
			new Response(child.stderr).text(),
		]);
		expect(exitCode).toBe(2);
		expect(stderr).toContain(
			"--release requires at least 2 distinct route providers",
		);
	});

	test("does not consume a flag as a model value", async () => {
		const child = Bun.spawn(
			["bun", "run", "evals/run.ts", "--model", "--release"],
			{ cwd: new URL("..", import.meta.url).pathname, stderr: "pipe" },
		);
		const [exitCode, stderr] = await Promise.all([
			child.exited,
			new Response(child.stderr).text(),
		]);
		expect(exitCode).toBe(2);
		expect(stderr).toContain("--model requires a value");
	});
});
