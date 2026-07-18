import { z } from "zod";
import {
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
} from "../domain/feature-id.js";
import { MAX_ORCHESTRATION_PASSES } from "../domain/limits.js";
import { validateOrchestrationPassPolicy } from "../domain/orchestration-policy.js";
import { type Session, toFeatureId, toSessionId } from "../domain/session.js";
import {
	canonicalSessionSnapshotId,
	validateCausalChain,
} from "../domain/transitions.js";

export {
	hasCandidateExecutionEvidence,
	hasVerifierExecutionEvidence,
	isCandidateShapedDecision,
} from "../domain/orchestration-policy.js";

export const FeatureIdSchema = z
	.string()
	.regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE)
	.transform(toFeatureId);

const SessionIdSchema = z
	.string()
	.regex(/^[a-zA-Z0-9_-]+$/, "Invalid session id.")
	.transform(toSessionId);

export const DigestSchema = z
	.string()
	.regex(/^sha256:[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest.")
	.transform((value) => value as `sha256:${string}`);

export const SnapshotIdSchema = DigestSchema;
export const EvidenceIdSchema = DigestSchema;
export const OperationIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
export const CausalRevisionSchema = z.number().int().nonnegative().safe();

export const FeatureStatusSchema = z.enum([
	"pending",
	"in_progress",
	"completed",
	"blocked",
]);

export const SessionStatusSchema = z.enum([
	"planning",
	"ready",
	"running",
	"blocked",
	"completed",
]);

export const ReviewStatusSchema = z.enum(["passed", "failed"]);
export const ReviewFindingTaxonomySchema = z.enum([
	"implementation_defect",
	"regression_coverage_gap",
	"evidence_gap",
	"advisory",
]);
export const ReviewKindSchema = z.enum(["feature", "final"]);
export const ReviewVerdictSchema = z.enum(["passed", "failed"]);
export const ReviewTerminalDispositionSchema = z.enum([
	"submitted",
	"observed_unsubmitted",
]);
export const ValidationStatusSchema = z.enum(["passed", "failed"]);
export const ValidationScopeSchema = z.enum(["targeted", "broad"]);
export const FeatureReviewDepthSchema = z.enum([
	"quick",
	"standard",
	"detailed",
]);
export const FinalReviewPolicySchema = z.enum(["broad", "detailed"]);
export const OrchestrationPassKindSchema = z.enum([
	"discovery",
	"audit",
	"review",
	"validation",
	"verification",
	"candidate",
	"implementation-decision",
]);
export const OrchestrationModeSchema = z.enum([
	"evidence",
	"review",
	"validation",
	"audit",
	"verifier",
	"candidate-implementation",
]);
export const OrchestrationDecisionSchema = z.enum([
	"serial",
	"parallel",
	"candidate-exact-path",
	"candidate-worktree",
	"tournament",
	"skipped",
]);
export const OrchestrationCandidateEligibilitySchema = z.enum([
	"eligible",
	"not_eligible",
	"unknown",
]);
export const OrchestrationCandidateDecisionSchema = z.enum([
	"used",
	"skipped",
	"serial_required",
]);
export const OrchestrationDecisionFactorSchema = z.enum([
	"shared_state",
	"overlapping_files",
	"small_slice",
	"needs_manager_judgment",
	"independent_surface",
	"validation_available",
]);
export const OrchestrationWriteScopeSchema = z.enum([
	"none",
	"manager-serial",
	"exact-path",
	"isolated-worktree",
	"mixed",
]);
export const OrchestrationVerificationStatusSchema = z.enum([
	"not-needed",
	"pending",
	"passed",
	"failed",
	"mixed",
	"downgraded",
]);
export const OrchestrationOutcomeSchema = z.enum([
	"accepted",
	"modified",
	"rejected",
	"partial",
	"not-covered",
	"superseded",
]);

export const OrchestrationPassRecordSchema = z
	.object({
		id: z.string().min(1),
		kind: OrchestrationPassKindSchema,
		decision: OrchestrationDecisionSchema.optional(),
		decisionReason: z.string().min(1).optional(),
		candidateEligibility:
			OrchestrationCandidateEligibilitySchema.default("unknown"),
		candidateDecision: OrchestrationCandidateDecisionSchema.optional(),
		decisionFactors: z.array(OrchestrationDecisionFactorSchema).default([]),
		modes: z.array(OrchestrationModeSchema).default([]),
		workerCount: z.number().int().nonnegative().default(0),
		candidateWorkerCount: z.number().int().nonnegative().default(0),
		verifierWorkerCount: z.number().int().nonnegative().default(0),
		sliceIds: z.array(z.string().min(1)).default([]),
		dependsOn: z.array(z.string().min(1)).default([]),
		writeScope: OrchestrationWriteScopeSchema.default("none"),
		handoffRefs: z.array(z.string().min(1)).default([]),
		verificationStatus:
			OrchestrationVerificationStatusSchema.default("not-needed"),
		outcome: OrchestrationOutcomeSchema.default("accepted"),
		synthesisRef: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		for (const issue of validateOrchestrationPassPolicy(value)) {
			ctx.addIssue({
				code: "custom",
				path: [issue.path],
				message: issue.message,
			});
		}
	});

export const OrchestrationTelemetrySchema = z
	.object({
		passCount: z.number().int().nonnegative().default(0),
		workerCount: z.number().int().nonnegative().default(0),
		candidatePassCount: z.number().int().nonnegative().default(0),
		verifierPassCount: z.number().int().nonnegative().default(0),
		candidateEligibleCount: z.number().int().nonnegative().default(0),
		candidateUsedDecisionCount: z.number().int().nonnegative().default(0),
		candidateSerialRequiredDecisionCount: z
			.number()
			.int()
			.nonnegative()
			.default(0),
		skippedCandidateDecisionCount: z.number().int().nonnegative().default(0),
		latestPasses: z
			.array(OrchestrationPassRecordSchema)
			.max(MAX_ORCHESTRATION_PASSES)
			.default([]),
	})
	.strict();

export const ReviewFindingSchema = z
	.object({
		summary: z.string().min(1),
		severity: z.enum(["blocking", "advisory"]).default("blocking"),
	})
	.strict();

const ReviewExecutionIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(
		/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/,
		"Review execution ids must use a bounded portable identifier.",
	);

export const ReviewSnapshotIdSchema = z.string().pipe(SnapshotIdSchema);

const ReviewTimestampSchema = z.string().datetime({ offset: true });

export const ReviewExecutionFindingInputSchema = z
	.object({
		taxonomy: ReviewFindingTaxonomySchema,
		subject: z.string().trim().min(1).max(512),
		requirementOrRisk: z.string().trim().min(1).max(2_000),
		evidenceLocator: z.string().trim().min(1).max(2_000),
		summary: z.string().trim().min(1).max(4_000),
		severity: z.enum(["blocking", "advisory"]),
	})
	.strict();

export const ReviewExecutionFindingSchema =
	ReviewExecutionFindingInputSchema.extend({
		fingerprint: z.string().regex(/^finding-v1-[a-f0-9]{32}$/),
	}).strict();

const ReviewExecutionBaseShape = {
	attemptId: ReviewExecutionIdSchema,
	logicalPassId: ReviewExecutionIdSchema,
	featureId: FeatureIdSchema,
	reviewKind: ReviewKindSchema,
	reviewSnapshotId: ReviewSnapshotIdSchema,
	verdict: ReviewVerdictSchema,
	startedAt: ReviewTimestampSchema,
	completedAt: ReviewTimestampSchema,
	terminalDisposition: ReviewTerminalDispositionSchema,
} as const;

function validateReviewExecution(
	value: {
		verdict: "passed" | "failed";
		findings: Array<{ severity: "blocking" | "advisory" }>;
		startedAt: string;
		completedAt: string;
		terminalDisposition: "submitted" | "observed_unsubmitted";
	},
	ctx: z.RefinementCtx,
): void {
	if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
		ctx.addIssue({
			code: "custom",
			path: ["completedAt"],
			message: "completedAt must not precede startedAt.",
		});
	}
	const hasBlockingFinding = value.findings.some(
		(finding) => finding.severity === "blocking",
	);
	if (value.verdict === "failed" && !hasBlockingFinding) {
		ctx.addIssue({
			code: "custom",
			path: ["findings"],
			message: "A failed review execution requires a blocking finding.",
		});
	}
	if (value.verdict === "passed" && hasBlockingFinding) {
		ctx.addIssue({
			code: "custom",
			path: ["findings"],
			message: "A passed review execution cannot retain blocking findings.",
		});
	}
	if (
		value.terminalDisposition === "observed_unsubmitted" &&
		value.verdict !== "failed"
	) {
		ctx.addIssue({
			code: "custom",
			path: ["terminalDisposition"],
			message: "An observed_unsubmitted review execution must be failed.",
		});
	}
}

export const ReviewExecutionInputSchema = z
	.object({
		...ReviewExecutionBaseShape,
		findings: z.array(ReviewExecutionFindingInputSchema).max(100),
	})
	.strict()
	.superRefine(validateReviewExecution);

export const ReviewExecutionSchema = z
	.object({
		...ReviewExecutionBaseShape,
		findings: z.array(ReviewExecutionFindingSchema).max(100),
	})
	.strict()
	.superRefine(validateReviewExecution);

export const ReviewSchema = z
	.object({
		status: ReviewStatusSchema,
		summary: z.string().min(1),
		blockingFindings: z.array(ReviewFindingSchema).default([]),
	})
	.strict();

export const FinalReviewSchema = ReviewSchema.extend({
	reviewDepth: FinalReviewPolicySchema,
}).strict();

export const ValidationRunSchema = z
	.object({
		command: z.string().min(1),
		status: ValidationStatusSchema,
		summary: z.string().min(1),
	})
	.strict();

const EvidenceTimestampSchema = z.string().datetime({ offset: true });

// Server-derived identity fields. The public caller never asserts these; the
// trusted boundary computes them and binds each record to the current snapshot
// and the recomputed source digest.
const EvidenceIdentityShape = {
	evidenceId: EvidenceIdSchema,
	snapshotId: SnapshotIdSchema,
	sourceDigest: DigestSchema,
} as const;

const EvidenceTimeShape = {
	startedAt: EvidenceTimestampSchema,
	completedAt: EvidenceTimestampSchema,
} as const;

const ValidationCommandClassSchema = z.enum([
	"test",
	"typecheck",
	"lint",
	"build",
	"format",
	"smoke",
	"other",
]);

// Command timing and output/environment metadata are caller-attested: the
// eight-tool surface has no host command-execution hook, so Flow cannot observe
// validation start/end itself. These fields are labeled honestly as attested,
// and every chronology that can be derived is still enforced.
const ValidationEvidenceDetailShape = {
	commandClass: ValidationCommandClassSchema,
	exitCode: z.number().int().safe(),
	outputDigest: DigestSchema,
	artifactRef: z
		.object({
			kind: z.literal("restricted_evidence_v1"),
			digest: DigestSchema,
			byteLength: z.number().int().nonnegative().safe(),
		})
		.strict()
		.optional(),
	environmentKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).max(64),
} as const;

