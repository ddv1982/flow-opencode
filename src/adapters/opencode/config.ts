import { applyFlowConfig, type MutableFlowConfig } from "../../config-shared";
import {
	flowInstructionPath,
	refreshFlowInstructionFile,
	resolveWorkspaceRoot,
} from "../../runtime/workspace";
import { createFlowLog } from "./logging";
import type { ToolContext } from "./sdk";

export function createConfigHook(
	ctx: Pick<ToolContext, "worktree" | "directory">,
) {
	const log = createFlowLog(ctx);
	return async (config: MutableFlowConfig) => {
		let instructionPath: string | undefined;
		try {
			const root = resolveWorkspaceRoot(ctx);
			await refreshFlowInstructionFile(root);
			instructionPath = flowInstructionPath(root);
		} catch (error) {
			log(
				"warn",
				`Flow could not register generated instructions: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		applyFlowConfig(
			config,
			instructionPath ? { flowInstructionPath: instructionPath } : undefined,
		);
	};
}
