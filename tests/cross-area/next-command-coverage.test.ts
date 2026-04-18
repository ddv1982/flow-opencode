import { describe, expect, test } from "bun:test";
import {
	FLOW_PLAN_COMMAND,
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_RUN_COMMAND,
	FLOW_STATUS_COMMAND,
	flowResetFeatureCommand,
} from "../../src/runtime/constants";
import { SessionStatusSchema } from "../../src/runtime/schema";
import { createSession } from "../../src/runtime/session";
import { deriveNextCommand } from "../../src/runtime/summary";
import { cloneSamplePlan } from "../fixtures";

describe("cross-area next command coverage", () => {
	test("covers every session.status value", () => {
		const statuses = SessionStatusSchema.options;
		expect(statuses).toEqual([
			"planning",
			"ready",
			"running",
			"blocked",
			"completed",
		]);

		const planning = createSession("Coverage");
		expect(deriveNextCommand(planning)).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);

		const base = {
			...planning,
			approval: "approved" as const,
			plan: cloneSamplePlan(),
		};
		expect(deriveNextCommand({ ...base, status: "planning" })).toBe(
			FLOW_PLAN_COMMAND,
		);
		expect(deriveNextCommand({ ...base, status: "ready" })).toBe(
			FLOW_RUN_COMMAND,
		);
		expect(
			deriveNextCommand({
				...base,
				status: "running",
				execution: {
					...base.execution,
					activeFeatureId: "setup-runtime",
				},
			}),
		).toBe(FLOW_RUN_COMMAND);
		expect(
			deriveNextCommand({
				...base,
				status: "blocked",
				execution: {
					...base.execution,
					lastFeatureId: "setup-runtime",
					lastOutcome: {
						kind: "contract_error",
						retryable: true,
						autoResolvable: true,
						needsHuman: false,
					},
				},
			}),
		).toBe(flowResetFeatureCommand("setup-runtime"));
		expect(
			deriveNextCommand({
				...base,
				status: "blocked",
				execution: {
					...base.execution,
					lastFeatureId: "setup-runtime",
					lastOutcome: {
						kind: "needs_operator_input",
						needsHuman: true,
					},
				},
			}),
		).toBe(FLOW_STATUS_COMMAND);
		expect(deriveNextCommand({ ...base, status: "completed" })).toBe(
			FLOW_PLAN_WITH_GOAL_COMMAND,
		);
	});
});