function validateEvidenceTimes(
	value: { startedAt: string; completedAt: string },
	ctx: z.RefinementCtx,
): void {
	if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
		ctx.addIssue({
			code: "custom",
			path: ["completedAt"],
			message: "completedAt must not precede startedAt.",
		});
	}
}

export const ValidationEvidenceSchema = z
	.object({
		kind: z.literal("validation"),
		...EvidenceIdentityShape,
		...EvidenceTimeShape,
		...ValidationEvidenceDetailShape,
	})
	.strict()
	.superRefine(validateEvidenceTimes);

export const ReviewEvidenceSchema = z
	.object({
		kind: z.literal("review"),
		...EvidenceIdentityShape,
		...EvidenceTimeShape,
		attemptId: ReviewExecutionIdSchema,
		packetDigest: DigestSchema,
	})
	.strict()
	.superRefine(validateEvidenceTimes);

export const EvidenceRecordSchema = z.discriminatedUnion("kind", [
	ValidationEvidenceSchema,
	ReviewEvidenceSchema,
]);

// One public validation observation carries both the declared validation run
// and its attestation. Identity and command classification remain trusted
// server-derived fields.
export const ValidationObservationSchema = z
	.strictObject({
		command: z.string().trim().min(1),
		summary: z.string().trim().min(1),
		...EvidenceTimeShape,
		exitCode: z.number().int().safe(),
		outputDigest: DigestSchema,
		artifactRef: ValidationEvidenceDetailShape.artifactRef,
		environmentKeys: ValidationEvidenceDetailShape.environmentKeys,
	})
	.superRefine(validateEvidenceTimes);

