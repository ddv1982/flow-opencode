import { z } from "zod";

export const REPLAY_SCENARIO_IDS = [
	"active_final_feature_awaiting_review",
	"contradictory_feature_final_verdicts",
	"failed_to_passed_retry",
	"unsubmitted_review_failure",
	"malformed_optional_telemetry",
	"empty_or_malformed_handoff",
	"stale_validation",
	"unchanged_finding_retry",
	"crash_replay_around_mutation",
] as const;

export const ReplayScenarioIdSchema = z.enum(REPLAY_SCENARIO_IDS);
export type ReplayScenarioId = z.infer<typeof ReplayScenarioIdSchema>;

export const ReplayVariantSchema = z.enum(["A", "B", "C", "D"]);
export type ReplayVariant = z.infer<typeof ReplayVariantSchema>;

function canonicalIdSchema(prefix: string) {
	return z.string().regex(new RegExp(`^${prefix}_[0-9]{1,4}$`));
}

export const FixtureIdSchema = canonicalIdSchema("fixture");
export const SessionIdSchema = canonicalIdSchema("session");
export const OperationIdSchema = canonicalIdSchema("operation");
export const WorkerIdSchema = canonicalIdSchema("worker");
export const AttemptIdSchema = canonicalIdSchema("attempt");
export const LogicalPassIdSchema = canonicalIdSchema("pass");
export const SnapshotIdSchema = canonicalIdSchema("snapshot");
export const EvidenceRefSchema = canonicalIdSchema("evidence");
export const MutationIdSchema = canonicalIdSchema("mutation");

/** Closed, canonical identifier forms; arbitrary slugs and prose are rejected. */
export const OpaqueIdSchema = z.union([
	FixtureIdSchema,
	SessionIdSchema,
	OperationIdSchema,
	WorkerIdSchema,
	AttemptIdSchema,
	LogicalPassIdSchema,
	SnapshotIdSchema,
	EvidenceRefSchema,
	MutationIdSchema,
]);
export type OpaqueId = z.infer<typeof OpaqueIdSchema>;

export const REPLAY_IDENTIFIER_SCHEMAS = {
	fixture: FixtureIdSchema,
	session: SessionIdSchema,
	operation: OperationIdSchema,
	worker: WorkerIdSchema,
	attempt: AttemptIdSchema,
	logicalPass: LogicalPassIdSchema,
	snapshot: SnapshotIdSchema,
	evidence: EvidenceRefSchema,
	mutation: MutationIdSchema,
} as const;

export const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type Sha256Digest = z.infer<typeof Sha256DigestSchema>;

const UnsignedIntegerSchema = z.number().int().nonnegative().safe();

export const SourceCategorySchema = z.enum([
	"host_metadata",
	"flow_ledger",
	"supplied_observation",
	"replay_derived",
]);
export type SourceCategory = z.infer<typeof SourceCategorySchema>;

export const AvailabilityReasonSchema = z.enum([
	"not_recorded",
	"provider_unavailable",
	"not_applicable",
	"privacy_redacted",
	"unreconciled",
]);
export type AvailabilityReason = z.infer<typeof AvailabilityReasonSchema>;

export const UnsignedAvailabilitySchema = z.discriminatedUnion("status", [
	z.strictObject({
		status: z.literal("available"),
		value: UnsignedIntegerSchema,
	}),
	z.strictObject({
		status: z.literal("unavailable"),
		reason: AvailabilityReasonSchema,
	}),
]);
export type UnsignedAvailability = z.infer<typeof UnsignedAvailabilitySchema>;

export const REVIEW_LIFECYCLE_AGGREGATE_METRICS = [
	"review_assignment_attempt_count",
	"invalid_reviewer_payload_count",
	"completion_submission_count",
	"accepted_blocker_count",
	"schema_rejection_count",
	"evidence_only_rerun_count",
	"feature_reset_count",
	"abandoned_session_count",
] as const;
export type ReviewLifecycleAggregateMetric =
	(typeof REVIEW_LIFECYCLE_AGGREGATE_METRICS)[number];

