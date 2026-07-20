export const FLOW_GUIDANCE_TOPICS = [
	"flow",
	"flow-plan",
	"flow-run",
	"flow-review",
] as const;

export type FlowGuidanceTopic = (typeof FLOW_GUIDANCE_TOPICS)[number];

export const FLOW_GUIDANCE_IDS = FLOW_GUIDANCE_TOPICS;

export type FlowGuidanceId = (typeof FLOW_GUIDANCE_IDS)[number];
