export const VALIDATION_STATUSES = ["passed", "failed", "failed_existing", "partial"] as const;
export const REVIEW_STATUSES = ["passed", "failed", "needs_followup"] as const;
export const VERIFICATION_STATUSES = ["passed", "partial", "failed", "not_recorded"] as const;
export const GOAL_MODES = ["implementation", "review", "review_and_fix"] as const;
export const DECOMPOSITION_POLICIES = ["atomic_feature", "iterative_refinement", "open_ended"] as const;
export const WORKER_STATUSES = ["ok", "needs_input"] as const;
export const OUTCOME_KINDS = ["completed", "replan_required", "blocked_external", "needs_operator_input", "contract_error"] as const;
export const NEEDS_INPUT_OUTCOME_KINDS = ["replan_required", "blocked_external", "needs_operator_input", "contract_error"] as const;
