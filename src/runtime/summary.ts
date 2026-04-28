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

type SummarizedPlanning = Pick<
	Session["planning"],
	| "repoProfile"
	| "research"
	| "implementationApproach"
	| "decisionLog"
	| "replanLog"
> & {
	packageManager?: Session["planning"]["packageManager"];
	packageManagerAmbiguous?: true;
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
	planning: SummarizedPlanning;
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

const NO_ACTIVE_SESSION_SUMMARY = "No active Flow session found.";
const NO_ACTIVE_SESSION_GUIDANCE_SUMMARY =
	"No active Flow session exists for this workspace.";

type SummarizedFeature = SummarizedSessionDetails["features"][number];
type SummarizedActiveFeature = SummarizedSessionDetails["activeFeature"];

function summarizeFeature(feature: Feature): string {
	return `${feature.id} (${feature.status}): ${feature.title}`;
}

function projectFeature(feature: Feature): SummarizedFeature {
	return {
		id: feature.id,
		title: feature.title,
		status: feature.status,
		summary: feature.summary,
	};
}

function projectActiveFeature(
	feature: Feature | null,
): SummarizedActiveFeature {
	return feature ? projectFeature(feature) : null;
}

function sessionFeatures(session: Session): Feature[] {
	return session.plan?.features ?? [];
}

function summarizePlanning(session: Session): SummarizedPlanning {
	return {
		repoProfile: session.planning.repoProfile,
		research: session.planning.research,
		implementationApproach: session.planning.implementationApproach,
		decisionLog: session.planning.decisionLog,
		replanLog: session.planning.replanLog,
		...(session.planning.packageManager
			? { packageManager: session.planning.packageManager }
			: {}),
		...(session.planning.packageManagerAmbiguous
			? { packageManagerAmbiguous: true as const }
			: {}),
	};
}

function activeFeatureForSession(
	session: Session,
	features: Feature[] = sessionFeatures(session),
): Feature | null {
	return (
		features.find(
			(feature) => feature.id === session.execution.activeFeatureId,
		) ?? null
	);
}

function missingSessionGuidance(
	operator: SessionOperatorState,
): SessionGuidance {
	return {
		category: "no_session",
		status: "missing",
		summary: NO_ACTIVE_SESSION_GUIDANCE_SUMMARY,
		...operator,
	};
}

function sessionSummaryText(session: Session): string {
	return (
		session.execution.lastSummary ??
		session.plan?.summary ??
		"Flow session is initialized."
	);
}

function buildSessionDetails(
	session: Session,
	operator: SessionOperatorState,
): SummarizedSessionDetails {
	const features = sessionFeatures(session);
	const completion = summarizeCompletion(session);
	const decisionGate = activeDecisionGate(session);

	return {
		id: session.id,
		goal: session.goal,
		approval: session.approval,
		status: session.status,
		planSummary: session.plan?.summary ?? null,
		planOverview: session.plan?.overview ?? null,
		completion,
		activeFeature: projectActiveFeature(
			activeFeatureForSession(session, features),
		),
		featureProgress: {
			completed: features.filter((feature) => feature.status === "completed")
				.length,
			total: features.length,
		},
		features: features.map(projectFeature),
		notes: session.notes,
		artifacts: session.artifacts,
		closure: session.closure,
		planning: summarizePlanning(session),
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
	};
}

function buildSessionGuidance(
	session: Session | null,
	operator: SessionOperatorState,
): SessionGuidance {
	if (!session) {
		return missingSessionGuidance(operator);
	}

	switch (operator.phase) {
		case "decision": {
			const decisionGate = activeDecisionGate(session);
			return {
				category: "decision_gate",
				status: decisionGate?.status ?? session.status,
				summary: decisionGate?.question ?? operator.blocker ?? session.status,
				...operator,
			};
		}
		case "planning": {
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
		case "blocked":
			return {
				category: "blocked",
				status: session.status,
				summary:
					operator.blocker ??
					"Flow is blocked and needs recovery before it can continue.",
				...operator,
			};
		case "ready":
		case "executing": {
			const activeFeature = activeFeatureForSession(session);
			return {
				category: "execution",
				status: session.status,
				summary: activeFeature
					? `Flow is focused on feature '${activeFeature.id}'.`
					: "Flow is ready to continue execution.",
				...operator,
			};
		}
		case "completed":
			return {
				category: "completed",
				status: session.status,
				summary:
					session.closure?.summary ??
					session.execution.lastSummary ??
					"Flow has completed the active session.",
				...operator,
			};
		default:
			return missingSessionGuidance(operator);
	}
}

export function deriveSessionViewModel(
	session: Session | null,
): SessionViewModel {
	if (!session) {
		const operator = deriveSessionOperatorState(null);
		return {
			status: "missing",
			summary: NO_ACTIVE_SESSION_SUMMARY,
			session: null,
			guidance: missingSessionGuidance(operator),
			operator,
		};
	}

	const operator = deriveSessionOperatorState(session);

	return {
		status: session.status,
		summary: sessionSummaryText(session),
		session: buildSessionDetails(session, operator),
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
