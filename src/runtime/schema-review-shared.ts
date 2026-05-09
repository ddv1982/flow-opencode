import { z } from "zod";
import {
	FINAL_REVIEW_POLICIES,
	FINAL_REVIEW_SURFACES,
	REVIEW_FINDING_CLOSURE_STATUSES,
	REVIEW_SCOPE_ACCOUNTING_STATUSES,
	REVIEW_SCOPE_TARGET_KINDS,
	REVIEW_STATUSES,
} from "./constants";
import {
	isSafeReviewArtifactPath,
	isSafeReviewArtifactRef,
	normalizeArtifactPath,
	normalizeReviewArtifactRef,
} from "./domain/final-review-coverage-paths";
import { REVIEW_DISCOVERY_REASONS } from "./domain/review-content-discovery";

export const FollowUpSchema = z.object({
	summary: z.string().min(1),
	severity: z.string().min(1).optional(),
});

export const ReviewFindingClosureSchema = z
	.object({
		findingRef: z.string().min(1),
		status: z.enum(REVIEW_FINDING_CLOSURE_STATUSES),
		fixRefs: z.array(z.string().min(1)).default([]),
		testRefs: z.array(z.string().min(1)).default([]),
		validationRefs: z.array(z.string().min(1)).default([]),
		residualRisk: z.string().min(1),
	})
	.strict();

export const ReviewScopeTargetSchema = z
	.object({
		id: z.string().min(1),
		kind: z.enum(REVIEW_SCOPE_TARGET_KINDS),
		target: z.string().min(1),
		description: z.string().min(1).optional(),
	})
	.strict();

export const ReviewScopeAccountingStatusSchema = z.enum(
	REVIEW_SCOPE_ACCOUNTING_STATUSES,
);

export const ReviewScopeLedgerEntrySchema = z
	.object({
		scopeId: z.string().min(1),
		status: ReviewScopeAccountingStatusSchema,
		evidenceRefs: z.array(z.string().min(1)).default([]),
		findingRefs: z.array(z.string().min(1)).optional(),
		validationRefs: z.array(z.string().min(1)).optional(),
		residualRisk: z.string().min(1),
		rationale: z.string().min(1).optional(),
	})
	.strict();

export const ReviewFindingSchema = z.object({
	summary: z.string().min(1),
});

export const ReviewDepthSchema = z.enum(FINAL_REVIEW_POLICIES);
export const ReviewSurfaceSchema = z.enum(FINAL_REVIEW_SURFACES);

export const FinalReviewEvidenceRefsInputSchema = z
	.object({
		changedArtifacts: z.array(z.string().min(1)),
		validationCommands: z.array(z.string().min(1)),
	})
	.strict();

export const FinalReviewEvidenceRefsPersistedSchema = z
	.object({
		changedArtifacts: z.array(z.string().min(1)).default([]),
		validationCommands: z.array(z.string().min(1)).default([]),
	})
	.strict()
	.default({ changedArtifacts: [], validationCommands: [] });

export const FinalReviewEvidenceRefsSchema =
	FinalReviewEvidenceRefsPersistedSchema;

export const BehaviorRiskClassSchema = z.enum([
	"async_event_ordering",
	"lifecycle_reentrancy",
	"state_commit_rollback",
	"persistence_recovery",
	"interaction_geometry",
	"accessibility_semantics",
	"test_evidence_authenticity",
]);
const ReviewDiscoveryReasonSchema = z.enum(REVIEW_DISCOVERY_REASONS);

const NonEmptyTrimmedStringSchema = z.string().trim().min(1);
const SafeReviewRefSchema = NonEmptyTrimmedStringSchema.transform(
	normalizeReviewArtifactRef,
).refine(isSafeReviewArtifactRef, {
	message: "must be a safe relative path reference",
});
const SafeReviewPathSchema = NonEmptyTrimmedStringSchema.transform(
	normalizeArtifactPath,
).refine(isSafeReviewArtifactPath, {
	message: "must be a safe relative path",
});

const BehaviorRiskClassCompatSchema = z
	.enum([...BehaviorRiskClassSchema.options, "test_oracle_authenticity"])
	.overwrite((value) =>
		value === "test_oracle_authenticity" ? "test_evidence_authenticity" : value,
	) as typeof BehaviorRiskClassSchema;

const ReviewDiscoveryReasonCompatSchema = z
	.enum([...ReviewDiscoveryReasonSchema.options, "test_oracle"])
	.overwrite((value) =>
		value === "test_oracle" ? "test_evidence" : value,
	) as typeof ReviewDiscoveryReasonSchema;

export const BehaviorCheckResultSchema = z.enum([
	"passed",
	"gap_recorded",
	"not_applicable",
	"needs_fix",
]);

const behaviorCheckShape = {
	riskClass: BehaviorRiskClassCompatSchema,
	result: BehaviorCheckResultSchema,
	invariant: z.string().min(1),
	entrypointRefs: z.array(z.string().min(1)).default([]),
	stateOwnerRefs: z.array(z.string().min(1)).default([]),
	lifecycleOwnerRefs: z.array(z.string().min(1)).default([]),
	failurePath: z.string().min(1),
	testEvidenceRefs: z.array(z.string().min(1)).optional(),
	oracleRefs: z.array(z.string().min(1)).optional(),
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

function arraysMatch(
	left: readonly string[],
	right: readonly string[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
}

function addPriorRefsConflictIssue(
	value: {
		testEvidenceRefs?: string[] | undefined;
		oracleRefs?: string[] | undefined;
	},
	context: z.RefinementCtx,
): void {
	if (
		value.testEvidenceRefs !== undefined &&
		value.oracleRefs !== undefined &&
		!arraysMatch(value.testEvidenceRefs, value.oracleRefs)
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["oracleRefs"],
			message:
				"prior oracleRefs input must match testEvidenceRefs when both are provided.",
		});
	}
}

