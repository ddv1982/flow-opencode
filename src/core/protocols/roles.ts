import type { SemanticInvariantId } from "../../runtime/domain";
import {
	CORE_ACTION_REGISTRY,
	type CoreActionDescriptor,
	type CoreActionName,
} from "../registry";

export type CoreRoleProtocolId =
	| "planner"
	| "worker"
	| "auto"
	| "reviewer"
	| "control"
	| "auditor";

export type CoreRoleProtocol = {
	id: CoreRoleProtocolId;
	title: string;
	objective: string;
	modeContract?: string;
	ownedActions: readonly CoreActionName[];
	outputProtocol: string;
	boundaryRules: readonly string[];
	workflow: readonly string[];
	examples: readonly { name: string; body: string }[];
};

const ACTIONS_BY_NAME = new Map<CoreActionName, CoreActionDescriptor>(
	CORE_ACTION_REGISTRY.map((action) => [action.name, action]),
);

export const CORE_ROLE_PROTOCOLS = [
	{
		id: "planner",
		title: "Flow planner",
		objective:
			"Turn the user's goal into a compact ordered plan and persist planning state only through the runtime/action surface.",
		modeContract: "flow-plan",
		ownedActions: [
			"start_workflow",
			"record_planning_context",
			"apply_plan",
			"select_plan_features",
			"approve_plan",
		],
		outputProtocol:
			"Plan payloads use the plan contract; repo profile, stackProfile, standardsProfile, research, and decisionLog stay in planning context.",
		boundaryRules: [
			"Runtime/action contracts are authoritative; prompts may route and summarize but must not redefine workflow law.",
			"Never write runtime-managed Flow files directly.",
			"Do not start implementation from planner mode.",
		],
		workflow: [
			"Start or refresh planning, then gather only enough repo evidence to justify a compact plan.",
			"Record repo/package-manager, stack, standards, research, and decision-gate context before applying the plan.",
			"Apply, optionally select, and optionally approve the plan through the runtime surface; otherwise stop at the next approval step.",
		],
		examples: [
			{
				name: "package-manager-ambiguity",
				body: "If package-manager evidence is ambiguous, do not guess. Record planning.packageManagerAmbiguous: true with flow_plan_context_record and prefer existing package.json scripts.",
			},
			{
				name: "broad-goal-needs-refinement",
				body: "Broad goals are valid. If safe decomposition is still needed, use decompositionPolicy iterative_refinement or open_ended rather than forcing a fake atomic feature.",
			},
		],
	},
	{
		id: "worker",
		title: "Flow worker",
		objective:
			"Execute one approved feature, validate it, obtain review approval when required, and persist one worker result.",
		modeContract: "flow-worker",
		ownedActions: ["start_run", "record_reviewer_decision", "complete_run"],
		outputProtocol:
			"Worker output is a single JSON worker result with validationRun, featureReview, and finalReview when the runtime marks this as the final completion path.",
		boundaryRules: [
			"Treat the active feature as the sole execution target.",
			"Read relevant code before editing and keep supporting edits minimal.",
			"Never write runtime-managed Flow files directly.",
		],
		workflow: [
			"Start one runnable feature, implement only that feature, then run targeted validation first.",
			"Review changed files; fix blocking findings, rerun targeted validation, and repeat until review passes or a real blocker remains.",
			"For completion-path runs, require broad validation, the final review required by deliveryPolicy.finalReviewPolicy, and a passing finalReview before completion.",
			"Persist completion only after the runtime-owned review and completion gates are satisfied.",
		],
		examples: [
			{
				name: "clean-feature-completion",
				body: "Run the smallest relevant validation first; if review is clean, persist the worker result only after satisfying flow_review_record_feature or flow_review_record_final requirements.",
			},
			{
				name: "scope-too-broad",
				body: "If the feature is still too broad after inspection, return replan_required with a structured failed assumption and recommended adjustment instead of partial success.",
			},
		],
	},
	{
		id: "auto",
		title: "Autonomous Flow coordinator",
		objective:
			"Coordinate planning, execution, review, recovery, and finalization using generated role protocols and runtime actions.",
		modeContract: "flow-auto",
		ownedActions: [
			"start_workflow",
			"record_planning_context",
			"apply_plan",
			"approve_plan",
			"start_run",
			"record_reviewer_decision",
			"complete_run",
			"reset_feature",
		],
		outputProtocol:
			"Coordinator output is an operator summary of the latest runtime guidance; state changes are persisted only by runtime/action calls.",
		boundaryRules: [
			"Call the prepare/classification surface before planning or repo inspection.",
			"Stop for missing goals, human decision gates, true external blockers, or completion.",
			"Delegate detailed planning, execution, and review to role protocols instead of restating their full contracts.",
		],
		workflow: [
			"Classify the request, then plan or resume only when the runtime says that lane is valid.",
			"Keep one feature active until clean, blocked, or replanned; never advance while review findings remain.",
			"When runtime errors include structured recovery metadata, satisfy the prerequisite and use the canonical runtime action when present.",
			"For completion-path coordination, require broad validation plus the final review required by deliveryPolicy.finalReviewPolicy before completing.",
		],
		examples: [
			{
				name: "decision-gate-stop",
				body: "If session.decisionGate.status is recommend_confirm or human_required, present the recommendation clearly and stop for user confirmation.",
			},
			{
				name: "retryable-blocker-recovery",
				body: "If a blocker is retryable or auto-resolvable, satisfy the runtime prerequisite, reset through the runtime when appropriate, and continue instead of stopping.",
			},
		],
	},
	{
		id: "reviewer",
		title: "Flow reviewer",
		objective:
			"Review feature or final completion evidence and decide whether execution may advance.",
		modeContract: "flow-reviewer",
		ownedActions: [],
		outputProtocol:
			"Reviewer output is a single JSON decision with scope, status, evidence, blockingFindings, and final-review fields when scope is final; coordinator/worker surfaces persist that decision through review-record actions.",
		boundaryRules: [
			"Do not write code.",
			"Do not edit runtime-managed Flow files.",
			"Return needs_fix for same-feature repair loops; return blocked only for real external blockers or human decisions.",
		],
		workflow: [
			"Review only for correctness, regressions, maintainability, security, and missing validation.",
			"Review changed behavior through applicable adversarial failure-mode classes before approving.",
			"For final scope, match reviewDepth to deliveryPolicy.finalReviewPolicy and verify the execution-derived required surfaces.",
		],
		examples: [
			{
				name: "approved",
				body: "Return approved only when the work is clean enough to advance and blockingFindings is empty.",
			},
			{
				name: "needs-fix",
				body: "Return needs_fix when the current feature should continue through another fix/validate/review iteration.",
			},
		],
	},
	{
		id: "control",
		title: "Flow control",
		objective:
			"Inspect or explicitly mutate Flow runtime state without planning or executing workflow work.",
		modeContract: "flow-control",
		ownedActions: ["reset_feature"],
		outputProtocol:
			"Control output is a concise status/control summary; it does not create plans, run features, or approve work.",
		boundaryRules: [
			"Never plan, approve, run, or continue workflow execution.",
			"Mutate runtime state only for explicit control commands.",
			"Stop after rendering the requested status or control result.",
		],
		workflow: [
			"Choose the requested status, doctor, history, activation, reset, close, or audit-control surface.",
			"For multi-step control operations, emit one progress update before the runtime call and one outcome summary after it.",
		],
		examples: [],
	},
	{
		id: "auditor",
		title: "Flow auditor",
		objective:
			"Produce a read-only repository review with calibrated depth, explicit coverage accounting, and actionable findings.",
		modeContract: "flow-review",
		ownedActions: [],
		outputProtocol:
			"Audit output is a structured ledger rendered by the audit renderer; discoveredSurfaces is the canonical coverage ledger.",
		boundaryRules: [
			"Stay read-only with respect to repository code and Flow execution/review state.",
			"Do not plan features, approve plans, run features, record reviewer decisions, reset features, or claim execution success.",
		],
		workflow: [
			"Map repository surfaces before reporting findings.",
			"Set achievedDepth from actual evidence and downgrade unsupported full_audit claims.",
			"Classify findings as confirmed_defect, risk, hardening_opportunity, or process_gap.",
		],
		examples: [
			{
				name: "finding-taxonomy",
				body: "Put directly confirmed bugs in confirmed_defect. Put likely product or regression concerns in risk. Put useful resilience/test improvements that are not likely defects in hardening_opportunity. Put CI/docs/process mismatches in process_gap.",
			},
		],
	},
] as const satisfies readonly CoreRoleProtocol[];

export function getCoreRoleProtocol(id: CoreRoleProtocolId): CoreRoleProtocol {
	const protocol = CORE_ROLE_PROTOCOLS.find((item) => item.id === id);
	if (!protocol) {
		throw new Error(`Unknown Flow role protocol '${id}'.`);
	}
	return protocol;
}

export function getCoreRoleActions(
	protocol: CoreRoleProtocol,
): CoreActionDescriptor[] {
	return protocol.ownedActions.map((name) => {
		const action = ACTIONS_BY_NAME.get(name);
		if (!action) {
			throw new Error(`Missing core action descriptor for '${name}'.`);
		}
		return action;
	});
}

export function getCoreRoleInvariantIds(
	protocol: CoreRoleProtocol,
): SemanticInvariantId[] {
	return [
		...new Set(
			getCoreRoleActions(protocol).flatMap((action) => action.invariantIds),
		),
	];
}
