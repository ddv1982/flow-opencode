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
