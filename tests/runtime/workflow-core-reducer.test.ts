import { describe, expect, test } from "bun:test";
import {
	applyWorkflowEvent,
	CORE_ACTION_REGISTRY,
	CORE_INVARIANT_MAPPINGS,
	decideWorkflowCommand,
	replayWorkflowEvents,
	type WorkflowCommand,
	type WorkflowEvent,
	type WorkflowState,
} from "../../src/core";
import type { ReviewerDecision, WorkerResult } from "../../src/runtime/schema";

type CompletedWorkerResult = Extract<WorkerResult, { status: "ok" }>;

import { samplePlan } from "../runtime-test-helpers";

const STARTED_AT = "2026-05-03T10:00:00.000Z";

function applyCommand(
	state: WorkflowState | null,
	command: WorkflowCommand,
	recordedAt: string,
): WorkflowState {
	const decision = decideWorkflowCommand(state, command, { recordedAt });
	expect(decision.accepted).toBe(true);
	if (!decision.accepted) {
		throw new Error(decision.message);
	}
	const replayed = replayWorkflowEvents(decision.events, state);
	if (!replayed) {
		throw new Error("Expected replay to produce workflow state.");
	}
	return replayed;
}

function collectEvents(
	state: WorkflowState | null,
	command: WorkflowCommand,
	recordedAt: string,
): readonly WorkflowEvent[] {
	const decision = decideWorkflowCommand(state, command, { recordedAt });
	expect(decision.accepted).toBe(true);
	if (!decision.accepted) {
		throw new Error(decision.message);
	}
	return decision.events;
}

function startWorkflow(): WorkflowState {
	return applyCommand(
		null,
		{
			type: "start_workflow",
			sessionId: "core-session-1",
			goal: "Build the deterministic workflow core.",
		},
		STARTED_AT,
	);
}

