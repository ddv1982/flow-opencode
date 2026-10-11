import type {
	DecisionAdvice,
	DecisionTelemetry,
	RecoveryCandidate,
} from "./ports/decision-provider.js";

export type LastRecoveryAssessment = Readonly<{
	kind: "selected" | "unavailable" | "abstain";
	mode: "shadow" | "delegated";
	packetDigest: string;
	model: string | null;
	requestedModel: "jev-1.13.0";
	selectedCandidateId: string | null;
	action: RecoveryCandidate["action"] | null;
	featureId: string | null;
	reason: string | null;
	telemetry: DecisionTelemetry &
		Readonly<{
			assessmentElapsedMs: number;
			attemptsReserved: number;
			reservedUsd: number;
		}>;
	decision: Readonly<{
		choice: string;
		confidence: number;
		probabilities: Readonly<Record<string, number>>;
		assessments: Readonly<
			Record<string, { goal: number; suitability: number }>
		>;
		thresholds: Readonly<{ choice: number; goal: number; suitability: number }>;
		checks: Readonly<{
			attemptReserved: boolean;
			modelMatched: boolean;
			candidatePresent: boolean;
			assessmentPresent: boolean;
			choicePassed: boolean;
			goalPassed: boolean;
			suitabilityPassed: boolean;
		}>;
	}> | null;
}>;
export type RecoveryActivation = {
	host: string;
	source: "explicit" | "default" | "api";
	mode: "off" | "shadow" | "delegated";
	attempts: number;
	outcome: string;
	inactiveReason: string | null;
};

export function recoveryActivationView(
	activation: RecoveryActivation,
	active: boolean,
	bound: boolean,
	advice: {
		calls: number;
		last: Record<string, unknown> | null;
		inFlight: boolean;
	} | null,
) {
	const attempts = advice?.calls ?? activation.attempts;
	return {
		automation: { scope: "current-plugin-process", active, bound },
		advice: {
			configured: activation.mode !== "off",
			configuredMode: activation.mode,
			activationSource: activation.source,
			active: advice !== null,
			attempted: attempts > 0,
			attemptsReserved: attempts,
			outcome:
				typeof advice?.last?.kind === "string"
					? advice.last.kind
					: advice?.inFlight
						? "pending"
						: activation.outcome,
			inactiveReason: advice ? null : activation.inactiveReason,
		},
	};
}

export function recoveryDecisionView(
	advice: DecisionAdvice,
	candidate: RecoveryCandidate | undefined,
	attemptReserved: boolean,
	thresholds: NonNullable<LastRecoveryAssessment["decision"]>["thresholds"],
): LastRecoveryAssessment["decision"] {
	if (advice.kind !== "answered") return null;
	const assessment = candidate ? advice.assessments[candidate.id] : undefined;
	return {
		choice: advice.choice,
		confidence: advice.confidence,
		probabilities: advice.probabilities,
		assessments: advice.assessments,
		thresholds: {
			choice: thresholds.choice,
			goal: thresholds.goal,
			suitability: thresholds.suitability,
		},
		checks: {
			attemptReserved,
			modelMatched: advice.model === "jev-1.13.0",
			candidatePresent: candidate !== undefined,
			assessmentPresent: assessment !== undefined,
			choicePassed:
				candidate !== undefined &&
				(advice.probabilities[candidate.id] ?? 0) >= thresholds.choice,
			goalPassed:
				assessment !== undefined && assessment.goal >= thresholds.goal,
			suitabilityPassed:
				assessment !== undefined &&
				assessment.suitability >= thresholds.suitability,
		},
	};
}