function addBehaviorCheckIssues(
	value: {
		result: string;
		remainingGap?: string | undefined;
		testEvidenceRefs?: string[] | undefined;
		oracleRefs?: string[] | undefined;
	},
	context: z.RefinementCtx,
): void {
	addGapRecordedRemainingGapIssue(value, context);
	addPriorRefsConflictIssue(value, context);
}

function canonicalizeTestEvidenceRefs<
	T extends {
		testEvidenceRefs?: string[] | undefined;
		oracleRefs?: string[] | undefined;
	},
>(
	value: T,
): Omit<T, "oracleRefs" | "testEvidenceRefs"> & { testEvidenceRefs: string[] } {
	const { oracleRefs, testEvidenceRefs, ...rest } = value;
	return {
		...rest,
		testEvidenceRefs: testEvidenceRefs ?? oracleRefs ?? [],
	};
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
	oracleRefs: z.array(SafeReviewRefSchema).optional(),
} as const;

export const RuntimeBehaviorCheckSchema = z
	.object(runtimeBehaviorCheckShape)
	.strict()
	.superRefine(addBehaviorCheckIssues)
	.overwrite(
		canonicalizeTestEvidenceRefs,
	) as unknown as z.ZodType<CanonicalBehaviorCheck>;

const validationCoverageShape = {
	command: z.string().min(1),
	behaviorClasses: z.array(BehaviorRiskClassCompatSchema).default([]),
	proves: z.array(z.string().min(1)).default([]),
	gaps: z.array(z.string().min(1)).default([]),
	testEvidenceRefs: z.array(z.string().min(1)).optional(),
	oracleRefs: z.array(z.string().min(1)).optional(),
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
	.superRefine(addPriorRefsConflictIssue)
	.overwrite(
		canonicalizeTestEvidenceRefs,
	) as unknown as z.ZodType<CanonicalValidationCoverage>;

export const RuntimeValidationCoverageSchema = z
	.object({
		...validationCoverageShape,
		testEvidenceRefs: z.array(SafeReviewRefSchema).optional(),
		oracleRefs: z.array(SafeReviewRefSchema).optional(),
	})
	.strict()
	.superRefine(addPriorRefsConflictIssue)
	.overwrite(
		canonicalizeTestEvidenceRefs,
	) as unknown as z.ZodType<CanonicalValidationCoverage>;

export const ReviewContextPackSchema = z
	.object({
		task: NonEmptyTrimmedStringSchema,
		compareBase: NonEmptyTrimmedStringSchema.optional(),
		changedFiles: z.array(SafeReviewPathSchema).default([]),
		includedContext: z
			.array(
				z
					.object({
						path: SafeReviewPathSchema,
						reason: ReviewDiscoveryReasonCompatSchema,
						surface: ReviewSurfaceSchema.optional(),
						summary: NonEmptyTrimmedStringSchema.optional(),
					})
					.strict(),
			)
			.default([]),
		relationships: z
			.array(
				z
					.object({
						from: SafeReviewPathSchema,
						to: SafeReviewPathSchema,
						kind: NonEmptyTrimmedStringSchema,
						summary: NonEmptyTrimmedStringSchema,
					})
					.strict(),
			)
			.default([]),
		validationEvidence: z
			.array(
				z
					.object({
						command: NonEmptyTrimmedStringSchema,
						status: NonEmptyTrimmedStringSchema.optional(),
						summary: NonEmptyTrimmedStringSchema.optional(),
					})
					.strict(),
			)
			.default([]),
		suggestedValidation: z.array(NonEmptyTrimmedStringSchema).default([]),
		coverageGaps: z.array(NonEmptyTrimmedStringSchema).default([]),
		reviewedSurfaces: z.array(ReviewSurfaceSchema).default([]),
	})
	.strict();

export const ReviewSchema = z.object({
	status: z.enum(REVIEW_STATUSES),
	summary: z.string().min(1),
	blockingFindings: z.array(ReviewFindingSchema).default([]),
});

const finalReviewCommonShape = {
	reviewDepth: ReviewDepthSchema,
	reviewedSurfaces: z.array(ReviewSurfaceSchema).default([]),
	evidenceSummary: z.string().min(1).optional(),
	validationAssessment: z.string().min(1).optional(),
	integrationChecks: z.array(z.string().min(1)).default([]),
	regressionChecks: z.array(z.string().min(1)).default([]),
	remainingGaps: z.array(z.string().min(1)).default([]),
	suggestedValidation: z.array(z.string().min(1)).optional(),
	reviewContextPack: ReviewContextPackSchema.optional(),
} as const;

export const finalReviewInputSharedShape = {
	...finalReviewCommonShape,
	evidenceRefs: FinalReviewEvidenceRefsInputSchema,
	behaviorChecks: z.array(RuntimeBehaviorCheckSchema).optional(),
	validationCoverage: z.array(RuntimeValidationCoverageSchema).optional(),
} as const;

export const finalReviewPersistedSharedShape = {
	...finalReviewCommonShape,
	evidenceRefs: FinalReviewEvidenceRefsPersistedSchema,
	behaviorChecks: z.array(BehaviorCheckSchema).optional(),
	validationCoverage: z.array(ValidationCoverageSchema).optional(),
} as const;

export const finalReviewSharedShape = finalReviewPersistedSharedShape;
