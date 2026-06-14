import { createFlowLog } from "./logging";
import { createContextTool } from "./tool-surface/context-tool";
import { createPlanTools } from "./tool-surface/plan-tools";
import { createReviewTool } from "./tool-surface/review-tool";
import { createRunTools } from "./tool-surface/run-tools";
import { createSessionTool } from "./tool-surface/session-tool";
import { createStatusTool } from "./tool-surface/status-tool";
import { OPENCODE_TOOL_NAMES_FROM_REGISTRY } from "./tool-surface/tool-registry";

function orderProjectedTools<T extends Record<string, unknown>>(tools: T): T {
	const toolNames = new Set(Object.keys(tools));
	const projectedNames = new Set<string>(OPENCODE_TOOL_NAMES_FROM_REGISTRY);
	const missing = OPENCODE_TOOL_NAMES_FROM_REGISTRY.filter(
		(name) => !toolNames.has(name),
	);
	const extra = [...toolNames].filter((name) => !projectedNames.has(name));

	if (missing.length > 0 || extra.length > 0) {
		throw new Error(
			[
				missing.length > 0
					? `Missing OpenCode registry tool(s): ${missing.join(", ")}`
					: null,
				extra.length > 0
					? `Unregistered OpenCode tool(s): ${extra.join(", ")}`
					: null,
			]
				.filter((message): message is string => message !== null)
				.join("; "),
		);
	}

	return Object.fromEntries(
		OPENCODE_TOOL_NAMES_FROM_REGISTRY.map((name) => [name, tools[name]]),
	) as T;
}

function createCoreTools() {
	return orderProjectedTools({
		...createStatusTool(),
		...createContextTool(),
		...createPlanTools(),
		...createRunTools(),
		...createReviewTool(),
		...createSessionTool(),
	});
}

export function createTools(ctx: unknown) {
	createFlowLog(ctx)("info", "Creating Flow tool surface.");
	return createCoreTools();
}
