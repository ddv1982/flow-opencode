import flowSkill from "../../skills/flow/SKILL.md" with { type: "text" };
import flowPlanSkill from "../../skills/flow-plan/SKILL.md" with {
	type: "text",
};
import flowReviewSkill from "../../skills/flow-review/SKILL.md" with {
	type: "text",
};
import flowRunSkill from "../../skills/flow-run/SKILL.md" with { type: "text" };
import {
	FLOW_GUIDANCE_IDS,
	FLOW_GUIDANCE_TOPICS,
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
	relativePath: "SKILL.md";
	content: string;
};

export const FLOW_MANAGER_KERNEL = [
	"## Flow manager kernel",
	"",
	[
		"- The root manager owns manager lifecycle mutations, integration, validation, and review dispatch;",
		"the independent reviewer submits only its own result.",
	].join(" "),
	[
		"- Delegate active Flow work only to `flow-worker` and independent review only to `flow-reviewer`;",
		"never use generic or general-purpose agents.",
	].join(" "),
	[
		"- Make one automatic fresh full retry only when the projected `nextAction`",
		"is `flow_feature_reset`; otherwise checkpoint.",
	].join(" "),
	[
		"- Before review, require current-source evidence appropriate to the changed outcome,",
		"including behavior evidence when behavior changes, plus relevant base-diff, deletion,",
		"rename, file-type, and executable-mode facts.",
	].join(" "),
].join("\n");

const GUIDANCE_CONTENT: Record<FlowGuidanceTopic, string> = {
	flow: `${flowSkill.trimEnd()}\n\n${FLOW_MANAGER_KERNEL}\n`,
	"flow-plan": flowPlanSkill,
	"flow-run": `${flowRunSkill.trimEnd()}\n\n${FLOW_MANAGER_KERNEL}\n`,
	"flow-review": flowReviewSkill,
};

export type FlowGuidanceDocument = FlowGuidanceFile & {
	id: FlowGuidanceId;
	topic: FlowGuidanceTopic;
};

export const FLOW_GUIDANCE_DOCUMENTS: readonly FlowGuidanceDocument[] =
	FLOW_GUIDANCE_TOPICS.map((name) => ({
		relativePath: "SKILL.md",
		content: GUIDANCE_CONTENT[name],
		id: name,
		topic: name,
	}));

const FLOW_GUIDANCE_BY_ID = new Map(
	FLOW_GUIDANCE_DOCUMENTS.map((document) => [document.id, document]),
);

export function getFlowGuidance(id: FlowGuidanceId): FlowGuidanceDocument {
	const document = FLOW_GUIDANCE_BY_ID.get(id);
	if (!document) throw new Error(`Missing bundled Flow guidance '${id}'.`);
	return document;
}

if (FLOW_GUIDANCE_BY_ID.size !== FLOW_GUIDANCE_IDS.length) {
	throw new Error("Bundled Flow guidance ids and documents are out of sync.");
}
