/**
 * v2 compat shim: retired v2 tool names stay registered as hidden-but-executable
 * stubs so v2 sessions and transcripts that reference them degrade gracefully.
 * Stubs never translate arguments — old schemas differ from the canonical v3
 * tools, and silent mistranslation is worse than an explicit redirect — so each
 * stub accepts anything and returns the standard error envelope pointing at the
 * canonical replacement.
 *
 * These names are deliberately excluded from the canonical tool registry, the
 * bundle-sanity toolCount metric, and all skill/command guidance.
 *
 * Scheduled for removal after one minor cycle (v3.1).
 */
import { toJson } from "../../../runtime/application/workspace-runtime";
import type { CanonicalRuntimeToolName } from "../../../runtime/constants";
import { errorResponse } from "../../../runtime/errors";
import { tool } from "../sdk";

export const V2_COMPAT_TOOL_ALIASES = {
	flow_doctor: "flow_status",
	flow_auto_prepare: "flow_status",
	flow_plan_start: "flow_plan_save",
	flow_plan_context_record: "flow_plan_save",
	flow_plan_apply: "flow_plan_save",
	flow_plan_select_features: "flow_plan_approve",
	flow_run_complete_feature: "flow_feature_complete",
	flow_reset_feature: "flow_feature_complete",
	flow_review_record_feature: "flow_review_record",
	flow_review_record_final: "flow_review_record",
	flow_review_render: "flow_review_record",
	flow_session_activate: "flow_session",
	flow_session_close: "flow_session",
	flow_history: "flow_session",
	flow_history_show: "flow_session",
} as const satisfies Record<string, CanonicalRuntimeToolName>;

export type V2CompatToolName = keyof typeof V2_COMPAT_TOOL_ALIASES;
export type V2CompatReplacementName =
	(typeof V2_COMPAT_TOOL_ALIASES)[V2CompatToolName];

export const V2_COMPAT_TOOL_NAMES = Object.keys(
	V2_COMPAT_TOOL_ALIASES,
) as readonly V2CompatToolName[];

const REPLACEMENT_USAGE_HINTS: Record<V2CompatReplacementName, string> = {
	flow_status:
		"flow_status takes an optional view ('compact' | 'detailed') and reports session state, workspace readiness, and the suggested next step.",
	flow_plan_save:
		"flow_plan_save takes optional goal, planning (context payload), and plan (draft plan payload) fields in one JSON object.",
	flow_plan_approve:
		"flow_plan_approve takes an optional featureIds array to approve a dependency-consistent feature subset.",
	flow_feature_complete:
		"flow_feature_complete takes a validated worker result payload, or reset=true with featureId to reset a feature to pending.",
	flow_review_record:
		"flow_review_record takes scope ('feature' | 'final'), status, summary, and featureId when scope is 'feature'.",
	flow_session:
		"flow_session takes action ('activate' | 'close' | 'history' | 'show') plus sessionId, kind, or summary depending on the action.",
};

function createV2CompatStub(
	name: V2CompatToolName,
	replacement: V2CompatReplacementName,
) {
	return tool({
		description: `Retired v2 tool; use ${replacement}.`,
		args: {},
		execute: async (_args, context) => {
			context.metadata?.({
				title: `Retired v2 tool: ${name}`,
				metadata: { replacement },
			});
			return toJson(
				errorResponse(
					`${name} was retired in v3; call ${replacement} instead`,
					{
						replacement,
						usage: REPLACEMENT_USAGE_HINTS[replacement],
					},
				),
			);
		},
	});
}

export function createV2CompatTools() {
	return Object.fromEntries(
		V2_COMPAT_TOOL_NAMES.map((name) => [
			name,
			createV2CompatStub(name, V2_COMPAT_TOOL_ALIASES[name]),
		]),
	) as Record<V2CompatToolName, ReturnType<typeof createV2CompatStub>>;
}
