import { describe, expect, test } from "bun:test";
import { hostConfigSha256 } from "../evals/provenance.js";
import {
	assertExactReleaseCatalog,
	assertReleaseHost,
	assertReleaseModels,
	releaseAttemptsFor,
	releaseCaseCatalogSha256,
	releaseCaseIds,
	releaseCatalog,
	releaseHostConfigSha256,
	releaseHostPermissions,
	releasePolicySha256,
	releaseScenarioCatalog,
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
import packageJson from "../package.json" with { type: "json" };

describe("release eval sampling", () => {
	test("binds 9.5.0 unattended permissions without changing historical host inputs", () => {
		const model = {
			routeProvider: "openai",
			gateway: null,
			family: "gpt-6-sol",
			model: "gpt-6-sol",
			revision: null,
		};
		for (const packageVersion of [
			"9.1.0",
			"9.2.0",
			"9.3.0",
			"9.4.0",
			"standard",
		]) {
			expect(releaseHostPermissions(packageVersion)).toBeUndefined();
			expect(releaseHostConfigSha256({ packageVersion, model })).toBe(
				hostConfigSha256({
					opencodeVersion: "1.18.31",
					plugin: `opencode-plugin-flow@${packageVersion}`,
					model: "openai/gpt-6-sol",
					reviewerModel: "openai/gpt-6-sol",
					reviewerSteps: null,
					platform: "linux",
				}),
			);
		}
		const currentModel = {
			...model,
			family: "gpt-6.1-sol",
			model: "gpt-6.1-sol",
		};
		expect(releaseHostPermissions("9.5.0")).toEqual({
			external_directory: "deny",
		});
		expect(
			releaseHostConfigSha256({ packageVersion: "9.5.0", model: currentModel }),
		).toBe(
			hostConfigSha256({
				opencodeVersion: "1.18.31",
				plugin: "opencode-plugin-flow@9.5.0",
				model: "openai/gpt-6.1-sol",
				reviewerModel: "openai/gpt-6.1-sol",
				reviewerSteps: null,
				platform: "linux",
				permission: { external_directory: "deny" },
			}),
		);
	});
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
			scenarios: releaseScenarios("9.1.0"),
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
			scenarios: releaseScenarios("9.2.0"),
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

	test("requires the inspection audit case on the 9.3.0 OpenAI-only grid", () => {
		const catalog = releaseCatalog("9.3.0");
		expect(catalog.every((row) => row.minProviders === 1)).toBe(true);
		expect(
			catalog.find((row) => row.caseId === "inspection-failed-audit-completes"),
		).toMatchObject({
			caseVersion: 1,
			minScoredAttempts: 10,
			minPassRate: 0.9,
			release: "required",
		});
		const plan = campaignPlanFor({
			models: ["openai/gpt-6-sol"],
			scenarios: releaseScenarios("9.3.0"),
			sampling: { kind: "release", packageVersion: "9.3.0" },
			opencodeVersion: "1.18.31",
		});
		expect(plan.stoppingRule.count).toBe(48);
		expect(plan.budget.maxAttempts).toBe(57);
		expect(plan.abortPolicy.maxReplacementBlocks).toBe(9);
		expect(releaseCaseIds("9.2.0")).not.toContain(
			"inspection-failed-audit-completes",
		);
	});

	test("preserves the published 9.2.0 case-catalog identity", () => {
		expect(releaseScenarioCatalog(SCENARIOS, "9.2.0")).toHaveLength(8);
		expect(releaseCaseCatalogSha256(SCENARIOS, "9.2.0")).toBe(
			"sha256:134581f969e030f4194ff48f94e6df4d2fac5ebbd3af57f66cf430a32f7f7b6c",
		);
		expect(releaseScenarioCatalog(SCENARIOS, "9.3.0")).toHaveLength(9);
	});

	test("checks configured CI release models before authorization", async () => {
		for (const [configured, expectedCode] of [
			["openai/gpt-6.1-sol", 0],
			["openai/gpt-6-sol", 1],
			["openai/gpt-6.1-sol,xai/grok-4.6", 1],
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
					`Release ${packageJson.version} requires exactly openai/gpt-6.1-sol`,
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

	test("schedules exactly the required 96-cell two-provider release", () => {
		const scenarios = releaseScenarios("8.1.2");
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
		expect(plan.cells).toHaveLength(114);
		expect(
			plan.cells.filter((cell) => cell.schedule === "primary"),
		).toHaveLength(96);
		expect(
			plan.cells.filter((cell) => cell.schedule === "environment-reserve"),
		).toHaveLength(18);
		expect(plan.stoppingRule.count).toBe(96);
		expect(plan.budget.maxAttempts).toBe(114);
		expect(plan.abortPolicy).toEqual({
			retry: "environment-only",
			maxReplacementBlocks: 18,
		});
		expect(
			caseCatalogFor(scenarios, { kind: "release", packageVersion: "8.1.2" }),
		).toEqual(releaseCatalog());
		expect(
			plan.cells.filter((cell) => cell.caseId === "skipped-case-named-binding"),
		).toHaveLength(8);
		const jobs = jobsFor(["xai/grok-4.6", "openai/gpt-5.6-sol"], scenarios, {
			kind: "release",
			packageVersion: "8.1.2",
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

	test("preserves the 9.4 twelve-case OpenAI-only grid", () => {
		const scenarios = releaseScenarios("9.4.0");
		expect(scenarios).toHaveLength(12);
		const plan = campaignPlanFor({
			models: ["openai/gpt-6-sol"],
			scenarios,
			sampling: { kind: "release", packageVersion: "9.4.0" },
			opencodeVersion: "1.18.31",
		});
		expect(plan.stoppingRule.count).toBe(57);
		expect(plan.budget.maxAttempts).toBe(69);
		expect(plan.abortPolicy.maxReplacementBlocks).toBe(12);
		expect(
			plan.cells.filter((cell) => cell.schedule === "primary"),
		).toHaveLength(57);
	});

	test("current 9.6 candidate retains all seventeen cases on its OpenAI-only grid", () => {
		const scenarios = releaseScenarios();
		expect(scenarios).toHaveLength(17);
		expect(
			releaseCatalog(packageJson.version).every(
				(row) => row.minProviders === 1,
			),
		).toBe(true);
		const plan = campaignPlanFor({
			models: ["openai/gpt-6.1-sol"],
			scenarios,
			sampling: { kind: "release", packageVersion: packageJson.version },
			opencodeVersion: "1.18.31",
		});
		expect(plan.stoppingRule.count).toBe(72);
		expect(plan.budget.maxAttempts).toBe(89);
		expect(plan.abortPolicy.maxReplacementBlocks).toBe(17);
		expect(
			plan.cells.filter((cell) => cell.schedule === "primary"),
		).toHaveLength(72);
		expect(() =>
			campaignPlanFor({
				models: ["openai/gpt-6-sol"],
				scenarios,
				sampling: { kind: "release", packageVersion: packageJson.version },
				opencodeVersion: "1.18.31",
			}),
		).toThrow("openai/gpt-6.1-sol");
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

	test("rejects release grids outside the canonical OpenAI route", async () => {
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
				`Release ${packageJson.version} requires exactly openai/gpt-6.1-sol`,
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
				"openai/gpt-6.1-sol",
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
