import { bench } from "mitata";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";
import {
	createApprovedSession,
	createPlan,
	createSession,
	createWorkerResult,
} from "./fixtures";

function assertOk<T>(
	result: { ok: true; value: T } | { ok: false; message: string },
): T {
	if (!result.ok) {
		throw new Error(result.message);
	}

	return result.value;
}

bench("transition reducer | applyPlan", () => {
	const session = createSession("Apply plan benchmark");
	assertOk(applyPlan(session, createPlan(20)));
});

bench("transition reducer | approvePlan", () => {
	const session = createSession("Approve plan benchmark");
	const applied = assertOk(applyPlan(session, createPlan(20)));
	assertOk(approvePlan(applied));
});

bench("transition reducer | startRun", () => {
	const session = createApprovedSession(20);
	assertOk(startRun(session));
});

bench("transition reducer | completeRun", () => {
	const session = createApprovedSession(20);
	const started = assertOk(startRun(session)).session;
	const featureId = started.execution.activeFeatureId;

	if (!featureId) {
		throw new Error("Expected active feature.");
	}

	const reviewed = assertOk(
		recordReviewerDecision(started, {
			scope: "feature",
			featureId,
			status: "approved",
			summary: `Approved ${featureId}.`,
			blockingFindings: [],
			followUps: [],
			suggestedValidation: [],
		}),
	);

	assertOk(completeRun(reviewed, createWorkerResult(featureId)));
});
