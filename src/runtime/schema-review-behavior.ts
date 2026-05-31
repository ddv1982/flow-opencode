import { z } from "zod";
import {
	isSafeReviewArtifactRef,
	normalizeReviewArtifactRef,
} from "./domain/final-review-coverage-paths";
import { REVIEW_DISCOVERY_REASONS } from "./domain/review-content-discovery";

const BehaviorRiskClassSchema = z.enum([
	"async_event_ordering",
	"lifecycle_reentrancy",
	"state_commit_rollback",
	"persistence_recovery",
	"interaction_geometry",
	"accessibility_semantics",
	"test_evidence_authenticity",
]);

export const ReviewDiscoveryReasonSchema = z.enum(REVIEW_DISCOVERY_REASONS);
const NonEmptyTrimmedStringSchema = z.string().trim().min(1);
const SafeReviewRefSchema = NonEmptyTrimmedStringSchema.transform(
	normalizeReviewArtifactRef,
).refine(isSafeReviewArtifactRef, {
	message: "must be a safe relative path reference",
});

const BehaviorCheckResultSchema = z.enum([
	"passed",
	"gap_recorded",
	"not_applicable",
	"needs_fix",
]);

const behaviorCheckShape = {
	riskClass: BehaviorRiskClassSchema,
	result: BehaviorCheckResultSchema,
	invariant: z.string().min(1),
	entrypointRefs: z.array(z.string().min(1)).default([]),
	stateOwnerRefs: z.array(z.string().min(1)).default([]),
	lifecycleOwnerRefs: z.array(z.string().min(1)).default([]),
	failurePath: z.string().min(1),
	testEvidenceRefs: z.array(z.string().min(1)).optional(),
	validationRefs: z.array(z.string().min(1)).default([]),
	remainingGap: z.string().min(1).optional(),
} as const;

function addGapRecordedRemainingGapIssue(
	value: { result: string; remainingGap?: string | undefined },
	context: z.RefinementCtx,
): void {
	if (value.result === "gap_recorded" && !value.remainingGap?.trim()) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["remainingGap"],
			message: "gap_recorded behavior checks must include remainingGap.",
		});
	}
}

function addBehaviorCheckIssues(
	value: {
		result: string;
		remainingGap?: string | undefined;
	},
	context: z.RefinementCtx,
): void {
	addGapRecordedRemainingGapIssue(value, context);
}

function duplicateRiskClasses(riskClasses: readonly string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const riskClass of riskClasses) {
		if (seen.has(riskClass)) {
			duplicates.add(riskClass);
			continue;
		}
		seen.add(riskClass);
	}
	return [...duplicates];
}

function addDuplicateBehaviorCheckIssues(
	value: readonly { riskClass: string }[],
	context: z.RefinementCtx,
): void {
	for (const riskClass of duplicateRiskClasses(
		value.map((check) => check.riskClass),
	)) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: `behaviorChecks must contain at most one entry per riskClass: ${riskClass}`,
		});
	}
}

function addDuplicateValidationCoverageIssues(
	value: readonly { behaviorClasses: readonly string[] }[],
	context: z.RefinementCtx,
): void {
	for (const [index, item] of value.entries()) {
		for (const riskClass of duplicateRiskClasses(item.behaviorClasses)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: [index, "behaviorClasses"],
				message: `validationCoverage[${index}].behaviorClasses must contain at most one entry per riskClass: ${riskClass}`,
			});
		}
	}
}

type CanonicalBehaviorCheck = {
	riskClass: z.infer<typeof BehaviorRiskClassSchema>;
	result: z.infer<typeof BehaviorCheckResultSchema>;
	invariant: string;
	entrypointRefs: string[];
	stateOwnerRefs: string[];
	lifecycleOwnerRefs: string[];
	failurePath: string;
	testEvidenceRefs: string[];
	validationRefs: string[];
	remainingGap?: string | undefined;
};

function canonicalizeTestEvidenceRefs<
	T extends { testEvidenceRefs?: string[] | undefined },
>(value: T): Omit<T, "testEvidenceRefs"> & { testEvidenceRefs: string[] } {
	const { testEvidenceRefs, ...rest } = value;
	return {
		...rest,
		testEvidenceRefs: testEvidenceRefs ?? [],
	};
}

export const BehaviorCheckSchema = z
	.object(behaviorCheckShape)
	.strict()
	.superRefine(addBehaviorCheckIssues)
	.overwrite(
		canonicalizeTestEvidenceRefs,
	) as unknown as z.ZodType<CanonicalBehaviorCheck>;

const runtimeBehaviorCheckShape = {
	...behaviorCheckShape,
	entrypointRefs: z.array(SafeReviewRefSchema).default([]),
	stateOwnerRefs: z.array(SafeReviewRefSchema).default([]),
	lifecycleOwnerRefs: z.array(SafeReviewRefSchema).default([]),
	testEvidenceRefs: z.array(SafeReviewRefSchema).optional(),
} as const;

const RuntimeBehaviorCheckSchema = z
	.object(runtimeBehaviorCheckShape)
	.strict()
	.superRefine(addBehaviorCheckIssues)
	.overwrite(
		canonicalizeTestEvidenceRefs,
	) as unknown as z.ZodType<CanonicalBehaviorCheck>;

const validationCoverageShape = {
	command: z.string().min(1),
	behaviorClasses: z.array(BehaviorRiskClassSchema).default([]),
	proves: z.array(z.string().min(1)).default([]),
	gaps: z.array(z.string().min(1)).default([]),
	testEvidenceRefs: z.array(z.string().min(1)).optional(),
} as const;

type CanonicalValidationCoverage = {
	command: string;
	behaviorClasses: z.infer<typeof BehaviorRiskClassSchema>[];
	proves: string[];
	gaps: string[];
	testEvidenceRefs: string[];
};

export const ValidationCoverageSchema = z
	.object(validationCoverageShape)
	.strict()
	.overwrite(
		canonicalizeTestEvidenceRefs,
	) as unknown as z.ZodType<CanonicalValidationCoverage>;

const RuntimeValidationCoverageSchema = z
	.object({
		...validationCoverageShape,
		testEvidenceRefs: z.array(SafeReviewRefSchema).optional(),
	})
	.strict()
	.overwrite(
		canonicalizeTestEvidenceRefs,
	) as unknown as z.ZodType<CanonicalValidationCoverage>;

export const RuntimeBehaviorCheckArraySchema = z
	.array(RuntimeBehaviorCheckSchema)
	.superRefine(addDuplicateBehaviorCheckIssues);

export const RuntimeValidationCoverageArraySchema = z
	.array(RuntimeValidationCoverageSchema)
	.superRefine(addDuplicateValidationCoverageIssues);
