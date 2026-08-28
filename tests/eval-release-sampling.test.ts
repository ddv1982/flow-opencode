import { describe, expect, test } from "bun:test";
import {
	assertExactReleaseCatalog,
	assertReleaseHost,
	releaseAttemptsFor,
	releaseCaseIds,
	releaseCatalog,
} from "../evals/release-policy.js";
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
		for (const policy of releaseCatalog()) {
			expect(releaseAttemptsFor(policy.caseId)).toBe(
				policy.minPassRate === 0.9 ? 10 : 3,
			);
		}
	});

	test("rejects any persisted catalog drift from repository policy", () => {
		const canonical = releaseCatalog();
		const mutations: unknown[] = [
			canonical.slice(1),
			[...canonical].reverse(),
			canonical.map((row, index) =>
				index === 0 ? { ...row, minPassRate: 0.9 } : row,
			),
			canonical.map((row, index) =>
				index === 0 ? { ...row, minProviders: 1 } : row,
			),
			canonical.map((row, index) =>
				index === 0 ? { ...row, minScoredAttempts: 1 } : row,
			),
		];
		for (const mutation of mutations) {
			expect(() => assertExactReleaseCatalog(mutation)).toThrow(
				"does not match repository release policy",
			);
		}
		expect(assertExactReleaseCatalog(canonical)).toEqual(canonical);
	});

	test("rejects narrowed release plans without changing ordinary repeats", () => {
		const scenarios = SCENARIOS.filter((scenario) =>
			["happy-path", "unprovable-claim-refused"].includes(scenario.id),
		);
		expect(() =>
			campaignPlanFor({
				models: ["xai/grok-4.6"],
				scenarios,
				sampling: { kind: "release" },
				opencodeVersion: "1.18.6",
			}),
		).toThrow("Release scenarios do not match repository release policy");

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
			"sha256:59ddde9655ac5aca872104603e8674504046db7de88e5f16f819a53af19532d5",
		);
	});

	test("schedules exactly the required 76-cell two-provider release", () => {
		const scenarios = releaseScenarios();
		expect(scenarios.map((scenario) => scenario.id).sort()).toEqual(
			[...releaseCaseIds()].sort(),
		);
		expect(releaseCaseIds()).toContain("skipped-case-named-binding");
		const plan = campaignPlanFor({
			models: ["xai/grok-4.6", "openai/gpt-5.6-sol"],
			scenarios,
			sampling: { kind: "release" },
			opencodeVersion: "1.18.6",
		});
		expect(plan.cells).toHaveLength(76);
		expect(plan.stoppingRule.count).toBe(76);
		expect(plan.budget.maxAttempts).toBe(76);
		expect(caseCatalogFor(scenarios, { kind: "release" })).toEqual(
			releaseCatalog(),
		);
		expect(
			plan.cells.filter((cell) => cell.caseId === "skipped-case-named-binding"),
		).toHaveLength(6);
		const jobs = jobsFor(["xai/grok-4.6", "openai/gpt-5.6-sol"], scenarios, {
			kind: "release",
		}).flat();
		expect(
			jobs.map((job) => [job.slot, job.scenario.id, job.attempt - 1]),
		).toEqual(
			plan.cells.map((cell, slot) => [slot, cell.caseId, cell.repetition]),
		);
	});

	test("keeps ordinary scenario catalogs report-only", () => {
		const scenarios = SCENARIOS.filter((scenario) =>
			["happy-path", "skipped-case-named-binding"].includes(scenario.id),
		);
		for (const policy of caseCatalogFor(scenarios, {
			kind: "ordinary",
			repeat: 2,
		})) {
			expect(policy.release).toBe("report-only");
			expect(policy.minScoredAttempts).toBe(1);
			expect(policy.minPassRate).toBeNull();
		}
	});

	test("pins release host and rejects every runtime override", () => {
		expect(() => assertReleaseHost({ platform: "darwin" })).toThrow(
			"canonical Linux host",
		);
		for (const override of [
			{ opencodeOverride: "1.18.7" },
			{ reviewerModelOverride: "xai/other" },
			{ reviewerStepsOverride: "20" },
		]) {
			expect(() =>
				assertReleaseHost({ platform: "linux", ...override }),
			).toThrow("no OpenCode or reviewer overrides");
		}
		expect(() => assertReleaseHost({ platform: "linux" })).not.toThrow();
	});

	test("rejects release sampling overrides", async () => {
		for (const override of [
			["--repeat", "3"],
			["--scenario", "happy-path"],
			["--repeat"],
			["--scenario"],
			["--repeat=3"],
			["--scenario=happy-path"],
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

	test("rejects every release model grid except two distinct providers", async () => {
		for (const models of [
			["xai/a"],
			["xai/a", "xai/b"],
			["xai/a", "openai/b", "anthropic/c"],
			["xai/a", "openai/b", "xai/a"],
		]) {
			const child = Bun.spawn(
				[
					"bun",
					"run",
					"evals/run.ts",
					...models.flatMap((model) => ["--model", model]),
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
				"--release requires exactly 2 models on distinct route providers",
			);
		}
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
