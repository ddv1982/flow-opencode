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
