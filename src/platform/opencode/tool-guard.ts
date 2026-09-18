import { dataNote } from "../../application/flow-response.js";
import type { AutoDriveCoordinator } from "./auto-drive.js";
import type {
	FlowLeadershipHandle,
	FlowLeadershipReason,
	FlowLeadershipStatus,
} from "./leadership.js";
import type { Hooks } from "./sdk.js";

const MUTATION =
	/^flow_(?:plan_save|plan_approve|run_start|review_start|feature_complete|feature_reset|session_close)$/;
function acceptedMutation(tool: string, output: string) {
	if (!MUTATION.test(tool)) return null;
	try {
		const response = JSON.parse(output);
		const data = response.workflowData;
		const closeAccepted =
			tool === "flow_session_close" &&
			response.status === "error" &&
			data?.closeState?.durableAccepted === true;
		const revision = data?.projection?.revision;
		if (
			data?.operation?.replayed !== false ||
			(response.status !== "ok" && !closeAccepted) ||
			typeof revision !== "number" ||
			!Number.isSafeInteger(revision)
		)
			return null;
		const sessionId = data.projection?.sessionId;
		return {
			revision,
			sessionId: typeof sessionId === "string" ? sessionId : undefined,
		};
	} catch {
		return null;
	}
}
type FlowTools = NonNullable<Hooks["tool"]>;

/**
 * Tools whose successful output is markdown prose rather than a Flow response
 * envelope. A guard rejection must stay in the same shape the caller is reading,
 * so these get a markdown failure instead of a JSON blob.
 */
const MARKDOWN_TOOLS = new Set(["flow_guidance"]);

/** Actionable recovery for each non-operational leadership reason. */
function guardRecovery(reason: FlowLeadershipReason): string {
	switch (reason) {
		case "duplicate-instances":
			return "Two Flow plugin instances are registered for this project. Remove the duplicate installation so exactly one remains, then restart OpenCode.";
		case "incompatible-registry":
			return "Another Flow build owns an incompatible runtime registry. Align the installed Flow versions, then restart OpenCode.";
		default:
			return "Flow is not registered for this project. Restart OpenCode to re-register, then retry.";
	}
}

function guardRejection(name: string, status: FlowLeadershipStatus): string {
	const recovery = guardRecovery(status.reason);
	if (MARKDOWN_TOOLS.has(name)) {
		return `${status.message}\n\nRecovery: ${recovery}`;
	}
	// The same envelope every other Flow failure uses, so a caller told to read
	// `workflowData.failure.recovery` finds it here too.
	return JSON.stringify({
		status: "error",
		summary: status.message,
		workflowData: {
			dataNote: dataNote(),
			failure: { summary: status.message, recovery },
			runtimeGuard: status,
		},
	});
}

export function guardTools(
	tools: FlowTools,
	runtimeGuard: FlowLeadershipHandle,
	autoDrive: AutoDriveCoordinator,
): FlowTools {
	return Object.fromEntries(
		Object.entries(tools).map(([name, definition]) => [
			name,
			{
				...definition,
				execute: async (...args: Parameters<typeof definition.execute>) => {
					if (args[1].agent === "flow-planner")
						return JSON.stringify({
							status: "error",
							summary:
								"The planning specialist supplies advice only; the manager owns all Flow tools.",
							workflowData: {},
						});
					const status = runtimeGuard.query();
					if (!status.operational) return guardRejection(name, status);
					const output = await definition.execute(...args);
					const mutation = acceptedMutation(name, String(output));
					const context = args[1];
					if (mutation)
						autoDrive.observeMutation(
							context.sessionID,
							mutation.revision,
							name === "flow_plan_save" && mutation.revision === 1
								? mutation.sessionId
								: undefined,
							context.messageID,
							name === "flow_review_start",
						);
					return output;
				},
			},
		]),
	) as FlowTools;
}
