import { activeDecisionGate } from "./domain";
import type { Feature, Session } from "./schema";
import {
	compactEvidence,
	type OperatorLike,
	runtimeProjectionHandoffFields,
	type TaskProgressRow,
} from "./summary-task-progress-model";
import {
	latestFailedAttemptRow,
	pendingFinalReviewRow,
	reviewerRow,
	validationRow,
} from "./summary-task-progress-review";

export type { TaskProgressRow } from "./summary-task-progress-model";

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
		...runtimeProjectionHandoffFields(),
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
		...runtimeProjectionHandoffFields(),
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
