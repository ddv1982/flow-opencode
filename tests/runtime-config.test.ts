import { describe, expect, test } from "bun:test";
import {
	createFlowCoreConfigEntries,
	resolveFlowHarnessRuntimeConfig,
} from "../src/config-shared.js";

describe("Flow harness runtime configuration", () => {
	test("defaults to the standard observe-first profile", () => {
		expect(resolveFlowHarnessRuntimeConfig({})).toEqual({
			profile: "standard",
			rolloutMode: "observe",
			warnings: [],
		});
	});

	test("accepts explicit control and assurance modes", () => {
		expect(
			resolveFlowHarnessRuntimeConfig({
				OPENCODE_FLOW_HARNESS_PROFILE: "assurance",
				OPENCODE_FLOW_ROLLOUT_MODE: "enforce",
			}),
		).toEqual({
			profile: "assurance",
			rolloutMode: "enforce",
			warnings: [],
		});
		expect(
			resolveFlowHarnessRuntimeConfig({
				OPENCODE_FLOW_HARNESS_PROFILE: "control",
				OPENCODE_FLOW_ROLLOUT_MODE: "control",
			}),
		).toMatchObject({ profile: "control", rolloutMode: "control" });
	});

	test("unknown values fail back to conservative control with warnings", () => {
		const resolved = resolveFlowHarnessRuntimeConfig({
			OPENCODE_FLOW_HARNESS_PROFILE: "economy",
			OPENCODE_FLOW_ROLLOUT_MODE: "maybe",
		});
		expect(resolved.profile).toBe("control");
		expect(resolved.rolloutMode).toBe("control");
		expect(resolved.warnings).toHaveLength(2);
	});

	test("routes current OpenCode steps by worker class with fallback", () => {
		const entries = createFlowCoreConfigEntries({
			env: {
				OPENCODE_FLOW_WORKER_STEPS: "20",
				OPENCODE_FLOW_READONLY_WORKER_STEPS: "12",
				OPENCODE_FLOW_REVIEW_WORKER_STEPS: "16",
				OPENCODE_FLOW_CANDIDATE_WORKER_STEPS: "24",
			},
		});
		expect(entries.agent["flow-evidence-worker"]).toMatchObject({ steps: 12 });
		expect(entries.agent["flow-validation-worker"]).toMatchObject({
			steps: 12,
		});
		expect(entries.agent["flow-audit-worker"]).toMatchObject({ steps: 12 });
		expect(entries.agent["flow-reviewer"]).toMatchObject({ steps: 16 });
		expect(entries.agent["flow-verifier-worker"]).toMatchObject({ steps: 16 });
		expect(entries.agent["flow-candidate-worker"]).toMatchObject({ steps: 24 });
	});

	test("ignores invalid step limits and emits each warning once", () => {
		const warnings: string[] = [];
		const entries = createFlowCoreConfigEntries({
			env: { OPENCODE_FLOW_WORKER_STEPS: "0" },
			onWarning: (warning) => warnings.push(warning),
		});
		expect(warnings).toEqual([
			"OPENCODE_FLOW_WORKER_STEPS must be an integer from 1 through 1000; ignoring it.",
		]);
		for (const agent of Object.values(entries.agent)) {
			expect(agent).not.toHaveProperty("steps");
		}
	});

	test("does not add provider-specific reasoning options", () => {
		const entries = createFlowCoreConfigEntries({
			env: { OPENCODE_FLOW_WORKER_STEPS: "8" },
		});
		for (const agent of Object.values(entries.agent)) {
			expect(agent).not.toHaveProperty("reasoningEffort");
			expect(agent).not.toHaveProperty("maxSteps");
		}
	});
});
