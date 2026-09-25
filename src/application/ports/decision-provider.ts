export const JEV_ATTEMPT_RESERVATION_USD = (64_000 * 0.042) / 1_000_000;

import type { SourceDigest } from "../../domain/session.js";
export type RecoveryCandidate = Readonly<{
	id: string;
	action: "retry" | "independent-feature";
	featureId: string;
	remedy: string;
	changedFromPreviousAttempt: string;
	findingIds: readonly string[];
}>;
export type DecisionPacket = Readonly<{
	sessionId: string;
	revision: number;
	sourceDigest: SourceDigest;
	goal: string;
	planDigest: string;
	rubric: "recovery-v1";
	findings: readonly { id: string; summary: string; evidence: string }[];
	candidates: readonly RecoveryCandidate[];
}>;
export type DecisionAdvice =
	| Readonly<{ kind: "unavailable"; reason: string }>
	| Readonly<{
			kind: "answered";
			model: "jev-1.13.0";
			choice: string;
			probabilities: Readonly<Record<string, number>>;
			confidence: number;
			assessments: Readonly<
				Record<string, { goal: number; suitability: number }>
			>;
			inputTokens: number;
			outputTokens: number;
			latencyMs: number;
	  }>;
export interface DecisionProvider {
	fitsRequest?(packet: DecisionPacket): boolean;
	assess(
		packet: DecisionPacket,
		options: Readonly<{ signal: AbortSignal; reserveAttempt: () => boolean }>,
	): Promise<DecisionAdvice>;
}
