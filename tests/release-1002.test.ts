import { expect, test } from "bun:test";
import {
	assertReleaseModels,
	releaseCatalog,
	releaseCellsFor,
	releasePolicySha256,
	releaseReviewerModel,
} from "../evals/release-policy.js";
import type { ModelIdentity } from "../evals/report.js";
import { releaseScenarios } from "../evals/run.js";

const sol: ModelIdentity = {
	routeProvider: "openai",
	gateway: null,
	family: "gpt-6.1-sol",
	model: "gpt-6.1-sol",
	revision: null,
};

test("10.0.2 preserves its historical prefix and requires three status cases", () => {
	const catalog = releaseCatalog("10.0.2");
	expect(catalog.slice(0, 17)).toEqual([...releaseCatalog("10.0.1")]);
	expect(catalog.slice(17).map((row) => row.caseId)).toEqual([
		"guidance-status-ready",
		"guidance-status-blocked",
		"guidance-status-error",
	]);
	for (const row of catalog.slice(17)) {
		expect(row.release).toBe("required");
		expect(row.minScoredAttempts).toBe(3);
		expect(row.minPassRate).toBe(1);
		expect(row.minProviders).toBe(1);
	}
	const scenarios = releaseScenarios("10.0.2");
	expect(scenarios.map((row) => row.id)).toEqual(
		catalog.map((row) => row.caseId),
	);
	const cells = releaseCellsFor([sol], "10.0.2");
	const primary = cells.filter((cell) => cell.schedule === "primary");
	const reserves = cells.filter(
		(cell) => cell.schedule === "environment-reserve",
	);
	expect(primary).toHaveLength(81);
	expect(reserves).toHaveLength(20);
	const steps = new Map(scenarios.map((row) => [row.id, row.steps.length]));
	const countSteps = (rows: typeof cells) =>
		rows.reduce((total, row) => total + (steps.get(row.caseId) ?? 0), 0);
	expect(countSteps(primary) + 1).toBe(100);
	expect(countSteps(primary) + countSteps(reserves) + 1).toBe(126);
	for (const cell of cells) expect(cell.reviewerModel).toEqual(sol);
});

test("10.0.2 accepts only the approved canonical OpenAI manager/reviewer identity", () => {
	expect(() => assertReleaseModels([sol], "10.0.2")).not.toThrow();
	expect(releaseReviewerModel("10.0.2")).toEqual(sol);
	for (const forged of [
		{ ...sol, routeProvider: "other" },
		{ ...sol, model: "other" },
		{ ...sol, family: "other" },
		{ ...sol, gateway: "proxy" },
		{ ...sol, revision: "preview" },
		{ ...sol, variant: "fast" },
	])
		expect(() => assertReleaseModels([forged], "10.0.2")).toThrow();
	for (const models of [[], [sol, sol]])
		expect(() => assertReleaseModels(models, "10.0.2")).toThrow();
	expect(releaseCatalog("10.0.3").map((row) => row.minProviders)).toEqual(
		Array(20).fill(2),
	);
	expect(() => assertReleaseModels([sol], "10.0.3")).toThrow();
});

test("10.0.2 does not rewrite the qualified 10.0.1 policy", () => {
	expect(releaseCatalog("10.0.1")).toHaveLength(17);
	expect(releasePolicySha256("10.0.1")).toBe(
		"sha256:62eb9715b2d3188a0d944106a8d8c1beb890cfbd72f58bf056f0ea79706bebec",
	);
});
