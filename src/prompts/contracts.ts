// Flow prompt-expression source: runtime policy, transitions, and schema remain the normative owner of workflow semantics.
// Keep these contracts aligned with runtime invariants; do not introduce conflicting policy here.

import type { SemanticInvariantId } from "../runtime/domain/semantic-invariants";
import { COMPLETION_GATE_PROMPT_GUIDANCE } from "../runtime/transitions/completion-gate-projections.generated";
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
- features: { id, title, summary, priority?: critical | important | nice_to_have, deferCandidate?: boolean, fileTargets: string[], reviewScope?: { id: string, kind: file | glob | domain | surface | workflow | custom, target: string, description?: string }[], verification: string[], dependsOn?: string[], blockedBy?: string[] }[]
- goalMode?: implementation | review | review_and_fix
- decompositionPolicy?: atomic_feature | iterative_refinement | open_ended
- completionPolicy?: { minCompletedFeatures?: number }
- deliveryPolicy?: { priorityMode?: strict_scope | balanced | quality_first, stopRule?: ship_when_clean | ship_when_core_done | ship_when_threshold_met, deferAllowed?: boolean, finalReviewPolicy?: broad | detailed, strictReview?: true }
- notes?: string[]

Plan rules:
- review/review_and_fix plans must declare review scope through reviewScope or fileTargets for every target/domain the runtime must account.
- reviewScope adds domain/surface targets; it does not narrow or replace fileTargets unless fileTargets are intentionally omitted.
- Use goalMode: review_and_fix only when concrete findings already exist and are recorded in planning.reviewFindings; broad review-and-fix/codebase-review goals with no findings must start as goalMode: review for audit/discovery, then replan review_and_fix after findings are recorded.
- Match deliveryPolicy.finalReviewPolicy to implementation risk: choose broad for one localized implementation file or small DOM/CSS/accessibility tweaks with direct validation and no state/lifecycle/async/persistence/release/tooling/schema risk; choose detailed for actual multi-domain source behavior changes, runtime transitions, persistence/recovery, adapter/tool schemas, release automation, prompt/runtime semantic contracts, review/review_and_fix work, or explicit high-assurance implementation.
- Set deliveryPolicy.strictReview true only for explicit high-assurance implementation or review/review_and_fix strict governance, and include a rationale in decisions/notes; priorityMode: strict_scope alone is scope discipline and does not imply strictReview.

Record planning context separately via flow_plan_context_record or flow_plan_apply({ plan, planning: ... }) when needed — not inside \`plan\`.
- planning.repoProfile?: string[]
- planning.packageManager?: npm | pnpm | yarn | bun
- planning.packageManagerAmbiguous?: true when package-manager evidence conflicts and Flow should avoid guessing
- planning.stackProfile?: { languages: { name, evidenceRefs, confidence }[], frameworks: { name, evidenceRefs, confidence }[], runtimes: { name, evidenceRefs, confidence }[], packageManagers: { name, evidenceRefs, confidence }[], tools: { name, evidenceRefs, confidence }[] }
- planning.standardsProfile?: { localGuidelines: { title, sourceType, reference, confidence }[], externalGuidance: { title, sourceType, reference, confidence }[], rules: { summary, sourceRefs, priority }[], gaps: { stackItem, reason, suggestedResearch }[], precedence: string[] }
- planning.research?: string[]
- planning.implementationApproach?: { chosenDirection: string, keyConstraints: string[], validationSignals: string[], sources: string[] }
- planning.decisionLog?: { question: string, decisionMode?: autonomous_choice | recommend_confirm | human_required, decisionDomain?: architecture | product | quality | scope | delivery, options: { label: string, tradeoffs: string[] }[], recommendation: string, rationale: string[] }[]
- planning.reviewFindings?: { findingRef: string, summary: string, sourceRefs: string[] }[] — concrete existing findings from a user-provided finding, audit report, issue, failing test, or prior review ledger; sourceRefs must be non-empty concrete refs. Missing/empty means no remediation findings are known yet.
- planning.evidencePackets?: { id: string, purpose?: planning | review | audit | validation | general, contextLane?: planning | auto_planning | execution | review | status | history | session | reset | doctor | control, summary: string, sourceRefs?: string[], highlights?: string[], selectedContext?: string[], excludedContext?: string[], codemapSummaries?: string[], sliceSummaries?: string[], relationshipHypotheses?: string[], ambiguities?: string[], knownExclusions?: string[], alreadyCoveredFindings?: string[], validationEvidence?: { command, status, summary }[] }[]`;

