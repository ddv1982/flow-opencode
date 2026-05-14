import type {
	FinalReviewBehaviorCheck,
	FinalReviewBehaviorCoverageTarget,
	FinalReviewBehaviorRiskClass,
	FinalReviewValidationCoverage,
} from "./final-review-behavior-risks";
import { normalizeBehaviorRiskClassName } from "./final-review-canonicalization";

export type BehaviorValidationLedgerTarget = Pick<
	FinalReviewBehaviorCoverageTarget,
	| "evidenceRefs"
	| "remainingGaps"
	| "suggestedValidation"
	| "behaviorChecks"
	| "validationCoverage"
	| "reviewContextPack"
>;

function hasText(value: string | undefined): boolean {
	return Boolean(value?.trim());
}

function validationCommandRefsForReview(
	review: BehaviorValidationLedgerTarget,
): string[] {
	return (review.evidenceRefs?.validationCommands ?? [])
		.map((command) => command.trim())
		.filter((command) => command.length > 0);
}

function normalizedStringSet(
	values: readonly string[] | undefined,
): Set<string> {
	return new Set(
		(values ?? [])
			.map((value) => value.trim())
			.filter((value) => value.length > 0),
	);
}

function validationCoverageForRisk(
	validationCoverage: readonly FinalReviewValidationCoverage[],
	riskClass: FinalReviewBehaviorRiskClass,
	commands: ReadonlySet<string>,
): FinalReviewValidationCoverage[] {
	return validationCoverage.filter(
		(item) =>
			commands.has(item.command.trim()) &&
			item.behaviorClasses.includes(riskClass),
	);
}

function duplicateRiskClasses(riskClasses: readonly string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const riskClass of riskClasses) {
		const normalized = normalizeBehaviorRiskClassName(riskClass);
		if (seen.has(normalized)) {
			duplicates.add(normalized);
			continue;
		}
		seen.add(normalized);
	}
	return [...duplicates];
}

function duplicateBehaviorCheckReasons(
	behaviorChecks: readonly FinalReviewBehaviorCheck[],
): string[] {
	return duplicateRiskClasses(
		behaviorChecks.map((check) => check.riskClass),
	).map(
		(riskClass) =>
			`behaviorChecks must contain at most one entry per riskClass: ${riskClass}`,
	);
}

function duplicateValidationCoverageReasons(
	validationCoverage: readonly FinalReviewValidationCoverage[],
): string[] {
	const reasons: string[] = [];
	for (const [index, item] of validationCoverage.entries()) {
		for (const riskClass of duplicateRiskClasses(item.behaviorClasses)) {
			reasons.push(
				`validationCoverage[${index}].behaviorClasses must contain at most one entry per riskClass: ${riskClass}`,
			);
		}
	}
	return reasons;
}

