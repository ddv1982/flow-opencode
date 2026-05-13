import { finalReviewPolicyForPlan, summarizeCompletion } from "./domain";
import type { ReviewerDecision, Session } from "./schema";
import {
	compactEvidence,
	type TaskProgressRow,
} from "./summary-task-progress-model";

export function latestFailedAttemptRow(
	session: Session,
): TaskProgressRow | null {
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

export function validationRow(session: Session): TaskProgressRow | null {
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

export function reviewerRow(session: Session): TaskProgressRow | null {
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

export function pendingFinalReviewRow(
	session: Session,
): TaskProgressRow | null {
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