export const CausalMutationRecordSchema = z
	.object({
		operationId: OperationIdSchema,
		operationKind: z.enum([
			"plan_save",
			"plan_approve",
			"run_start",
			"review_record",
			"evidence_record",
			"feature_complete",
			"feature_reset",
			"session_close",
		]),
		requestDigest: DigestSchema,
		priorMutationDigest: DigestSchema.nullable(),
		mutationDigest: DigestSchema,
		priorRevision: CausalRevisionSchema,
		revision: CausalRevisionSchema,
		priorSnapshotId: SnapshotIdSchema,
		currentSnapshotId: SnapshotIdSchema,
		changedEntity: z
			.object({
				kind: z.enum([
					"session",
					"plan",
					"feature",
					"review",
					"evidence",
					"closure",
				]),
				id: z.string().min(1).max(128),
			})
			.strict(),
		changedFields: z.array(z.string().min(1).max(128)).max(64),
		blockerDelta: z
			.object({
				added: z.array(z.string().min(1).max(2_000)).max(32),
				removed: z.array(z.string().min(1).max(2_000)).max(32),
			})
			.strict(),
		evidenceRefs: z.array(EvidenceIdSchema).max(100),
		recordedAt: EvidenceTimestampSchema,
	})
	.strict()
	.superRefine((value, context) => {
		if (value.revision !== value.priorRevision + 1) {
			context.addIssue({
				code: "custom",
				path: ["revision"],
				message: "revision must advance exactly once from priorRevision.",
			});
		}
	});

