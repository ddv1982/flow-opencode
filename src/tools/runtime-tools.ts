import { createExecutionRuntimeTools } from "./runtime-tools/execution-tools";
import { createPlanningRuntimeTools } from "./runtime-tools/planning-tools";
import { createReviewRuntimeTools } from "./runtime-tools/review-tools";

export function createRuntimeTools() {
	return {
		...createPlanningRuntimeTools(),
		...createExecutionRuntimeTools(),
		...createReviewRuntimeTools(),
	};
}
