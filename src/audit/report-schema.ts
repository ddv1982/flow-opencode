import { z } from "zod";

const ReviewDepthSchema = z.enum(["broad_audit", "deep_audit", "full_audit"]);
const SurfaceCategorySchema = z.enum([
	"source_runtime",
	"tests",
	"ci_release",
	"docs_config",
	"tooling",
	"other",
]);
const SurfaceReviewStatusSchema = z.enum([
	"directly_reviewed",
	"spot_checked",
	"unreviewed",
]);
const ValidationStatusSchema = z.enum([
	"passed",
	"failed",
	"partial",
	"not_run",
]);
const FindingCategorySchema = z.enum([
	"confirmed_defect",
	"likely_risk",
	"hardening_opportunity",
	"process_gap",
]);
const FindingConfidenceSchema = z.enum(["confirmed", "likely", "speculative"]);
const FindingSeveritySchema = z.enum(["high", "medium", "low"]);

export const ReviewDiscoveredSurfaceSchema = z
	.object({
		name: z.string().min(1),
		category: SurfaceCategorySchema,
		reviewStatus: SurfaceReviewStatusSchema,
		evidence: z.array(z.string().min(1)).optional(),
		reason: z.string().min(1).optional(),
	})
	.strict();

export const ReviewCoverageSummarySchema = z
	.object({
		discoveredSurfaceCount: z.number().int().nonnegative(),
		reviewedSurfaceCount: z.number().int().nonnegative(),
		unreviewedSurfaceCount: z.number().int().nonnegative(),
		notes: z.array(z.string().min(1)).optional(),
	})
	.strict();

export const ReviewReviewedSurfaceSchema = z
	.object({
		name: z.string().min(1),
		evidence: z.array(z.string().min(1)),
	})
	.strict();

export const ReviewUnreviewedSurfaceSchema = z
	.object({
		name: z.string().min(1),
		reason: z.string().min(1),
	})
	.strict();

export const ReviewCoverageRubricSchema = z
	.object({
		fullAuditEligible: z.boolean(),
		directlyReviewedCategories: z.array(z.string().min(1)),
		spotCheckedCategories: z.array(z.string().min(1)),
		unreviewedCategories: z.array(z.string().min(1)),
		blockingReasons: z.array(z.string().min(1)),
	})
	.strict();

export const ReviewValidationRunSchema = z
	.object({
		command: z.string().min(1),
		status: ValidationStatusSchema,
		summary: z.string().min(1),
	})
	.strict();

export const ReviewFindingSchema = z
	.object({
		title: z.string().min(1),
		category: FindingCategorySchema,
		confidence: FindingConfidenceSchema,
		severity: FindingSeveritySchema.optional(),
		evidence: z.array(z.string().min(1)),
		impact: z.string().min(1),
		remediation: z.string().min(1).optional(),
	})
	.strict();

export const ReviewReportSchema = z
	.object({
		requestedDepth: ReviewDepthSchema,
		achievedDepth: ReviewDepthSchema,
		repoSummary: z.string().min(1),
		overallVerdict: z.string().min(1),
		discoveredSurfaces: z.array(ReviewDiscoveredSurfaceSchema),
		coverageSummary: ReviewCoverageSummarySchema,
		reviewedSurfaces: z.array(ReviewReviewedSurfaceSchema),
		unreviewedSurfaces: z.array(ReviewUnreviewedSurfaceSchema),
		coverageRubric: ReviewCoverageRubricSchema,
		validationRun: z.array(ReviewValidationRunSchema),
		findings: z.array(ReviewFindingSchema),
		nextSteps: z.array(z.string().min(1)).optional(),
	})
	.strict();

export type ReviewReport = z.infer<typeof ReviewReportSchema>;
