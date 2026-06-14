import type { Feature, Session } from "../schema";
import type {
	ContextDiagnostic,
	ContextTraceabilityProjection,
	WorkflowReadinessProjection,
} from "./types";

function diagnosticSummary(
	diagnostic: ContextDiagnostic,
): WorkflowReadinessProjection["blocking"][number] {
	return {
		id: diagnostic.id,
		...(diagnostic.featureId ? { featureId: diagnostic.featureId } : {}),
		summary: diagnostic.summary,
		remediation: diagnostic.remediation,
	};
}

function warningSummary(
	diagnostic: ContextDiagnostic,
): WorkflowReadinessProjection["warnings"][number] {
	return {
		id: diagnostic.id,
		...(diagnostic.featureId ? { featureId: diagnostic.featureId } : {}),
		summary: diagnostic.summary,
	};
}

export function buildWorkflowReadinessProjection(
	session: Session,
	features: Feature[],
	diagnostics: ContextDiagnostic[],
	traceability: ContextTraceabilityProjection,
): WorkflowReadinessProjection {
	const warnings = diagnostics.map(warningSummary);
	const contextBlockingDiagnostics = diagnostics.filter((diagnostic) => {
		if (diagnostic.id === "changed_artifacts_outside_planned_context") {
			return true;
		}
		if (!session.plan || session.approval === "pending") {
			return diagnostic.severity === "warn";
		}
		const activeFeatureId = session.execution.activeFeatureId;
		return (
			diagnostic.severity === "warn" &&
			Boolean(activeFeatureId) &&
			diagnostic.featureId === activeFeatureId
		);
	});
	const scopeDriftGaps = traceability.features.flatMap((feature) =>
		feature.gaps
			.filter((gap) => gap.id === "feature_changed_artifacts_outside_scope")
			.map((gap) => ({
				id: gap.id,
				featureId: feature.id,
				summary: gap.summary,
				remediation: gap.remediation,
			})),
	);
	const validationBlockingGaps = traceability.features.flatMap((feature) =>
		feature.gaps
			.filter((gap) => gap.id === "feature_changed_without_validation")
			.map((gap) => ({
				id: gap.id,
				featureId: feature.id,
				summary: gap.summary,
				remediation: gap.remediation,
			})),
	);
	const reviewBlockingGaps = traceability.features.flatMap((feature) =>
		feature.gaps
			.filter(
				(gap) =>
					gap.id === "completed_feature_missing_feature_review" ||
					gap.id === "strict_review_feature_missing_approval",
			)
			.map((gap) => ({
				id: gap.id,
				featureId: feature.id,
				summary: gap.summary,
				remediation: gap.remediation,
			})),
	);
	if (contextBlockingDiagnostics.length > 0) {
		return {
			state: "blocked_by_context",
			blocking: [
				...contextBlockingDiagnostics.map(diagnosticSummary),
				...scopeDriftGaps,
			],
			warnings,
			nextAction:
				"Resolve or explicitly account for the context diagnostics before relying on the next workflow phase.",
		};
	}

	if (scopeDriftGaps.length > 0) {
		return {
			state: "blocked_by_context",
			blocking: scopeDriftGaps,
			warnings,
			nextAction:
				"Resolve changed artifacts outside planned targets or review scope before relying on the next workflow phase.",
		};
	}

	if (validationBlockingGaps.length > 0) {
		return {
			state: "blocked_by_validation",
			blocking: validationBlockingGaps,
			warnings,
			nextAction:
				"Run and record validation that covers the changed artifacts before review or completion claims.",
		};
	}

	if (reviewBlockingGaps.length > 0) {
		return {
			state: "blocked_by_review",
			blocking: reviewBlockingGaps,
			warnings,
			nextAction:
				"Run the read-only review lane and record the missing reviewer evidence.",
		};
	}

	if (session.status === "completed") {
		return {
			state: "release_ready",
			blocking: [],
			warnings,
			nextAction:
				"Use final review, validation evidence, and release hygiene checks to decide whether to cut a release.",
		};
	}

	if (!session.plan || session.approval === "pending") {
		return {
			state: "planning_ready",
			blocking: [],
			warnings,
			nextAction:
				"Finish the plan, including repo profile, inspected references, feature targets, review scope, and verification.",
		};
	}

	const allFeaturesComplete =
		features.length > 0 &&
		features.every((feature) => feature.status === "completed");
	if (allFeaturesComplete) {
		return {
			state: "final_review_ready",
			blocking: [],
			warnings,
			nextAction:
				"Run final review against planned scope, changed artifacts, validation evidence, and remaining gaps.",
		};
	}

	const activeTraceability = traceability.features.find(
		(feature) => feature.id === session.execution.activeFeatureId,
	);
	if (
		activeTraceability &&
		activeTraceability.validationCommands.length > 0 &&
		activeTraceability.featureReviewStatus !== "passed"
	) {
		return {
			state: "feature_review_ready",
			blocking: [],
			warnings,
			nextAction:
				"Review the active feature against planned targets, changed artifacts, and validation evidence.",
		};
	}

	return {
		state: "execution_ready",
		blocking: [],
		warnings,
		nextAction:
			"Continue the approved plan one feature at a time and keep validation and review evidence aligned with scope.",
	};
}