export const CausalStateSchema = z
	.object({
		revision: CausalRevisionSchema,
		genesisSnapshotId: SnapshotIdSchema,
		snapshotId: SnapshotIdSchema,
		mutations: z.array(CausalMutationRecordSchema),
		evidence: z.array(EvidenceRecordSchema),
	})
	.strict();

export const ArtifactSchema = z
	.object({
		path: z.string().min(1),
	})
	.strict();

export const FeatureSchema = z
	.object({
		id: FeatureIdSchema,
		title: z.string().min(1),
		summary: z.string().min(1),
		status: FeatureStatusSchema.default("pending"),
		reviewDepth: FeatureReviewDepthSchema.default("standard"),
		targets: z.array(z.string().min(1)).default([]),
		validation: z.array(z.string().min(1)).default([]),
		dependsOn: z.array(FeatureIdSchema).default([]),
	})
	.strict();

export const PlanSchema = z
	.object({
		summary: z.string().min(1),
		overview: z.string().min(1),
		requirements: z.array(z.string().min(1)).default([]),
		decisions: z.array(z.string().min(1)).default([]),
		finalReviewPolicy: FinalReviewPolicySchema.default("detailed"),
		features: z.array(FeatureSchema).min(1),
	})
	.strict();

export const PlanInputSchema = PlanSchema.omit({ features: true }).extend({
	finalReviewPolicy: FinalReviewPolicySchema.optional(),
	features: z
		.array(
			FeatureSchema.omit({ status: true })
				.extend({
					status: FeatureStatusSchema.optional(),
					reviewDepth: FeatureReviewDepthSchema.optional(),
					targets: z.array(z.string().min(1)).optional(),
					validation: z.array(z.string().min(1)).optional(),
					dependsOn: z.array(FeatureIdSchema).optional(),
				})
				.strict(),
		)
		.min(1),
});

