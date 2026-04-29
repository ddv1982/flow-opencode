import { z } from "zod";
import {
	AUDIT_DEPTHS,
	AUDIT_FINDING_CATEGORIES,
	AUDIT_FINDING_CONFIDENCE,
	AUDIT_SURFACE_CATEGORIES,
	AUDIT_SURFACE_REVIEW_STATUSES,
	AUDIT_VALIDATION_STATUSES,
} from "./constants";

export const AuditValidationStatusSchema = z.enum(AUDIT_VALIDATION_STATUSES);
export const AuditDepthSchema = z.enum(AUDIT_DEPTHS);
export const AuditSurfaceCategorySchema = z.enum(AUDIT_SURFACE_CATEGORIES);
export const AuditSurfaceReviewStatusSchema = z.enum(
	AUDIT_SURFACE_REVIEW_STATUSES,
);
export const AuditFindingCategorySchema = z.enum(AUDIT_FINDING_CATEGORIES);
export const AuditFindingConfidenceSchema = z.enum(AUDIT_FINDING_CONFIDENCE);

export const AuditValidationRunSchema = z.object({
	command: z.string().min(1),
	status: AuditValidationStatusSchema,
	summary: z.string().min(1),
});

export const AuditSurfaceSchema = z
	.object({
		name: z.string().min(1),
		category: AuditSurfaceCategorySchema,
		reviewStatus: AuditSurfaceReviewStatusSchema,
		evidence: z.array(z.string().min(1)).default([]),
		reason: z.string().min(1).optional(),
	})
	.superRefine((value, context) => {
		if (value.reviewStatus === "unreviewed") {
			if (!value.reason) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"Unreviewed audit surfaces must include a reason explaining the coverage gap.",
					path: ["reason"],
				});
			}
			if (value.evidence.length > 0) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"Unreviewed audit surfaces must not claim direct evidence lines.",
					path: ["evidence"],
				});
			}
			return;
		}

		if (value.evidence.length === 0) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Reviewed or spot-checked audit surfaces must include supporting evidence.",
				path: ["evidence"],
			});
		}
	});

export const ReviewedAuditSurfaceSchema = z.object({
	name: z.string().min(1),
	evidence: z.array(z.string().min(1)).min(1),
});

export const UnreviewedAuditSurfaceSchema = z.object({
	name: z.string().min(1),
	reason: z.string().min(1),
});

export const AuditCoverageSummarySchema = z.object({
	discoveredSurfaceCount: z.number().int().nonnegative(),
	reviewedSurfaceCount: z.number().int().nonnegative(),
	unreviewedSurfaceCount: z.number().int().nonnegative(),
	notes: z.array(z.string().min(1)).optional(),
});

export const AuditCoverageRubricSchema = z.object({
	fullAuditEligible: z.boolean(),
	directlyReviewedCategories: z.array(AuditSurfaceCategorySchema).default([]),
	spotCheckedCategories: z.array(AuditSurfaceCategorySchema).default([]),
	unreviewedCategories: z.array(AuditSurfaceCategorySchema).default([]),
	blockingReasons: z.array(z.string().min(1)).default([]),
});

export const AuditFindingSchema = z.object({
	title: z.string().min(1),
	category: AuditFindingCategorySchema,
	confidence: AuditFindingConfidenceSchema,
	severity: z.enum(["high", "medium", "low"]).optional(),
	evidence: z.array(z.string().min(1)).min(1),
	impact: z.string().min(1),
	remediation: z.string().min(1).optional(),
});

export const AuditReportBaseSchema = z.object({
	requestedDepth: AuditDepthSchema,
	achievedDepth: AuditDepthSchema,
	repoSummary: z.string().min(1),
	overallVerdict: z.string().min(1),
	discoveredSurfaces: z.array(AuditSurfaceSchema).min(1),
	validationRun: z.array(AuditValidationRunSchema).min(1),
	findings: z.array(AuditFindingSchema).default([]),
	nextSteps: z.array(z.string().min(1)).optional(),
});

