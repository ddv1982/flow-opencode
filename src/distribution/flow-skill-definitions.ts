import flowParallelOrchestrationDoc from "../../skills/flow/references/parallel-orchestration.md" with {
	type: "text",
};
import flowRecoveryPlaybookDoc from "../../skills/flow/references/recovery-playbook.md" with {
	type: "text",
};
import flowSkillDoc from "../../skills/flow/SKILL.md" with { type: "text" };
import flowDeslopRefactorWorkflowDoc from "../../skills/flow-deslop/references/refactor-workflow.md" with {
	type: "text",
};
import flowDeslopSmellRubricDoc from "../../skills/flow-deslop/references/smell-rubric.md" with {
	type: "text",
};
import flowDeslopSkillDoc from "../../skills/flow-deslop/SKILL.md" with {
	type: "text",
};
import flowPlanParallelDiscoveryDoc from "../../skills/flow-plan/references/parallel-discovery.md" with {
	type: "text",
};
import flowPlanPlanningExamplesDoc from "../../skills/flow-plan/references/planning-examples.md" with {
	type: "text",
};
import flowPlanSkillDoc from "../../skills/flow-plan/SKILL.md" with {
	type: "text",
};
import flowReviewReviewRubricDoc from "../../skills/flow-review/references/review-rubric.md" with {
	type: "text",
};
import flowReviewSkillDoc from "../../skills/flow-review/SKILL.md" with {
	type: "text",
};
import flowRunAuditRubricDoc from "../../skills/flow-run/references/audit-rubric.md" with {
	type: "text",
};
import flowRunValidationRubricDoc from "../../skills/flow-run/references/validation-rubric.md" with {
	type: "text",
};
import flowRunSkillDoc from "../../skills/flow-run/SKILL.md" with {
	type: "text",
};
import flowUiQualityUiRubricDoc from "../../skills/flow-ui-quality/references/ui-rubric.md" with {
	type: "text",
};
import flowUiQualityVisualVerificationDoc from "../../skills/flow-ui-quality/references/visual-verification.md" with {
	type: "text",
};
import flowUiQualitySkillDoc from "../../skills/flow-ui-quality/SKILL.md" with {
	type: "text",
};
import {
	type FlowSkillDefinition,
	type FlowSkillFile,
	SKILL_DOCUMENT_FILENAME,
} from "./sync-types";

export type { FlowSkillDefinition, FlowSkillFile };

/**
 * The hand-authored skills shipped with the plugin. The markdown is embedded
 * at build time via Bun text imports so the bundled dist/index.js remains
 * self-contained. Source of truth: the `skills/` directory in the repo.
 */
export const FLOW_SKILL_DEFINITIONS: readonly FlowSkillDefinition[] = [
	{
		name: "flow",
		files: [
			{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowSkillDoc },
			{
				relativePath: "references/recovery-playbook.md",
				content: flowRecoveryPlaybookDoc,
			},
			{
				relativePath: "references/parallel-orchestration.md",
				content: flowParallelOrchestrationDoc,
			},
		],
	},
	{
		name: "flow-deslop",
		files: [
			{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowDeslopSkillDoc },
			{
				relativePath: "references/smell-rubric.md",
				content: flowDeslopSmellRubricDoc,
			},
			{
				relativePath: "references/refactor-workflow.md",
				content: flowDeslopRefactorWorkflowDoc,
			},
		],
	},
	{
		name: "flow-plan",
		files: [
			{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowPlanSkillDoc },
			{
				relativePath: "references/planning-examples.md",
				content: flowPlanPlanningExamplesDoc,
			},
			{
				relativePath: "references/parallel-discovery.md",
				content: flowPlanParallelDiscoveryDoc,
			},
		],
	},
	{
		name: "flow-run",
		files: [
			{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowRunSkillDoc },
			{
				relativePath: "references/audit-rubric.md",
				content: flowRunAuditRubricDoc,
			},
			{
				relativePath: "references/validation-rubric.md",
				content: flowRunValidationRubricDoc,
			},
		],
	},
	{
		name: "flow-review",
		files: [
			{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowReviewSkillDoc },
			{
				relativePath: "references/review-rubric.md",
				content: flowReviewReviewRubricDoc,
			},
		],
	},
	{
		name: "flow-ui-quality",
		files: [
			{ relativePath: SKILL_DOCUMENT_FILENAME, content: flowUiQualitySkillDoc },
			{
				relativePath: "references/ui-rubric.md",
				content: flowUiQualityUiRubricDoc,
			},
			{
				relativePath: "references/visual-verification.md",
				content: flowUiQualityVisualVerificationDoc,
			},
		],
	},
];
