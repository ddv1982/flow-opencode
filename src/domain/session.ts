import type { ValidationCommandClass } from "./validation-command.js";

export type FeatureStatus = "pending" | "in_progress" | "completed" | "blocked";
export type SessionStatus =
	| "planning"
	| "ready"
	| "running"
	| "blocked"
	| "completed";
export type FeatureReviewDepth = "quick" | "standard" | "detailed";
export type FinalReviewPolicy = "broad" | "detailed";
export type ValidationScope = "targeted" | "broad";

export type SnapshotId = string;
export type EvidenceId = string;
export type FeatureRunId = string;
export type ReviewAssignmentId = string;
export type EvidenceArtifactRef = {
	kind: "restricted_evidence_v1";
	digest: `sha256:${string}`;
	byteLength: number;
};

export type CausalGuard = {
	operationId: string;
	expectedRevision: number;
	expectedSnapshotId: SnapshotId;
};

declare const featureIdBrand: unique symbol;
declare const sessionIdBrand: unique symbol;

export type FeatureId = string & { readonly [featureIdBrand]: "FeatureId" };
export type SessionId = string & { readonly [sessionIdBrand]: "SessionId" };

export function toFeatureId(value: string): FeatureId {
	return value as FeatureId;
}

export function toSessionId(value: string): SessionId {
	return value as SessionId;
}

export type OrchestrationPassRecord = {
	id: string;
	kind:
		| "discovery"
		| "audit"
		| "review"
		| "validation"
		| "verification"
		| "candidate"
		| "implementation-decision";
	decision?:
		| "serial"
		| "parallel"
		| "candidate-exact-path"
		| "candidate-worktree"
		| "tournament"
		| "skipped"
		| undefined;
	decisionReason?: string | undefined;
	candidateEligibility: "eligible" | "not_eligible" | "unknown";
	candidateDecision?: "used" | "skipped" | "serial_required" | undefined;
	decisionFactors: Array<
		| "shared_state"
		| "overlapping_files"
		| "small_slice"
		| "needs_manager_judgment"
		| "independent_surface"
		| "validation_available"
	>;
	modes: Array<
		| "evidence"
		| "review"
		| "validation"
		| "audit"
		| "verifier"
		| "candidate-implementation"
	>;
	workerCount: number;
	candidateWorkerCount: number;
	verifierWorkerCount: number;
	sliceIds: string[];
	dependsOn: string[];
	writeScope:
		| "none"
		| "manager-serial"
		| "exact-path"
		| "isolated-worktree"
		| "mixed";
	handoffRefs: string[];
	verificationStatus:
		| "not-needed"
		| "pending"
		| "passed"
		| "failed"
		| "mixed"
		| "downgraded";
	outcome:
		| "accepted"
		| "modified"
		| "rejected"
		| "partial"
		| "not-covered"
		| "superseded";
	synthesisRef?: string | undefined;
};

export type OrchestrationTelemetry = {
	passCount: number;
	workerCount: number;
	candidatePassCount: number;
	verifierPassCount: number;
	candidateEligibleCount: number;
	candidateUsedDecisionCount: number;
	candidateSerialRequiredDecisionCount: number;
	skippedCandidateDecisionCount: number;
	latestPasses: OrchestrationPassRecord[];
};

export type ReviewFindingTaxonomy =
	| "implementation_defect"
	| "regression_coverage_gap"
	| "evidence_gap"
	| "advisory";

export type ReviewExecutionFindingInput = {
	taxonomy: ReviewFindingTaxonomy;
	subject: string;
	requirementOrRisk: string;
	evidenceLocator: string;
	summary: string;
	severity: "blocking" | "advisory";
};

export type ReviewExecutionFinding = ReviewExecutionFindingInput & {
	fingerprint: string;
};

export type ReviewExecutionInput = {
	assignmentId: ReviewAssignmentId;
	featureRunId: FeatureRunId;
	attemptId: string;
	logicalPassId: string;
	featureId: FeatureId;
	reviewKind: "feature" | "final";
	reviewSnapshotId: string;
	verdict: "passed" | "failed";
	findings: ReviewExecutionFindingInput[];
	startedAt: string;
	completedAt: string;
	terminalDisposition: "submitted" | "observed_unsubmitted";
};

export type ReviewExecution = Omit<ReviewExecutionInput, "findings"> & {
	findings: ReviewExecutionFinding[];
};

