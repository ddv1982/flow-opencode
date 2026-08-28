import type {
	RetainedScenarioEvidence,
	ScenarioGradeInput,
} from "./grader-input.js";
import { askedQuestions } from "./harness.js";
import {
	completionHonesty,
	type MetricSession,
	reviewerActivity,
} from "./metrics.js";
import { instructionDelivery } from "./provenance.js";
import type {
	ActorIdentity,
	AttemptRecordV2,
	InstructionDelivery,
} from "./report.js";

export function retainedReportActors(
	evidence: RetainedScenarioEvidence,
): ActorIdentity[] {
	return evidence.actors.map((actor) => ({
		role: actor.role,
		requestedModel: actor.requestedModel,
		actualModel:
			actor.actualModel.kind === "observed"
				? {
						kind: "unobserved" as const,
						reason: `Host observed providerID=${actor.actualModel.value.providerID} modelID=${actor.actualModel.value.modelID}; full family, gateway, and revision identity is unavailable.`,
					}
				: actor.actualModel,
		sessionIds: [...actor.sessionIds],
	}));
}

export function retainedInstructions(
	evidence: RetainedScenarioEvidence,
): InstructionDelivery[] {
	return evidence.guidanceLoads.map((load) =>
		instructionDelivery({
			source: "guidance",
			name: load.id ?? "unknown-guidance",
			sequence: load.sequence,
			text: load.rawOutput,
		}),
	);
}

export function deriveConformanceOutcome(input: {
	readonly evidence: RetainedScenarioEvidence;
	readonly check: (gradeInput: ScenarioGradeInput) => readonly string[];
	readonly scenarioId: string;
	readonly model: string;
	readonly attempt: number;
}): Extract<AttemptRecordV2["outcome"], { kind: "product" }> {
	const issues = [...input.check(input.evidence.gradeInput)];
	const documents = [
		...(input.evidence.gradeInput.session
			? [input.evidence.gradeInput.session]
			: []),
		...input.evidence.gradeInput.archives,
	] as MetricSession[];
	return {
		kind: "product",
		passed: issues.length === 0,
		endedBy:
			askedQuestions(input.evidence.gradeInput).length > 0
				? "user-escalation"
				: "quiet",
		issues: issues.length > 0 ? issues : [],
		evidence: {
			kind: "conformance",
			falseCompletion: completionHonesty(
				documents.find((document) => document.closure) ?? null,
			).falseCompletion,
			unsubmittedReviews: reviewerActivity(documents).unsubmitted,
			facts: {
				scenario: input.scenarioId,
				model: input.model,
				attempt: input.attempt,
				flowCalls: input.evidence.gradeInput.flowCalls.length,
				guidanceLoads: input.evidence.guidanceLoads.length,
			},
		},
	};
}
