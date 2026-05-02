// Flow prompt-expression source: runtime policy, transitions, and schema remain the normative owner of workflow semantics.
// Fragments compose prompt wording only; they must not redefine runtime-owned workflow behavior.

import type { SemanticInvariantId } from "../runtime/domain/semantic-invariants";

export const FLOW_FRAGMENT_INVARIANT_IDS = [
	"completion.policy.min_completed_features",
	"decision_gate.planning_surface.binding",
	"recovery.next_action.binding",
	"tools.canonical_surface.no_raw_wrappers",
] as const satisfies readonly SemanticInvariantId[];

export const FLOW_RUNTIME_TOOLS_AUTHORITATIVE_RULE =
	"- Treat Flow runtime tools as authoritative.";
export const FLOW_RUNTIME_TOOLS_AUTHORITATIVE_WORKFLOW_RULE =
	"- Treat Flow runtime tools as authoritative for workflow state.";
export const FLOW_NEVER_WRITE_FLOW_FILES_RULE =
	"- Never write .flow files directly.";
export const FLOW_COORDINATOR_BOUNDARY_RULE =
	"- Stay at the coordinator layer: decide whether planning, execution, review, reset, or recovery happens next, and rely on the specialized Flow roles for their detailed contracts.";
export const FLOW_REVIEW_FINDINGS_LOOP_RULE =
	"- Do not complete a feature while review findings remain. Fix them, rerun validation, and rereview until the feature is clean or a real blocker remains.";
export const FLOW_FEATURE_REVIEW_APPROVAL_RULE =
	"- Before persisting success, get flow-reviewer approval and record it through flow_review_record_feature.";
export const FLOW_FINAL_COMPLETION_PATH_RULE =
	"- Treat the active feature as the final completion path whenever completing it would satisfy the session completion policy, including completionPolicy.minCompletedFeatures even if other plan features remain pending. On the final completion path, switch to broad validation, get the runtime-owned final review required by deliveryPolicy.finalReviewPolicy (detailed cross-feature by default) through flow_review_record_final, and include a passing finalReview before completion.";
export const FLOW_NEVER_ADVANCE_DIRTY_FEATURE_RULE =
	"- Never advance to the next feature while the current feature still has review findings. Stay on the current feature until it is clean or truly blocked.";
export const FLOW_FINAL_COMPLETION_REVIEW_RULE =
	"- Before final completion, run broad repo validation, perform the runtime-owned final review required by deliveryPolicy.finalReviewPolicy (detailed cross-feature by default), fix findings, rerun broad validation, and only then finish with a passing `finalReview`. The final completion path can be reached by satisfying completionPolicy.minCompletedFeatures even when other plan features remain pending.";
export const FLOW_NO_INFERRED_GOAL_RULE =
	"- Do not derive, infer, or invent a new goal from repository inspection when invoked without a goal and no active session exists.";
export const FLOW_RESUME_ONLY_RULE =
	"- When invoked with empty input or `resume`, treat the command as resume-only. If no active session exists, stop and request a goal instead of creating one.";
export const FLOW_STRUCTURED_RECOVERY_RULE =
	"- When tool errors include structured recovery metadata, satisfy `recovery.prerequisite` first. Only call canonical `recovery.nextRuntimeTool` values when they are present. Treat `recovery.nextCommand` as user-facing guidance, not the agent's only option.";
export const FLOW_RUNTIME_STATE_TRANSITION_RULE =
	"- Use Flow runtime tools for every state transition.";
export const FLOW_COORDINATOR_ROLE_ROUTING_RULE =
	"- Use flow-planner for plan creation, flow-worker for implementation plus validation, and flow-reviewer for approval instead of restating their full instructions yourself.";
export const FLOW_TASK_HANDOFF_RULE =
	"- When OpenCode task/subagent invocation is available, use the Task tool to hand bounded planning to flow-planner, implementation to flow-worker, and review to flow-reviewer so each role works in a fresh child context and reports back with its artifacts, validation, and blockers. Those handoffs do not replace runtime ownership: persist state changes only through Flow runtime tools and never edit .flow files directly.";
export const FLOW_WORKER_REVIEW_TASK_RULE =
	"- When OpenCode task/subagent invocation is available, ask flow-reviewer through the Task tool for an independent review in a fresh child context instead of performing the approval gate in the same worker context.";
export const FLOW_PERSIST_REVIEWER_DECISIONS_RULE =
	"- Persist every reviewer decision through flow_review_record_feature or flow_review_record_final before deciding whether to continue, fix, block, or complete.";
export const FLOW_RESOLVE_RUNTIME_ERRORS_RULE =
	"- Treat runtime contract errors, completion gating failures, and failing validation as work to resolve, not stop conditions.";