export type FeatureRun = {
	id: FeatureRunId;
	featureId: FeatureId;
	sequence: number;
	status:
		| "active"
		| "completed"
		| "blocked"
		| "reset"
		| "deferred"
		| "abandoned";
	startedAt: string;
	endedAt: string | null;
};

export type BoundReviewPrerequisite = {
	assignmentId: ReviewAssignmentId;
	result: ReviewAssignmentResultInput;
	resultDigest: string;
};

export type ReviewAssignment = {
	id: ReviewAssignmentId;
	operationId: string;
	featureRunId: FeatureRunId;
	featureId: FeatureId;
	reviewKind: "feature" | "final";
	validationScope: ValidationScope;
	validationEvidenceRefs: EvidenceId[];
	sourceDigest: string;
	packetDigest: string;
	packetSummary: string;
	riskLenses: string[];
	prerequisite: BoundReviewPrerequisite | null;
	attemptId: string;
	logicalPassId: string;
	startedAt: string;
	requiredDepth: FeatureReviewDepth | FinalReviewPolicy;
	status: "pending" | "submitted" | "observed_unsubmitted" | "invalidated";
	completedAt: string | null;
	invalidatedAt: string | null;
	invalidationReason:
		| "feature_reset"
		| "source_changed"
		| "session_deferred"
		| "session_abandoned"
		| null;
};

export type ReviewAssignmentResultInput = {
	assignmentId: ReviewAssignmentId;
	verdict: "passed" | "failed";
	findings: ReviewExecutionFindingInput[];
	completedAt: string;
	terminalDisposition: "submitted" | "observed_unsubmitted";
};

export type ReviewLifecycleTelemetry = {
	featureAttemptCount: number;
	finalAttemptCount: number;
	passedVerdictCount: number;
	failedVerdictCount: number;
	retryConsumedCount: number;
};

export type ObservedReviewWorkerLedger =
	| {
			source: "unavailable";
			reconciliationStatus: "unreconciled";
			observedExecutionCount: null;
	  }
	| {
			source: "host_observed";
			reconciliationStatus: "reconciled";
			observedExecutionCount: number;
	  };

export type ValidationEvidence = {
	kind: "validation";
	evidenceId: EvidenceId;
	featureRunId: FeatureRunId;
	capturedAtRevision: number;
	capturedAtSnapshotId: SnapshotId;
	snapshotId: SnapshotId;
	sourceDigest: string;
	commandDigest: string;
	commandClass: ValidationCommandClass;
	startedAt: string;
	completedAt: string;
	exitCode: number;
	outputDigest: string;
	artifactRef?: EvidenceArtifactRef | undefined;
	environmentKeys: string[];
};

export type ReviewEvidence = {
	kind: "review";
	evidenceId: EvidenceId;
	featureRunId: FeatureRunId;
	assignmentId: ReviewAssignmentId;
	capturedAtRevision: number;
	capturedAtSnapshotId: SnapshotId;
	snapshotId: SnapshotId;
	sourceDigest: string;
	attemptId: string;
	packetDigest: string;
	startedAt: string;
	completedAt: string;
};

export type EvidenceRecord = ValidationEvidence | ReviewEvidence;

export type CausalMutationRecord = {
	operationId: string;
	operationKind:
		| "plan_save"
		| "plan_approve"
		| "run_start"
		| "review_start"
		| "feature_complete"
		| "feature_reset"
		| "session_close";
	requestDigest: string;
	featureRunId: FeatureRunId | null;
	priorMutationDigest: string | null;
	mutationDigest: string;
	priorRevision: number;
	revision: number;
	priorSnapshotId: SnapshotId;
	currentSnapshotId: SnapshotId;
	changedEntity: {
		kind: "session" | "plan" | "feature" | "review" | "evidence" | "closure";
		id: string;
	};
	changedFields: string[];
	blockerDelta: {
		added: string[];
		removed: string[];
	};
	evidenceRefs: EvidenceId[];
	recordedAt: string;
};

export type CausalState = {
	revision: number;
	genesisSnapshotId: SnapshotId;
	snapshotId: SnapshotId;
	mutations: CausalMutationRecord[];
	evidence: EvidenceRecord[];
};

export type ReviewerProjectionRequest = { assignmentId: ReviewAssignmentId };

