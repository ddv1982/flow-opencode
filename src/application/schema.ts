import { z } from "zod";
import { ARTIFACT_PATH_MESSAGE, isArtifactPath } from "../domain/artifact.js";
import {
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
} from "../domain/feature-id.js";
import {
	MAX_ARTIFACTS,
	MAX_PATH_BYTES,
	MAX_PLAN_BYTES,
	MAX_PLAN_FEATURES,
	MAX_REVIEW_FINDINGS,
	MAX_SESSION_BYTES,
	MAX_SESSION_ID_LENGTH,
	MAX_TEXT_BYTES,
	MAX_VALIDATIONS_PER_RUN,
} from "../domain/limits.js";
import type { Session, SourceDigest } from "../domain/session.js";
import { sessionInvariantIssues } from "../domain/transitions.js";

const encoder = new TextEncoder();

function boundedText(
	label: string,
	options?: { allowEmpty?: boolean; maxBytes?: number },
) {
	const maxBytes = options?.maxBytes ?? MAX_TEXT_BYTES;
	return z
		.string()
		.trim()
		.refine(
			(value) => options?.allowEmpty || value.length > 0,
			`${label} cannot be empty.`,
		)
		.refine(
			(value) => encoder.encode(value).byteLength <= maxBytes,
			`${label} cannot exceed ${maxBytes} UTF-8 bytes.`,
		);
}

export const FeatureIdSchema = z
	.string()
	.max(MAX_SESSION_ID_LENGTH)
	.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE);
export const OperationIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
export const RevisionSchema = z.number().int().safe().nonnegative();
export const SourceDigestSchema = z.custom<SourceDigest>(
	(value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value),
	"Expected a sha256: content digest.",
);

export const PlanFeatureSchema = z
	.object({
		id: FeatureIdSchema,
		title: boundedText("Feature title"),
		summary: boundedText("Feature summary"),
		targets: z
			.array(boundedText("Feature target"))
			.max(MAX_PLAN_FEATURES)
			.default([]),
		validation: z
			.array(boundedText("Feature validation"))
			.max(MAX_PLAN_FEATURES)
			.default([]),
		dependsOn: z.array(FeatureIdSchema).max(MAX_PLAN_FEATURES).default([]),
	})
	.strict();

export const PlanSchema = z
	.object({
		summary: boundedText("Plan summary"),
		overview: boundedText("Plan overview"),
		requirements: z
			.array(boundedText("Plan requirement"))
			.max(MAX_PLAN_FEATURES)
			.default([]),
		decisions: z
			.array(boundedText("Plan decision"))
			.max(MAX_PLAN_FEATURES)
			.default([]),
		features: z.array(PlanFeatureSchema).min(1).max(MAX_PLAN_FEATURES),
	})
	.strict()
	.superRefine((plan, context) => {
		if (encoder.encode(JSON.stringify(plan)).byteLength > MAX_PLAN_BYTES) {
			context.addIssue({
				code: "custom",
				message: `Plan cannot exceed ${MAX_PLAN_BYTES} UTF-8 bytes.`,
			});
		}
	});

export const ReviewFindingSchema = z
	.object({
		severity: z.enum(["blocking", "advisory"]),
		summary: boundedText("Review finding summary"),
		evidence: boundedText("Review finding evidence").optional(),
	})
	.strict();

export const PublicReviewResultSchema = z
	.object({
		verdict: z.enum(["passed", "failed"]),
		findings: z.array(ReviewFindingSchema).max(MAX_REVIEW_FINDINGS).default([]),
		terminalDisposition: z.enum(["submitted", "observed_unsubmitted"]),
	})
	.strict()
	.superRefine((result, context) => {
		const blocking = result.findings.some(
			(finding) => finding.severity === "blocking",
		);
		for (const [index, finding] of result.findings.entries()) {
			if (finding.severity === "blocking" && !finding.evidence) {
				context.addIssue({
					code: "custom",
					path: ["findings", index, "evidence"],
					message: "A blocking finding requires concrete evidence.",
				});
			}
		}
		if (result.verdict === "failed" && !blocking) {
			context.addIssue({
				code: "custom",
				path: ["findings"],
				message: "A failed review requires a blocking finding.",
			});
		}
		if (result.verdict === "passed" && blocking) {
			context.addIssue({
				code: "custom",
				path: ["findings"],
				message: "A passed review cannot contain blocking findings.",
			});
		}
		if (
			result.terminalDisposition === "observed_unsubmitted" &&
			result.verdict !== "failed"
		) {
			context.addIssue({
				code: "custom",
				path: ["terminalDisposition"],
				message: "Observed-but-unsubmitted review work must fail closed.",
			});
		}
	});

