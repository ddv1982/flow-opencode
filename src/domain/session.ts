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

export type ReviewFinding = {
	summary: string;
	severity: "blocking" | "advisory";
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

export type Review = {
	status: "passed" | "failed";
	summary: string;
	blockingFindings: ReviewFinding[];
};

export type FinalReview = Review & {
	reviewDepth: FinalReviewPolicy;
};

export type ValidationRun = {
	command: string;
	status: "passed" | "failed";
	summary: string;
};

export type ValidationEvidence = {
	kind: "validation";
	evidenceId: EvidenceId;
	snapshotId: SnapshotId;
	sourceDigest: string;
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
		| "review_record"
		| "evidence_record"
		| "feature_complete"
		| "feature_reset"
		| "session_close";
	requestDigest: string;
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

type ReviewerProjectionRequestBase = {
	featureId: FeatureId;
	packetHash: string;
	evidenceRefs: string[];
	expectedRevision?: number | undefined;
	expectedSnapshotId?: SnapshotId | undefined;
};

export type ReviewerProjectionRequest =
	| (ReviewerProjectionRequestBase & { reviewKind: "feature" })
	| (ReviewerProjectionRequestBase & { reviewKind: "final" });

type ReviewerProjectionBase = {
	view: "reviewer";
	featureId: FeatureId;
	assignedScope: string[];
	packetHash: string;
	evidenceRefs: string[];
	expectedRevision: number;
	expectedSnapshotId: SnapshotId;
};

export type ReviewerProjection =
	| (ReviewerProjectionBase & {
			reviewKind: "feature";
			requiredDepth: FeatureReviewDepth;
	  })
	| (ReviewerProjectionBase & {
			reviewKind: "final";
			requiredDepth: FinalReviewPolicy;
			requirements: string[];
			decisions: string[];
	  });

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

export type CompletedWorkerOutcome = {
	kind: "completed";
	summary?: string | undefined;
	resolutionHint?: string | undefined;
};

export type NeedsInputOutcome = {
	kind: "blocked" | "needs_input" | "replan_required";
	summary: string;
	resolutionHint?: string | undefined;
};

export type WorkerOutcome = CompletedWorkerOutcome | NeedsInputOutcome;

type WorkerResultBase = {
	operationId?: string | undefined;
	expectedRevision?: number | undefined;
	expectedSnapshotId?: SnapshotId | undefined;
	/** Trusted application-boundary digest of the normalized public request. */
	requestDigest?: string | undefined;
	featureId: FeatureId;
	summary: string;
	artifactsChanged: Artifact[];
	validationRun: ValidationRun[];
	validationScope?: ValidationScope | undefined;
	featureReviewDepth?: FeatureReviewDepth | undefined;
	featureReview?: Review | undefined;
	finalReview?: FinalReview | undefined;
	reviewExecutions?: ReviewExecutionInput[] | undefined;
	evidence?: EvidenceRecord[] | undefined;
	orchestrationPasses: OrchestrationPassRecord[];
};

export type WorkerResult =
	| (WorkerResultBase & {
			status: "ok";
			validationScope: ValidationScope;
			featureReviewDepth: FeatureReviewDepth;
			featureReview: Review;
			outcome?: CompletedWorkerOutcome | undefined;
	  })
	| (WorkerResultBase & {
			status: "needs_input";
			outcome: NeedsInputOutcome;
	  });

export type ExecutionHistoryEntry = {
	featureId: FeatureId;
	status: "completed" | "blocked" | "needs_input";
	summary: string;
	recordedAt: string;
	artifactsChanged: Artifact[];
	validationRun: ValidationRun[];
	validationScope?: ValidationScope | undefined;
	featureReviewDepth?: FeatureReviewDepth | undefined;
	featureReview?: Review | undefined;
	finalReview?: FinalReview | undefined;
	outcome?: WorkerOutcome | undefined;
	orchestrationPasses: OrchestrationPassRecord[];
};

export type BudgetTelemetry = {
	reviewCount: number;
	failedReviewCount: number;
	failedReviewAttemptsByFeature: Record<string, number>;
	reviewExecutions: ReviewExecution[];
	reviewLifecycle: ReviewLifecycleTelemetry;
	observedReviewWorkers: ObservedReviewWorkerLedger;
	orchestration: OrchestrationTelemetry;
};

export type Session = {
	version: 3;
	id: SessionId;
	goal: string;
	status: SessionStatus;
	approval: "pending" | "approved";
	plan: Plan | null;
	activeFeatureId: FeatureId | null;
	history: ExecutionHistoryEntry[];
	budget: BudgetTelemetry;
	causal: CausalState;
	closure: {
		kind: "completed" | "deferred" | "abandoned";
		summary: string;
		recordedAt: string;
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