export const AggregateMetricSchema = z.enum([
	"session_count",
	"child_session_count",
	"tool_part_count",
	"input_token_count",
	"cache_read_token_count",
	"output_token_count",
	"compaction_count",
	"flow_tool_call_count",
	"flow_tool_result_character_count",
	"root_flow_tool_call_count",
	"root_flow_tool_result_character_count",
	"child_flow_status_call_count",
	"child_flow_status_result_character_count",
	"prompt_character_count",
	"live_prompt_character_count",
	"live_prompt_estimated_token_count",
	"result_character_count",
	"tool_error_count",
	"message_error_count",
	"reviewer_execution_count",
	"reviewer_dispatch_count",
	"reviewer_child_session_count",
	"declared_worker_count",
	"review_attempt_count",
	"failed_review_attempt_count",
	"duplicate_finding_count",
	"validation_failure_count",
	"completion_schema_failure_count",
	"recovery_count",
	"tool_latency_total_ms",
	"tool_latency_p50_ms",
	"tool_latency_p95_ms",
	"reviewer_input_share_basis_points",
	"review_packet_file_count",
	"review_packet_line_count",
	"four_invocation_character_count",
	"scenario_count",
	"terminal_decision_count",
	...REVIEW_LIFECYCLE_AGGREGATE_METRICS,
]);
export type AggregateMetric = z.infer<typeof AggregateMetricSchema>;

export const ApprovedAggregateFactSchema = z.strictObject({
	metric: AggregateMetricSchema,
	availability: UnsignedAvailabilitySchema,
});
export type ApprovedAggregateFact = z.infer<typeof ApprovedAggregateFactSchema>;

export const SourceProjectionSchema = z.strictObject({
	category: SourceCategorySchema,
	fingerprint: Sha256DigestSchema,
});

export const ReplayControlDefectSchema = z.enum([
	"active_final_false_block",
	"contradictory_verdict_not_reconciled",
	"logical_pass_retry_not_correlated",
	"unsubmitted_review_failure_not_counted",
	"malformed_telemetry_masks_review",
	"handoff_not_runtime_validated",
	"stale_validation_not_snapshot_bound",
	"unchanged_finding_not_deduplicated",
	"mutation_recovery_not_idempotent",
]);
export type ReplayControlDefect = z.infer<typeof ReplayControlDefectSchema>;

export const ReplayDecisionSchema = z.enum([
	"complete",
	"blocked",
	"retry",
	"recovered",
	"failed",
]);
export type ReplayDecision = z.infer<typeof ReplayDecisionSchema>;

export const ReplayReasonSchema = z.enum([
	"all_gates_passed",
	"active_final_feature_in_progress",
	"contradictory_review_verdicts",
	"review_failed",
	"review_retry_passed",
	"review_failure_unsubmitted",
	"optional_telemetry_malformed",
	"handoff_invalid",
	"validation_stale",
	"finding_unchanged",
	"mutation_recovered",
	"mutation_incomplete",
	"schema_invalid",
]);
export type ReplayReason = z.infer<typeof ReplayReasonSchema>;

export const SessionStatusSchema = z.enum([
	"planning",
	"ready",
	"running",
	"blocked",
	"completed",
]);
export const FeatureStatusSchema = z.enum([
	"pending",
	"in_progress",
	"blocked",
	"completed",
]);
export const ReplayRoleSchema = z.enum([
	"root_manager",
	"implementation_worker",
	"feature_reviewer",
	"final_reviewer",
	"verifier",
	"host",
]);
export const ReplayModelClassSchema = z.enum([
	"manager",
	"worker",
	"reviewer",
	"verifier",
	"unknown",
]);

const EventBaseShape = {
	seq: UnsignedIntegerSchema,
	atMs: UnsignedIntegerSchema,
	source: SourceCategorySchema,
} as const;

const ExecutionIdentityShape = {
	operationId: OperationIdSchema,
	workerId: WorkerIdSchema,
	role: ReplayRoleSchema,
	modelClass: ReplayModelClassSchema,
} as const;

const SessionStateEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("session_state"),
	sessionId: SessionIdSchema,
	revision: UnsignedIntegerSchema,
	sessionStatus: SessionStatusSchema,
	featureStatus: FeatureStatusSchema,
	stateDigest: Sha256DigestSchema,
});

const ValidationEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("validation"),
	operationId: OperationIdSchema,
	evidenceRef: EvidenceRefSchema,
	snapshotId: SnapshotIdSchema,
	revision: UnsignedIntegerSchema,
	scope: z.enum(["targeted", "broad"]),
	status: z.enum(["passed", "failed"]),
	freshness: z.enum(["current", "stale", "unknown"]),
	latencyMs: UnsignedAvailabilitySchema,
});

const ReviewAttemptShape = {
	...EventBaseShape,
	...ExecutionIdentityShape,
	attemptId: AttemptIdSchema,
	logicalPassId: LogicalPassIdSchema,
	snapshotId: SnapshotIdSchema,
	evidenceRef: EvidenceRefSchema,
	verdict: z.enum(["passed", "failed"]),
	submitted: z.boolean(),
	findingFingerprints: z.array(Sha256DigestSchema).max(64),
	duplicateFindingCount: UnsignedIntegerSchema,
} as const;

