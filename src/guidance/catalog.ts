import flowHandoffFormatDoc from "../../skills/flow/references/handoff-format.md" with {
	type: "text",
};
import flowParallelDecisionDoc from "../../skills/flow/references/parallel-decision.md" with {
	type: "text",
};
import flowParallelExecutionDoc from "../../skills/flow/references/parallel-execution.md" with {
	type: "text",
};
import flowParallelManifestDoc from "../../skills/flow/references/parallel-manifest.md" with {
	type: "text",
};
import flowParallelOrchestrationDoc from "../../skills/flow/references/parallel-orchestration.md" with {
	type: "text",
};
import flowParallelPassExampleDoc from "../../skills/flow/references/parallel-pass-example.md" with {
	type: "text",
};
import flowParallelSynthesisDoc from "../../skills/flow/references/parallel-synthesis.md" with {
	type: "text",
};
import flowRecoveryPlaybookDoc from "../../skills/flow/references/recovery-playbook.md" with {
	type: "text",
};
import flowSkillDoc from "../../skills/flow/SKILL.md" with { type: "text" };
import flowCommitSkillDoc from "../../skills/flow-commit/SKILL.md" with {
	type: "text",
};
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
import flowPlanPlanQualityChecklistDoc from "../../skills/flow-plan/references/plan-quality-checklist.md" with {
	type: "text",
};
import flowPlanPlanningExamplesDoc from "../../skills/flow-plan/references/planning-examples.md" with {
	type: "text",
};
import flowPlanSkillDoc from "../../skills/flow-plan/SKILL.md" with {
	type: "text",
};
import flowReviewHiddenReviewerContractDoc from "../../skills/flow-review/references/hidden-reviewer-contract.md" with {
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
import flowTestSkillDoc from "../../skills/flow-test/SKILL.md" with {
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
	FLOW_GUIDANCE_IDS,
	type FlowGuidanceId,
	type FlowGuidanceTopic,
} from "./ids.js";

export {
	FLOW_GUIDANCE_IDS,
	FLOW_GUIDANCE_TOPICS,
	type FlowGuidanceId,
	type FlowGuidanceTopic,
} from "./ids.js";

export type FlowGuidanceFile = {
	relativePath: string;
	content: string;
};

export type FlowGuidanceDefinition = {
	name: FlowGuidanceTopic;
	files: FlowGuidanceFile[];
};

export const FLOW_GUIDANCE_DEFINITIONS: readonly FlowGuidanceDefinition[] = [
	{
		name: "flow",
		files: [
			{ relativePath: "SKILL.md", content: flowSkillDoc },
			{
				relativePath: "references/recovery-playbook.md",
				content: flowRecoveryPlaybookDoc,
			},
			{
				relativePath: "references/parallel-orchestration.md",
				content: flowParallelOrchestrationDoc,
			},
			{
				relativePath: "references/parallel-decision.md",
				content: flowParallelDecisionDoc,
			},
			{
				relativePath: "references/parallel-manifest.md",
				content: flowParallelManifestDoc,
			},
			{
				relativePath: "references/parallel-execution.md",
				content: flowParallelExecutionDoc,
			},
			{
				relativePath: "references/parallel-synthesis.md",
				content: flowParallelSynthesisDoc,
			},
			{
				relativePath: "references/parallel-pass-example.md",
				content: flowParallelPassExampleDoc,
			},
			{
				relativePath: "references/handoff-format.md",
				content: flowHandoffFormatDoc,
			},
		],
	},
	{
		name: "flow-plan",
		files: [
			{ relativePath: "SKILL.md", content: flowPlanSkillDoc },
			{
				relativePath: "references/planning-examples.md",
				content: flowPlanPlanningExamplesDoc,
			},
			{
				relativePath: "references/plan-quality-checklist.md",
				content: flowPlanPlanQualityChecklistDoc,
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
			{ relativePath: "SKILL.md", content: flowRunSkillDoc },
			{
				relativePath: "references/validation-rubric.md",
				content: flowRunValidationRubricDoc,
			},
			{
				relativePath: "references/audit-rubric.md",
				content: flowRunAuditRubricDoc,
			},
		],
	},
	{
		name: "flow-test",
		files: [{ relativePath: "SKILL.md", content: flowTestSkillDoc }],
	},
	{
		name: "flow-review",
		files: [
			{ relativePath: "SKILL.md", content: flowReviewSkillDoc },
			{
				relativePath: "references/hidden-reviewer-contract.md",
				content: flowReviewHiddenReviewerContractDoc,
			},
			{
				relativePath: "references/review-rubric.md",
				content: flowReviewReviewRubricDoc,
			},
		],
	},
	{
		name: "flow-deslop",
		files: [
			{ relativePath: "SKILL.md", content: flowDeslopSkillDoc },
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
		name: "flow-ui-quality",
		files: [
			{ relativePath: "SKILL.md", content: flowUiQualitySkillDoc },
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
	{
		name: "flow-commit",
		files: [{ relativePath: "SKILL.md", content: flowCommitSkillDoc }],
	},
];

function guidanceId(
	topic: FlowGuidanceTopic,
	relativePath: string,
): FlowGuidanceId {
	const id = relativePath === "SKILL.md" ? topic : `${topic}/${relativePath}`;
	if ((FLOW_GUIDANCE_IDS as readonly string[]).includes(id)) {
		return id as FlowGuidanceId;
	}
	throw new Error(`Bundled Flow guidance has an undeclared id '${id}'.`);
}

export type FlowGuidanceDocument = FlowGuidanceFile & {
	id: FlowGuidanceId;
	topic: FlowGuidanceTopic;
};

export const FLOW_GUIDANCE_DOCUMENTS: readonly FlowGuidanceDocument[] =
	FLOW_GUIDANCE_DEFINITIONS.flatMap((definition) =>
		definition.files.map((file) => ({
			...file,
			id: guidanceId(definition.name, file.relativePath),
			topic: definition.name,
		})),
	);

const FLOW_GUIDANCE_BY_ID = new Map(
	FLOW_GUIDANCE_DOCUMENTS.map((document) => [document.id, document]),
);

if (FLOW_GUIDANCE_BY_ID.size !== FLOW_GUIDANCE_IDS.length) {
	throw new Error(
		"Bundled Flow guidance ids and imported documents are out of sync.",
	);
}

export function getFlowGuidance(id: FlowGuidanceId): FlowGuidanceDocument {
	const document = FLOW_GUIDANCE_BY_ID.get(id);
	if (!document) throw new Error(`Missing bundled Flow guidance '${id}'.`);
	return document;
}

export function findFlowGuidance(
	topic: string,
	relativePath: string,
): FlowGuidanceDocument | undefined {
	return FLOW_GUIDANCE_DOCUMENTS.find(
		(document) =>
			document.topic === topic && document.relativePath === relativePath,
	);
}