export const FLOW_PLAN_CONTRACT = `${FLOW_PLAN_CONTRACT_BASE}

Output examples:

${renderExampleBlocks([
	{
		name: "plan-payload",
		body: `summary: "Stabilize Flow prompt quality improvements"
overview: "Refactor prompt surfaces, add examples, and add prompt-quality tests."
features:
- id: "refactor-prompt-surface"
  fileTargets: ["src/prompts/*", "tests/config/prompt-contracts.test.ts"]
  verification: ["bun test tests/config/prompt-contracts.test.ts"]`,
	},
	{
		name: "planning-context-payload",
		body: `{"packageManagerAmbiguous":true,"research":["Repo contains multiple lockfile families; prefer existing package.json scripts until ambiguity is resolved."]}`,
	},
])}`;

const FLOW_WORKER_CONTRACT_BASE = `Return exactly one JSON object that matches the worker result payload below, with no markdown fences, commentary, or trailing text:

- contractVersion: "1"
- status: ok | needs_input
- summary: string
- artifactsChanged: { path, kind? }[]
- validationRun: { command, status: passed | failed | failed_existing | partial, summary }[]
- decisions: { summary }[]
- reviewFindingClosures?: { findingRef, status: closed | partially_closed | not_closed | blocked, fixRefs: string[], testRefs: string[], validationRefs: string[], residualRisk }[]
- reviewScopeLedger?: { scopeId: string, status: reviewed_no_findings | finding_closed | deferred | out_of_scope | blocked, evidenceRefs: string[], findingRefs?: string[], validationRefs?: string[], residualRisk: string, rationale?: string }[]
- evidencePackets?: immutable compact evidence/context packet reference[]
- nextStep: string
- reviewIterations?: number
- validationScope?: targeted | broad
- outcome?: { kind, category?, summary?, resolutionHint?, retryable?, autoResolvable?, needsHuman?, replanReason?, failedAssumption?, recommendedAdjustment? }
- featureResult: { featureId, verificationStatus?: passed | partial | failed | not_recorded, notes?: { note }[], followUps?: { summary, severity? }[] }
- featureReview: { status: passed | failed | needs_followup, summary, blockingFindings: { summary }[] }
- finalReview?: { status: passed | failed | needs_followup, reviewDepth: broad | detailed, reviewedSurfaces?: changed_files | integration_points | shared_surfaces | validation_evidence | tests | operator_surfaces | docs_and_prompts | tooling_and_config | release_surface [], evidenceSummary?: string, validationAssessment?: string, evidenceRefs: { changedArtifacts: string[], validationCommands: string[] }, evidencePackets?: immutable evidence/context packet[], reviewContextPack?: { task: string, compareBase?: string, changedFiles: string[], includedContext: { path: string, reason: changed_file | imported_dependency | caller | callee | state_owner | lifecycle_owner | architectural_neighbor | test_evidence | validation_evidence, surface?: changed_files | integration_points | shared_surfaces | validation_evidence | tests | operator_surfaces | docs_and_prompts | tooling_and_config | release_surface, summary?: string }[], relationships: { from: string, to: string, kind: string, summary: string }[], validationEvidence: { command: string, status?: string, summary?: string }[], suggestedValidation: string[], coverageGaps: string[], reviewedSurfaces: changed_files | integration_points | shared_surfaces | validation_evidence | tests | operator_surfaces | docs_and_prompts | tooling_and_config | release_surface [] }, integrationChecks?: string[], regressionChecks?: string[], remainingGaps?: string[], suggestedValidation?: string[], behaviorChecks?: { riskClass: async_event_ordering | lifecycle_reentrancy | state_commit_rollback | persistence_recovery | interaction_geometry | accessibility_semantics | test_evidence_authenticity, result: passed | gap_recorded | not_applicable | needs_fix, invariant: string, entrypointRefs: string[], stateOwnerRefs: string[], lifecycleOwnerRefs: string[], failurePath: string, testEvidenceRefs: string[], validationRefs: string[], remainingGap?: string }[], validationCoverage?: { command: string, behaviorClasses: (async_event_ordering | lifecycle_reentrancy | state_commit_rollback | persistence_recovery | interaction_geometry | accessibility_semantics | test_evidence_authenticity)[], proves: string[], gaps: string[], testEvidenceRefs: string[] }[], summary, blockingFindings: { summary }[] }

Status rules:
- if status is ok, outcome must be omitted or use kind: completed
- if status is needs_input, outcome.kind must be replan_required | blocked_external | needs_operator_input | contract_error
- if outcome.kind is replan_required, include replanReason, failedAssumption, and recommendedAdjustment
- never return status: ok with a non-completion outcome
- never return status: ok until targeted validation is complete and featureReview has no blocking findings
- when the active feature is the final completion path for the session, run broad validation, include finalReview from the runtime-owned final review matching deliveryPolicy.finalReviewPolicy, set finalReview.reviewDepth to match deliveryPolicy.finalReviewPolicy, and use validationScope: broad
- finalReview must always include reviewedSurfaces, evidenceSummary, validationAssessment, and evidenceRefs describing what was checked
- changed artifacts are review seeds, not the final review boundary; include connected context and cross-surface behavior coverage required by deliveryPolicy.finalReviewPolicy and the actual risk profile before approval
- when async_event_ordering, lifecycle_reentrancy, state_commit_rollback, or test_evidence_authenticity risks are truly required, include finalReview.behaviorChecks entries with result passed or gap_recorded; omit non-required behavior classes instead of padding not_applicable entries
- when validation is used to justify final review success, map each relied-on command through finalReview.validationCoverage and keep commands aligned with validationRun
- set finalReview.remainingGaps to an empty array only when every truly required behavior class is passed, or each required gap is explicitly recorded in behaviorChecks/validationCoverage with no additional unrecorded gaps
- finalReview.evidenceRefs.changedArtifacts must reference actual artifactsChanged paths, and finalReview.evidenceRefs.validationCommands must reference actual validationRun commands from the current run
- top-level evidencePackets are compact packet references for planning/execution context the worker reused or extended; they do not replace artifactsChanged, validationRun, featureReview, or finalReview evidenceRefs
- finalReview.evidencePackets is optional read-only metadata for selected/excluded context, exact sources, relationship hypotheses, ambiguities, known exclusions, already-covered findings, and validation evidence; do not use it as a substitute for required finalReview.evidenceRefs
- finalReview.reviewedSurfaces must cover the execution-derived required surfaces from the current run, including changed_files when artifactsChanged is non-empty, validation_evidence when validationRun is recorded, and any touched docs/prompt, tooling/config, operator, release, or test surfaces
- when deliveryPolicy.finalReviewPolicy is broad, keep the final review proportional to changed files, validation evidence, and local connected context; when it is detailed, include finalReview.integrationChecks and finalReview.regressionChecks, and make sure reviewedSurfaces covers validation_evidence plus at least one cross-feature surface
- treat the active feature as the final completion path whenever completing it would satisfy the session completion policy, including completionPolicy.minCompletedFeatures even if other plan features remain pending
- for review_and_fix work, include reviewFindingClosures before claiming success; each original finding must have a stable findingRef, status, code fixRefs, testRefs, validationRefs that match validationRun.command values, and residualRisk
- final review_and_fix completion must close every planning.reviewFindings findingRef, including findings closed by earlier completed features
- for review/review_and_fix completion, account for every declared review scope target/domain using reviewScopeLedger entries with exactly one status per scopeId: reviewed_no_findings, finding_closed, deferred, out_of_scope, or blocked
- reviewScopeLedger entries must be evidence-grounded and include evidenceRefs plus truthful residualRisk; use findingRefs/validationRefs when applicable
- when recovery details provide exampleReviewScopeLedger, reassess scope entries; scaffold-only, never replay unchanged
- if a final-review or completion tool returns status: error, do not retry the same payload unchanged; inspect flow_status or recovery details and repair reviewScopeLedger evidenceRefs before retrying
- reviewScopeLedger is runtime scope accounting, not a requirement to edit every declared target file
- do not mark a finding closed unless fixRefs, testRefs, and validationRefs all identify concrete evidence; use status: needs_input with partially_closed, not_closed, or blocked closure entries when evidence is incomplete

Completion gate guidance (descriptor-projected, runtime enforcement remains authoritative):
${COMPLETION_GATE_PROMPT_GUIDANCE}`;

