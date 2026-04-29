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

export const FLOW_AUDIT_CONTRACT = `Return exactly one JSON object that matches the audit report payload below, with no markdown fences, commentary, or trailing text:

- requestedDepth: broad_audit | deep_audit | full_audit
- achievedDepth: broad_audit | deep_audit | full_audit
- repoSummary: string
- overallVerdict: string
- discoveredSurfaces: { name: string, category: source_runtime | tests | ci_release | docs_config | tooling | other, reviewStatus: directly_reviewed | spot_checked | unreviewed, evidence?: string[], reason?: string }[]
- coverageSummary: { discoveredSurfaceCount: number, reviewedSurfaceCount: number, unreviewedSurfaceCount: number, notes?: string[] }
- reviewedSurfaces: { name: string, evidence: string[] }[]
- unreviewedSurfaces: { name: string, reason: string }[]
- coverageRubric: { fullAuditEligible: boolean, directlyReviewedCategories: string[], spotCheckedCategories: string[], unreviewedCategories: string[], blockingReasons: string[] }
- validationRun: { command: string, status: passed | failed | partial | not_run, summary: string }[]
- findings: { title: string, category: confirmed_defect | likely_risk | hardening_opportunity | process_gap, confidence: confirmed | likely | speculative, severity?: high | medium | low, evidence: string[], impact: string, remediation?: string }[]
- nextSteps?: string[]

Audit rules:
- treat requestedDepth as the user's requested review strength, but set achievedDepth from actual evidence gathered
- discoveredSurfaces is the canonical coverage ledger; reviewedSurfaces, unreviewedSurfaces, coverageSummary, and coverageRubric must be derivable from it without contradiction
- achievedDepth can be full_audit only when every major surface discovered during repo mapping is directly reviewed, every discovered surface is represented in discoveredSurfaces, and coverageRubric.fullAuditEligible is true
- if any major surface remains unreviewed, spot-checked only, or intentionally skipped, do not use achievedDepth: full_audit
- use category confirmed_defect only for directly supported defects; use likely_risk or hardening_opportunity when the finding is partially inferred or advisory
- use confidence confirmed only when the cited evidence directly supports the conclusion
- keep process/reporting issues in process_gap instead of mixing them into product defects
- when no validation was run, include an explicit validationRun entry with status: not_run and explain why
- when persisting an audit artifact through flow_audit_write_report, Flow recomputes the coverage sections from discoveredSurfaces and rejects unsupported full_audit claims

Output examples:

${renderExampleBlocks([
	{
		name: "downgraded-full-audit",
		body: `{"requestedDepth":"full_audit","achievedDepth":"deep_audit","repoSummary":"Mapped prompt/config and prompt-eval surfaces directly, but did not finish all discovered repo surfaces.","overallVerdict":"Useful deep audit with one confirmed defect and a documented coverage downgrade.","coverageSummary":{"discoveredSurfaceCount":2,"reviewedSurfaceCount":1,"unreviewedSurfaceCount":1,"notes":["Command/config surfaces were reviewed directly; runtime smoke paths were not fully inspected."]},"reviewedSurfaces":[{"name":"prompt/config wiring","evidence":["src/config.ts:1-126","src/prompts/commands.ts:1-215"]}],"unreviewedSurfaces":[{"name":"runtime smoke coverage","reason":"The audit stayed read-only and did not inspect every runtime-oriented test surface."}],"validationRun":[{"command":"bun run check","status":"not_run","summary":"The audit surface is read-only, so no shell validation was executed directly."}],"findings":[{"title":"Audit claims can overstate coverage when reviewed surfaces are not enumerated explicitly.","category":"confirmed_defect","confidence":"confirmed","severity":"high","evidence":["src/prompts/contracts.ts:59-90"],"impact":"A report can sound more exhaustive than the actual inspection that was performed.","remediation":"Keep coverage counts aligned with the listed reviewed and unreviewed surfaces."}],"nextSteps":["Fix confirmed defects first.","Run a follow-up full_audit only after every discovered major surface is directly reviewed."]}`,
	},
	{
		name: "broad-audit-hygiene",
		body: `{"requestedDepth":"broad_audit","achievedDepth":"broad_audit","repoSummary":"Quick audit sweep across the command and documentation surfaces.","overallVerdict":"No confirmed product defects, but there is a process gap worth fixing.","coverageSummary":{"discoveredSurfaceCount":1,"reviewedSurfaceCount":1,"unreviewedSurfaceCount":0},"reviewedSurfaces":[{"name":"release-process documentation parity","evidence":["docs/development.md:47-61",".github/workflows/ci.yml:92-104"]}],"unreviewedSurfaces":[],"validationRun":[{"command":"bun run check","status":"not_run","summary":"No shell validation was executed directly from this read-only audit surface."}],"findings":[{"title":"Documentation can drift from the actual CI validation path.","category":"process_gap","confidence":"confirmed","severity":"medium","evidence":["docs/development.md:47-61",".github/workflows/ci.yml:92-104"],"impact":"Operators can get the wrong impression about which checks currently gate CI.","remediation":"Keep maintainer docs aligned with the real workflow files."}]}`,
	},
])}`;
