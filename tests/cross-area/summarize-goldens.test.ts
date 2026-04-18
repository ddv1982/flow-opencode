import { describe, expect, test } from "bun:test";
import type { Session } from "../../src/runtime/schema";
import { createSession } from "../../src/runtime/session";
import { summarizeSession } from "../../src/runtime/summary";
import { cloneSamplePlan } from "../fixtures";

function normalizeSummary(value: unknown): unknown {
	return JSON.parse(
		JSON.stringify(value, (_key, current) =>
			typeof current === "string"
				? current
						.replace(
							/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
							"<session-id>",
						)
						.replace(
							/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g,
							"<timestamp>",
						)
				: current,
		),
	);
}

function buildSession(status: Session["status"]): Session {
	const session = createSession("Summarize canonical fixtures");
	const plan = cloneSamplePlan();
	const base: Session = {
		...session,
		status,
		approval: status === "planning" ? "pending" : "approved",
		plan,
	};

	switch (status) {
		case "planning":
			return base;
		case "ready":
			return base;
		case "running":
			return {
				...base,
				execution: {
					...base.execution,
					activeFeatureId: "setup-runtime",
					lastFeatureId: "setup-runtime",
					lastSummary: "Running feature 'setup-runtime'.",
				},
				plan: {
					...plan,
					features: plan.features.map((feature) =>
						feature.id === "setup-runtime"
							? { ...feature, status: "in_progress" }
							: feature,
					),
				},
			};
		case "blocked":
			return {
				...base,
				execution: {
					...base.execution,
					lastFeatureId: "setup-runtime",
					lastSummary: "Blocked on an operator decision.",
					lastOutcomeKind: "needs_operator_input",
					lastOutcome: {
						kind: "needs_operator_input",
						summary: "Waiting on an operator.",
						needsHuman: true,
					},
				},
				plan: {
					...plan,
					features: plan.features.map((feature) =>
						feature.id === "setup-runtime"
							? { ...feature, status: "blocked" }
							: feature,
					),
				},
			};
		case "completed":
			return {
				...base,
				execution: {
					...base.execution,
					lastFeatureId: "setup-runtime",
					lastSummary: "Completed runtime setup.",
					lastOutcomeKind: "completed",
					lastOutcome: { kind: "completed" },
				},
				plan: {
					...plan,
					features: plan.features.map((feature) => ({
						...feature,
						status: "completed",
					})),
				},
				timestamps: {
					...base.timestamps,
					completedAt: "2026-01-01T00:00:00.000Z",
				},
			};
	}
}

