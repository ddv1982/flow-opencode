import { createAuditHistorySessionTools } from "./session-tools/audit-history-tools";
import { createAuditSessionTools } from "./session-tools/audit-tools";
import { createHistorySessionTools } from "./session-tools/history-tools";
import { createLifecycleSessionTools } from "./session-tools/lifecycle-tools";
import { createPlanningSessionTools } from "./session-tools/planning-tools";

export function createSessionTools() {
	return {
		...createAuditSessionTools(),
		...createAuditHistorySessionTools(),
		...createHistorySessionTools(),
		...createPlanningSessionTools(),
		...createLifecycleSessionTools(),
	};
}