export function behaviorValidationLedgerFailureReasons(
	recordedValidationCommands: readonly string[],
	review: BehaviorValidationLedgerTarget,
	requiredRisks: readonly FinalReviewBehaviorRiskClass[],
	options: {
		rejectNeedsFix?: boolean;
	} = {},
): string[] {
	const behaviorChecks: readonly FinalReviewBehaviorCheck[] =
		review.behaviorChecks ?? [];
	const validationCoverage = review.validationCoverage ?? [];
	const actualValidationCommandSet = normalizedStringSet(
		recordedValidationCommands,
	);
	const validationCoverageCommandSet = new Set(
		validationCoverage.map((item) => item.command.trim()),
	);
	const reviewRemainingGapSet = normalizedStringSet(review.remainingGaps);
	const validationCommandRefs = validationCommandRefsForReview(review);
	const reasons: string[] = [];

	const rejectNeedsFix = options.rejectNeedsFix ?? true;

	for (const [index, check] of behaviorChecks.entries()) {
		const label = `behaviorChecks[${index}]`;
		if (rejectNeedsFix && check.result === "needs_fix") {
			reasons.push(
				`${label} cannot use result needs_fix in an approved/passing final review`,
			);
		}
		for (const validationRef of check.validationRefs) {
			const command = validationRef.trim();
			if (!actualValidationCommandSet.has(command)) {
				reasons.push(
					`${label}.validationRefs includes '${validationRef}', which was not recorded in validationRun`,
				);
			}
		}
	}

	for (const [index, item] of validationCoverage.entries()) {
		const command = item.command.trim();
		if (!actualValidationCommandSet.has(command)) {
			reasons.push(
				`validationCoverage[${index}].command '${item.command}' was not recorded in validationRun`,
			);
		}
	}

	reasons.push(
		...duplicateBehaviorCheckReasons(behaviorChecks),
		...duplicateValidationCoverageReasons(validationCoverage),
	);

	if (requiredRisks.length === 0) {
		return reasons;
	}

	const missingRisks = requiredRisks.filter(
		(riskClass) =>
			!behaviorChecks.some((check) => check.riskClass === riskClass),
	);
	if (missingRisks.length > 0) {
		reasons.push(
			`must account for required behavior risk classes: ${missingRisks.join(", ")}`,
		);
	}

	for (const riskClass of requiredRisks) {
		for (const [index, check] of behaviorChecks.entries()) {
			if (check.riskClass !== riskClass) {
				continue;
			}
			const label = `behaviorChecks[${index}] (${riskClass})`;
			const behaviorValidationCommandSet = normalizedStringSet([
				...validationCommandRefs,
				...check.validationRefs,
			]);
			for (const validationRef of check.validationRefs) {
				const command = validationRef.trim();
				if (
					command.length > 0 &&
					actualValidationCommandSet.has(command) &&
					!validationCoverageCommandSet.has(command)
				) {
					reasons.push(
						`${label}.validationRefs includes '${validationRef}', which is not mapped in validationCoverage`,
					);
				}
			}
			if (check.result === "passed") {
				if (!hasText(check.invariant)) {
					reasons.push(`${label} must include an invariant`);
				}
				if (!hasText(check.failurePath)) {
					reasons.push(`${label} must include a failurePath`);
				}
				if (
					check.entrypointRefs.length === 0 &&
					check.stateOwnerRefs.length === 0 &&
					check.lifecycleOwnerRefs.length === 0
				) {
					reasons.push(
						`${label} must include entrypointRefs, stateOwnerRefs, or lifecycleOwnerRefs`,
					);
				}
				if (
					check.testEvidenceRefs.length === 0 &&
					check.validationRefs.length === 0
				) {
					reasons.push(
						`${label} must include testEvidenceRefs or validationRefs`,
					);
				}
				const mappedCoverage = validationCoverageForRisk(
					validationCoverage,
					riskClass,
					behaviorValidationCommandSet,
				);
				if (mappedCoverage.length === 0) {
					reasons.push(
						`${label} passed must map ${riskClass} in validationCoverage`,
					);
				} else if (!mappedCoverage.some((item) => item.proves.length > 0)) {
					reasons.push(
						`${label} passed validationCoverage must include proves`,
					);
				}
			}
			if (check.result === "gap_recorded") {
				const remainingGap = check.remainingGap?.trim();
				if (!remainingGap) {
					reasons.push(`${label} gap_recorded must include remainingGap`);
				}
				if (!review.remainingGaps?.length) {
					reasons.push(
						`${label} gap_recorded must also list the gap in remainingGaps`,
					);
				} else if (remainingGap && !reviewRemainingGapSet.has(remainingGap)) {
					reasons.push(
						`${label} gap_recorded remainingGap must match an entry in remainingGaps`,
					);
				}
				if (
					!review.suggestedValidation?.length &&
					!review.reviewContextPack?.suggestedValidation.length
				) {
					reasons.push(
						`${label} gap_recorded must include suggestedValidation`,
					);
				}
				const mappedCoverage = validationCoverageForRisk(
					validationCoverage,
					riskClass,
					behaviorValidationCommandSet,
				);
				if (mappedCoverage.length === 0) {
					reasons.push(
						`${label} gap_recorded must map ${riskClass} in validationCoverage`,
					);
				} else if (!mappedCoverage.some((item) => item.gaps.length > 0)) {
					reasons.push(
						`${label} gap_recorded validationCoverage must include gaps`,
					);
				}
			}
			if (check.result === "not_applicable") {
				reasons.push(
					`${label} required behavior risk cannot use not_applicable; use passed or gap_recorded`,
				);
				if (!hasText(check.invariant)) {
					reasons.push(`${label} not_applicable must include an invariant`);
				}
				if (!hasText(check.failurePath)) {
					reasons.push(
						`${label} not_applicable must explain the failurePath boundary`,
					);
				}
			}
		}
	}

	const unmappedValidationRefs = validationCommandRefs.filter(
		(command) => !validationCoverageCommandSet.has(command),
	);
	if (unmappedValidationRefs.length > 0) {
		reasons.push(
			`must map evidenceRefs.validationCommands in validationCoverage when behavior risks are required: ${unmappedValidationRefs.join(", ")}`,
		);
	}

	return reasons;
}
