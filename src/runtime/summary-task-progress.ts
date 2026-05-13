import {
	activeDecisionGate,
	finalReviewPolicyForPlan,
	summarizeCompletion,
} from "./domain";
import type { FeatureDocDrilldownTarget } from "./feature-doc-drilldown";
import type { Feature, ReviewerDecision, Session } from "./schema";

export type TaskProgressRow = {
	id: string;
	phase:
		| "planning"
		| "execution"
		| "validation"
		| "review"
		| "final_review"
		| "recovery"
		| "session";
	ownerRole:
		| "flow-auto"
		| "flow-planner"
		| "flow-planning-researcher"
		| "flow-worker"
		| "flow-reviewer"
		| "flow-runtime";
	subject: string;
	status:
		| "pending"
		| "active"
		| "blocked"
		| "needs_fix"
		| "needs_input"
		| "completed"
		| "ready";
	featureId?: string;
	featureDrilldown?: FeatureDocDrilldownTarget;
	evidence: string[];
	blocker: string | null;
	next: string;
	source:
		| "planning"
		| "plan"
		| "execution"
		| "validation"
		| "reviewer_decision"
		| "operator";
};

type OperatorLike = {
	phase: string;
	nextStep: string;
	blocker: string | null;
};

function inlineText(value: string): string {
	return value.replace(/\r?\n+/g, " / ").trim();
}

function compactEvidence(items: Array<string | null | undefined>): string[] {
	return items.filter((item): item is string => Boolean(item)).map(inlineText);
}

function latestFailedAttemptRow(session: Session): TaskProgressRow | null {
	const failure = session.execution.lastFailedMutation;
	if (!failure || session.status === "completed") {
		return null;
	}
	return {
		id: `failed:${failure.tool}:${failure.failureCategory}`,
		phase: failure.phase,
		ownerRole: "flow-runtime",
		subject: `Latest failed attempt: ${failure.tool}`,
		status: "blocked",
		evidence: compactEvidence([
			`category: ${failure.failureCategory}`,
			failure.sameCategoryFailureCount
				? `same-category attempts: ${failure.sameCategoryFailureCount}`
				: null,
			failure.summary,
		]),
		blocker: failure.summary,
		next:
			failure.recoveryHint ??
			"Inspect the failed tool JSON recovery details before retrying.",
		source: "operator",
	};
}

function projectFeatureStatus(
	status: Feature["status"],
): TaskProgressRow["status"] {
	switch (status) {
		case "in_progress":
			return "active";
		case "blocked":
			return "blocked";
		case "completed":
			return "completed";
		case "pending":
			return "pending";
	}
}

function projectReviewerStatus(
	status: ReviewerDecision["status"],
): TaskProgressRow["status"] {
	switch (status) {
		case "approved":
			return "completed";
		case "needs_fix":
			return "needs_fix";
		case "blocked":
			return "blocked";
	}
}

function projectValidationStatus(
	validationRun: Session["execution"]["lastValidationRun"],
): TaskProgressRow["status"] {
	if (validationRun.every((item) => item.status === "passed")) {
		return "completed";
	}
	if (
		validationRun.some(
			(item) => item.status === "failed" || item.status === "failed_existing",
		)
	) {
		return "blocked";
	}
	return "needs_input";
}

function planningEvidence(session: Session): string[] {
	const plan = session.plan;
	return compactEvidence([
		plan ? `features: ${plan.features.length}` : null,
		session.planning.research.length > 0
			? `research: ${session.planning.research.length}`
			: null,
		session.planning.decisionLog.length > 0
			? `decisions: ${session.planning.decisionLog.length}`
			: null,
		session.planning.evidencePackets
			? `evidence packets: ${session.planning.evidencePackets.length}`
			: null,
	]);
}

function planningRow(
	session: Session,
	operator?: OperatorLike,
): TaskProgressRow | null {
	if (session.status !== "planning" && !session.plan) {
		return null;
	}

	const decisionGate = activeDecisionGate(session);
	const hasPlan = Boolean(session.plan);
	const status: TaskProgressRow["status"] = decisionGate
		? "needs_input"
		: hasPlan && session.approval === "approved"
			? "completed"
			: hasPlan
				? "ready"
				: "active";

	return {
		id: "planning",
		phase: "planning",
		ownerRole: "flow-planner",
		subject: "Planning",
		status,
		evidence: planningEvidence(session),
		blocker:
			decisionGate?.question ??
			(operator?.phase === "planning" ? operator.blocker : null),
		next:
			status === "completed"
				? "Plan is approved; no planning action needed."
				: (decisionGate?.recommendation ??
					operator?.nextStep ??
					(hasPlan
						? "Review or approve the draft plan."
						: "Create a draft plan.")),
		source: hasPlan ? "plan" : "planning",
	};
}