export const FLOW_WORKER_CONTRACT = `${FLOW_WORKER_CONTRACT_BASE}

Output examples:

${renderExampleBlocks([
	{
		name: "ok-completed",
		body: `{"contractVersion":"1","status":"ok","summary":"Completed feature safely.","artifactsChanged":[{"path":"src/prompts/agents.ts"}],"validationRun":[{"command":"bun test tests/config/prompt-contracts.test.ts","status":"passed","summary":"Prompt contract checks passed."}],"decisions":[{"summary":"Kept runtime-owned semantics unchanged."}],"reviewFindingClosures":[{"findingRef":"review: prompt contract omitted validation evidence","status":"closed","fixRefs":["src/prompts/contracts.ts"],"testRefs":["tests/config/prompt-contracts.test.ts"],"validationRefs":["bun test tests/config/prompt-contracts.test.ts"],"residualRisk":"No known residual risk."}],"nextStep":"Ask flow-reviewer to confirm the next feature or final completion path.","reviewIterations":1,"validationScope":"targeted","featureResult":{"featureId":"improve-prompts","verificationStatus":"passed"},"featureReview":{"status":"passed","summary":"No blocking findings.","blockingFindings":[]},"outcome":{"kind":"completed"}}`,
	},
	{
		name: "needs-input-replan",
		body: `{"contractVersion":"1","status":"needs_input","summary":"Feature is still too broad for one safe execution pass.","artifactsChanged":[],"validationRun":[],"decisions":[{"summary":"A smaller feature split is required before editing."}],"nextStep":"Refresh the plan with smaller executable features.","outcome":{"kind":"replan_required","replanReason":"Feature mixes prompt refactor, tool-hook changes, and eval harness rollout.","failedAssumption":"The active feature was atomic enough to execute safely.","recommendedAdjustment":"Split prompt refactor and eval harness work into separate features."},"featureResult":{"featureId":"improve-prompts"},"featureReview":{"status":"needs_followup","summary":"Execution should not advance yet.","blockingFindings":[{"summary":"Scope is too broad for a single worker pass."}]}}`,
	},
])}`;

