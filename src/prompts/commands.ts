import {
	FLOW_COORDINATOR_BOUNDARY_RULE,
	FLOW_COORDINATOR_ROLE_ROUTING_RULE,
	FLOW_FINAL_COMPLETION_REVIEW_RULE,
	FLOW_NO_INFERRED_GOAL_RULE,
	FLOW_PERSIST_REVIEWER_DECISIONS_RULE,
	FLOW_RESOLVE_RUNTIME_ERRORS_RULE,
	FLOW_RESUME_ONLY_RULE,
	FLOW_RUNTIME_STATE_TRANSITION_RULE,
	FLOW_STRUCTURED_RECOVERY_RULE,
} from "./fragments";

export const FLOW_PLAN_COMMAND_TEMPLATE = `Manage the active Flow plan.

Arguments: $ARGUMENTS

Behavior:
- If the arguments start with \`approve\`, approve the current draft plan. Extra tokens are feature ids to keep before approval.
- If the arguments start with \`select\`, narrow the current draft plan to the listed feature ids without approving it.
- Otherwise treat the full argument string as the planning goal and create or refresh a draft plan.
- For planning, call \`flow_plan_start\` first, read the repo before finalizing, use external research only when it materially improves direction, persist the draft through \`flow_plan_apply\`, and end with a concise draft summary plus the next approval step.
Do not start implementation from this command.`;

export const FLOW_RUN_COMMAND_TEMPLATE = `Execute one approved Flow feature.

Arguments: $ARGUMENTS

Behavior:
- Call \`flow_run_start\` first, passing the argument as a feature id only when it is non-empty.
- If no feature is runnable, summarize the runtime result and stop.
- Otherwise implement exactly one feature, run targeted validation, review the changed files, fix review findings, rerun validation, and obtain reviewer approval through \`flow_review_record_feature_from_raw\`.
- On the final completion path, run broad validation, obtain final approval through \`flow_review_record_final_from_raw\`, include a passing \`finalReview\`, and only then persist the result through \`flow_run_complete_feature_from_raw\`. Treat the active feature as the final completion path whenever completing it would satisfy the session completion policy, including \`completionPolicy.minCompletedFeatures\` even if other plan features remain pending.
- End with a compact summary of changes, validation evidence, and the runtime next step.`;

export const FLOW_AUTO_COMMAND_TEMPLATE = `Run Flow autonomously.

Behavior:
- Treat this command as a coordinator entrypoint for Flow's existing planner, worker, reviewer, and runtime tools.
${FLOW_COORDINATOR_BOUNDARY_RULE}
- Call \`flow_auto_prepare\` first and follow its classification before planning or repo inspection.
- If the argument string is non-empty and not \`resume\`, treat the full argument string as a new autonomous goal.
- If the argument string is empty or \`resume\`, resume the active session only.
${FLOW_RESUME_ONLY_RULE}
${FLOW_NO_INFERRED_GOAL_RULE}
- Plan or refresh only when the runtime says planning is needed, approve that plan, then keep work on the current feature until it is clean or truly blocked.
${FLOW_COORDINATOR_ROLE_ROUTING_RULE}
${FLOW_PERSIST_REVIEWER_DECISIONS_RULE}
${FLOW_RESOLVE_RUNTIME_ERRORS_RULE}
- When blocked by a solvable finding, inspect the evidence, use repo and research tools as needed, make the smallest recovery plan, execute it, and keep iterating.
- If a feature lands in a retryable or auto-resolvable blocked state, satisfy the runtime prerequisite, reset it through the runtime when appropriate, and continue instead of stopping.
${FLOW_STRUCTURED_RECOVERY_RULE}
- Do not advance to the next feature until the current one is clean.
${FLOW_FINAL_COMPLETION_REVIEW_RULE}
${FLOW_RUNTIME_STATE_TRANSITION_RULE}
- End with the latest runtime summary.

Arguments: $ARGUMENTS`;

export const FLOW_STATUS_COMMAND_TEMPLATE = `Inspect the active Flow session.

Call \`flow_status\`, render the runtime result clearly, and stop.`;

export const FLOW_HISTORY_COMMAND_TEMPLATE = `Inspect stored Flow session history.

Arguments: $ARGUMENTS

Behavior:
- If the arguments are empty, call \`flow_history\`, render the runtime result clearly, and stop.
- If the arguments start with \`show\`, call \`flow_history_show\` with the provided session id.
- Otherwise explain the valid forms briefly.

Always summarize what you found and the next logical step.`;

export const FLOW_SESSION_COMMAND_TEMPLATE = `Manage the active Flow session pointer.

Arguments: $ARGUMENTS

Behavior:
- If the arguments start with \`activate\`, call \`flow_session_activate\` with the provided session id.
- Otherwise explain the valid forms briefly.

Always summarize what changed and the next logical step.`;

export const FLOW_RESET_COMMAND_TEMPLATE = `Reset Flow state.

Arguments: $ARGUMENTS

Behavior:
- If the arguments are exactly \`session\`, archive the active Flow session through \`flow_reset_session\`.
- If the arguments start with \`feature\`, reset the named feature through \`flow_reset_feature\`.
- Otherwise explain the valid forms briefly.

Always summarize what changed and the next logical step.`;