function approvedFeatureDecision(featureId: string): ReviewerDecision {
	return {
		scope: "feature",
		featureId,
		status: "approved",
		summary: "Feature review approved.",
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

function approvedFinalDecision(): ReviewerDecision {
	return {
		scope: "final",
		reviewPurpose: "completion_gate",
		reviewDepth: "detailed",
		reviewedSurfaces: [
			"changed_files",
			"shared_surfaces",
			"validation_evidence",
		],
		evidenceSummary: "Final review covered changed files and shared surfaces.",
		validationAssessment: "Broad validation passed for the completed workflow.",
		evidenceRefs: {
			changedArtifacts: ["src/core/workflow/reducer.ts"],
			validationCommands: [
				"bun test tests/runtime/workflow-core-reducer.test.ts",
			],
		},
		integrationChecks: ["Checked core reducer and command integration."],
		regressionChecks: ["Checked event replay did not regress core state."],
		remainingGaps: [],
		status: "approved",
		summary: "Final review approved.",
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

function completedWorker(
	featureId: string,
	overrides: Partial<CompletedWorkerResult> = {},
): CompletedWorkerResult {
	return {
		contractVersion: "1",
		status: "ok",
		summary: `Completed ${featureId}.`,
		artifactsChanged: [{ path: "src/core/workflow/reducer.ts" }],
		validationRun: [
			{
				command: "bun test tests/runtime/workflow-core-reducer.test.ts",
				status: "passed",
				summary: "Workflow core tests passed.",
			},
		],
		validationScope: "targeted",
		decisions: [],
		nextStep: "Continue with the next workflow step.",
		outcome: { kind: "completed" },
		featureResult: {
			featureId,
			verificationStatus: "passed",
		},
		featureReview: {
			status: "passed",
			summary: "Feature review passed.",
			blockingFindings: [],
		},
		...overrides,
	};
}

describe("core workflow action/event foundation", () => {
	test("rejects events that require an active session before workflow_started", () => {
		expect(() =>
			applyWorkflowEvent(null, {
				type: "plan_approved",
				plan: samplePlan(),
				recordedAt: STARTED_AT,
			}),
		).toThrow("Cannot apply 'plan_approved' before workflow_started.");
	});

	test("rejects applying workflow_started twice", () => {
		const started = startWorkflow();
		expect(() =>
			applyWorkflowEvent(started, {
				type: "workflow_started",
				sessionId: "core-session-duplicate",
				goal: "Duplicate start.",
				recordedAt: "2026-05-03T10:00:01.000Z",
			}),
		).toThrow("workflow_started cannot be applied twice.");
	});

	test("replay is partition-invariant for accepted command streams", () => {
		const commands: readonly WorkflowCommand[] = [
			{
				type: "start_workflow",
				sessionId: "partition-seed-1",
				goal: "Verify replay invariance across partitions.",
			},
			{
				type: "apply_plan",
				plan: samplePlan(),
			},
			{ type: "approve_plan" },
			{ type: "start_run" },
			{
				type: "record_reviewer_decision",
				decision: approvedFeatureDecision("setup-runtime"),
			},
			{
				type: "complete_run",
				worker: completedWorker("setup-runtime"),
			},
		];
		const events: WorkflowEvent[] = [];
		let current: WorkflowState | null = null;
		for (const [index, command] of commands.entries()) {
			const decision = decideWorkflowCommand(current, command, {
				recordedAt: `2026-05-03T10:00:0${index}.000Z`,
			});
			expect(decision.accepted).toBe(true);
			if (!decision.accepted) {
				throw new Error(decision.message);
			}
			events.push(...decision.events);
			current = replayWorkflowEvents(decision.events, current);
		}
		const expected = replayWorkflowEvents(events);
		for (let splitIndex = 1; splitIndex < events.length; splitIndex += 1) {
			const head = events.slice(0, splitIndex);
			const tail = events.slice(splitIndex);
			const splitReplay = replayWorkflowEvents(
				tail,
				replayWorkflowEvents(head),
			);
			expect(splitReplay).toEqual(expected);
		}
	});

	test("records planning context and reduces plan application/approval events", () => {
		let state = startWorkflow();

		state = applyCommand(
			state,
			{
				type: "record_planning_context",
				planning: {
					repoProfile: ["TypeScript runtime package"],
					packageManager: "bun",
				},
			},
			"2026-05-03T10:01:00.000Z",
		);
		expect(state.planning.packageManager).toBe("bun");
		expect(state.planning.repoProfile).toEqual(["TypeScript runtime package"]);

		state = applyCommand(
			state,
			{ type: "apply_plan", plan: samplePlan() },
			"2026-05-03T10:02:00.000Z",
		);
		expect(state.status).toBe("planning");
		expect(state.approval).toBe("pending");
		expect(state.plan?.features.map((feature) => feature.status)).toEqual([
			"pending",
			"pending",
		]);

		state = applyCommand(
			state,
			{ type: "approve_plan" },
			"2026-05-03T10:03:00.000Z",
		);
		expect(state.status).toBe("ready");
		expect(state.approval).toBe("approved");
		expect(state.timestamps.approvedAt).toBe("2026-05-03T10:03:00.000Z");
	});

	test("reduces run start and feature-review events", () => {
		let state = startWorkflow();
		state = applyCommand(
			state,
			{ type: "apply_plan", plan: samplePlan() },
			"2026-05-03T10:02:00.000Z",
		);
		state = applyCommand(
			state,
			{ type: "approve_plan" },
			"2026-05-03T10:03:00.000Z",
		);
		state = applyCommand(
			state,
			{ type: "start_run" },
			"2026-05-03T10:04:00.000Z",
		);

		expect(state.status).toBe("running");
		expect(state.execution.activeFeatureId).toBe("setup-runtime");
		expect(state.plan?.features[0]?.status).toBe("in_progress");

		state = applyCommand(
			state,
			{
				type: "record_reviewer_decision",
				decision: approvedFeatureDecision("setup-runtime"),
			},
			"2026-05-03T10:05:00.000Z",
		);
		expect(state.execution.lastReviewerDecision?.scope).toBe("feature");
		expect(state.execution.lastReviewerDecision?.status).toBe("approved");
	});

	test("reduces accepted feature completion events without closing unfinished workflows", () => {
		let state = startWorkflow();
		state = applyCommand(
			state,
			{ type: "apply_plan", plan: samplePlan() },
			"2026-05-03T10:02:00.000Z",
		);
		state = applyCommand(
			state,
			{ type: "approve_plan" },
			"2026-05-03T10:03:00.000Z",
		);
		state = applyCommand(
			state,
			{ type: "start_run" },
			"2026-05-03T10:04:00.000Z",
		);
		state = applyCommand(
			state,
			{
				type: "record_reviewer_decision",
				decision: approvedFeatureDecision("setup-runtime"),
			},
			"2026-05-03T10:05:00.000Z",
		);

		const events = collectEvents(
			state,
			{
				type: "complete_run",
				worker: completedWorker("setup-runtime"),
			},
			"2026-05-03T10:06:00.000Z",
		);
		expect(events.map((event) => event.type)).toEqual(["run_completed"]);

		const completed = replayWorkflowEvents(events, state);
		expect(completed?.status).toBe("ready");
		expect(completed?.execution.activeFeatureId).toBeNull();
		expect(completed?.execution.history).toHaveLength(1);
		expect(completed?.plan?.features[0]?.status).toBe("completed");
		expect(completed?.plan?.features[1]?.status).toBe("pending");
	});

	test("reduces final completion events to a closed workflow", () => {
		const basePlan = samplePlan();
		const [firstFeature] = basePlan.features;
		if (!firstFeature) {
			throw new Error("Expected sample plan to contain a feature.");
		}
		const oneFeaturePlan = {
			...basePlan,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [firstFeature],
		};
		let state = startWorkflow();
		state = applyCommand(
			state,
			{ type: "apply_plan", plan: oneFeaturePlan },
			"2026-05-03T10:02:00.000Z",
		);
		state = applyCommand(
			state,
			{ type: "approve_plan" },
			"2026-05-03T10:03:00.000Z",
		);
		state = applyCommand(
			state,
			{ type: "start_run" },
			"2026-05-03T10:04:00.000Z",
		);
		state = applyCommand(
			state,
			{
				type: "record_reviewer_decision",
				decision: approvedFinalDecision(),
			},
			"2026-05-03T10:05:00.000Z",
		);

		state = applyCommand(
			state,
			{
				type: "complete_run",
				worker: completedWorker("setup-runtime", {
					validationScope: "broad",
					nextStep: "Workflow complete.",
					finalReview: {
						status: "passed",
						summary: "Final review passed.",
						blockingFindings: [],
						reviewDepth: "detailed",
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
						],
						evidenceSummary:
							"Final review covered changed files and shared surfaces.",
						validationAssessment:
							"Broad validation passed for the completed workflow.",
						evidenceRefs: {
							changedArtifacts: ["src/core/workflow/reducer.ts"],
							validationCommands: [
								"bun test tests/runtime/workflow-core-reducer.test.ts",
							],
						},
						integrationChecks: [
							"Checked core reducer and command integration.",
						],
						regressionChecks: [
							"Checked event replay did not regress core state.",
						],
						remainingGaps: [],
					},
				}),
			},
			"2026-05-03T10:06:00.000Z",
		);

		expect(state.status).toBe("completed");
		expect(state.closure?.kind).toBe("completed");
		expect(state.timestamps.completedAt).toBe("2026-05-03T10:06:00.000Z");
		expect(state.plan?.features[0]?.status).toBe("completed");

		state = applyCommand(
			state,
			{ type: "reset_feature", featureId: "setup-runtime" },
			"2026-05-03T10:07:00.000Z",
		);
		expect(state.status).toBe("ready");
		expect(state.closure).toBeNull();
		expect(state.timestamps.completedAt).toBeNull();
		expect(state.plan?.features[0]?.status).toBe("pending");
	});

	test("maps existing runtime invariants and actions into the core registry", () => {
		expect(CORE_ACTION_REGISTRY.map((action) => action.name)).toEqual([
			"start_workflow",
			"record_planning_context",
			"apply_plan",
			"approve_plan",
			"select_plan_features",
			"start_run",
			"record_reviewer_decision",
			"complete_run",
			"reset_feature",
		]);
		expect(CORE_INVARIANT_MAPPINGS.map((mapping) => mapping.id)).toEqual([
			"completion.gates.required_order",
			"completion.policy.min_completed_features",
			"decision_gate.planning_surface.binding",
			"review.scope.payload_binding",
			"recovery.next_action.binding",
			"tools.canonical_surface.no_raw_wrappers",
		]);
		for (const action of CORE_ACTION_REGISTRY) {
			expect(action.emits.length).toBeGreaterThan(0);
			expect(action.policyOwners.length).toBeGreaterThan(0);
		}
	});
});
