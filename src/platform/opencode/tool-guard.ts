import { z } from "zod";
import { dataNote } from "../../application/flow-response.js";
import { PlanSaveInputSchema } from "../../application/schema.js";
import { assertMutableWorkspaceRoot } from "../../infrastructure/fs/workspace-paths.js";
import type { AutoDriveCoordinator } from "./auto-drive.js";
import type { FlowTools, FlowToolValue } from "./flow-tool.js";
import type {
	FlowLeadershipHandle,
	FlowLeadershipReason,
	FlowLeadershipStatus,
} from "./leadership.js";

const MUTATION =
	/^flow_(?:plan_save|plan_approve|plan_amend|run_start|review_start|feature_complete|feature_reset|session_close)$/;
const AcceptedMutation = z.object({
	status: z.enum(["ok", "error"]),
	workflowData: z.object({
		operation: z.object({ replayed: z.literal(false) }),
		projection: z.object({
			revision: z.number().int().safe(),
			sessionId: z.string().optional(),
		}),
		closeState: z.object({ durableAccepted: z.boolean() }).optional(),
	}),
});
function acceptedMutation(tool: string, output: FlowToolValue) {
	if (!MUTATION.test(tool)) return null;
	const result = AcceptedMutation.safeParse(output);
	if (
		!result.success ||
		(result.data.status !== "ok" &&
			!(
				tool === "flow_session_close" &&
				result.data.workflowData.closeState?.durableAccepted
			))
	)
		return null;
	return result.data.workflowData.projection;
}
const NativeSessionIdentity = z.object({
	id: z.string().min(1),
	agent: z.string().min(1),
	location: z.object({ directory: z.string().min(1) }),
	parentID: z.string().min(1).optional(),
});

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
function rejection(
	name: string,
	summary: string,
	recovery?: string,
	status?: FlowLeadershipStatus,
): FlowToolValue {
	return name === "flow_guidance"
		? `${summary}${recovery ? `\n\nRecovery: ${recovery}` : ""}`
		: {
				status: "error",
				summary,
				workflowData: {
					dataNote: dataNote(),
					failure: { summary, ...(recovery ? { recovery } : {}) },
					...(status ? { runtimeGuard: status } : {}),
				},
			};
}
const SPECIALISTS = new Set(["flow-planner", "flow-worker", "flow-reviewer"]);

export function guardTools(
	tools: FlowTools,
	runtimeGuard: FlowLeadershipHandle,
	autoDrive: Pick<AutoDriveCoordinator, "clear" | "observeMutation">,
	readSession: (sessionId: string) => Promise<unknown>,
): FlowTools {
	return Object.fromEntries(
		Object.entries(tools).map(([name, definition]) => [
			name,
			{
				...definition,
				execute: async (
					input: unknown,
					context: Parameters<typeof definition.execute>[1],
				) => {
					const status = runtimeGuard.query();
					if (!status.operational) {
						autoDrive.clear();
						return rejection(
							name,
							status.message,
							guardRecovery(status.reason),
							status,
						);
					}
					let permitted = false;
					try {
						const identity = NativeSessionIdentity.parse(
							await readSession(context.sessionID),
						);
						const workspace = assertMutableWorkspaceRoot(context.directory);
						const sameIdentity =
							identity.id === context.sessionID &&
							identity.agent === context.agent &&
							assertMutableWorkspaceRoot(identity.location.directory) ===
								workspace;
						const request =
							input && typeof input === "object" && "recoveryProposal" in input;
						const managerMutation =
							MUTATION.test(name) ||
							name === "flow_validation_start" ||
							request;
						if (
							sameIdentity &&
							context.agent !== "flow-planner" &&
							context.agent !== "flow-worker"
						) {
							if (
								name === "flow_feature_complete" &&
								identity.parentID &&
								context.agent === "flow-reviewer"
							) {
								permitted = true;
							} else {
								permitted = managerMutation
									? !identity.parentID && !SPECIALISTS.has(context.agent)
									: true;
							}
						}
					} catch {}
					if (!permitted)
						return rejection(
							name,
							"Flow tools require a verified workspace session. Mutations require a primary manager or an independent reviewer child session.",
						);
					await context.assertCurrent?.();
					if (context.abort.aborted)
						throw new Error("Flow tool execution was cancelled.");
					runtimeGuard.assertOperational("execute a Flow tool");
					const output = await definition.execute(input, context);
					const mutation = acceptedMutation(name, output);
					if (mutation) {
						const saved =
							name === "flow_plan_save"
								? PlanSaveInputSchema.safeParse(input)
								: null;
						autoDrive.observeMutation(
							context.sessionID,
							mutation.revision,
							name === "flow_plan_save" && mutation.revision === 1
								? mutation.sessionId
								: undefined,
							context.messageID,
							name === "flow_review_start",
							saved?.success
								? {
										tool: name,
										goal: saved.data.request.goal,
										features: saved.data.request.plan.features,
									}
								: undefined,
						);
					}
					return output;
				},
			},
		]),
	);
}
