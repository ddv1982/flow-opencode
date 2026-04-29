import { createAuditHistorySessionTools } from "./audit-history-tools";
import { createAuditSessionTools } from "./audit-tools";

export function createAuditTools(options: {
	reportsTool: boolean;
	writeTool: boolean;
}) {
	return {
		...(options.writeTool ? createAuditSessionTools() : {}),
		...(options.reportsTool ? createAuditHistorySessionTools() : {}),
	};
}
