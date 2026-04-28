// Flow prompt-expression source: runtime policy, transitions, and schema remain the normative owner of workflow semantics.
// Keep these contracts aligned with runtime invariants; do not introduce conflicting policy here.

import type { SemanticInvariantId } from "../runtime/domain/semantic-invariants";
import { renderExampleBlocks } from "./format";

export const FLOW_CONTRACT_INVARIANT_IDS = [
	"completion.gates.required_order",
	"completion.policy.min_completed_features",
	"review.scope.payload_binding",
] as const satisfies readonly SemanticInvariantId[];

const FLOW_PLAN_CONTRACT_BASE = `Persist a plan with:

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

Record planning context separately via flow_plan_context_record or flow_plan_apply({ plan, planning: ... }) when needed — not inside \`plan\`.
- planning.repoProfile?: string[]
- planning.packageManager?: npm | pnpm | yarn | bun
- planning.packageManagerAmbiguous?: true when package-manager evidence conflicts and Flow should avoid guessing
- planning.research?: string[]
- planning.implementationApproach?: { chosenDirection: string, keyConstraints: string[], validationSignals: string[], sources: string[] }
- planning.decisionLog?: { question: string, decisionMode?: autonomous_choice | recommend_confirm | human_required, decisionDomain?: architecture | product | quality | scope | delivery, options: { label: string, tradeoffs: string[] }[], recommendation: string, rationale: string[] }[]`;

export const FLOW_PLAN_CONTRACT = `${FLOW_PLAN_CONTRACT_BASE}

Output examples:

${renderExampleBlocks([
	{
		name: "plan-payload",
		body: `summary: "Stabilize Flow prompt quality improvements"
overview: "Refactor prompt surfaces, add examples, and add prompt-quality tests."
features:
- id: "refactor-prompt-surface"
  fileTargets: ["src/prompts/*", "tests/config.test.ts"]
  verification: ["bun test tests/config.test.ts"]`,
	},
	{
		name: "planning-context-payload",
		body: `{"packageManagerAmbiguous":true,"research":["Repo contains multiple lockfile families; prefer existing package.json scripts until ambiguity is resolved."]}`,
	},
])}`;

export const FLOW_PLAN_CONTRACT_COMPACT = FLOW_PLAN_CONTRACT_BASE;

const FLOW_WORKER_CONTRACT_BASE = `Return exactly one JSON object that matches the worker result payload below, with no markdown fences, commentary, or trailing text:

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

export const FLOW_WORKER_CONTRACT = `${FLOW_WORKER_CONTRACT_BASE}

Output examples:

${renderExampleBlocks([
	{
		name: "ok-completed",
		body: `{"contractVersion":"1","status":"ok","summary":"Completed feature safely.","artifactsChanged":[{"path":"src/prompts/agents.ts"}],"validationRun":[{"command":"bun test tests/config.test.ts","status":"passed","summary":"Prompt contract checks passed."}],"decisions":[{"summary":"Kept runtime-owned semantics unchanged."}],"nextStep":"Ask flow-reviewer to confirm the next feature or final completion path.","reviewIterations":1,"validationScope":"targeted","featureResult":{"featureId":"improve-prompts","verificationStatus":"passed"},"featureReview":{"status":"passed","summary":"No blocking findings.","blockingFindings":[]},"outcome":{"kind":"completed"}}`,
	},
	{
		name: "needs-input-replan",
		body: `{"contractVersion":"1","status":"needs_input","summary":"Feature is still too broad for one safe execution pass.","artifactsChanged":[],"validationRun":[],"decisions":[{"summary":"A smaller feature split is required before editing."}],"nextStep":"Refresh the plan with smaller executable features.","outcome":{"kind":"replan_required","replanReason":"Feature mixes prompt refactor, tool-hook changes, and eval harness rollout.","failedAssumption":"The active feature was atomic enough to execute safely.","recommendedAdjustment":"Split prompt refactor and eval harness work into separate features."},"featureResult":{"featureId":"improve-prompts"},"featureReview":{"status":"needs_followup","summary":"Execution should not advance yet.","blockingFindings":[{"summary":"Scope is too broad for a single worker pass."}]}}`,
	},
])}`;

export const FLOW_WORKER_CONTRACT_COMPACT = FLOW_WORKER_CONTRACT_BASE;

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
- do not implement fixes yourself; only review and report findings

Output examples:

${renderExampleBlocks([
	{
		name: "feature-approved",
		body: `{"scope":"feature","featureId":"improve-prompts","reviewPurpose":"execution_gate","status":"approved","summary":"Prompt changes are internally consistent and validation is sufficient.","blockingFindings":[]}`,
	},
	{
		name: "feature-needs-fix",
		body: `{"scope":"feature","featureId":"improve-prompts","reviewPurpose":"execution_gate","status":"needs_fix","summary":"The worker output is missing required validation evidence.","blockingFindings":[{"summary":"No targeted validation command was recorded."}],"suggestedValidation":["bun test tests/config.test.ts"]}`,
	},
])}`;
