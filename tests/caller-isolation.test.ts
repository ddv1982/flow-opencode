import { describe, expect, test } from "bun:test";
import { createSession } from "../src/runtime/session";
import { applyPlan, selectPlanFeatures } from "../src/runtime/transitions";
import { cloneSamplePlan } from "./fixtures";

function buildSessionWithDraftPlan() {
	const session = createSession("Build a workflow plugin");
	const applied = applyPlan(session, cloneSamplePlan());
	expect(applied.ok).toBe(true);
	if (!applied.ok) {
		throw new Error(applied.message);
	}

	return applied.value;
}

describe("transition caller isolation", () => {
	test("selectPlanFeatures does not mutate caller session.execution", () => {
		const session = buildSessionWithDraftPlan();
		const snapshot = structuredClone(session);

		const selected = selectPlanFeatures(session, [
			session.plan?.features[0]?.id ?? "setup-runtime",
		]);
		expect(selected.ok).toBe(true);
		expect(session).toEqual(snapshot);
	});

	test("applyPlan does not mutate caller session.execution", () => {
		const session = createSession("Build a workflow plugin");
		const snapshot = structuredClone(session);

		const applied = applyPlan(session, cloneSamplePlan());
		expect(applied.ok).toBe(true);
		expect(session).toEqual(snapshot);
	});
});
