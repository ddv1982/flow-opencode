import { createHistorySessionTools } from "./session-tools/history-tools";
import { createLifecycleSessionTools } from "./session-tools/lifecycle-tools";
import { createPlanningSessionTools } from "./session-tools/planning-tools";

export function createSessionTools() {
	return {
		...createHistorySessionTools(),
		...createPlanningSessionTools(),
		...createLifecycleSessionTools(),
	};
}