export const AuditReportSchema = AuditReportBaseSchema.extend({
	coverageSummary: AuditCoverageSummarySchema,
	reviewedSurfaces: z.array(ReviewedAuditSurfaceSchema),
	unreviewedSurfaces: z.array(UnreviewedAuditSurfaceSchema),
	coverageRubric: AuditCoverageRubricSchema,
}).superRefine((value, context) => {
	const reviewed = value.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus !== "unreviewed",
	);
	const unreviewed = value.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "unreviewed",
	);
	const directlyReviewed = value.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "directly_reviewed",
	);
	const spotChecked = value.discoveredSurfaces.filter(
		(surface) => surface.reviewStatus === "spot_checked",
	);

	if (
		value.coverageSummary.discoveredSurfaceCount !==
		value.discoveredSurfaces.length
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageSummary.discoveredSurfaceCount must match discoveredSurfaces length.",
			path: ["coverageSummary", "discoveredSurfaceCount"],
		});
	}
	if (value.coverageSummary.reviewedSurfaceCount !== reviewed.length) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageSummary.reviewedSurfaceCount must match the number of non-unreviewed discovered surfaces.",
			path: ["coverageSummary", "reviewedSurfaceCount"],
		});
	}
	if (value.coverageSummary.unreviewedSurfaceCount !== unreviewed.length) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageSummary.unreviewedSurfaceCount must match the number of unreviewed discovered surfaces.",
			path: ["coverageSummary", "unreviewedSurfaceCount"],
		});
	}
	if (value.reviewedSurfaces.length !== reviewed.length) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"reviewedSurfaces must enumerate every reviewed or spot-checked discovered surface.",
			path: ["reviewedSurfaces"],
		});
	}
	if (value.unreviewedSurfaces.length !== unreviewed.length) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"unreviewedSurfaces must enumerate every unreviewed discovered surface.",
			path: ["unreviewedSurfaces"],
		});
	}

	const reviewedNames = new Set(
		value.reviewedSurfaces.map((surface) => surface.name),
	);
	for (const surface of reviewed) {
		if (!reviewedNames.has(surface.name)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Reviewed surface '${surface.name}' is missing from reviewedSurfaces.`,
				path: ["reviewedSurfaces"],
			});
		}
	}
	const unreviewedNames = new Set(
		value.unreviewedSurfaces.map((surface) => surface.name),
	);
	for (const surface of unreviewed) {
		if (!unreviewedNames.has(surface.name)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Unreviewed surface '${surface.name}' is missing from unreviewedSurfaces.`,
				path: ["unreviewedSurfaces"],
			});
		}
	}

	const allDirectlyReviewed =
		directlyReviewed.length === value.discoveredSurfaces.length &&
		spotChecked.length === 0 &&
		unreviewed.length === 0;

	if (value.coverageRubric.fullAuditEligible !== allDirectlyReviewed) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageRubric.fullAuditEligible must match whether every discovered surface is directly reviewed.",
			path: ["coverageRubric", "fullAuditEligible"],
		});
	}

	if (value.achievedDepth === "full_audit" && !allDirectlyReviewed) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"achievedDepth cannot be full_audit unless every discovered surface is directly reviewed.",
			path: ["achievedDepth"],
		});
	}

	if (
		value.coverageRubric.fullAuditEligible &&
		value.coverageRubric.blockingReasons.length > 0
	) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"coverageRubric.blockingReasons must be empty when fullAuditEligible is true.",
			path: ["coverageRubric", "blockingReasons"],
		});
	}
});

export type AuditReport = z.infer<typeof AuditReportSchema>;
export type AuditReportArgs = z.input<typeof AuditReportBaseSchema>;
export type AuditSurface = z.infer<typeof AuditSurfaceSchema>;
