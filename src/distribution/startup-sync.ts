import {
	flowAgentDefinitions,
	flowCommandDefinitions,
	syncFlowCommandsAndAgents,
} from "./managed-markdown-sync";
import { syncFlowSkills } from "./skill-folder-sync";
import { detectPreNpmFlowPlugin } from "./sync-paths";
import { describeError } from "./sync-utils";

export { flowAgentDefinitions, flowCommandDefinitions };

type FlowStartupLogger = (level: "info" | "warn", message: string) => void;

/**
 * Best-effort startup hook: sync skills and surface the pre-npm-copy warning
 * without ever failing plugin initialization.
 */
export async function runFlowStartupSync(
	version: string,
	log: FlowStartupLogger,
): Promise<void> {
	try {
		const results = await syncFlowSkills({ version });
		const changed = results.filter(
			(result) =>
				result.action !== "unchanged" && result.action !== "skipped_foreign",
		);
		if (changed.length > 0) {
			log(
				"info",
				`Flow synced global skills (${changed
					.map((result) => `${result.name}: ${result.action}`)
					.join(", ")}). Restart OpenCode once if skills were just installed.`,
			);
		}
	} catch (error) {
		log("warn", `Flow skill sync failed: ${describeError(error)}`);
	}

	try {
		const results = await syncFlowCommandsAndAgents({ version });
		const changed = results.filter(
			(result) =>
				result.action !== "unchanged" && result.action !== "skipped_foreign",
		);
		if (changed.length > 0) {
			log(
				"info",
				`Flow synced global commands/agents (${changed
					.map((result) => `${result.name}: ${result.action}`)
					.join(
						", ",
					)}). Restart OpenCode once if commands were just installed.`,
			);
		}
	} catch (error) {
		log("warn", `Flow command/agent sync failed: ${describeError(error)}`);
	}

	try {
		const preNpmCopy = await detectPreNpmFlowPlugin();
		if (preNpmCopy) {
			log(
				"warn",
				`Stale pre-npm Flow plugin copy detected at ${preNpmCopy.path}. Flow now loads from npm via the opencode.json plugin array; remove the stale copy to avoid loading Flow twice (run \`bunx opencode-plugin-flow uninstall\`${preNpmCopy.flowOwned ? "" : " or delete the file manually"}).`,
			);
		}
	} catch (error) {
		log("warn", `Flow pre-npm install check failed: ${describeError(error)}`);
	}
}
