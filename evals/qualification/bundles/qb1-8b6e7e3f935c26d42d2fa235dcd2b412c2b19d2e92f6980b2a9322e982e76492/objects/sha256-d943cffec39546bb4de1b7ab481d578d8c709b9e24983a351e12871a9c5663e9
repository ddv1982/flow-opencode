import flowSkill from "../../skills/flow/SKILL.md" with { type: "text" };
import flowPlanSkill from "../../skills/flow-plan/SKILL.md" with {
	type: "text",
};
import flowReviewSkill from "../../skills/flow-review/SKILL.md" with {
	type: "text",
};
import flowRunSkill from "../../skills/flow-run/SKILL.md" with { type: "text" };
import { FLOW_GUIDANCE_IDS, type FlowGuidanceId } from "./ids.js";

export { FLOW_GUIDANCE_IDS, type FlowGuidanceId } from "./ids.js";

export const FLOW_MANAGER_KERNEL = [
	"## Flow manager kernel",
	"",
	[
		"- The root manager owns manager lifecycle mutations, integration, validation, and review dispatch;",
		"the independent reviewer submits only its own result.",
	].join(" "),
	[
		"- After a feature run starts, delegate implementation slices only to `flow-worker`",
		"and independent review only to `flow-reviewer`; never use generic or general-purpose agents.",
	].join(" "),
	[
		"- Make one automatic fresh full retry only when the projected `nextAction`",
		"is `flow_feature_reset`; otherwise checkpoint.",
		"On `await-user-direction` or a lease stop, print compact `findingsDigest`",
		"without inventing ids.",
	].join(" "),
	[
		"- Before review, require current-source evidence appropriate to the changed outcome,",
		"including behavior evidence when behavior changes, plus relevant base-diff, deletion,",
		"rename, file-type, and executable-mode facts.",
	].join(" "),
].join("\n");

const GUIDANCE_CONTENT: Record<FlowGuidanceId, string> = {
	flow: `${flowSkill.trimEnd()}\n\n${FLOW_MANAGER_KERNEL}\n`,
	"flow-plan": flowPlanSkill,
	"flow-run": `${flowRunSkill.trimEnd()}\n\n${FLOW_MANAGER_KERNEL}\n`,
	"flow-review": flowReviewSkill,
};

type FlowGuidanceDocument = {
	id: FlowGuidanceId;
	content: string;
};

const FLOW_GUIDANCE_DOCUMENTS: readonly FlowGuidanceDocument[] =
	FLOW_GUIDANCE_IDS.map((id) => ({ id, content: GUIDANCE_CONTENT[id] }));

const FLOW_GUIDANCE_BY_ID = new Map(
	FLOW_GUIDANCE_DOCUMENTS.map((document) => [document.id, document]),
);

export function getFlowGuidance(id: FlowGuidanceId): FlowGuidanceDocument {
	const document = FLOW_GUIDANCE_BY_ID.get(id);
	if (!document) throw new Error(`Missing bundled Flow guidance '${id}'.`);
	return document;
}