const ValidationObservationSchema = z
	.object({
		id: z.string().min(1).max(256),
		featureId: FeatureIdSchema,
		runId: z.string().min(1).max(256),
		scope: z.enum(["focused", "broad"]),
		command: boundedText("Validation command"),
		sourceDigest: SourceDigestSchema,
		exitCode: z.number().int().safe(),
		outputDigest: SourceDigestSchema,
		outputComplete: z.boolean(),
		recordedRevision: RevisionSchema,
	})
	.strict();

const PersistedReviewResultSchema = PublicReviewResultSchema.and(
	z.object({ recordedRevision: RevisionSchema }).strict(),
);

const ArtifactSchema = z
	.object({
		path: boundedText("Artifact path", { maxBytes: MAX_PATH_BYTES }).refine(
			isArtifactPath,
			ARTIFACT_PATH_MESSAGE,
		),
	})
	.strict();

const ReviewAssignmentSchema = z
	.object({
		id: z.string().min(1).max(256),
		operationId: OperationIdSchema,
		featureId: FeatureIdSchema,
		runId: z.string().min(1).max(256),
		kind: z.enum(["feature", "final"]),
		sourceDigest: SourceDigestSchema,
		validationIds: z
			.array(z.string().min(1).max(256))
			.min(1)
			.max(MAX_VALIDATIONS_PER_RUN),
		packet: z
			.object({
				summary: boundedText("Review packet summary"),
				riskLenses: z
					.array(boundedText("Review risk lens"))
					.max(16)
					.default([]),
			})
			.strict(),
		createdRevision: RevisionSchema,
		result: PersistedReviewResultSchema.nullable(),
	})
	.strict();

const FeatureRunSchema = z
	.object({
		id: z.string().min(1).max(256),
		featureId: FeatureIdSchema,
		attempt: z.number().int().safe().positive(),
		state: z.enum(["active", "completed", "blocked", "superseded"]),
		startedRevision: RevisionSchema,
		summary: boundedText("Feature result summary").nullable(),
		artifactsChanged: z.array(ArtifactSchema).max(MAX_ARTIFACTS),
		validations: z
			.array(ValidationObservationSchema)
			.max(MAX_VALIDATIONS_PER_RUN),
		reviews: z.array(ReviewAssignmentSchema).max(64),
	})
	.strict();

const OperationRecordSchema = z
	.object({
		id: OperationIdSchema,
		kind: z.enum([
			"plan-save",
			"plan-approve",
			"run-start",
			"review-start",
			"feature-complete",
			"feature-reset",
			"session-close",
		]),
		inputDigest: SourceDigestSchema,
		committedRevision: RevisionSchema,
		entityId: z.string().min(1).max(1024).optional(),
	})
	.strict();

const ClosureSchema = z
	.object({
		kind: z.enum(["completed", "deferred", "abandoned"]),
		summary: boundedText("Closure summary", { allowEmpty: true }),
		operationId: OperationIdSchema,
		recordedRevision: RevisionSchema,
	})
	.strict();

