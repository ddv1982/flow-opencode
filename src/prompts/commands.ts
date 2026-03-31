export const FLOW_PLAN_COMMAND_TEMPLATE = `Manage the active Flow plan.

Arguments: $ARGUMENTS

Behavior:
- If the arguments start with \`approve\`, approve the current draft plan. If extra tokens are present, treat them as feature ids to keep before approval.
- If the arguments start with \`select\`, narrow the current draft plan to the listed feature ids without approving it.
- Otherwise treat the full argument string as the planning goal and create or refresh a draft plan.

For planning:
- Call \`flow_plan_start\` first.
- Read the repo before finalizing the plan.
- Use external research only when it materially improves implementation direction.
- Persist the draft through \`flow_plan_apply\`.
- End with a concise draft summary and the next approval step.

Do not start implementation from this command.`;

export const FLOW_RUN_COMMAND_TEMPLATE = `Execute one approved Flow feature.

Arguments: $ARGUMENTS

Behavior:
- Call \`flow_run_start\` first, passing the argument as a feature id only when it is non-empty.
- If no feature is runnable, summarize the runtime result and stop.
- Otherwise implement exactly one feature, run targeted validation, review the changed files, fix review findings, rerun validation, and obtain reviewer approval through \`flow_review_record_feature\`.
- If the active feature is the final completion path for the session, run broad validation, obtain final approval through \`flow_review_record_final\`, include a passing \`finalReview\`, and only then persist the result through \`flow_run_complete_feature\`.
- End with a compact summary of changes, validation evidence, and the runtime's next step.`;

export const FLOW_AUTO_COMMAND_TEMPLATE = `Run Flow autonomously.

Arguments: $ARGUMENTS

Behavior:
- If the argument string is empty or \`resume\`, resume the active session if one exists.
- Otherwise treat the full argument string as a new autonomous goal.
- Plan, approve, execute, review, fix findings, and replan as needed until completion or a real blocker.
- Do not advance to the next feature until the current one is clean.
- Before final completion, run broad repo validation, perform a final cross-feature review, fix any findings, rerun broad validation, and only then finish with a passing \`finalReview\`.
- Use Flow runtime tools for every state transition.
- End with the latest runtime summary.`;

export const FLOW_STATUS_COMMAND_TEMPLATE = `Inspect the active Flow session.

Call \`flow_status\`, render the runtime result clearly, and stop.`;

export const FLOW_RESET_COMMAND_TEMPLATE = `Reset Flow state.

Arguments: $ARGUMENTS

Behavior:
- If the arguments are exactly \`session\`, clear the active Flow session through \`flow_reset_session\`.
- If the arguments start with \`feature\`, reset the named feature through \`flow_reset_feature\`.
- Otherwise explain the valid forms briefly.

Always summarize what changed and the next logical command.`;