const FeatureReviewAttemptEventSchema = z.strictObject({
	...ReviewAttemptShape,
	kind: z.literal("feature_review_attempt"),
});

const FinalReviewAttemptEventSchema = z.strictObject({
	...ReviewAttemptShape,
	kind: z.literal("final_review_attempt"),
});

const HandoffValidityEventSchema = z.strictObject({
	...EventBaseShape,
	...ExecutionIdentityShape,
	kind: z.literal("handoff_validity"),
	status: z.enum(["valid", "empty", "malformed"]),
	evidenceRef: EvidenceRefSchema,
});

const TelemetryValidityEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("telemetry_validity"),
	operationId: OperationIdSchema,
	status: z.enum(["valid", "malformed", "unavailable"]),
	declaredWorkerCount: UnsignedAvailabilitySchema,
});

const OperationMetricsEventSchema = z.strictObject({
	...EventBaseShape,
	...ExecutionIdentityShape,
	kind: z.literal("operation_metrics"),
	latencyMs: UnsignedAvailabilitySchema,
	inputTokenCount: UnsignedAvailabilitySchema,
	cacheReadTokenCount: UnsignedAvailabilitySchema,
	outputTokenCount: UnsignedAvailabilitySchema,
	promptCharacterCount: UnsignedAvailabilitySchema,
	resultCharacterCount: UnsignedAvailabilitySchema,
});

const RetryFindingDeltaEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("retry_finding_delta"),
	operationId: OperationIdSchema,
	logicalPassId: LogicalPassIdSchema,
	previousAttemptId: AttemptIdSchema,
	currentAttemptId: AttemptIdSchema,
	delta: z.enum(["unchanged", "changed", "resolved"]),
	previousFindingCount: UnsignedIntegerSchema,
	currentFindingCount: UnsignedIntegerSchema,
	duplicateFindingCount: UnsignedIntegerSchema,
});

const CompactionEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("compaction"),
	operationId: OperationIdSchema,
	beforeCharacterCount: UnsignedAvailabilitySchema,
	afterCharacterCount: UnsignedAvailabilitySchema,
});

const SchemaFailureEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("schema_failure"),
	operationId: OperationIdSchema,
	target: z.enum(["completion", "handoff", "telemetry", "durable_state"]),
	failure: z.enum([
		"missing_field",
		"extra_field",
		"invalid_type",
		"invalid_value",
	]),
});

const MutationStartEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("mutation_start"),
	operationId: OperationIdSchema,
	mutationId: MutationIdSchema,
	baseRevision: UnsignedIntegerSchema,
	inputDigest: Sha256DigestSchema,
});

const MutationCommitEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("mutation_commit"),
	operationId: OperationIdSchema,
	mutationId: MutationIdSchema,
	revision: UnsignedIntegerSchema,
	stateDigest: Sha256DigestSchema,
});

const MutationCrashEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("mutation_crash"),
	operationId: OperationIdSchema,
	mutationId: MutationIdSchema,
	phase: z.enum(["before_write", "after_write_before_commit", "after_commit"]),
});

const MutationRecoveryEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("mutation_recovery"),
	operationId: OperationIdSchema,
	mutationId: MutationIdSchema,
	status: z.enum(["rolled_back", "commit_reused", "reapplied"]),
	revision: UnsignedIntegerSchema,
	stateDigest: Sha256DigestSchema,
});

const TerminalDecisionEventSchema = z.strictObject({
	...EventBaseShape,
	kind: z.literal("terminal_decision"),
	decision: ReplayDecisionSchema,
	reason: ReplayReasonSchema,
	revision: UnsignedIntegerSchema,
	stateDigest: Sha256DigestSchema,
	evidenceRefs: z.array(EvidenceRefSchema).max(64),
});

export const ReplayEventSchema = z.discriminatedUnion("kind", [
	SessionStateEventSchema,
	ValidationEventSchema,
	FeatureReviewAttemptEventSchema,
	FinalReviewAttemptEventSchema,
	HandoffValidityEventSchema,
	TelemetryValidityEventSchema,
	OperationMetricsEventSchema,
	RetryFindingDeltaEventSchema,
	CompactionEventSchema,
	SchemaFailureEventSchema,
	MutationStartEventSchema,
	MutationCommitEventSchema,
	MutationCrashEventSchema,
	MutationRecoveryEventSchema,
	TerminalDecisionEventSchema,
]);
export type ReplayEvent = z.infer<typeof ReplayEventSchema>;

