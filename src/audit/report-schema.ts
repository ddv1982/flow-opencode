import { z } from "zod";
import { behaviorValidationLedgerFailureReasons } from "../runtime/domain/final-review-behavior-risks";
import {
	BehaviorCheckSchema,
	EvidencePacketArraySchema,
	ValidationCoverageSchema,
} from "../runtime/schema";

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
const ContextArtifactKindSchema = z.enum([
	"file_map",
	"selection",
	"validation_log",
	"other",
]);

function isSafeRelativeSourcePath(path: string): boolean {
	if (path.trim() !== path || path.length === 0) {
		return false;
	}
	if (
		path.startsWith("/") ||
		path.startsWith("~") ||
		/^[a-zA-Z]:[\\/]/.test(path) ||
		/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)
	) {
		return false;
	}
	const segments = path.split(/[\\/]+/);
	return segments.every((segment) => segment.length > 0 && segment !== "..");
}

const RelativeSourcePathSchema = z
	.string()
	.min(1)
	.refine(isSafeRelativeSourcePath, {
		message:
			"Source paths must be relative to the reviewed repository root and must not traverse outside it.",
	});

const ReviewTargetSchema = z
	.object({
		repoRoot: z.string().min(1),
		repoName: z.string().min(1),
		gitHead: z.string().min(1).optional(),
		gitBranch: z.string().min(1).optional(),
		generatedAt: z.string().min(1),
		invokedFromCwd: z.string().min(1),
	})
	.strict();

const ReviewContextArtifactSchema = z
	.object({
		kind: ContextArtifactKindSchema,
		repoRoot: z.string().min(1),
		source: z.string().min(1).optional(),
		summary: z.string().min(1).optional(),
	})
	.strict();

const FindingLocationSchema = z
	.object({
		path: RelativeSourcePathSchema,
		startLine: z.number().int().positive().optional(),
		endLine: z.number().int().positive().optional(),
		reason: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((location, ctx) => {
		if (
			location.startLine !== undefined &&
			location.endLine !== undefined &&
			location.endLine < location.startLine
		) {
			ctx.addIssue({
				code: "custom",
				path: ["endLine"],
				message: "Location endLine must be greater than or equal to startLine.",
			});
		}
	});

const ReviewDiscoveredSurfaceSchema = z
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

const ReviewValidationRunSchema = z
	.object({
		command: z.string().min(1),
		status: ValidationStatusSchema,
		summary: z.string().min(1),
	})
	.strict();

const ReviewFindingSchema = z
	.object({
		title: z.string().min(1),
		category: FindingCategorySchema,
		confidence: FindingConfidenceSchema,
		severity: FindingSeveritySchema.optional(),
		primaryLocation: FindingLocationSchema.optional(),
		relatedLocations: z.array(FindingLocationSchema).optional(),
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
		reviewTarget: ReviewTargetSchema.optional(),
		requestedDepth: ReviewDepthSchema,
		achievedDepth: ReviewDepthSchema,
		repoSummary: z.string().min(1),
		overallVerdict: z.string().min(1),
		discoveredSurfaces: z.array(ReviewDiscoveredSurfaceSchema),
		contextArtifacts: z.array(ReviewContextArtifactSchema).optional(),
		evidencePackets: EvidencePacketArraySchema.optional(),
		coverageNotes: z.array(z.string().min(1)).optional(),
		behaviorChecks: z.array(BehaviorCheckSchema).optional(),
		validationCoverage: z.array(ValidationCoverageSchema).optional(),
		validationRun: z.array(ReviewValidationRunSchema),
		findings: z.array(ReviewFindingSchema),
		nextSteps: z.array(z.string().min(1)).optional(),
	})
	.strict()
	.superRefine((report, ctx) => {
		const validationCommands = report.validationRun.map(
			(entry) => entry.command,
		);
		const reasons = behaviorValidationLedgerFailureReasons(
			validationCommands,
			{
				evidenceRefs: { validationCommands },
				behaviorChecks: report.behaviorChecks,
				validationCoverage: report.validationCoverage,
			},
			[],
			{ rejectNeedsFix: false },
		);
		for (const reason of reasons) {
			ctx.addIssue({
				code: "custom",
				message: `Behavior validation coverage: ${reason}`,
			});
		}
		if ((report.contextArtifacts?.length ?? 0) > 0 && !report.reviewTarget) {
			ctx.addIssue({
				code: "custom",
				path: ["reviewTarget"],
				message:
					"reviewTarget is required when contextArtifacts are present so artifact provenance can be validated.",
			});
		}
		if (report.reviewTarget) {
			for (const [index, artifact] of (
				report.contextArtifacts ?? []
			).entries()) {
				if (artifact.repoRoot !== report.reviewTarget.repoRoot) {
					ctx.addIssue({
						code: "custom",
						path: ["contextArtifacts", index, "repoRoot"],
						message:
							"Context artifacts must use the same repoRoot as reviewTarget so file maps and evidence cannot silently refer to another repository.",
					});
				}
			}
		}
	});

export type ReviewReport = z.infer<typeof ReviewReportSchema>;