function featureRow(
	session: Session,
	feature: Feature,
	operator?: OperatorLike,
): TaskProgressRow {
	const isActive = session.execution.activeFeatureId === feature.id;
	const hasLastResultForFeature =
		session.execution.lastFeatureResult?.featureId === feature.id;
	const hasLastFeatureRecord = session.execution.lastFeatureId === feature.id;
	const hasLastExecutionForFeature =
		hasLastFeatureRecord || hasLastResultForFeature;
	const outcome = hasLastFeatureRecord ? session.execution.lastOutcome : null;
	const featureResult = hasLastResultForFeature
		? session.execution.lastFeatureResult
		: null;
	const reviewerDecision =
		session.execution.lastReviewerDecision?.scope === "feature" &&
		session.execution.lastReviewerDecision.featureId === feature.id
			? session.execution.lastReviewerDecision
			: null;
	const evidence = compactEvidence([
		`file targets: ${feature.fileTargets.length}`,
		`verification: ${feature.verification.length}`,
		hasLastExecutionForFeature
			? `validation: ${session.execution.lastValidationRun.length}`
			: null,
		outcome ? `outcome: ${outcome.kind}` : null,
		featureResult?.verificationStatus
			? `verification status: ${featureResult.verificationStatus}`
			: null,
		reviewerDecision ? `review: ${reviewerDecision.status}` : null,
	]);

	return {
		id: `feature:${feature.id}`,
		phase: "execution",
		ownerRole: "flow-worker",
		subject: `${feature.id} — ${feature.title}`,
		status: projectFeatureStatus(feature.status),
		featureId: feature.id,
		evidence,
		blocker:
			feature.status === "blocked"
				? (outcome?.summary ??
					reviewerDecision?.summary ??
					session.execution.lastSummary ??
					"Feature is blocked.")
				: null,
		next: isActive
			? (operator?.nextStep ?? "Continue the active feature.")
			: feature.status === "blocked"
				? (session.execution.lastNextStep ??
					outcome?.resolutionHint ??
					"Resolve the blocker before retrying this feature.")
				: feature.status === "completed"
					? "No action needed."
					: "Waiting for execution selection.",
		source: "execution",
	};
}

function validationRow(session: Session): TaskProgressRow | null {
	const validationRun = session.execution.lastValidationRun;
	if (validationRun.length === 0) {
		return null;
	}

	const featureId =
		session.execution.lastFeatureResult?.featureId ??
		session.execution.lastFeatureId ??
		undefined;
	const status = projectValidationStatus(validationRun);
	return {
		id: `validation:${featureId ?? "session"}`,
		phase: "validation",
		ownerRole: "flow-worker",
		subject: `Validation for ${featureId ?? "session"}`,
		status,
		...(featureId ? { featureId } : {}),
		evidence: validationRun.map(
			(item) => `${item.status}: ${item.command} — ${item.summary}`,
		),
		blocker:
			status === "blocked"
				? (validationRun.find((item) => item.status !== "passed")?.summary ??
					"Validation did not pass.")
				: null,
		next:
			status === "completed"
				? "Validation is complete; continue review or completion."
				: "Fix validation findings, then rerun validation.",
		source: "validation",
	};
}

function reviewerRow(session: Session): TaskProgressRow | null {
	const decision = session.execution.lastReviewerDecision;
	if (!decision) {
		return null;
	}

	const status = projectReviewerStatus(decision.status);
	const isFinal = decision.scope === "final";
	return {
		id: isFinal ? "review:final" : `review:${decision.featureId}`,
		phase: isFinal ? "final_review" : "review",
		ownerRole: "flow-reviewer",
		subject: isFinal
			? "Final session review"
			: `Feature review: ${decision.featureId}`,
		status,
		...(isFinal ? {} : { featureId: decision.featureId }),
		evidence: compactEvidence([
			`decision: ${decision.status}`,
			decision.reviewPurpose ? `purpose: ${decision.reviewPurpose}` : null,
			isFinal && decision.reviewDepth
				? `review depth: ${decision.reviewDepth}`
				: null,
			isFinal && decision.reviewedSurfaces
				? `reviewed surfaces: ${decision.reviewedSurfaces.length}`
				: null,
			decision.evidencePackets
				? `evidence packets: ${decision.evidencePackets.length}`
				: null,
			decision.summary,
		]),
		blocker: status === "completed" ? null : decision.summary,
		next:
			status === "completed"
				? "Review is complete; continue the next runtime step."
				: "Address reviewer findings before continuing.",
		source: "reviewer_decision",
	};
}

function pendingFinalReviewRow(session: Session): TaskProgressRow | null {
	if (!session.plan) {
		return null;
	}
	const completion = summarizeCompletion(session);
	const hasFinalDecision =
		session.execution.lastReviewerDecision?.scope === "final";
	if (!completion?.activeFeatureTriggersSessionCompletion || hasFinalDecision) {
		return null;
	}

	const policy = finalReviewPolicyForPlan(session.plan);
	return {
		id: "review:final:pending",
		phase: "final_review",
		ownerRole: "flow-reviewer",
		subject: `Final ${policy} review`,
		status: "pending",
		evidence: compactEvidence([
			`completion target: ${completion.targetCompletedFeatures}/${completion.totalFeatures} features`,
		]),
		blocker: null,
		next: `Run broad validation and record the ${policy} final review.`,
		source: "operator",
	};
}

export function projectTaskProgress(
	session: Session,
	operator?: OperatorLike,
): TaskProgressRow[] {
	return [
		planningRow(session, operator),
		...(session.plan?.features ?? []).map((feature) =>
			featureRow(session, feature, operator),
		),
		validationRow(session),
		latestFailedAttemptRow(session),
		reviewerRow(session),
		pendingFinalReviewRow(session),
	].filter((row): row is TaskProgressRow => Boolean(row));
}
