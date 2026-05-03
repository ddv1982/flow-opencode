import { describe, expect, test } from "bun:test";
import {
	decideWorkflowCommand,
	replayWorkflowEvents,
	type WorkflowCommand,
	type WorkflowState,
} from "../../src/core";
import {
	approvedFeatureDecision,
	approvedFinalDecision,
	assertWorkflowSemanticInvariants,
	completedWorker,
	createReplayPlan,
	timestamp,
} from "./helpers";

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x1_0000_0000;
	};
}

function pick<T>(random: () => number, values: readonly T[]): T {
	const value = values[Math.floor(random() * values.length)];
	if (value === undefined) {
		throw new Error("Cannot pick from an empty list.");
	}
	return value;
}

function featureIds(state: WorkflowState): string[] {
	return state.plan?.features.map((feature) => feature.id) ?? [];
}

function completedFeatureCount(state: WorkflowState): number {
	return (
		state.plan?.features.filter((feature) => feature.status === "completed")
			.length ?? 0
	);
}

function targetCompletedFeatureCount(state: WorkflowState): number {
	return (
		state.plan?.completionPolicy?.minCompletedFeatures ??
		state.plan?.features.length ??
		0
	);
}

function activeFeatureNeedsFinalReview(state: WorkflowState): boolean {
	return completedFeatureCount(state) + 1 >= targetCompletedFeatureCount(state);
}

function hasReviewForActiveFeature(state: WorkflowState): boolean {
	const activeFeatureId = state.execution.activeFeatureId;
	const decision = state.execution.lastReviewerDecision;
	if (!activeFeatureId || !decision) {
		return false;
	}
	if (activeFeatureNeedsFinalReview(state)) {
		return decision.scope === "final" && decision.status === "approved";
	}
	return (
		decision.scope === "feature" &&
		decision.featureId === activeFeatureId &&
		decision.status === "approved"
	);
}

function nextGeneratedCommand(
	state: WorkflowState | null,
	random: () => number,
	seed: number,
): WorkflowCommand {
	if (!state) {
		return {
			type: "start_workflow",
			sessionId: `property-seed-${seed}`,
			goal: `Exercise generated event sequence ${seed}.`,
		};
	}

	if (!state.plan) {
		if (random() < 0.35) {
			return {
				type: "record_planning_context",
				planning: {
					repoProfile: [`seed:${seed}`],
					packageManager: "bun",
				},
			};
		}

		const featureCount = 1 + Math.floor(random() * 4);
		const minCompletedFeatures =
			random() < 0.25 ? 1 + Math.floor(random() * featureCount) : undefined;
		return {
			type: "apply_plan",
			plan: createReplayPlan(
				featureCount,
				minCompletedFeatures === undefined ? {} : { minCompletedFeatures },
			),
		};
	}

	if (state.approval !== "approved") {
		if (random() < 0.2 && state.plan.features.length > 1) {
			const selected = state.plan.features
				.filter(() => random() < 0.75)
				.map((feature) => feature.id);
			return {
				type: "select_plan_features",
				featureIds:
					selected.length > 0
						? selected
						: [state.plan.features[0]?.id ?? "feature-1"],
			};
		}
		return { type: "approve_plan" };
	}

	if (state.status === "completed") {
		const resettable = featureIds(state).filter((id) =>
			state.plan?.features.some(
				(feature) => feature.id === id && feature.status === "completed",
			),
		);
		return { type: "reset_feature", featureId: pick(random, resettable) };
	}

	if (state.status === "running") {
		const activeFeatureId = state.execution.activeFeatureId;
		if (!activeFeatureId) {
			return { type: "start_run" };
		}

		if (!hasReviewForActiveFeature(state)) {
			return {
				type: "record_reviewer_decision",
				decision: activeFeatureNeedsFinalReview(state)
					? approvedFinalDecision()
					: approvedFeatureDecision(activeFeatureId),
			};
		}

		return {
			type: "complete_run",
			worker: completedWorker(activeFeatureId, {
				final: activeFeatureNeedsFinalReview(state),
			}),
		};
	}

	const completed = state.plan.features.filter(
		(feature) => feature.status === "completed",
	);
	if (completed.length > 0 && random() < 0.15) {
		return { type: "reset_feature", featureId: pick(random, completed).id };
	}

	return { type: "start_run" };
}

describe("generated workflow event-sequence properties", () => {
	test("seeded accepted command streams preserve semantic invariants after every event", () => {
		for (let seed = 1; seed <= 24; seed += 1) {
			const random = seededRandom(seed);
			let state: WorkflowState | null = null;
			let acceptedEventCount = 0;

			for (let step = 0; step < 48; step += 1) {
				const command = nextGeneratedCommand(state, random, seed);
				const decision = decideWorkflowCommand(state, command, {
					recordedAt: timestamp(seed * 100 + step),
				});

				if (!decision.accepted) {
					expect(
						state,
						`seed ${seed} rejected ${command.type} keeps state`,
					).toBe(state);
					continue;
				}

				for (const event of decision.events) {
					state = replayWorkflowEvents([event], state);
					expect(
						state,
						`seed ${seed} ${event.type} produces state`,
					).not.toBeNull();
					if (state) {
						assertWorkflowSemanticInvariants(
							state,
							`seed ${seed} step ${step} event ${event.type}`,
						);
					}
					acceptedEventCount += 1;
				}
			}

			expect(
				acceptedEventCount,
				`seed ${seed} produced events`,
			).toBeGreaterThan(4);
		}
	});
});
