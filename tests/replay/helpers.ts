import { expect } from "bun:test";
import {
	decideWorkflowCommand,
	replayWorkflowEvents,
	type WorkflowCommand,
	type WorkflowEvent,
	type WorkflowState,
} from "../../src/core";
import {
	type Plan,
	type ReviewerDecision,
	SessionSchema,
} from "../../src/runtime/schema";

export type ReplayScriptStep =
	| WorkflowCommand
	| ((state: WorkflowState | null) => WorkflowCommand);

export type GoldenEventLogCase = {
	name: string;
	sessionId: string;
	description: string;
	events: readonly WorkflowEvent[];
	finalState: WorkflowState;
};

export function timestamp(index: number): string {
	return new Date(Date.UTC(2026, 4, 3, 12, index, 0)).toISOString();
}

export function createReplayPlan(
	featureCount: number,
	options: { minCompletedFeatures?: number } = {},
): Plan {
	return {
		summary: `Replay plan with ${featureCount} feature(s).`,
		overview: "Deterministic event-log replay fixture.",
		requirements: [
			"Replay events deterministically",
			"Preserve semantic invariants",
		],
		architectureDecisions: [
			"Use append-only workflow events as the release-gated source of truth.",
		],
		features: Array.from({ length: featureCount }, (_, index) => {
			const featureNumber = index + 1;
			return {
				id: `feature-${featureNumber}`,
				title: `Replay feature ${featureNumber}`,
				summary: `Complete replay fixture feature ${featureNumber}.`,
				fileTargets: [`src/core/workflow/feature-${featureNumber}.ts`],
				verification: ["bun test tests/replay"],
				...(index > 0 ? { dependsOn: [`feature-${index}`] } : {}),
				status: "pending" as const,
			};
		}),
		goalMode: "implementation",
		decompositionPolicy: "atomic_feature",
		...(options.minCompletedFeatures === undefined
			? {}
			: {
					completionPolicy: {
						minCompletedFeatures: options.minCompletedFeatures,
					},
				}),
	};
}