export const SessionSchema: z.ZodType<Session> = z
	.object({
		version: z.literal(5),
		id: z.string().min(1).max(MAX_SESSION_ID_LENGTH),
		revision: RevisionSchema,
		goal: boundedText("Goal"),
		approval: z.enum(["pending", "approved"]),
		plan: PlanSchema.nullable(),
		runs: z.array(FeatureRunSchema).max(512),
		operations: z.array(OperationRecordSchema).max(4096),
		closure: ClosureSchema.nullable(),
	})
	.strict()
	.superRefine((session, context) => {
		const bytes = encoder.encode(JSON.stringify(session)).byteLength;
		if (bytes > MAX_SESSION_BYTES) {
			context.addIssue({
				code: "custom",
				message: `Session cannot exceed ${MAX_SESSION_BYTES} UTF-8 bytes.`,
			});
		}
		for (const issue of sessionInvariantIssues(session)) {
			context.addIssue({ code: "custom", message: issue });
		}
	});

const guarded = {
	operationId: OperationIdSchema,
	expectedRevision: RevisionSchema,
} as const;

export const PlanSaveInputSchema = z
	.object({
		request: z
			.object({
				...guarded,
				goal: boundedText("Goal"),
				plan: PlanSchema,
			})
			.strict(),
	})
	.strict();

export const PlanApproveInputSchema = z
	.object({ request: z.object(guarded).strict() })
	.strict();

export const RunStartInputSchema = z
	.object({
		request: z
			.object({ ...guarded, featureId: FeatureIdSchema.optional() })
			.strict(),
	})
	.strict();

export const ReviewStartInputSchema = z
	.object({
		request: z
			.object({
				...guarded,
				featureId: FeatureIdSchema,
				artifactsChanged: z.array(ArtifactSchema).max(MAX_ARTIFACTS),
				packet: z
					.object({
						summary: boundedText("Review packet summary"),
						riskLenses: z
							.array(boundedText("Review risk lens"))
							.max(16)
							.default([]),
					})
					.strict(),
			})
			.strict(),
	})
	.strict();

export const FeatureCompleteInputSchema = z
	.object({
		request: z
			.object({
				...guarded,
				featureId: FeatureIdSchema,
				assignmentId: z.string().min(1).max(256),
				summary: boundedText("Feature result summary"),
				result: PublicReviewResultSchema,
			})
			.strict(),
	})
	.strict();

export const FeatureResetInputSchema = z
	.object({
		request: z.object({ ...guarded, featureId: FeatureIdSchema }).strict(),
	})
	.strict();

export const SessionCloseInputSchema = z
	.object({
		request: z
			.object({
				...guarded,
				sessionId: z.string().min(1).max(MAX_SESSION_ID_LENGTH),
				kind: z.enum(["completed", "deferred", "abandoned"]),
				summary: boundedText("Closure summary", { allowEmpty: true }).default(
					"",
				),
			})
			.strict(),
	})
	.strict();

export const ValidationStartInputSchema = z
	.object({
		request: z
			.object({
				expectedRevision: RevisionSchema,
				featureId: FeatureIdSchema,
				command: boundedText("Validation command"),
				scope: z.enum(["focused", "broad"]),
			})
			.strict(),
	})
	.strict();

export const StatusInputSchema = z
	.object({
		request: z.discriminatedUnion("view", [
			z.object({ view: z.literal("compact") }).strict(),
			z.object({ view: z.literal("detail") }).strict(),
			z.object({ view: z.literal("execution") }).strict(),
			z
				.object({
					view: z.literal("reviewer"),
					assignmentId: z.string().min(1).max(256),
				})
				.strict(),
		]),
	})
	.strict();

export type PlanSaveRequest = z.infer<typeof PlanSaveInputSchema>["request"];
export type PlanApproveRequest = z.infer<
	typeof PlanApproveInputSchema
>["request"];
export type RunStartRequest = z.infer<typeof RunStartInputSchema>["request"];
export type ReviewStartRequest = z.infer<
	typeof ReviewStartInputSchema
>["request"];
export type FeatureCompleteRequest = z.infer<
	typeof FeatureCompleteInputSchema
>["request"];
export type FeatureResetRequest = z.infer<
	typeof FeatureResetInputSchema
>["request"];
export type SessionCloseRequest = z.infer<
	typeof SessionCloseInputSchema
>["request"];
export type ValidationStartRequest = z.infer<
	typeof ValidationStartInputSchema
>["request"];
export type StatusRequest = z.infer<typeof StatusInputSchema>["request"];
