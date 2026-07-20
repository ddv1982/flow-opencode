export type SessionStatus =
	| "planning"
	| "ready"
	| "running"
	| "blocked"
	| "completed"
	| "closed";

export type FeatureId = string;
export type SessionId = string;
export type SourceDigest = `sha256:${string}`;

export type Artifact = Readonly<{ path: string }>;

export type PlanFeature = Readonly<{
	id: FeatureId;
	title: string;
	summary: string;
	targets: string[];
	validation: string[];
	dependsOn: FeatureId[];
}>;

export type Plan = Readonly<{
	summary: string;
	overview: string;
	requirements: string[];
	decisions: string[];
	features: PlanFeature[];
}>;

export type ValidationScope = "focused" | "broad";

export type ValidationObservation = Readonly<{
	id: string;
	featureId: FeatureId;
	runId: string;
	scope: ValidationScope;
	command: string;
	sourceDigest: SourceDigest;
	exitCode: number;
	outputDigest: SourceDigest;
	outputComplete: boolean;
	recordedRevision: number;
}>;

export type ReviewFinding = Readonly<{
	severity: "blocking" | "advisory";
	summary: string;
	evidence?: string | undefined;
}>;

export type ReviewResult = Readonly<{
	verdict: "passed" | "failed";
	findings: ReviewFinding[];
	terminalDisposition: "submitted" | "observed_unsubmitted";
	recordedRevision: number;
}>;

export type ReviewAssignment = Readonly<{
	id: string;
	operationId: string;
	featureId: FeatureId;
	runId: string;
	kind: "feature" | "final";
	sourceDigest: SourceDigest;
	validationIds: string[];
	packet: Readonly<{
		summary: string;
		riskLenses: string[];
	}>;
	createdRevision: number;
	result: ReviewResult | null;
}>;

/**
 * The run is the canonical execution aggregate. Feature status, active work,
 * validation, review, and completion are derived from this one record instead
 * of being copied into parallel histories and counters.
 */
export type FeatureRun = Readonly<{
	id: string;
	featureId: FeatureId;
	attempt: number;
	state: "active" | "completed" | "blocked" | "superseded";
	startedRevision: number;
	summary: string | null;
	artifactsChanged: Artifact[];
	validations: ValidationObservation[];
	reviews: ReviewAssignment[];
}>;

export type OperationKind =
	| "plan-save"
	| "plan-approve"
	| "run-start"
	| "review-start"
	| "feature-complete"
	| "feature-reset"
	| "session-close";

export type OperationRecord = Readonly<{
	id: string;
	kind: OperationKind;
	inputDigest: SourceDigest;
	committedRevision: number;
	entityId?: string | undefined;
}>;

export type SessionClosure = Readonly<{
	kind: "completed" | "deferred" | "abandoned";
	summary: string;
	operationId: string;
	recordedRevision: number;
}>;

/**
 * Session v5 is a deliberate hard cutover. Older active sessions must be
 * closed before upgrading; archived documents are inert history.
 *
 * Revision/order carries lifecycle truth. There are deliberately no clocks in
 * the correctness model.
 */
export type Session = Readonly<{
	version: 5;
	id: SessionId;
	revision: number;
	goal: string;
	approval: "pending" | "approved";
	plan: Plan | null;
	runs: FeatureRun[];
	operations: OperationRecord[];
	closure: SessionClosure | null;
}>;