export const CompletedWorkerOutcomeSchema = z
	.object({
		kind: z.literal("completed"),
		summary: z.string().min(1).optional(),
		resolutionHint: z.string().min(1).optional(),
	})
	.strict();

export const NeedsInputOutcomeSchema = z
	.object({
		kind: z.enum(["blocked", "needs_input", "replan_required"]),
		summary: z.string().min(1),
		resolutionHint: z.string().min(1).optional(),
	})
	.strict();

export const WorkerOutcomeSchema = z.discriminatedUnion("kind", [
	CompletedWorkerOutcomeSchema,
	NeedsInputOutcomeSchema,
]);

export const WorkerResultSchema = z.discriminatedUnion("status", [
	z.strictObject({
		status: z.literal("ok"),
		operationId: OperationIdSchema,
		expectedRevision: CausalRevisionSchema,
		expectedSnapshotId: SnapshotIdSchema,
		requestDigest: DigestSchema,
		featureId: FeatureIdSchema,
		summary: z.string().min(1),
		artifactsChanged: z.array(ArtifactSchema).default([]),
		validationRun: z.array(ValidationRunSchema).min(1).max(100),
		validationScope: ValidationScopeSchema,
		featureReviewDepth: FeatureReviewDepthSchema,
		featureReview: ReviewSchema,
		finalReview: FinalReviewSchema.optional(),
		outcome: CompletedWorkerOutcomeSchema.optional(),
		reviewExecutions: z.array(ReviewExecutionInputSchema).min(1).max(100),
		evidence: z.array(EvidenceRecordSchema).min(1).max(100),
		orchestrationPasses: z
			.array(OrchestrationPassRecordSchema)
			.max(MAX_ORCHESTRATION_PASSES)
			.default([]),
	}),
	z.strictObject({
		status: z.literal("needs_input"),
		operationId: OperationIdSchema,
		expectedRevision: CausalRevisionSchema,
		expectedSnapshotId: SnapshotIdSchema,
		requestDigest: DigestSchema,
		featureId: FeatureIdSchema,
		summary: z.string().min(1),
		artifactsChanged: z.array(ArtifactSchema).default([]),
		validationRun: z.array(ValidationRunSchema).default([]),
		validationScope: ValidationScopeSchema.optional(),
		featureReviewDepth: FeatureReviewDepthSchema.optional(),
		featureReview: ReviewSchema.optional(),
		finalReview: FinalReviewSchema.optional(),
		outcome: NeedsInputOutcomeSchema,
		reviewExecutions: z.array(ReviewExecutionInputSchema).max(100).default([]),
		evidence: z.array(EvidenceRecordSchema).max(100).default([]),
		orchestrationPasses: z
			.array(OrchestrationPassRecordSchema)
			.max(MAX_ORCHESTRATION_PASSES)
			.default([]),
	}),
]);

export const ExecutionHistoryEntrySchema = z
	.object({
		featureId: FeatureIdSchema,
		status: z.enum(["completed", "blocked", "needs_input"]),
		summary: z.string().min(1),
		recordedAt: z.string().min(1),
		artifactsChanged: z.array(ArtifactSchema).default([]),
		validationRun: z.array(ValidationRunSchema).default([]),
		validationScope: ValidationScopeSchema.optional(),
		featureReviewDepth: FeatureReviewDepthSchema.optional(),
		featureReview: ReviewSchema.optional(),
		finalReview: FinalReviewSchema.optional(),
		outcome: WorkerOutcomeSchema.optional(),
		orchestrationPasses: z
			.array(OrchestrationPassRecordSchema)
			.max(MAX_ORCHESTRATION_PASSES)
			.default([]),
	})
	.strict();

