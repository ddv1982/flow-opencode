type GuidanceFields = {
	phase: string;
	lane: string;
	laneReason: string;
	blocker: string | null;
	reason: string;
};

export function guidanceFields(guidance: GuidanceFields) {
	return {
		phase: guidance.phase,
		lane: guidance.lane,
		laneReason: guidance.laneReason,
		blocker: guidance.blocker,
		reason: guidance.reason,
	};
}