export const FLOW_REVIEWER_CONTRACT = `Return exactly one JSON object that matches the reviewer result payload below, with no markdown fences, commentary, or trailing text:

- scope: feature | final
- featureId?: string
- reviewPurpose?: execution_gate | completion_gate
- reviewDepth?: broad | detailed
- reviewedSurfaces?: changed_files | integration_points | shared_surfaces | validation_evidence | tests | operator_surfaces | docs_and_prompts | tooling_and_config | release_surface []
- evidenceSummary?: string
- validationAssessment?: string
- evidenceRefs?: { changedArtifacts: string[], validationCommands: string[] }
- evidencePackets?: read-only evidence/context packet references for feature reviews; full evidence/context packets for final reviews
- reviewScopeLedger?: { scopeId: string, status: reviewed_no_findings | finding_closed | deferred | out_of_scope | blocked, evidenceRefs: string[], findingRefs?: string[], validationRefs?: string[], residualRisk: string, rationale?: string }[]
- reviewContextPack?: { task: string, compareBase?: string, changedFiles: string[], includedContext: { path: string, reason: changed_file | imported_dependency | caller | callee | state_owner | lifecycle_owner | architectural_neighbor | test_evidence | validation_evidence, surface?: changed_files | integration_points | shared_surfaces | validation_evidence | tests | operator_surfaces | docs_and_prompts | tooling_and_config | release_surface, summary?: string }[], relationships: { from: string, to: string, kind: string, summary: string }[], validationEvidence: { command: string, status?: string, summary?: string }[], suggestedValidation: string[], coverageGaps: string[], reviewedSurfaces: changed_files | integration_points | shared_surfaces | validation_evidence | tests | operator_surfaces | docs_and_prompts | tooling_and_config | release_surface [] }
- integrationChecks?: string[]
- regressionChecks?: string[]
- remainingGaps?: string[]
- status: approved | needs_fix | blocked
- summary: string
- blockingFindings: { summary }[]
- followUps?: { summary, severity? }[]
- suggestedValidation?: string[]
- behaviorChecks?: { riskClass: async_event_ordering | lifecycle_reentrancy | state_commit_rollback | persistence_recovery | interaction_geometry | accessibility_semantics | test_evidence_authenticity, result: passed | gap_recorded | not_applicable | needs_fix, invariant: string, entrypointRefs: string[], stateOwnerRefs: string[], lifecycleOwnerRefs: string[], failurePath: string, testEvidenceRefs: string[], validationRefs: string[], remainingGap?: string }[]
- validationCoverage?: { command: string, behaviorClasses: (async_event_ordering | lifecycle_reentrancy | state_commit_rollback | persistence_recovery | interaction_geometry | accessibility_semantics | test_evidence_authenticity)[], proves: string[], gaps: string[], testEvidenceRefs: string[] }[]

Reviewer rules:
- return approved only when the current feature is clean enough to advance
- return needs_fix when implementation should continue on the same feature
- return blocked only for real external blockers or required human decisions
- for review-fix work, return needs_fix when the worker omits reviewFindingClosures, omits any original finding from the closure ledger, marks a finding closed without code/test/validation evidence, or cites validation that was not actually recorded
- treat release hygiene as part of maintainability review: return needs_fix if release-bound source or build artifacts contain raw console calls, debugger statements, or undocumented debug-only instrumentation, if an intentional operator/observability signal was deleted without evidence of an equivalent logger, telemetry, or stdout/stderr replacement preserving severity, message intent, and key context, or if a new logging or telemetry dependency was added without explicit approval
- before approving, review the applicable adversarial failure-mode classes for the touched behavior: lifecycle/reentrancy/idempotency, async races/event ordering, persistence failure and recovery, interaction geometry/hit-testing, accessibility semantics/live regions, and test-evidence authenticity
- cite concrete checked paths or gaps in summary, integrationChecks, regressionChecks, blockingFindings, followUps, or suggestedValidation; do not invent findings for classes that are not applicable
- for scope: feature, include the active featureId and use reviewPurpose execution_gate
- for scope: final, use reviewPurpose completion_gate
- for scope: final, include reviewDepth matching deliveryPolicy.finalReviewPolicy
- for scope: final, include reviewedSurfaces, evidenceSummary, validationAssessment, and evidenceRefs describing what was checked
- for scope: final, changed files are required evidence but not the review boundary; include connected context and integration surfaces discovered from changed files, relationships, state/lifecycle ownership, tests, and validation evidence when deliveryPolicy.finalReviewPolicy or the actual risk profile requires them
- for scope: final, when async_event_ordering, lifecycle_reentrancy, state_commit_rollback, or test_evidence_authenticity risks are truly required, include behaviorChecks entries with result passed or gap_recorded; omit non-required behavior classes instead of padding not_applicable entries
- for scope: final, when validation is used to justify success, map each relied-on command through validationCoverage and align commands with recorded validation evidence
- for scope: final, keep remainingGaps empty only when every truly required behavior class is passed, or each required gap is explicitly recorded in behaviorChecks/validationCoverage with no additional unrecorded gaps
- for scope: final, when reviewContextPack is present, keep it grounded: reviewContextPack.changedFiles should map to reviewed changed artifacts, reviewContextPack.includedContext should capture connected context (not duplicate changed files only), and reviewContextPack.reviewedSurfaces should match reviewedSurfaces
- for scope: final, when reviewContextPack.coverageGaps is non-empty, carry those gaps into remainingGaps and include suggestedValidation unless the pack already supplies it
- for scope: final, distinguish directly changed files from connected context in summary/integrationChecks/regressionChecks/remainingGaps, and use remainingGaps to report uncovered product paths, missing or weak test evidences, and validation limits
- for scope: final, set evidenceRefs.changedArtifacts to actual changed artifact paths you reviewed and evidenceRefs.validationCommands to actual validation commands you relied on
- feature-scope evidencePackets are compact packet references; final-scope evidencePackets may include full packet metadata, but neither replaces concrete changed path or validation evidence
- for scope: final, use evidencePackets only as optional read-only context/evidence metadata; do not let packet references replace concrete evidenceRefs
- for scope: final, cover the execution-derived required surfaces from the current run, including changed_files when artifactsChanged is non-empty, validation_evidence when validationRun is recorded, and any touched docs/prompt, tooling/config, operator, release, or test surfaces
- for scope: final, when reviewDepth is broad, keep review proportional to changed files, validation evidence, and local connected context; when reviewDepth is detailed, include integrationChecks and regressionChecks, and cover validation_evidence plus at least one cross-feature surface
- for scope: final, perform the review depth required by deliveryPolicy.finalReviewPolicy before approving; do not treat priorityMode: strict_scope alone as strictReview governance
- for scope: final in review/review_and_fix sessions, include reviewScopeLedger entries that account for every declared review scope target/domain with statuses reviewed_no_findings, finding_closed, deferred, out_of_scope, or blocked; include evidenceRefs and truthful residualRisk for each entry
- when recovery details provide exampleReviewScopeLedger, reassess scope entries; scaffold-only, do not replay unchanged
- if final-review persistence returns status: error, do not retry the same reviewer decision unchanged; inspect flow_status or recovery details and repair reviewScopeLedger evidenceRefs before retrying
- reviewScopeLedger accounting is required for review scope closure and does not require edits to every target file
- do not implement fixes yourself; only review and report findings

Output examples:

${renderExampleBlocks([
	{
		name: "feature-approved",
		body: `{"scope":"feature","featureId":"improve-prompts","reviewPurpose":"execution_gate","status":"approved","summary":"Prompt changes are internally consistent and validation is sufficient.","blockingFindings":[]}`,
	},
	{
		name: "feature-needs-fix",
		body: `{"scope":"feature","featureId":"improve-prompts","reviewPurpose":"execution_gate","status":"needs_fix","summary":"The worker output is missing required validation evidence.","blockingFindings":[{"summary":"No targeted validation command was recorded."}],"suggestedValidation":["bun test tests/config/prompt-contracts.test.ts"]}`,
	},
])}`;
