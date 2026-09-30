import type {
	EvidenceEntry,
	FeatureRun,
	Session,
	SourceDigest,
	ValidationCheck,
	ValidationObservation,
} from "./session.js";
import { isFinalFeatureRun } from "./session-queries.js";
import {
	isAcceptedExtraProof,
	isAcceptedObservedGate,
	isAcceptedValidation,
	isValidationEligible,
	isValidationFresh,
	resolveValidationPolicy,
	unresolvedVetoedCommands,
	unsatisfiedEvidence,
} from "./validation.js";

type ReviewKind = "feature" | "final";

/**
 * Whether the active run can open its review right now, and if not, why.
 *
 * `startReview` refuses on anything but `ready`, and the status projection
 * routes `nextAction` from the same result, so both callers apply the same
 * rules. The projection is digest-blind, though: it has no live workspace
 * digest to pass in, so it pins to the latest applicable broad validation's
 * digest, while the guard uses the live digest.
 */
export type ReviewReadiness =
	| Readonly<{
			kind: "ready";
			reviewKind: ReviewKind;
			applicable: ValidationObservation[];
	  }>
	| Readonly<{ kind: "vetoed"; commands: string[] }>
	| Readonly<{ kind: "needs-validation"; reviewKind: ReviewKind }>
	| Readonly<{ kind: "evidence-unsatisfied"; entries: EvidenceEntry[] }>
	| Readonly<{ kind: "checks-unsatisfied"; checks: ValidationCheck[] }>;

export function reviewReadiness(
	session: Session,
	run: FeatureRun,
	sourceDigest?: SourceDigest,
): ReviewReadiness {
	const reviewKind: ReviewKind = isFinalFeatureRun(session, run)
		? "final"
		: "feature";
	const vetoed = unresolvedVetoedCommands(session, run, sourceDigest);
	if (vetoed.length > 0) return { kind: "vetoed", commands: vetoed };
	const applicable = run.validations.filter(
		(validation) =>
			isAcceptedValidation(session, validation, sourceDigest) &&
			isValidationFresh(session, run, validation),
	);
	const required = applicable.filter((observation) => {
		const policy = resolveValidationPolicy(
			session,
			run.featureId,
			observation.command,
		);
		return policy.intent === "pass"
			? isValidationEligible(observation, sourceDigest)
			: isAcceptedObservedGate(session, observation, sourceDigest) ||
					(reviewKind === "feature" &&
						isAcceptedExtraProof(session, observation, sourceDigest));
	});
	const hasRequired =
		reviewKind === "feature"
			? required.length > 0
			: required.some((validation) => validation.scope === "broad");
	if (!hasRequired) return { kind: "needs-validation", reviewKind };
	const checkDigest =
		sourceDigest ??
		(reviewKind === "final"
			? required.findLast((entry) => entry.scope === "broad")?.sourceDigest
			: required.at(-1)?.sourceDigest);
	const checks =
		session.plan?.features.find((feature) => feature.id === run.featureId)
			?.checks ?? [];
	const missingChecks = checks.filter(
		(check) =>
			!applicable.some(
				(observation) =>
					observation.command === check.command &&
					observation.sourceDigest === checkDigest,
			),
	);
	if (missingChecks.length > 0)
		return { kind: "checks-unsatisfied", checks: missingChecks };
	if (reviewKind === "final") {
		// The projection has no live workspace digest to pass in, so it falls
		// back to the digest of the broad validation that satisfied `hasRequired`
		// above -- the same proxy `nextAction` used before this extraction, via
		// `findLast` over the identical eligible+fresh+broad predicate.
		const evidenceDigest =
			sourceDigest ??
			applicable.findLast((validation) => validation.scope === "broad")
				?.sourceDigest;
		const entries = unsatisfiedEvidence(session, evidenceDigest);
		if (entries.length > 0) return { kind: "evidence-unsatisfied", entries };
	}
	return { kind: "ready", reviewKind, applicable };
}
