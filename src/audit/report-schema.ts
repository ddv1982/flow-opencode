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
	"risk",
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
		evidence: z.array(z.string().min(1)).min(1).optional(),
		reason: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((surface, ctx) => {
		if (
			surface.reviewStatus === "directly_reviewed" &&
			(surface.evidence?.length ?? 0) === 0
		) {
			ctx.addIssue({
				code: "custom",
				path: ["evidence"],
				message:
					"Directly reviewed surfaces require at least one evidence reference.",
			});
		}
	});

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
		evidence: z.array(z.string().min(1)).min(1),
		impact: z.string().min(1),
		remediation: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((finding, ctx) => {
		if (
			finding.category === "confirmed_defect" &&
			finding.confidence !== "confirmed"
		) {
			ctx.addIssue({
				code: "custom",
				path: ["confidence"],
				message:
					"Confirmed defects require confidence: confirmed so release-blocking language is evidence-backed.",
			});
		}
		if (
			finding.category === "hardening_opportunity" &&
			finding.severity === "high"
		) {
			ctx.addIssue({
				code: "custom",
				path: ["severity"],
				message:
					"Hardening opportunities cannot use high severity; use risk or confirmed_defect when evidence supports blocker-level impact.",
			});
		}
		if (finding.severity === "high" && finding.confidence === "speculative") {
			ctx.addIssue({
				code: "custom",
				path: ["confidence"],
				message:
					"High-severity findings cannot be speculative; lower severity or provide stronger evidence.",
			});
		}
	});

export const ReviewReportSchema = z
	.object({
		requestedDepth: ReviewDepthSchema,
		achievedDepth: ReviewDepthSchema,
		repoSummary: z.string().min(1),
		overallVerdict: z.string().min(1),
		discoveredSurfaces: z.array(ReviewDiscoveredSurfaceSchema),
		coverageNotes: z.array(z.string().min(1)).optional(),
		validationRun: z.array(ReviewValidationRunSchema),
		findings: z.array(ReviewFindingSchema),
		nextSteps: z.array(z.string().min(1)).optional(),
	})
	.strict();

export type ReviewReport = z.infer<typeof ReviewReportSchema>;
