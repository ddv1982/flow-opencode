import {
	type BehaviorValidationLedgerTarget,
	behaviorRefGroundingFailureReasons,
	behaviorValidationLedgerFailureReasons,
	genericAppDomainForPath,
	reviewContextPackHasAsyncEventSignal,
} from "./final-review-behavior-validation";
import {
	artifactPathsForWorker,
	type FinalReviewWorkerEvidence,
	validationCommandsForWorker,
} from "./final-review-coverage-evidence";
import { isTestPath } from "./final-review-coverage-paths";
import type { ReviewContextPack } from "./review-content-discovery";
import { describeReviewContextPackGroundingFailure } from "./review-context-grounding";

export const FINAL_REVIEW_BEHAVIOR_RISK_CLASSES = [
	"async_event_ordering",
	"lifecycle_reentrancy",
	"state_commit_rollback",
	"persistence_recovery",
	"interaction_geometry",
	"accessibility_semantics",
	"test_evidence_authenticity",
] as const;

export type FinalReviewBehaviorRiskClass =
	(typeof FINAL_REVIEW_BEHAVIOR_RISK_CLASSES)[number];

export type FinalReviewBehaviorCheck = {
	riskClass: FinalReviewBehaviorRiskClass;
	result: "passed" | "gap_recorded" | "not_applicable" | "needs_fix";
	invariant: string;
	entrypointRefs: string[];
	stateOwnerRefs: string[];
	lifecycleOwnerRefs: string[];
	failurePath: string;
	testEvidenceRefs: string[];
	validationRefs: string[];
	remainingGap?: string | undefined;
};

export type FinalReviewValidationCoverage = {
	command: string;
	behaviorClasses: FinalReviewBehaviorRiskClass[];
	proves: string[];
	gaps: string[];
	testEvidenceRefs: string[];
};

export type FinalReviewBehaviorCoverageTarget = {
	evidenceRefs?:
		| {
				validationCommands: string[];
		  }
		| undefined;
	declaredReviewScope?:
		| readonly {
				id: string;
				kind: string;
				target: string;
		  }[]
		| undefined;
	remainingGaps?: string[] | undefined;
	suggestedValidation?: string[] | undefined;
	behaviorChecks?: FinalReviewBehaviorCheck[] | undefined;
	validationCoverage?: FinalReviewValidationCoverage[] | undefined;
	reviewContextPack?: ReviewContextPack | undefined;
};

export type { BehaviorValidationLedgerTarget };
export { behaviorValidationLedgerFailureReasons };

function addRequired(
	required: Set<FinalReviewBehaviorRiskClass>,
	...riskClasses: FinalReviewBehaviorRiskClass[]
): void {
	for (const riskClass of riskClasses) {
		required.add(riskClass);
	}
}

export function deriveRequiredFinalReviewBehaviorRisks(
	worker: FinalReviewWorkerEvidence,
	review: Pick<
		FinalReviewBehaviorCoverageTarget,
		"reviewContextPack" | "declaredReviewScope"
	> = {},
): FinalReviewBehaviorRiskClass[] {
	const required = new Set<FinalReviewBehaviorRiskClass>();
	const artifactPaths = artifactPathsForWorker(worker);
	const validationCommands = validationCommandsForWorker(worker);
	const genericAppDomains = new Set(
		artifactPaths
			.map(genericAppDomainForPath)
			.filter((domain): domain is string => domain !== null),
	);
	const testsTouched = artifactPaths.some(isTestPath);
	const pack = review.reviewContextPack;
	const groundedPack =
		pack &&
		describeReviewContextPackGroundingFailure(pack, {
			changedArtifacts: artifactPaths,
			validationCommands,
		}) === null
			? pack
			: undefined;

	if (groundedPack) {
		if (
			groundedPack.includedContext.some(
				(context) => context.reason === "state_owner",
			)
		) {
			addRequired(required, "state_commit_rollback");
		}
		if (
			groundedPack.includedContext.some(
				(context) => context.reason === "lifecycle_owner",
			)
		) {
			addRequired(required, "lifecycle_reentrancy");
		}
		if (reviewContextPackHasAsyncEventSignal(groundedPack)) {
			addRequired(required, "async_event_ordering");
		}
	}

	if (genericAppDomains.size >= 2) {
		addRequired(
			required,
			"async_event_ordering",
			"lifecycle_reentrancy",
			"state_commit_rollback",
		);
	}

	if (
		required.size > 0 &&
		(testsTouched ||
			validationCommands.length > 0 ||
			(groundedPack?.validationEvidence.length ?? 0) > 0)
	) {
		addRequired(required, "test_evidence_authenticity");
	}

	return FINAL_REVIEW_BEHAVIOR_RISK_CLASSES.filter((riskClass) =>
		required.has(riskClass),
	);
}

export function suppliedFinalReviewBehaviorEvidenceFailureReasons(
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewBehaviorCoverageTarget,
): string[] {
	return [
		...behaviorRefGroundingFailureReasons(worker, review),
		...behaviorValidationLedgerFailureReasons(
			validationCommandsForWorker(worker),
			review,
			[],
		),
	];
}

export function finalReviewBehaviorCoverageFailureReasons(
	worker: FinalReviewWorkerEvidence,
	review: FinalReviewBehaviorCoverageTarget,
): string[] {
	const requiredRisks = deriveRequiredFinalReviewBehaviorRisks(worker, review);
	const reasons: string[] = [
		...behaviorRefGroundingFailureReasons(worker, review),
		...behaviorValidationLedgerFailureReasons(
			validationCommandsForWorker(worker),
			review,
			requiredRisks,
		),
	];
	return reasons;
}
