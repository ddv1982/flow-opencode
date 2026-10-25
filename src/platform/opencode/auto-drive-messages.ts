import { FLOW_MANAGER_KERNEL } from "../../guidance/catalog.js";
import type { AutoDriveProjection } from "./auto-drive.js";

export function autoHandbackMessage(projection: AutoDriveProjection): string {
	const handback = [
		`Flow is handing control back at compact revision ${projection.revision}.`,
		"Call flow_status with the compact view first.",
		...(projection.nextAction === "await-user-direction"
			? [
					"Call flow_status with the detail view once.",
					"Report workflowData.statusReport verbatim before stopping at await-user-direction.",
				]
			: [
					"Print findingsDigest as the user-facing list. Do not invent ids.",
					`Then follow ${projection.nextAction} or stop at await-user-direction.`,
				]),
		"Do not expand the approved goal.",
	].join(" ");
	return `${handback}\n\n${FLOW_MANAGER_KERNEL}`;
}

export const CONTINUATION_ROUTE = [
	"Load flow-run guidance before any feature or closure route;",
	"for a fresh close use compact session id/revision plus a fresh operation id,",
	"and replay archiveRetry exactly from its projected request.",
].join(" ");

export function autoCompactionMessage(): string {
	const context = [
		"An in-memory /flow-auto continuation remains active.",
		"Read compact Flow state first.",
		CONTINUATION_ROUTE,
		"Do not expand the approved goal; stop for required user direction, a hard blocker, or confirmed closure.",
	].join(" ");
	return `${context}\n\n${FLOW_MANAGER_KERNEL}`;
}

export const AUTO_INITIAL_PROMPT = `Read compact status, load flow-plan, then call flow_plan_save.\n\n${FLOW_MANAGER_KERNEL}`;
