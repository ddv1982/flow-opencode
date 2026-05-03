import type { WorkflowCommand } from "../../src/core";
import {
	approvedFeatureDecision,
	approvedFinalDecision,
	buildGoldenEventLogCase,
	completedWorker,
	createReplayPlan,
	type GoldenEventLogCase,
} from "./helpers";

const planningPlan = createReplayPlan(2);
const singleFeaturePlan = createReplayPlan(1, { minCompletedFeatures: 1 });
const resetPlan = createReplayPlan(2);

function startCommand(sessionId: string, goal: string): WorkflowCommand {
	return {
		type: "start_workflow",
		sessionId,
		goal,
		planning: {
			repoProfile: ["TypeScript workflow package"],
			packageManager: "bun",
		},
	};
}

export const GOLDEN_EVENT_LOG_CORPUS: readonly GoldenEventLogCase[] = [
	buildGoldenEventLogCase(
		"planning-ready",
		"Planning context, plan application, and approval reach a ready session.",
		"golden-planning-ready",
		[
			startCommand(
				"golden-planning-ready",
				"Make replay planning a release gate.",
			),
			{
				type: "record_planning_context",
				planning: {
					research: [
						"Replay gate: golden event logs must replay deterministically.",
					],
					implementationApproach: {
						chosenDirection:
							"Use deterministic core events as release-gated fixtures.",
						keyConstraints: ["Do not add dependencies"],
						validationSignals: ["Replay/property tests pass"],
						sources: ["docs/investigations/ground-up-rewrite-2026-05-03.md"],
					},
				},
			},
			{ type: "apply_plan", plan: planningPlan },
			{ type: "approve_plan" },
		],
	),
	buildGoldenEventLogCase(
		"single-feature-completion",
		"A one-feature plan records final review evidence and completes the workflow.",
		"golden-single-feature-completion",
		[
			startCommand(
				"golden-single-feature-completion",
				"Complete replay release gate implementation.",
			),
			{ type: "apply_plan", plan: singleFeaturePlan },
			{ type: "approve_plan" },
			{ type: "start_run" },
			{ type: "record_reviewer_decision", decision: approvedFinalDecision() },
			{
				type: "complete_run",
				worker: completedWorker("feature-1", { final: true }),
			},
		],
	),
	buildGoldenEventLogCase(
		"feature-reset-recovery",
		"A completed feature can be reset and replay returns to a ready non-closed state.",
		"golden-feature-reset-recovery",
		[
			startCommand(
				"golden-feature-reset-recovery",
				"Verify reset recovery through replay.",
			),
			{ type: "apply_plan", plan: resetPlan },
			{ type: "approve_plan" },
			{ type: "start_run" },
			{
				type: "record_reviewer_decision",
				decision: approvedFeatureDecision("feature-1"),
			},
			{
				type: "complete_run",
				worker: completedWorker("feature-1"),
			},
			{ type: "reset_feature", featureId: "feature-1" },
		],
	),
];