export function approvedFeatureDecision(featureId: string): ReviewerDecision {
	return {
		scope: "feature",
		featureId,
		status: "approved",
		summary: `Feature ${featureId} approved for replay completion.`,
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

export function approvedFinalDecision(): ReviewerDecision {
	return {
		scope: "final",
		reviewPurpose: "completion_gate",
		reviewDepth: "detailed",
		reviewedSurfaces: [
			"changed_files",
			"shared_surfaces",
			"validation_evidence",
		],
		evidenceSummary:
			"Golden replay fixture covers event replay, checkpoint, projection, and validation evidence.",
		validationAssessment:
			"Broad replay validation passed for the completed workflow path.",
		evidenceRefs: {
			changedArtifacts: ["src/core/workflow/feature-1.ts"],
			validationCommands: ["bun test tests/replay"],
		},
		integrationChecks: [
			"Checked replayed event state against checkpoint and projection stores.",
		],
		regressionChecks: [
			"Checked seeded random event sequences preserve semantic invariants.",
		],
		remainingGaps: [],
		status: "approved",
		summary: "Final replay review approved.",
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

export function completedWorker(
	featureId: string,
	options: { final?: boolean } = {},
): Extract<WorkflowCommand, { type: "complete_run" }>["worker"] {
	const base = {
		contractVersion: "1" as const,
		status: "ok" as const,
		summary: `Completed ${featureId} through replay fixture.`,
		artifactsChanged: [{ path: `src/core/workflow/${featureId}.ts` }],
		validationRun: [
			{
				command: "bun test tests/replay",
				status: "passed" as const,
				summary: "Replay/property gate passed.",
			},
		],
		validationScope: options.final ? ("broad" as const) : ("targeted" as const),
		decisions: [],
		nextStep: options.final
			? "Workflow complete."
			: "Continue with the next replay feature.",
		outcome: { kind: "completed" as const },
		featureResult: {
			featureId,
			verificationStatus: "passed" as const,
		},
		featureReview: {
			status: "passed" as const,
			summary: "Feature review passed.",
			blockingFindings: [],
		},
	};

	if (!options.final) {
		return base;
	}

	return {
		...base,
		finalReview: {
			status: "passed" as const,
			summary: "Final review passed.",
			blockingFindings: [],
			reviewDepth: "detailed" as const,
			reviewedSurfaces: [
				"changed_files" as const,
				"shared_surfaces" as const,
				"validation_evidence" as const,
			],
			evidenceSummary:
				"Final review covered changed artifacts and replay validation evidence.",
			validationAssessment:
				"Broad validation evidence is sufficient for release-gate replay completion.",
			evidenceRefs: {
				changedArtifacts: [`src/core/workflow/${featureId}.ts`],
				validationCommands: ["bun test tests/replay"],
			},
			integrationChecks: ["Checked checkpoint and projection integration."],
			regressionChecks: ["Checked random event sequences."],
			remainingGaps: [],
		},
	};
}

export function buildGoldenEventLogCase(
	name: string,
	description: string,
	sessionId: string,
	steps: readonly ReplayScriptStep[],
): GoldenEventLogCase {
	let state: WorkflowState | null = null;
	const events: WorkflowEvent[] = [];

	steps.forEach((step, index) => {
		const command = typeof step === "function" ? step(state) : step;
		const decision = decideWorkflowCommand(state, command, {
			recordedAt: timestamp(index),
		});
		if (!decision.accepted) {
			throw new Error(
				`Golden replay case '${name}' rejected ${command.type}: ${decision.message}`,
			);
		}

		for (const event of decision.events) {
			const replayed = replayWorkflowEvents([event], state);
			if (!replayed) {
				throw new Error(`Golden replay case '${name}' did not produce state.`);
			}
			assertWorkflowSemanticInvariants(replayed, `${name}:${event.type}`);
			state = replayed;
			events.push(event);
		}
	});

	if (!state) {
		throw new Error(
			`Golden replay case '${name}' did not produce final state.`,
		);
	}

	return { name, description, sessionId, events, finalState: state };
}

export function eventRecordsForCase(testCase: GoldenEventLogCase) {
	return testCase.events.map((event, index) => ({
		version: 1 as const,
		sessionId: testCase.sessionId,
		sequence: index + 1,
		event,
	}));
}

export function eventLogJsonl(testCase: GoldenEventLogCase): string {
	return `${eventRecordsForCase(testCase)
		.map((record) => JSON.stringify(record))
		.join("\n")}\n`;
}

export function assertWorkflowSemanticInvariants(
	state: WorkflowState,
	label = "workflow state",
): void {
	const parsed = SessionSchema.parse(state);
	expect(parsed, label).toEqual(state);

	if (state.plan) {
		const featureIds = state.plan.features.map((feature) => feature.id);
		expect(new Set(featureIds).size, `${label}: unique feature ids`).toBe(
			featureIds.length,
		);

		for (const feature of state.plan.features) {
			for (const dependencyId of feature.dependsOn ?? []) {
				expect(
					featureIds.includes(dependencyId),
					`${label}: dependency ${dependencyId} exists`,
				).toBe(true);
			}
		}

		const inProgress = state.plan.features.filter(
			(feature) => feature.status === "in_progress",
		);
		expect(
			inProgress.length,
			`${label}: at most one in-progress feature`,
		).toBeLessThanOrEqual(1);

		if (state.execution.activeFeatureId) {
			expect(
				featureIds.includes(state.execution.activeFeatureId),
				`${label}: active feature exists in plan`,
			).toBe(true);
			expect(
				inProgress.map((feature) => feature.id),
				`${label}: active feature is the in-progress feature`,
			).toEqual([state.execution.activeFeatureId]);
		} else {
			expect(
				inProgress,
				`${label}: inactive state has no in-progress feature`,
			).toHaveLength(0);
		}

		for (const entry of state.execution.history) {
			const featureId = entry.featureResult?.featureId;
			if (featureId) {
				expect(
					featureIds.includes(featureId),
					`${label}: history feature ${featureId} exists in plan`,
				).toBe(true);
			}
		}
	}

	if (state.status === "running") {
		expect(
			state.execution.activeFeatureId,
			`${label}: running has active feature`,
		).toBeTruthy();
	} else {
		expect(
			state.execution.activeFeatureId,
			`${label}: non-running has no active feature`,
		).toBeNull();
	}

	if (state.approval === "approved") {
		expect(
			state.plan,
			`${label}: approved sessions have a plan`,
		).not.toBeNull();
		expect(
			state.timestamps.approvedAt,
			`${label}: approved timestamp recorded`,
		).toBeTruthy();
	}

	if (state.status === "completed") {
		expect(state.closure?.kind, `${label}: completed closure`).toBe(
			"completed",
		);
		expect(
			state.timestamps.completedAt,
			`${label}: completion timestamp`,
		).toBeTruthy();
	} else {
		expect(
			state.closure,
			`${label}: open sessions have no completed closure`,
		).toBeNull();
		expect(
			state.timestamps.completedAt,
			`${label}: open sessions have no completed timestamp`,
		).toBeNull();
	}

	if (state.timestamps.completedAt) {
		expect(state.timestamps.completedAt >= state.timestamps.createdAt).toBe(
			true,
		);
	}
	expect(state.timestamps.updatedAt >= state.timestamps.createdAt).toBe(true);
}
