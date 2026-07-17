export const FLOW_GUIDANCE_TOPICS = [
	"flow",
	"flow-plan",
	"flow-run",
	"flow-test",
	"flow-review",
	"flow-deslop",
	"flow-ui-quality",
	"flow-commit",
] as const;

export type FlowGuidanceTopic = (typeof FLOW_GUIDANCE_TOPICS)[number];

export const FLOW_GUIDANCE_IDS = [
	"flow",
	"flow/references/recovery-playbook.md",
	"flow/references/parallel-orchestration.md",
	"flow/references/parallel-decision.md",
	"flow/references/parallel-manifest.md",
	"flow/references/parallel-execution.md",
	"flow/references/parallel-synthesis.md",
	"flow/references/parallel-pass-example.md",
	"flow/references/handoff-format.md",
	"flow-plan",
	"flow-plan/references/planning-examples.md",
	"flow-plan/references/plan-quality-checklist.md",
	"flow-plan/references/parallel-discovery.md",
	"flow-run",
	"flow-run/references/validation-rubric.md",
	"flow-run/references/audit-rubric.md",
	"flow-test",
	"flow-review",
	"flow-review/references/hidden-reviewer-contract.md",
	"flow-review/references/review-rubric.md",
	"flow-deslop",
	"flow-deslop/references/smell-rubric.md",
	"flow-deslop/references/refactor-workflow.md",
	"flow-ui-quality",
	"flow-ui-quality/references/ui-rubric.md",
	"flow-ui-quality/references/visual-verification.md",
	"flow-commit",
] as const;

export type FlowGuidanceId = (typeof FLOW_GUIDANCE_IDS)[number];
