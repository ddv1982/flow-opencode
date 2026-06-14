import type { ProjectStructureMapProjection } from "../project-structure-map";
import type { Feature } from "../schema";

export type ContextDiagnosticSeverity = "info" | "warn";
export type WorkflowReadinessState =
	| "planning_ready"
	| "execution_ready"
	| "feature_review_ready"
	| "final_review_ready"
	| "release_ready"
	| "blocked_by_context"
	| "blocked_by_validation"
	| "blocked_by_review";

export type ContextDiagnostic = {
	id: string;
	severity: ContextDiagnosticSeverity;
	summary: string;
	featureId?: string;
	remediation: string;
};

export type FeatureContextProjection = {
	id: string;
	title: string;
	status: Feature["status"];
	fileTargets: string[];
	reviewScope: string[];
	verification: string[];
};

export type TraceabilityGap = {
	id: string;
	severity: ContextDiagnosticSeverity;
	summary: string;
	remediation: string;
};

export type FeatureTraceabilityProjection = FeatureContextProjection & {
	changedArtifacts: string[];
	validationCommands: string[];
	reviewerDecisionStatus: string | null;
	featureReviewStatus: string | null;
	finalReviewStatus: string | null;
	gaps: TraceabilityGap[];
};

export type ContextTraceabilityProjection = {
	plannedTargetCount: number;
	changedArtifactCount: number;
	validationCommandCount: number;
	unplannedChangedArtifacts: string[];
	reviewedFeatureCount: number;
	features: FeatureTraceabilityProjection[];
};

export type ContextQualityCheckStatus = "pass" | "warn" | "fail";
export type ContextQualityCheck = {
	id: string;
	status: ContextQualityCheckStatus;
	weight: number;
	summary: string;
};

export type ContextQualityProjection = {
	score: number;
	rating: "strong" | "adequate" | "weak";
	checks: ContextQualityCheck[];
};

export type WorkflowReadinessProjection = {
	state: WorkflowReadinessState;
	blocking: Array<{
		id: string;
		featureId?: string;
		summary: string;
		remediation: string;
	}>;
	warnings: Array<{
		id: string;
		featureId?: string;
		summary: string;
	}>;
	nextAction: string;
};

export type ContextPackProjection = {
	sessionId: string;
	goal: string;
	workflowProfile: string;
	repoProfile: string[];
	research: string[];
	requirements: string[];
	architectureDecisions: string[];
	notes: string[];
	features: FeatureContextProjection[];
	changedArtifacts: string[];
	validationCommands: string[];
	diagnostics: ContextDiagnostic[];
	quality: ContextQualityProjection;
	traceability: ContextTraceabilityProjection;
	workflowReadiness: WorkflowReadinessProjection;
	projectStructure?: ProjectStructureMapProjection;
};
