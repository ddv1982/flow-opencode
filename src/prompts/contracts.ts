// Flow prompt-expression source: runtime policy, transitions, and schema remain the normative owner of workflow semantics.
// Keep these contracts aligned with runtime invariants; do not introduce conflicting policy here.

import type { SemanticInvariantId } from "../runtime/domain/semantic-invariants";

export const FLOW_CONTRACT_INVARIANT_IDS = [
	"completion.gates.required_order",
	"completion.policy.min_completed_features",
	"review.scope.payload_binding",
] as const satisfies readonly SemanticInvariantId[];

export const FLOW_PLAN_CONTRACT = `Persist a plan with:

- summary: string
- overview: string
- requirements: string[]
- architectureDecisions: string[]
- features: { id, title, summary, priority?: critical | important | nice_to_have, deferCandidate?: boolean, fileTargets: string[], verification: string[], dependsOn?: string[], blockedBy?: string[] }[]
- goalMode?: implementation | review | review_and_fix
- decompositionPolicy?: atomic_feature | iterative_refinement | open_ended
- completionPolicy?: { minCompletedFeatures?: number }
- deliveryPolicy?: { priorityMode?: strict_scope | balanced | quality_first, stopRule?: ship_when_clean | ship_when_core_done | ship_when_threshold_met, deferAllowed?: boolean }
- notes?: string[]

Optional planning context (record this separately via flow_plan_context_record or flow_plan_apply({ plan, planning: ... }), not inside plan):
- repoProfile?: string[]
- packageManager?: npm | pnpm | yarn | bun
- research?: string[]
- implementationApproach?: { chosenDirection: string, keyConstraints: string[], validationSignals: string[], sources: string[] }
- decisionLog?: { question: string, decisionMode?: autonomous_choice | recommend_confirm | human_required, decisionDomain?: architecture | product | quality | scope | delivery, options: { label: string, tradeoffs: string[] }[], recommendation: string, rationale: string[] }[]`;

export const FLOW_WORKER_CONTRACT = `Return exactly one JSON object that matches the worker result payload below, with no markdown fences, commentary, or trailing text:

- contractVersion: "1"
- status: ok | needs_input
- summary: string
- artifactsChanged: { path, kind? }[]
- validationRun: { command, status: passed | failed | failed_existing | partial, summary }[]
- decisions: { summary }[]
- nextStep: string
- reviewIterations?: number
- validationScope?: targeted | broad
- outcome?: { kind, category?, summary?, resolutionHint?, retryable?, autoResolvable?, needsHuman?, replanReason?, failedAssumption?, recommendedAdjustment? }
- featureResult: { featureId, verificationStatus?: passed | partial | failed | not_recorded, notes?: { note }[], followUps?: { summary, severity? }[] }
- featureReview: { status: passed | failed | needs_followup, summary, blockingFindings: { summary }[] }
- finalReview?: same shape as featureReview

Status rules:
- if status is ok, outcome must be omitted or use kind: completed
- if status is needs_input, outcome.kind must be replan_required | blocked_external | needs_operator_input | contract_error
- if outcome.kind is replan_required, include replanReason, failedAssumption, and recommendedAdjustment
- never return status: ok with a non-completion outcome
- never return status: ok until targeted validation is complete and featureReview has no blocking findings
- when the active feature is the final completion path for the session, run broad validation, include finalReview, and use validationScope: broad
- treat the active feature as the final completion path whenever completing it would satisfy the session completion policy, including completionPolicy.minCompletedFeatures even if other plan features remain pending`;

export const FLOW_REVIEWER_CONTRACT = `Return exactly one JSON object that matches the reviewer result payload below, with no markdown fences, commentary, or trailing text:

- scope: feature | final
- featureId?: string
- reviewPurpose?: execution_gate | completion_gate
- status: approved | needs_fix | blocked
- summary: string
- blockingFindings: { summary }[]
- followUps?: { summary, severity? }[]
- suggestedValidation?: string[]

Reviewer rules:
- return approved only when the current feature is clean enough to advance
- return needs_fix when implementation should continue on the same feature
- return blocked only for real external blockers or required human decisions
- for scope: feature, include the active featureId and use reviewPurpose execution_gate
- for scope: final, use reviewPurpose completion_gate
- do not implement fixes yourself; only review and report findings`;
