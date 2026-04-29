import { createAuditHistorySessionTools } from "./audit-history-tools";
import { createAuditSessionTools } from "./audit-tools";

export function createAuditTools() {
	return {
		...createAuditSessionTools(),
		...createAuditHistorySessionTools(),
	};
}
