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
			instructionPath = flowInstructionPath(root);
			try {
				await refreshFlowInstructionFile(root);
			} catch (error) {
				log(
					"warn",
					`Flow could not refresh generated instructions: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		} catch (error) {
			log(
				"warn",
				`Flow could not resolve generated instruction path: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		applyFlowConfig(config, {
			...(instructionPath ? { flowInstructionPath: instructionPath } : {}),
			onCollision: (kind, name) => {
				log(
					"warn",
					`Flow replaced a user-defined ${kind} named '${name}'. Flow reserves this ${kind} id while the plugin is enabled; rename the local ${kind} to keep it.`,
				);
			},
		});
	};
}
