import { expect, test } from "bun:test";
import {
	assertReleaseHost,
	assertReleaseModels,
	RELEASE_HOST_POLICY,
	releaseCatalog,
	releaseCellsFor,
	releaseProfile,
	releaseReviewerModel,
} from "../evals/release-policy.js";
import {
	campaignPlanFor,
	evalReleaseReviewerConfiguration,
	releaseScenarios,
} from "../evals/run.js";
import { SCENARIOS } from "../evals/scenarios.js";

const version = "9.6.0";
const profile = releaseProfile(version);
const models = profile.requiredModels;
if (!models) throw new Error("Candidate model grid is absent.");
const model = models[0];
if (!model) throw new Error("Candidate model is absent.");

test("candidate retains all prior policy rows and promotes five truthful delivery boundaries", () => {
	const prior = releaseCatalog("9.5.0");
	const priorIds = new Set(prior.map((row) => row.caseId));
	const added = profile.catalog.filter((row) => !priorIds.has(row.caseId));
	expect(profile.catalog.slice(added.length)).toEqual([...prior]);
	expect(profile.catalog.slice(0, added.length)).toEqual(added);
	expect(added.map((row) => row.caseId)).toEqual([
		"delivery-summary-completed",
		"delivery-summary-deferred",
		"delivery-summary-observed-failure",
		"delivery-full-detail-followup",
		"delivery-idle-after-close",
	]);
	for (const row of added)
		expect(row).toMatchObject({
			caseVersion: 1,
			release: "required",
			minProviders: 1,
			minScoredAttempts: 3,
			minPassRate: 1,
		});
	expect(model).toEqual({
		routeProvider: "openai",
		gateway: null,
		family: "gpt-6.1-sol",
		model: "gpt-6.1-sol",
		revision: null,
	});
});

test("candidate grid binds both roles and scheduled top-level dispatch counts", () => {
	const cells = releaseCellsFor(models, version);
	const primary = cells.filter((cell) => cell.schedule === "primary");
	const reserve = cells.filter(
		(cell) => cell.schedule === "environment-reserve",
	);
	expect(primary).toHaveLength(72);
	expect(primary.slice(0, 3).map((cell) => cell.caseId)).toEqual([
		"delivery-summary-completed",
		"delivery-summary-completed",
		"delivery-summary-completed",
	]);
	expect(
		releaseScenarios(version)
			.slice(0, 5)
			.map((scenario) => scenario.id),
	).toEqual([
		"delivery-summary-completed",
		"delivery-summary-deferred",
		"delivery-summary-observed-failure",
		"delivery-full-detail-followup",
		"delivery-idle-after-close",
	]);
	expect(reserve).toHaveLength(17);
	for (const cell of cells)
		expect([cell.managerModel, cell.reviewerModel]).toEqual([model, model]);
	const dispatches = (scheduled: typeof cells) =>
		scheduled.reduce((sum, cell) => {
			const scenario = SCENARIOS.find((item) => item.id === cell.caseId);
			if (!scenario) throw new Error("Missing scheduled scenario.");
			return sum + scenario.steps.length;
		}, 0);
	expect(dispatches(primary)).toBe(90);
	expect(dispatches(reserve)).toBe(23);
	const plan = campaignPlanFor({
		models: ["openai/gpt-6.1-sol"],
		scenarios: releaseScenarios(version),
		sampling: { kind: "release", packageVersion: version },
		opencodeVersion: RELEASE_HOST_POLICY.opencodeVersion,
	});
	expect(plan.stoppingRule.count).toBe(72);
	expect(plan.budget.maxAttempts).toBe(89);
	expect(plan.abortPolicy).toEqual({
		retry: "environment-only",
		maxReplacementBlocks: 17,
	});
});

test("role pin and recovery requirement are candidate-only and reject environmental changes", () => {
	expect(
		evalReleaseReviewerConfiguration("openai/gpt-6.1-sol", version),
	).toEqual({
		requestedModel: "openai/gpt-6.1-sol",
		requestedSteps: null,
		pluginOptions: { model: "openai/gpt-6.1-sol" },
	});
	for (const old of ["9.1.0", "9.2.0", "9.3.0", "9.4.0", "9.5.0", "standard"]) {
		expect(releaseReviewerModel(old)).toBeNull();
		expect(
			releaseCellsFor(models, old).every((cell) => cell.reviewerModel === null),
		).toBe(true);
	}
	expect(() =>
		assertReleaseModels([{ ...model, routeProvider: "xai" }], version),
	).toThrow();
	expect(() =>
		assertReleaseModels([{ ...model, model: "gpt-6-sol" }], version),
	).toThrow();
	expect(() =>
		assertReleaseHost({
			platform: "linux",
			packageVersion: version,
			recoveryApiKeySet: true,
		}),
	).toThrow("unset TYPESAFE_API_KEY");
	expect(() =>
		assertReleaseHost({
			platform: "linux",
			packageVersion: "9.5.0",
			recoveryApiKeySet: true,
		}),
	).not.toThrow();
	expect(() =>
		assertReleaseHost({
			platform: "linux",
			packageVersion: version,
			reviewerModelOverride: "openai/gpt-6.1-sol",
		}),
	).toThrow();
	expect(() =>
		assertReleaseHost({
			platform: "linux",
			packageVersion: version,
			reviewerStepsOverride: "20",
		}),
	).toThrow();
});
