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
	"- Before persisting success, get flow-reviewer approval and record it with flow_review_record_feature.";
export const FLOW_FINAL_COMPLETION_PATH_RULE =
	"- Treat the active feature as the final completion path whenever completing it would satisfy the session completion policy, including completionPolicy.minCompletedFeatures even if other plan features remain pending. On the final completion path, switch to broad validation, get final approval through flow_review_record_final, and include a passing finalReview before completion.";
export const FLOW_NEVER_ADVANCE_DIRTY_FEATURE_RULE =
	"- Never advance to the next feature while the current feature still has review findings. Stay on the current feature until it is clean or truly blocked.";
export const FLOW_FINAL_COMPLETION_REVIEW_RULE =
	"- Before final completion, run broad repo validation, do a final cross-feature review, fix findings, rerun broad validation, and only then finish with a passing `finalReview`. The final completion path can be reached by satisfying completionPolicy.minCompletedFeatures even when other plan features remain pending.";
export const FLOW_NO_INFERRED_GOAL_RULE =
	"- Do not derive, infer, or invent a new goal from repository inspection when invoked without a goal and no active session exists.";
export const FLOW_RESUME_ONLY_RULE =
	"- When invoked with empty input or `resume`, treat the command as resume-only. If no active session exists, stop and request a goal instead of creating one.";
export const FLOW_STRUCTURED_RECOVERY_RULE =
	"- When tool errors include structured recovery metadata, satisfy `recovery.prerequisite` first. Only call `recovery.nextRuntimeTool` when it is present. Treat `recovery.nextCommand` as user-facing guidance, not the agent's only option.";
export const FLOW_RUNTIME_STATE_TRANSITION_RULE =
	"- Use Flow runtime tools for every state transition.";
export const FLOW_COORDINATOR_ROLE_ROUTING_RULE =
	"- Use flow-planner for plan creation, flow-worker for implementation plus validation, and flow-reviewer for approval instead of restating their full instructions yourself.";
export const FLOW_PERSIST_REVIEWER_DECISIONS_RULE =
	"- Persist every reviewer decision through flow_review_record_feature or flow_review_record_final before deciding whether to continue, fix, block, or complete.";
export const FLOW_RESOLVE_RUNTIME_ERRORS_RULE =
	"- Treat runtime contract errors, completion gating failures, and failing validation as work to resolve, not stop conditions.";