export const FLOW_OPERATOR_PROGRESS_RULE =
	"- Keep the user informed with concise operator progress updates at phase boundaries this mode owns: say the current phase, the immediate action, and why it matters in one short sentence before starting a major phase; after each phase, summarize the outcome/evidence and next step. Progress updates are assistant prose only; never include progress narration inside `workerJson`, `decisionJson`, reviewer decisions, or `finalReview` fields. Do not dump raw tool JSON or narrate every minor file read/tool call.";
export const FLOW_OPERATOR_PROGRESS_CHECKPOINTS = `Operator progress checkpoints:
- Start: classify the request or active session state.
- Planning: summarize the repo evidence being gathered and the plan/approval outcome.
- Execution: name the active feature and the implementation focus before edits.
- Validation: state the validation command or evidence target before running it, then report pass/fail.
- Review: state whether feature or final review is happening, then report approval/fix/blocker outcome.
- Recovery/reset: explain the blocker, prerequisite, canonical runtime action, and retry plan.
- Finalization: summarize completion status, remaining risk, and the runtime next step.`;

export const FLOW_ENGINEERING_QUALITY_RULE =
	"- Apply the repo's coding guidelines before completion: prefer deletion/reuse over new layers, keep diffs small, use existing scripts and utilities, inspect existing logging/telemetry/CLI-output patterns before changing `console.*`, classify each occurrence, remove only temporary debug noise, replace intentional operator/observability signals with the repo's existing logger, telemetry API, injected logger, or explicit stdout/stderr stream writes while preserving severity, message intent, and key context, if no facility exists add the smallest local injected adapter or report a blocker instead of inventing a dependency, and add or update tests for behavior changes.";
export const FLOW_RELEASE_HYGIENE_REVIEW_RULE =
	"- Treat release hygiene as a review gate: do not approve work that leaves raw console calls, debugger statements, or undocumented debug-only instrumentation in release-bound source or build artifacts, do not approve changes that delete intentional operator/observability signals without evidence of an equivalent logger, telemetry, or stdout/stderr replacement preserving severity, message intent, and key context, and do not approve a new logging or telemetry dependency unless it was explicitly approved.";

export const FLOW_PACKAGE_MANAGER_PRIMARY_CONTRACT_RULE =
	"- Treat existing package.json scripts as the primary execution contract; invoke them through the detected package manager or the repo's established script-running convention. Package-manager detection is supporting evidence. Do not assume Bun unless repo evidence says Bun.";
export const FLOW_PACKAGE_MANAGER_AMBIGUITY_PLAN_RULE =
	"- If package-manager evidence is ambiguous, do not guess. Prefer existing package.json scripts and call out the ambiguity in planning context.";
export const FLOW_PACKAGE_MANAGER_PRIMARY_VALIDATION_RULE =
	"- Use existing package.json scripts first for validation/build/test, invoked through the detected package manager or the repo's established script-running convention. Use raw manager-specific commands or direct tool binaries only when scripts do not cover the needed check. Do not default to Bun in non-Bun repos.";
export const FLOW_PACKAGE_MANAGER_AMBIGUITY_EXECUTION_RULE =
	"- If package-manager evidence is ambiguous, do not guess a manager-specific command when an existing package.json script covers the task.";
export const FLOW_PACKAGE_MANAGER_PRIMARY_COORDINATOR_RULE =
	"- Treat existing package.json scripts as primary and invoke them through the detected package manager or the repo's established script-running convention. Treat package-manager detection as supporting evidence instead of assuming Bun.";
export const FLOW_PACKAGE_MANAGER_AMBIGUITY_COORDINATOR_RULE =
	"- If package-manager evidence is ambiguous, do not invent a manager-specific command; use existing scripts first and surface the ambiguity clearly if scripts are insufficient.";
export const FLOW_FINAL_COMPLETION_COMMAND_RULE =
	"- On the final completion path, run broad validation, obtain the runtime-owned final approval required by deliveryPolicy.finalReviewPolicy (detailed cross-feature by default) through `flow_review_record_final` using `decisionJson`, include a passing `finalReview`, and only then persist the result through `flow_run_complete_feature` using `workerJson`.";
export const FLOW_FINAL_COMPLETION_WORKER_STEP_RULE =
	"On the final completion path, run broad validation, ask flow-reviewer for the final review required by deliveryPolicy.finalReviewPolicy (detailed cross-feature by default), and persist that approval with flow_review_record_final, encoding the reviewer decision into `decisionJson`.";
export const FLOW_FINAL_COMPLETION_AUTO_STEP_RULE =
	"On the final completion path, have flow-worker run broad validation, use flow-reviewer for the final review required by deliveryPolicy.finalReviewPolicy (detailed cross-feature by default), persist it with flow_review_record_final using `decisionJson`, and keep fixing/revalidating until the final review passes.";