export const ReplayScenarioSchema = z
	.strictObject({
		id: ReplayScenarioIdSchema,
		sessionId: SessionIdSchema,
		initialStateDigest: Sha256DigestSchema,
		controlDefects: z.array(ReplayControlDefectSchema).max(9),
		events: z.array(ReplayEventSchema).min(1).max(512),
	})
	.superRefine((scenario, context) => {
		const defects = new Set<string>();
		for (const [index, defect] of scenario.controlDefects.entries()) {
			if (defects.has(defect)) {
				context.addIssue({
					code: "custom",
					path: ["controlDefects", index],
					message: "Duplicate control defect.",
				});
			}
			defects.add(defect);
		}

		let priorSeq = -1;
		let priorAtMs = -1;
		for (const [index, event] of scenario.events.entries()) {
			if (event.seq <= priorSeq) {
				context.addIssue({
					code: "custom",
					path: ["events", index, "seq"],
					message: "Event sequence must be unique and strictly increasing.",
				});
			}
			if (event.atMs < priorAtMs) {
				context.addIssue({
					code: "custom",
					path: ["events", index, "atMs"],
					message: "Relative event time must be monotonic.",
				});
			}
			priorSeq = event.seq;
			priorAtMs = event.atMs;
		}
	});
export type ReplayScenario = z.infer<typeof ReplayScenarioSchema>;

const AggregateFactsSchema = z
	.array(ApprovedAggregateFactSchema)
	.max(AggregateMetricSchema.options.length)
	.superRefine((facts, context) => {
		const metrics = new Set<string>();
		for (const [index, fact] of facts.entries()) {
			if (metrics.has(fact.metric)) {
				context.addIssue({
					code: "custom",
					path: [index, "metric"],
					message: "Duplicate aggregate metric.",
				});
			}
			metrics.add(fact.metric);
		}
	});

export const ReviewLifecycleBaselineSchema = z
	.strictObject({
		version: z.literal(1),
		baselineId: z.literal("qa_scribe_5_1_high"),
		capturedOn: z.literal("2026-07-19"),
		inferenceEffort: z.enum(["high", "max"]),
		facts: z
			.array(ApprovedAggregateFactSchema)
			.length(REVIEW_LIFECYCLE_AGGREGATE_METRICS.length),
	})
	.superRefine((baseline, context) => {
		const metrics = new Set(baseline.facts.map((fact) => fact.metric));
		for (const [index, fact] of baseline.facts.entries()) {
			if (
				!REVIEW_LIFECYCLE_AGGREGATE_METRICS.includes(
					fact.metric as ReviewLifecycleAggregateMetric,
				)
			) {
				context.addIssue({
					code: "custom",
					path: ["facts", index, "metric"],
					message: "Lifecycle baseline contains a non-lifecycle metric.",
				});
			}
		}
		for (const metric of REVIEW_LIFECYCLE_AGGREGATE_METRICS) {
			if (!metrics.has(metric)) {
				context.addIssue({
					code: "custom",
					path: ["facts"],
					message: `Lifecycle baseline is missing '${metric}'.`,
				});
			}
		}
	});
export type ReviewLifecycleBaseline = z.infer<
	typeof ReviewLifecycleBaselineSchema
>;

export const ReplayFixtureSchema = z
	.strictObject({
		version: z.literal(1),
		fixtureId: FixtureIdSchema,
		sourceFingerprint: Sha256DigestSchema,
		sources: z.array(SourceProjectionSchema).min(1).max(4),
		hostFacts: AggregateFactsSchema,
		flowLedgerClaims: AggregateFactsSchema,
		suppliedObservations: AggregateFactsSchema,
		replayDerivedFacts: AggregateFactsSchema,
		scenarios: z.array(ReplayScenarioSchema).length(REPLAY_SCENARIO_IDS.length),
	})
	.superRefine((fixture, context) => {
		const sourceCategories = new Set<string>();
		for (const [index, source] of fixture.sources.entries()) {
			if (sourceCategories.has(source.category)) {
				context.addIssue({
					code: "custom",
					path: ["sources", index, "category"],
					message: "Duplicate source category.",
				});
			}
			sourceCategories.add(source.category);
		}

		const scenarioIds = new Set(fixture.scenarios.map(({ id }) => id));
		for (const scenarioId of REPLAY_SCENARIO_IDS) {
			if (!scenarioIds.has(scenarioId)) {
				context.addIssue({
					code: "custom",
					path: ["scenarios"],
					message: "Fixture must contain every replay scenario exactly once.",
				});
			}
		}
	});
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;
