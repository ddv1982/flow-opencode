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
	MAX_VALIDATION_ID_LENGTH,
	MAX_VALIDATIONS_PER_RUN,
} from "../domain/limits.js";
import {
	FINDING_ID_MESSAGE,
	FINDING_ID_PATTERN,
} from "../domain/review-findings.js";
import type { Session, SourceDigest } from "../domain/session.js";
import { reviewResultSemanticIssues } from "../domain/session.js";
import { sessionInvariantIssues } from "../domain/session-invariants.js";
import {
	EVIDENCE_PLATFORMS,
	VALIDATION_INELIGIBLE_REASONS,
} from "../domain/validation.js";

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

const FeatureIdSchema = z
	.string()
	.max(MAX_SESSION_ID_LENGTH)
	.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE);
const OperationIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const ReviewAssignmentIdSchema = z.string().min(1).max(256);
const RunIdSchema = z.string().min(1).max(256);
const RevisionSchema = z.number().int().safe().nonnegative();
const SourceDigestSchema = z.custom<SourceDigest>(
	(value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value),
	"Expected a sha256: content digest.",
);

const PlanFeatureSchema = z
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

const ExternalEvidenceSchema = z
	.object({
		requirement: boundedText("External evidence requirement"),
		environment: boundedText("External evidence environment"),
		command: boundedText("External evidence command"),
		/**
		 * Optional for the same reason the field around it is: an entry written before
		 * `platform` existed still hydrates and keeps the command-only rule, while
		 * `savePlan` refuses a new entry without it.
		 */
		platform: z.enum(EVIDENCE_PLATFORMS).optional(),
	})
	.strict();

const PlanSchema = z
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
		/**
		 * Optional in the persisted schema so a plan written before the field existed
		 * still hydrates; `savePlan` refuses a new plan without it.
		 */
		gate: boundedText("Plan gate").optional(),
		/**
		 * Optional for the same reason `gate` is: a plan written before the field
		 * existed still hydrates, and `savePlan` refuses a new plan without it. An
		 * empty array is the declared answer that nothing here needs another
		 * environment, which is different from never having been asked.
		 */
		externalEvidence: z
			.array(ExternalEvidenceSchema)
			.max(MAX_PLAN_FEATURES)
			.optional(),
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

const ReviewFindingSchema = z
	.object({
		severity: z.enum(["blocking", "advisory"]),
		summary: boundedText("Review finding summary"),
		evidence: boundedText("Review finding evidence").optional(),
		/** True when the repair needs work outside the approved plan. */
		scopeBlocker: z.boolean().optional(),
		/** Prior id for a recurrence; omitted for a new issue the runtime numbers. */
		findingId: z
			.string()
			.max(MAX_SESSION_ID_LENGTH)
			.regex(FINDING_ID_PATTERN, FINDING_ID_MESSAGE)
			.optional(),
	})
	.strict();

const PublicReviewResultSchema = z
	.object({
		verdict: z.enum(["passed", "failed"]),
		findings: z.array(ReviewFindingSchema).max(MAX_REVIEW_FINDINGS).default([]),
		terminalDisposition: z.enum(["submitted", "observed_unsubmitted"]),
	})
	.strict()
	.superRefine((result, context) => {
		for (const issue of reviewResultSemanticIssues(result)) {
			context.addIssue({ code: "custom", ...issue });
		}
	});

const ReviewPacketSchema = z
	.object({
		summary: boundedText("Review packet summary"),
		riskLenses: z.array(boundedText("Review risk lens")).max(16).default([]),
	})
	.strict();

const ValidationObservationSchema = z
	.object({
		id: z.string().min(1).max(MAX_VALIDATION_ID_LENGTH),
		featureId: FeatureIdSchema,
		runId: RunIdSchema,
		scope: z.enum(["focused", "broad"]),
		command: boundedText("Validation command"),
		sourceDigest: SourceDigestSchema,
		exitCode: z.number().int().safe().nullable(),
		outputDigest: SourceDigestSchema,
		outputComplete: z.boolean(),
		recordedRevision: RevisionSchema,
		/** The host this command ran on; absent in documents written before it existed. */
		hostPlatform: z.enum(EVIDENCE_PLATFORMS).optional(),
		ineligibleReason: z.enum(VALIDATION_INELIGIBLE_REASONS).optional(),
	})
	.strict()
	.refine(
		(observation) =>
			observation.exitCode !== null ||
			observation.ineligibleReason !== undefined,
		{
			error:
				"An observation without an exit code must record an ineligible reason.",
			path: ["ineligibleReason"],
		},
	);

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
		id: ReviewAssignmentIdSchema,
		operationId: OperationIdSchema,
		featureId: FeatureIdSchema,
		runId: RunIdSchema,
		kind: z.enum(["feature", "final"]),
		sourceDigest: SourceDigestSchema,
		validationIds: z
			.array(z.string().min(1).max(MAX_VALIDATION_ID_LENGTH))
			.min(1)
			.max(MAX_VALIDATIONS_PER_RUN),
		packet: ReviewPacketSchema,
		createdRevision: RevisionSchema,
		result: PersistedReviewResultSchema.nullable(),
	})
	.strict();

const FeatureRunSchema = z
	.object({
		id: RunIdSchema,
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
				packet: ReviewPacketSchema,
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
				assignmentId: ReviewAssignmentIdSchema,
				summary: boundedText("Feature result summary"),
				result: PublicReviewResultSchema,
			})
			.strict(),
	})
	.strict();

export const FeatureResetInputSchema = z
	.object({
		request: z
			.object({
				...guarded,
				featureId: FeatureIdSchema,
				nextFeatureId: FeatureIdSchema.optional(),
			})
			.strict(),
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
					assignmentId: ReviewAssignmentIdSchema,
				})
				.strict(),
		]),
	})
	.strict();

export type FeatureCompleteRequest = z.infer<
	typeof FeatureCompleteInputSchema
>["request"];
export type SessionCloseRequest = z.infer<
	typeof SessionCloseInputSchema
>["request"];
export type ValidationStartRequest = z.infer<
	typeof ValidationStartInputSchema
>["request"];
export type StatusRequest = z.infer<typeof StatusInputSchema>["request"];
