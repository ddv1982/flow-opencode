import { activeDecisionGate, summarizeCompletion } from "./domain";
import type { Feature, Session } from "./schema";
import {
	deriveNextCommand,
	deriveSessionOperatorState,
	type SessionOperatorState,
} from "./session-operator-state";

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
	phase:
		| "idle"
		| "planning"
		| "decision"
		| "ready"
		| "executing"
		| "blocked"
		| "completed";
	lane: "lite" | "standard" | "strict";
	laneReason: string;
	blocker: string | null;
	reason: string;
	nextStep: string;
	nextCommand: string;
};

export type SummarizedSessionDetails = {
	id: string;
	goal: string;
	approval: Session["approval"];
	status: Session["status"];
	planSummary: string | null;
	planOverview: string | null;
	completion: ReturnType<typeof summarizeCompletion>;
	activeFeature: {
		id: string;
		title: string;
		status: Feature["status"];
		summary: string;
	} | null;
	featureProgress: {
		completed: number;
		total: number;
	};
	features: Array<{
		id: string;
		title: string;
		status: Feature["status"];
		summary: string;
	}>;
	notes: Session["notes"];
	artifacts: Session["artifacts"];
	closure: Session["closure"];
	planning: Session["planning"];
	decisionGate: ReturnType<typeof activeDecisionGate>;
	lastOutcome: Session["execution"]["lastOutcome"];
	lastNextStep: Session["execution"]["lastNextStep"];
	lastFeatureResult: Session["execution"]["lastFeatureResult"];
	lastReviewerDecision: Session["execution"]["lastReviewerDecision"];
	lastValidationRun: Session["execution"]["lastValidationRun"];
	lastOutcomeKind: Session["execution"]["lastOutcomeKind"];
	nextCommand: string;
	operator: SessionOperatorState;
	featureLines: string[];
};

export type SessionViewModel = {
	status: string;
	summary: string;
	session: SummarizedSessionDetails | null;
	guidance: SessionGuidance;
	operator: SessionOperatorState;
};

function summarizeFeature(feature: Feature): string {
	return `${feature.id} (${feature.status}): ${feature.title}`;
}

function buildSessionGuidance(
	session: Session | null,
	operator: SessionOperatorState,
): SessionGuidance {
	if (!session) {
		return {
			category: "no_session",
			status: "missing",
			summary: "No active Flow session exists for this workspace.",
			...operator,
		};
	}

	const decisionGate = activeDecisionGate(session);
	if (decisionGate) {
		return {
			category: "decision_gate",
			status: decisionGate.status,
			summary: decisionGate.question,
			...operator,
		};
	}

	if (session.status === "planning") {
		const hasPlan = Boolean(session.plan);
		return {
			category: "planning",
			status: session.status,
			summary: hasPlan
				? "Flow has a draft plan that still needs the next planning step."
				: "Flow needs a draft plan before execution can begin.",
			...operator,
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
			...operator,
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
			...operator,
		};
	}

	return {
		category: "completed",
		status: session.status,
		summary:
			session.closure?.summary ??
			session.execution.lastSummary ??
			"Flow has completed the active session.",
		...operator,
	};
}

export function deriveSessionViewModel(
	session: Session | null,
): SessionViewModel {
	if (!session) {
		const operator = deriveSessionOperatorState(null);
		return {
			status: "missing",
			summary: "No active Flow session found.",
			session: null,
			guidance: buildSessionGuidance(null, operator),
			operator,
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
	const operator = deriveSessionOperatorState(session);

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
			operator,
			featureLines: features.map(summarizeFeature),
		},
		guidance: buildSessionGuidance(session, operator),
		operator,
	};
}

export function summarizeSession(session: Session | null) {
	const viewModel = deriveSessionViewModel(session);
	return viewModel.session
		? {
				status: viewModel.status,
				summary: viewModel.summary,
				session: viewModel.session,
			}
		: {
				status: viewModel.status,
				summary: viewModel.summary,
			};
}

export function explainSessionState(session: Session | null): SessionGuidance {
	return deriveSessionViewModel(session).guidance;
}

export type { SessionOperatorState } from "./session-operator-state";
export {
	deriveExecutionLane,
	deriveNextCommand,
	deriveSessionOperatorState,
} from "./session-operator-state";