export const BudgetTelemetrySchema = z
	.object({
		reviewCount: z.number().int().nonnegative().default(0),
		failedReviewCount: z.number().int().nonnegative().default(0),
		failedReviewAttemptsByFeature: z
			.record(
				z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
				z.number().int().nonnegative(),
			)
			.default({}),
		reviewExecutions: z.array(ReviewExecutionSchema).default([]),
		reviewLifecycle: z
			.object({
				featureAttemptCount: z.number().int().nonnegative().default(0),
				finalAttemptCount: z.number().int().nonnegative().default(0),
				passedVerdictCount: z.number().int().nonnegative().default(0),
				failedVerdictCount: z.number().int().nonnegative().default(0),
				retryConsumedCount: z.number().int().nonnegative().default(0),
			})
			.strict()
			.prefault({}),
		observedReviewWorkers: z
			.discriminatedUnion("source", [
				z
					.object({
						source: z.literal("unavailable"),
						reconciliationStatus: z.literal("unreconciled"),
						observedExecutionCount: z.null(),
					})
					.strict(),
				z
					.object({
						source: z.literal("host_observed"),
						reconciliationStatus: z.literal("reconciled"),
						observedExecutionCount: z.number().int().nonnegative(),
					})
					.strict(),
			])
			.default({
				source: "unavailable",
				reconciliationStatus: "unreconciled",
				observedExecutionCount: null,
			}),
		orchestration: OrchestrationTelemetrySchema.prefault({}),
	})
	.strict();

const SessionV3Schema = z
	.object({
		version: z.literal(3),
		// Constrained to the archive-safe charset so a hostile or hand-edited
		// session.json with an exotic id (e.g. "session/1") fails to load and
		// routes through quarantine recovery, instead of loading and then
		// wedging every archive (flow_plan_save / flow_session_close) forever.
		id: SessionIdSchema,
		goal: z.string().min(1),
		status: SessionStatusSchema,
		approval: z.enum(["pending", "approved"]),
		plan: PlanSchema.nullable(),
		activeFeatureId: FeatureIdSchema.nullable(),
		history: z.array(ExecutionHistoryEntrySchema).default([]),
		budget: BudgetTelemetrySchema.prefault({}),
		causal: CausalStateSchema.optional(),
		closure: z
			.object({
				kind: z.enum(["completed", "deferred", "abandoned"]),
				summary: z.string().min(1),
				recordedAt: z.string().min(1),
			})
			.strict()
			.nullable(),
		lastError: z
			.object({
				tool: z.string().min(1),
				summary: z.string().min(1),
				recovery: z.string().min(1).optional(),
				recordedAt: z.string().min(1),
			})
			.strict()
			.nullable()
			.default(null),
		timestamps: z
			.object({
				createdAt: z.string().min(1),
				updatedAt: z.string().min(1),
				completedAt: z.string().min(1).nullable(),
			})
			.strict(),
	})
	.strict();

export const SessionSchema = SessionV3Schema.transform((value): Session => {
	if (value.causal) return value as Session;
	const hydrated: Session = {
		...value,
		causal: {
			revision: 0,
			genesisSnapshotId: `sha256:${"0".repeat(64)}`,
			snapshotId: `sha256:${"0".repeat(64)}`,
			mutations: [],
			evidence: [],
		},
	};
	const snapshotId = canonicalSessionSnapshotId(hydrated);
	return {
		...hydrated,
		causal: {
			...hydrated.causal,
			genesisSnapshotId: snapshotId,
			snapshotId,
		},
	};
}).superRefine((session, context) => {
	const chainError = validateCausalChain(session);
	if (!chainError) return;
	context.addIssue({
		code: "custom",
		path: ["causal"],
		message: chainError,
	});
});

export type {
	Artifact,
	BudgetTelemetry,
	CausalMutationRecord,
	CausalState,
	EvidenceId,
	EvidenceRecord,
	ExecutionHistoryEntry,
	Feature,
	FeatureReviewDepth,
	FinalReview,
	ObservedReviewWorkerLedger,
	OrchestrationPassRecord,
	OrchestrationTelemetry,
	Plan,
	PlanInput,
	Review,
	ReviewExecution,
	ReviewExecutionFinding,
	ReviewExecutionFindingInput,
	ReviewExecutionInput,
	ReviewFindingTaxonomy,
	ReviewLifecycleTelemetry,
	Session,
	SnapshotId,
	ValidationRun,
	WorkerResult,
} from "../domain/session.js";