const expectedSummaryFixtures = {
	blocked: {
		session: {
			activeFeature: null,
			approval: "approved",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: false,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 0,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 2,
				totalFeatures: 2,
			},
			featureLines: [
				"setup-runtime (blocked): Create runtime helpers",
				"execute-feature (pending): Implement execution flow",
			],
			featureProgress: { completed: 0, total: 2 },
			features: [
				{
					id: "setup-runtime",
					status: "blocked",
					summary: "Add runtime helper files and state persistence.",
					title: "Create runtime helpers",
				},
				{
					id: "execute-feature",
					status: "pending",
					summary: "Wire runtime tools to feature execution.",
					title: "Implement execution flow",
				},
			],
			goal: "Summarize canonical fixtures",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: {
				kind: "needs_operator_input",
				needsHuman: true,
				summary: "Waiting on an operator.",
			},
			lastOutcomeKind: "needs_operator_input",
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-status",
			notes: [],
			planOverview: "Create one setup feature and one execution feature.",
			planSummary: "Implement a small workflow feature set.",
			planning: { repoProfile: [], research: [] },
			status: "blocked",
		},
		status: "blocked",
		summary: "Blocked on an operator decision.",
	},
	completed: {
		session: {
			activeFeature: null,
			approval: "approved",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: false,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 2,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 2,
				totalFeatures: 2,
			},
			featureLines: [
				"setup-runtime (completed): Create runtime helpers",
				"execute-feature (completed): Implement execution flow",
			],
			featureProgress: { completed: 2, total: 2 },
			features: [
				{
					id: "setup-runtime",
					status: "completed",
					summary: "Add runtime helper files and state persistence.",
					title: "Create runtime helpers",
				},
				{
					id: "execute-feature",
					status: "completed",
					summary: "Wire runtime tools to feature execution.",
					title: "Implement execution flow",
				},
			],
			goal: "Summarize canonical fixtures",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: { kind: "completed" },
			lastOutcomeKind: "completed",
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-plan <goal>",
			notes: [],
			planOverview: "Create one setup feature and one execution feature.",
			planSummary: "Implement a small workflow feature set.",
			planning: { repoProfile: [], research: [] },
			status: "completed",
		},
		status: "completed",
		summary: "Completed runtime setup.",
	},
	missing: {
		status: "missing",
		summary: "No active Flow session found.",
	},
	noPlanCompleted: {
		session: {
			activeFeature: null,
			approval: "approved",
			artifacts: [],
			completion: null,
			featureLines: [],
			featureProgress: { completed: 0, total: 0 },
			features: [],
			goal: "No-plan completed fixture",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-plan <goal>",
			notes: [],
			planOverview: null,
			planSummary: null,
			planning: { repoProfile: [], research: [] },
			status: "completed",
		},
		status: "completed",
		summary: "Flow session is initialized.",
	},
	planning: {
		session: {
			activeFeature: null,
			approval: "pending",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: false,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 0,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 2,
				totalFeatures: 2,
			},
			featureLines: [
				"setup-runtime (pending): Create runtime helpers",
				"execute-feature (pending): Implement execution flow",
			],
			featureProgress: { completed: 0, total: 2 },
			features: [
				{
					id: "setup-runtime",
					status: "pending",
					summary: "Add runtime helper files and state persistence.",
					title: "Create runtime helpers",
				},
				{
					id: "execute-feature",
					status: "pending",
					summary: "Wire runtime tools to feature execution.",
					title: "Implement execution flow",
				},
			],
			goal: "Summarize canonical fixtures",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-plan",
			notes: [],
			planOverview: "Create one setup feature and one execution feature.",
			planSummary: "Implement a small workflow feature set.",
			planning: { repoProfile: [], research: [] },
			status: "planning",
		},
		status: "planning",
		summary: "Implement a small workflow feature set.",
	},
	ready: {
		session: {
			activeFeature: null,
			approval: "approved",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: false,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 0,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 2,
				totalFeatures: 2,
			},
			featureLines: [
				"setup-runtime (pending): Create runtime helpers",
				"execute-feature (pending): Implement execution flow",
			],
			featureProgress: { completed: 0, total: 2 },
			features: [
				{
					id: "setup-runtime",
					status: "pending",
					summary: "Add runtime helper files and state persistence.",
					title: "Create runtime helpers",
				},
				{
					id: "execute-feature",
					status: "pending",
					summary: "Wire runtime tools to feature execution.",
					title: "Implement execution flow",
				},
			],
			goal: "Summarize canonical fixtures",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-run",
			notes: [],
			planOverview: "Create one setup feature and one execution feature.",
			planSummary: "Implement a small workflow feature set.",
			planning: { repoProfile: [], research: [] },
			status: "ready",
		},
		status: "ready",
		summary: "Implement a small workflow feature set.",
	},
	running: {
		session: {
			activeFeature: {
				fileTargets: ["src/runtime/session.ts"],
				id: "setup-runtime",
				status: "in_progress",
				summary: "Add runtime helper files and state persistence.",
				title: "Create runtime helpers",
				verification: ["bun test"],
			},
			approval: "approved",
			artifacts: [],
			completion: {
				activeFeatureTriggersSessionCompletion: false,
				canCompleteWithPendingFeatures: false,
				completedFeatures: 0,
				remainingBeyondTarget: 0,
				requiresFinalReview: false,
				targetCompletedFeatures: 2,
				totalFeatures: 2,
			},
			featureLines: [
				"setup-runtime (in_progress): Create runtime helpers",
				"execute-feature (pending): Implement execution flow",
			],
			featureProgress: { completed: 0, total: 2 },
			features: [
				{
					id: "setup-runtime",
					status: "in_progress",
					summary: "Add runtime helper files and state persistence.",
					title: "Create runtime helpers",
				},
				{
					id: "execute-feature",
					status: "pending",
					summary: "Wire runtime tools to feature execution.",
					title: "Implement execution flow",
				},
			],
			goal: "Summarize canonical fixtures",
			id: "<session-id>",
			lastFeatureResult: null,
			lastNextStep: null,
			lastOutcome: null,
			lastOutcomeKind: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			nextCommand: "/flow-run",
			notes: [],
			planOverview: "Create one setup feature and one execution feature.",
			planSummary: "Implement a small workflow feature set.",
			planning: { repoProfile: [], research: [] },
			status: "running",
		},
		status: "running",
		summary: "Running feature 'setup-runtime'.",
	},
};

describe("cross-area summarize goldens", () => {
	test("matches seven canonical summary fixtures", () => {
		const fixtures = {
			missing: summarizeSession(null),
			planning: summarizeSession(buildSession("planning")),
			ready: summarizeSession(buildSession("ready")),
			running: summarizeSession(buildSession("running")),
			blocked: summarizeSession(buildSession("blocked")),
			completed: summarizeSession(buildSession("completed")),
			noPlanCompleted: summarizeSession({
				...createSession("No-plan completed fixture"),
				status: "completed",
				approval: "approved",
				timestamps: {
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					approvedAt: "2026-01-01T00:00:00.000Z",
					completedAt: "2026-01-01T00:00:00.000Z",
				},
			}),
		};

		expect(normalizeSummary(fixtures)).toEqual(expectedSummaryFixtures);
	});
});
