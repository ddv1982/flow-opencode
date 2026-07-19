import assert from "node:assert/strict";
import {
	type Session,
	toFeatureId,
	toSessionId,
} from "../../src/domain/session.js";
import {
	applyPlan,
	approvePlan,
	createSession,
	startRun,
	type TransitionEnvironment,
} from "../../src/domain/transitions.js";

const FEATURE_ID = toFeatureId("lifecycle-sequence");
const ACCEPTANCE_TIME = "2026-07-19T12:00:00.000Z";

function environment(seed: number): TransitionEnvironment {
	let runtimeId = 0;
	return {
		now: () => ACCEPTANCE_TIME,
		newSessionId: () => toSessionId(`lifecycle-sequence-${seed}`),
		newOperationId: (revision) => `sequence-${seed}-operation-${revision}`,
		newRuntimeId: (kind) => `${kind}:sequence-${seed}-${++runtimeId}`,
	};
}

function plan() {
	return {
		summary: "Exercise Session v4 lifecycle invariants.",
		overview: "Build one bounded running-state fixture.",
		features: [
			{
				id: FEATURE_ID,
				title: "Lifecycle sequence",
				summary: "Exercise schema corruption and persistence boundaries.",
				targets: ["src/domain/transitions.ts"],
			},
		],
	};
}

export function parseBoundedInteger(
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(
			`Expected an integer in [${minimum}, ${maximum}], received '${value}'.`,
		);
	}
	return parsed;
}

export function runningSequenceSession(seed = 1): Session {
	const environmentValue = environment(seed);
	const created = createSession(
		"Build one running Session v4 fixture",
		environmentValue,
	);
	const planned = applyPlan(created, plan(), environmentValue);
	assert.ok(planned.ok);
	const approved = approvePlan(planned.value, environmentValue);
	assert.ok(approved.ok);
	const running = startRun(approved.value, environmentValue, FEATURE_ID);
	assert.ok(running.ok);
	return running.value.session;
}
