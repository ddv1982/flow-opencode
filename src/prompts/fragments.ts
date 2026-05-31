// Flow prompt-expression source: runtime policy, transitions, and schema remain the normative owner of workflow semantics.
// Fragments compose prompt wording only; they must not redefine runtime-owned workflow behavior.

import type { SemanticInvariantId } from "../runtime/domain/semantic-invariants";

export const FLOW_FRAGMENT_INVARIANT_IDS = [
	"completion.policy.min_completed_features",
	"decision_gate.planning_surface.binding",
	"recovery.next_action.binding",
	"tools.canonical_surface.no_raw_wrappers",
] as const satisfies readonly SemanticInvariantId[];

export const FLOW_AUTHORITATIVE_TOOL_JSON_RULE =
	"- Treat returned Flow tool JSON as authoritative. OpenCode row metadata is provisional request-time UI context only; when tool JSON returns status: error, do not retry the same final-review or completion payload unchanged.";
export const FLOW_NEVER_WRITE_FLOW_FILES_RULE =
	"- Never write .flow files directly.";
export const FLOW_HANDOFF_MODE_DECISION_RULE =
	"- Handoff decision: for each planning, execution, and review phase that flow-auto owns, choose handoffMode exactly as `task_subagent`, `inline_role`, or `not_supported`. Use `task_subagent` only for an actual OpenCode Task/subagent handoff to the target role; use `inline_role` for tiny, sequential, or tightly shared-context work; use `not_supported` when Task is unavailable, denied, or not permission-allowed.";
export const FLOW_HANDOFF_MODE_PROGRESS_RULE =
	"- Handoff reporting: before each planning, execution, or review phase, report `Phase: <phase> — handoffMode: <task_subagent|inline_role|not_supported> — target: <role> — reason: <...>`. Prefer `task_subagent` for non-trivial bounded planning/execution/review when supported; prefer `inline_role` for tiny/sequential/shared-context work; use `not_supported` when Task is unavailable/denied; derived task-progress rows are runtime projections, not proof of actual child sessions.";
export const FLOW_WORKER_REVIEW_TASK_RULE =
	"- When OpenCode task/subagent invocation is available, ask flow-reviewer through the Task tool for an independent review in a fresh child context instead of performing the approval gate in the same worker context. This is a direct approval handoff, not recursive delegation by default; if Task is unavailable or denied, report the review with handoffMode exactly as `inline_role` for inline approval fallback or `not_supported` when Task is unavailable or denied instead of implying a child session.";
