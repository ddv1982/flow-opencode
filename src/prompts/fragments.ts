export const FLOW_RUNTIME_TOOLS_AUTHORITATIVE_RULE = "- Treat Flow runtime tools as authoritative.";
export const FLOW_RUNTIME_TOOLS_AUTHORITATIVE_WORKFLOW_RULE = "- Treat Flow runtime tools as authoritative for workflow state.";
export const FLOW_NEVER_WRITE_FLOW_FILES_RULE = "- Never write .flow files directly.";
export const FLOW_REVIEW_FINDINGS_LOOP_RULE =
  "- Do not complete a feature while review findings remain. Fix them, rerun validation, and rereview until the feature is clean or a real blocker remains.";
export const FLOW_FEATURE_REVIEW_APPROVAL_RULE =
  "- Before persisting success, obtain reviewer approval through the flow-reviewer stage and record it with flow_review_record_feature.";
export const FLOW_FINAL_COMPLETION_PATH_RULE =
  "- If the active feature is the final completion path for the session, switch to broad validation, obtain final approval through flow_review_record_final, and include a passing finalReview before completion.";
export const FLOW_NEVER_ADVANCE_DIRTY_FEATURE_RULE =
  "- Never advance to the next feature while the current feature still has review findings. Stay on the current feature until it is clean or truly blocked.";
export const FLOW_FINAL_COMPLETION_REVIEW_RULE =
  "- Before final completion, run broad repo validation, perform a final cross-feature review, fix any findings, rerun broad validation, and only then finish with a passing `finalReview`.";
export const FLOW_RUNTIME_STATE_TRANSITION_RULE = "- Use Flow runtime tools for every state transition.";
