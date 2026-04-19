import {
	FLOW_PLAN_COMMAND,
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_RUN_COMMAND,
	FLOW_STATUS_COMMAND,
	flowResetFeatureCommand,
} from "./constants";
import { activeDecisionGate, summarizeCompletion } from "./domain";
import type { Feature, Session } from "./schema";

export type SessionGuidance = {
	category:
		| "no_session"
		| "planning"
		| "decision_gate"
		| "execution"
		| "blocked"
		| "completed";
	status: string;
	summary: string;
	nextStep: string;
	nextCommand: string;
};

function summarizeFeature(feature: Feature): string {
	return `${feature.id} (${feature.status}): ${feature.title}`;
}

export function summarizeSession(session: Session | null) {
	if (!session) {
		return {
			status: "missing",
			summary: "No active Flow session found.",
		};
	}

	const features = session.plan?.features ?? [];
	const completedCount = features.filter(
		(feature) => feature.status === "completed",
	).length;
	const activeFeature =
		features.find(
			(feature) => feature.id === session.execution.activeFeatureId,
		) ?? null;
	const completion = summarizeCompletion(session);
	const decisionGate = activeDecisionGate(session);

	return {
		status: session.status,
		summary:
			session.execution.lastSummary ??
			session.plan?.summary ??
			"Flow session is initialized.",
		session: {
			id: session.id,
			goal: session.goal,
			approval: session.approval,
			status: session.status,
			planSummary: session.plan?.summary ?? null,
			planOverview: session.plan?.overview ?? null,
			completion,
			activeFeature: activeFeature
				? {
						id: activeFeature.id,
						title: activeFeature.title,
						status: activeFeature.status,
						summary: activeFeature.summary,
					}
				: null,
			featureProgress: {
				completed: completedCount,
				total: features.length,
			},
			features: features.map((feature) => ({
				id: feature.id,
				title: feature.title,
				status: feature.status,
				summary: feature.summary,
			})),
			notes: session.notes,
			artifacts: session.artifacts,
			closure: session.closure,
			planning: session.planning,
			decisionGate,
			lastOutcome: session.execution.lastOutcome,
			lastNextStep: session.execution.lastNextStep,
			lastFeatureResult: session.execution.lastFeatureResult,
			lastReviewerDecision: session.execution.lastReviewerDecision,
			lastValidationRun: session.execution.lastValidationRun,
			lastOutcomeKind: session.execution.lastOutcomeKind,
			nextCommand: deriveNextCommand(session),
			featureLines: features.map(summarizeFeature),
		},
	};
}

export function explainSessionState(session: Session | null): SessionGuidance {
	if (!session) {
		return {
			category: "no_session",
			status: "missing",
			summary: "No active Flow session exists for this workspace.",
			nextStep: "Start a new Flow session with /flow-plan <goal>.",
			nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
		};
	}

	const nextCommand = deriveNextCommand(session);
	const decisionGate = activeDecisionGate(session);

	if (decisionGate) {
		return {
			category: "decision_gate",
			status: decisionGate.status,
			summary: decisionGate.question,
			nextStep: decisionGate.recommendation,
			nextCommand,
		};
	}

	if (session.status === "planning") {
		return {
			category: "planning",
			status: session.status,
			summary: session.plan
				? "Flow has a draft plan that still needs the next planning step."
				: "Flow needs a draft plan before execution can begin.",
			nextStep: session.plan
				? "Review or refine the draft plan, then approve it when ready."
				: "Create or refresh the draft plan for the current goal.",
			nextCommand,
		};
	}

	if (session.status === "blocked") {
		const outcome = session.execution.lastOutcome;
		const reviewerDecision = session.execution.lastReviewerDecision;

		return {
			category: "blocked",
			status: session.status,
			summary:
				outcome?.summary ??
				reviewerDecision?.summary ??
				session.execution.lastSummary ??
				"Flow is blocked and needs recovery before it can continue.",
			nextStep:
				session.execution.lastNextStep ??
				outcome?.resolutionHint ??
				(outcome?.retryable || outcome?.autoResolvable
					? "Address the blocking prerequisite, then retry the feature."
					: "Inspect the blocker and decide whether to reset, replan, or stop."),
			nextCommand,
		};
	}

	if (session.status === "ready" || session.status === "running") {
		const activeFeature = session.plan?.features.find(
			(feature) => feature.id === session.execution.activeFeatureId,
		);

		return {
			category: "execution",
			status: session.status,
			summary: activeFeature
				? `Flow is focused on feature '${activeFeature.id}'.`
				: "Flow is ready to continue execution.",
			nextStep:
				session.execution.lastNextStep ??
				(activeFeature
					? "Continue the active feature through validation and review."
					: "Run the next approved feature."),
			nextCommand,
		};
	}

	return {
		category: "completed",
		status: session.status,
		summary:
			session.closure?.summary ??
			session.execution.lastSummary ??
			"Flow has completed the active session.",
		nextStep: "Start a new goal when you are ready for more work.",
		nextCommand,
	};
}

export function renderSessionStatusSummary(
	session: Session | null,
	options?: { nextCommand?: string; nextStep?: string },
): string {
	const guidance = explainSessionState(session);
	const summary = summarizeSession(session);
	const lines = [`Flow ${guidance.status}: ${guidance.summary}`];

	if (summary.session?.goal) {
		lines.push(`Goal: ${summary.session.goal}`);
	}

	if (summary.session?.activeFeature) {
		const activeFeature = summary.session.activeFeature;
		lines.push(
			`Active feature: ${activeFeature.id} — ${activeFeature.title} (${activeFeature.status})`,
		);
	}

	if (summary.session?.featureProgress) {
		lines.push(
			`Progress: ${summary.session.featureProgress.completed}/${summary.session.featureProgress.total} completed`,
		);
	}

	lines.push(`Next: ${options?.nextStep ?? guidance.nextStep}`);
	lines.push(`Command: ${options?.nextCommand ?? guidance.nextCommand}`);

	return lines.join("\n");
}

export function deriveNextCommand(session: Session): string {
	if (!session.plan) {
		return FLOW_PLAN_WITH_GOAL_COMMAND;
	}
	if (session.status === "planning") {
		return FLOW_PLAN_COMMAND;
	}
	if (session.status === "ready" || session.status === "running") {
		return FLOW_RUN_COMMAND;
	}
	if (session.status === "blocked") {
		const lastFeatureId = session.execution.lastFeatureId;
		const outcome = session.execution.lastOutcome;

		if (
			lastFeatureId &&
			!outcome?.needsHuman &&
			(outcome?.retryable ||
				outcome?.autoResolvable ||
				outcome?.kind === "contract_error")
		) {
			return flowResetFeatureCommand(lastFeatureId);
		}
	}
	if (session.status === "completed") {
		return FLOW_PLAN_WITH_GOAL_COMMAND;
	}

	return FLOW_STATUS_COMMAND;
}
