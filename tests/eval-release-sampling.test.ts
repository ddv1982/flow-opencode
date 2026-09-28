import { describe, expect, test } from "bun:test";
import {
	assertExactReleaseCatalog,
	assertReleaseHost,
	assertReleaseModels,
	releaseAttemptsFor,
	releaseCaseIds,
	releaseCatalog,
	releasePolicySha256,
} from "../evals/release-policy.js";
import {
	campaignPlanFor,
	caseCatalogFor,
	type EvalSampling,
	jobsFor,
	releaseScenarios,
	reserveJobsFor,
} from "../evals/run.js";
import { SCENARIOS } from "../evals/scenarios.js";

describe("release eval sampling", () => {
	test("pins the 9.1.0 OpenAI-only grid without weakening later releases", () => {
		const model = {
			routeProvider: "openai",
			gateway: null,
			family: "gpt-6",
			model: "gpt-6-sol",
			revision: null,
		};
		const catalog = releaseCatalog("9.1.0");
		expect(catalog.every((row) => row.minProviders === 1)).toBe(true);
		expect(
			catalog.map((row) => row.minScoredAttempts).reduce((a, b) => a + b),
		).toBe(38);
		const plan = campaignPlanFor({
			models: ["openai/gpt-6-sol"],
			scenarios: releaseScenarios(),
			sampling: { kind: "release", packageVersion: "9.1.0" },
			opencodeVersion: "1.18.31",
		});
		expect(plan.stoppingRule.count).toBe(38);
		expect(plan.budget.maxAttempts).toBe(46);
		expect(plan.abortPolicy.maxReplacementBlocks).toBe(8);
		expect(() =>
			assertReleaseModels(
				[{ ...model, routeProvider: "xai", model: "grok-4.6" }],
				"9.1.0",
			),
		).toThrow("openai/gpt-6-sol");
		for (const forged of [
			{ ...model, gateway: "gateway" },
			{ ...model, family: "other-family" },
			{ ...model, revision: "preview" },
			{ ...model, variant: "fast" },
		]) {
			expect(() => assertReleaseModels([forged], "9.1.0")).toThrow(
				"canonical direct-route identity",
			);
		}
		expect(() => assertReleaseModels([model], "9.1.1")).toThrow(
			"exactly 2 models",
		);
		expect(releasePolicySha256("9.1.0")).not.toBe(releasePolicySha256("9.1.1"));
		expect(() => assertExactReleaseCatalog(catalog, "9.1.1")).toThrow();
	});

	test("pins the 9.2.0 OpenAI-only grid and restores two providers in 9.2.1", () => {
		const model = {
			routeProvider: "openai",
			gateway: null,
			family: "gpt-6-sol",
			model: "gpt-6-sol",
			revision: null,
		};
		const plan = campaignPlanFor({
			models: ["openai/gpt-6-sol"],
			scenarios: releaseScenarios(),
			sampling: { kind: "release", packageVersion: "9.2.0" },
			opencodeVersion: "1.18.31",
		});
		expect(plan.stoppingRule.count).toBe(38);
		expect(plan.budget.maxAttempts).toBe(46);
		expect(plan.abortPolicy.maxReplacementBlocks).toBe(8);
		expect(releaseCatalog("9.2.0").every((row) => row.minProviders === 1)).toBe(
			true,
		);
		expect(() => assertReleaseModels([model], "9.2.0")).not.toThrow();
		expect(() => assertReleaseModels([model], "9.2.1")).toThrow(
			"exactly 2 models",
		);
		expect(() => assertReleaseModels([model, model], "9.2.0")).toThrow(
			"openai/gpt-6-sol",
		);
		expect(releasePolicySha256("9.2.0")).toBe(releasePolicySha256("9.1.0"));
		expect(releasePolicySha256("9.2.0")).not.toBe(releasePolicySha256("9.2.1"));
	});

	test("checks configured CI release models before authorization", async () => {
		for (const [configured, expectedCode] of [
			["openai/gpt-6-sol", 0],
			["openai/gpt-6-sol,xai/grok-4.6", 1],
			["xai/grok-4.6", 1],
		] as const) {
			const child = Bun.spawn(
				["bun", "run", "scripts/check-release-models.ts"],
				{
					cwd: new URL("..", import.meta.url).pathname,
					env: { ...process.env, FLOW_EVAL_MODEL: configured },
					stderr: "pipe",
				},
			);
			const [code, stderr] = await Promise.all([
				child.exited,
				new Response(child.stderr).text(),
			]);
			expect(code).toBe(expectedCode);
			if (expectedCode !== 0)
				expect(stderr).toContain(
					"Release 9.2.0 requires exactly openai/gpt-6-sol",
				);
		}
	});
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
				sampling: { kind: "release", packageVersion: "8.1.2" },
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
			sampling: { kind: "release", packageVersion: "8.1.2" },
			opencodeVersion: "1.18.6",
		});
		expect(plan.cells).toHaveLength(92);
		expect(
			plan.cells.filter((cell) => cell.schedule === "primary"),
		).toHaveLength(76);
		expect(
			plan.cells.filter((cell) => cell.schedule === "environment-reserve"),
		).toHaveLength(16);
		expect(plan.stoppingRule.count).toBe(76);
		expect(plan.budget.maxAttempts).toBe(92);
		expect(plan.abortPolicy).toEqual({
			retry: "environment-only",
			maxReplacementBlocks: 16,
		});
		expect(
			caseCatalogFor(scenarios, { kind: "release", packageVersion: "8.1.2" }),
		).toEqual(releaseCatalog());
		expect(
			plan.cells.filter((cell) => cell.caseId === "skipped-case-named-binding"),
		).toHaveLength(8);
		const jobs = jobsFor(["xai/grok-4.6", "openai/gpt-5.6-sol"], scenarios, {
			kind: "release",
		}).flat();
		expect(
			jobs.map((job) => [job.slot, job.scenario.id, job.attempt - 1]),
		).toEqual(
			plan.cells
				.filter((cell) => cell.schedule === "primary")
				.map((cell, slot) => [slot, cell.caseId, cell.repetition]),
		);
		const reserve = plan.cells.find(
			(cell) => cell.schedule === "environment-reserve",
		);
		if (!reserve) throw new Error("Release plan requires a reserve.");
		expect(reserveJobsFor(plan, [reserve.cellId], scenarios).flat()).toEqual([
			expect.objectContaining({
				slot: plan.cells.indexOf(reserve),
				scenario: expect.objectContaining({ id: reserve.caseId }),
				attempt: reserve.repetition + 1,
			}),
		]);
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

	test("rejects release grids outside the 9.2.0 canonical OpenAI route", async () => {
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
				"Release 9.2.0 requires exactly openai/gpt-6-sol",
			);
		}
	});

	test("requires sequential release execution", async () => {
		const child = Bun.spawn(
			[
				"bun",
				"run",
				"evals/run.ts",
				"--model",
				"openai/gpt-6-sol",
				"--release",
				"--concurrency",
				"2",
			],
			{ cwd: new URL("..", import.meta.url).pathname, stderr: "pipe" },
		);
		const [exitCode, stderr] = await Promise.all([
			child.exited,
			new Response(child.stderr).text(),
		]);
		expect(exitCode).toBe(2);
		expect(stderr).toContain("--release requires --concurrency 1");
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
