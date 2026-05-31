import type { CoreRoleProtocolId } from "../core/protocols/roles";
import type { FlowPromptMode } from "./mode-contracts";

export type FlowSkillSpec = {
	name: "flow-plan" | "flow-run" | "flow-review";
	title: string;
	description: string;
	purpose: string;
	modeContracts: readonly FlowPromptMode[];
	roleProtocols: readonly CoreRoleProtocolId[];
	operatorGuidance: readonly string[];
};

export const FLOW_SKILL_SPECS = [
	{
		name: "flow-plan",
		title: "Flow planning skill",
		description:
			"Plan Flow work through runtime planning tools, context capture, plan apply, approval, and feature selection without starting implementation.",
		purpose:
			"Use when creating, refining, selecting, or approving a Flow plan from repository evidence.",
		modeContracts: ["flow-plan"],
		roleProtocols: ["planner"],
		operatorGuidance: [
			"Normalize the user goal into outcome, constraints, evidence gaps, and done condition before writing runtime state.",
			"Record repo, package-manager, stack, standards, research, and decision context before applying a plan.",
			"Keep retrieval bounded to evidence that changes plan quality, risk, or approval readiness; external lookup must be available/authorized and material.",
			"Stop at a draft, selection, approval, or approved handoff; do not implement from this skill.",
		],
	},
	{
		name: "flow-run",
		title: "Flow execution skill",
		description:
			"Run one approved Flow feature through start, focused implementation, validation, review recording, and runtime completion.",
		purpose:
			"Use when executing exactly one approved feature through the Flow runtime-owned execution and review gates.",
		modeContracts: ["flow-run", "flow-worker"],
		roleProtocols: ["worker"],
		operatorGuidance: [
			"Start exactly one runnable feature and keep edits scoped to that feature plus necessary support changes.",
			"Run targeted validation before success claims, then provide clean featureReview evidence and fix blocking findings.",
			"For ordinary implementation, completion may use passing validation plus featureReview/finalReview payloads without a separately recorded reviewer decision.",
			"Persist reviewer decisions only when review, review_and_fix, or explicit strictReview governance requires them; completion remains runtime-owned through flow_run_complete_feature.",
		],
	},
	{
		name: "flow-review",
		title: "Flow review skill",
		description:
			"Review Flow feature/final evidence or render standalone audits using read-only evidence, coverage accounting, and runtime-owned approval rules.",
		purpose:
			"Use when reviewing Flow execution evidence or producing a standalone read-only audit report.",
		modeContracts: ["flow-reviewer", "flow-review"],
		roleProtocols: ["reviewer", "auditor"],
		operatorGuidance: [
			"Stay read-only for reviewer and standalone audit surfaces; do not implement fixes.",
			"Review changed evidence, connected context, validation records, and applicable risk classes until the decision is supportable.",
			"For ordinary implementation, provide feature/final review payload guidance; recorded reviewer decisions are required only for review, review_and_fix, or explicit strictReview governance.",
			"Approve only when blocking findings are empty and evidence supports the claimed review depth; missing evidence is a gap, not proof of safety.",
			"For audit reports, maintain discoveredSurfaces as the coverage ledger and downgrade unsupported depth claims.",
		],
	},
] as const satisfies readonly FlowSkillSpec[];