export type AssignmentReviewerProjection = {
	view: "reviewer";
	assignmentId: ReviewAssignmentId;
	assignmentStatus: ReviewAssignment["status"];
	featureRunId: FeatureRunId;
	featureId: FeatureId;
	reviewKind: "feature" | "final";
	assignedScope: string[];
	requiredDepth: FeatureReviewDepth | FinalReviewPolicy;
	packetSummary: string;
	riskLenses: string[];
	validationScope: ValidationScope;
	validationEvidenceCount: number;
	terminalDisposition: "submitted" | "observed_unsubmitted" | null;
};

export type ReviewerProjection = AssignmentReviewerProjection;

export type Artifact = {
	path: string;
};

export type Feature = {
	id: FeatureId;
	title: string;
	summary: string;
	status: FeatureStatus;
	reviewDepth: FeatureReviewDepth;
	targets: string[];
	validation: string[];
	dependsOn: FeatureId[];
};

export type Plan = {
	summary: string;
	overview: string;
	requirements: string[];
	decisions: string[];
	finalReviewPolicy: FinalReviewPolicy;
	features: Feature[];
};

export type ExecutionProjection = {
	view: "execution";
	featureRunId?: FeatureRunId | undefined;
	goal: string;
	plan: {
		summary: string;
		overview: string;
		requirements: string[];
		decisions: string[];
		finalReviewPolicy: FinalReviewPolicy;
	};
	feature: {
		id: FeatureId;
		title: string;
		summary: string;
		targets: string[];
		validation: string[];
		dependsOn: FeatureId[];
		reviewDepth: FeatureReviewDepth;
	};
	isFinalFeature: boolean;
	requiredValidationScope: ValidationScope;
	expectedRevision: number;
	expectedSnapshotId: SnapshotId;
};

export type PlanInput = {
	summary: string;
	overview: string;
	requirements?: string[] | undefined;
	decisions?: string[] | undefined;
	finalReviewPolicy?: FinalReviewPolicy | undefined;
	features: Array<{
		id: FeatureId;
		title: string;
		summary: string;
		status?: FeatureStatus | undefined;
		reviewDepth?: FeatureReviewDepth | undefined;
		targets?: string[] | undefined;
		validation?: string[] | undefined;
		dependsOn?: FeatureId[] | undefined;
	}>;
};

export type ExecutionOutcome =
	| {
			kind: "blocked";
			summary: string;
			resolutionHint?: string | undefined;
	  }
	| {
			kind: "completed";
			summary?: string | undefined;
			resolutionHint?: string | undefined;
	  };

export type ExecutionHistoryEntry = {
	featureRunId: FeatureRunId;
	featureId: FeatureId;
	status: "completed" | "blocked";
	summary: string;
	recordedAt: string;
	artifactsChanged: Artifact[];
	validationScope: ValidationScope;
	validationEvidenceRefs: EvidenceId[];
	reviewAssignmentIds: ReviewAssignmentId[];
	outcome: ExecutionOutcome;
	orchestrationPasses: OrchestrationPassRecord[];
};

export type BudgetTelemetry = {
	reviewCount: number;
	failedReviewCount: number;
	failedReviewAttemptsByFeatureRun: Record<string, number>;
	reviewExecutions: ReviewExecution[];
	reviewLifecycle: ReviewLifecycleTelemetry;
	observedReviewWorkers: ObservedReviewWorkerLedger;
	orchestration: OrchestrationTelemetry;
};

export type Session = {
	version: 4;
	id: SessionId;
	goal: string;
	status: SessionStatus;
	approval: "pending" | "approved";
	plan: Plan | null;
	activeFeatureId: FeatureId | null;
	activeFeatureRunId: FeatureRunId | null;
	featureRuns: FeatureRun[];
	reviewAssignments: ReviewAssignment[];
	history: ExecutionHistoryEntry[];
	budget: BudgetTelemetry;
	causal: CausalState;
	closure: {
		kind: "completed" | "deferred" | "abandoned";
		summary: string;
		recordedAt: string;
		retryOperationId: string;
	} | null;
	lastError: {
		tool: string;
		summary: string;
		recovery?: string | undefined;
		recordedAt: string;
	} | null;
	timestamps: {
		createdAt: string;
		updatedAt: string;
		completedAt: string | null;
	};
};
