import {
	FLOW_CORE_AGENTS,
	FLOW_CORE_COMMANDS,
	type FlowAgentConfig,
} from "../../config-shared";

type MutableConfig = {
	agent?: Record<string, unknown>;
	command?: Record<string, unknown>;
};

function cloneAgentConfig(agent: FlowAgentConfig) {
	return {
		...agent,
		...(agent.permission
			? {
					permission: {
						...agent.permission,
						...(agent.permission.task
							? { task: { ...agent.permission.task } }
							: {}),
					},
				}
			: {}),
	};
}

export function createFlowCoreConfigEntries() {
	const agent = Object.fromEntries(
		Object.entries(FLOW_CORE_AGENTS).map(([name, item]) => [
			name,
			cloneAgentConfig(item),
		]),
	);
	const command = Object.fromEntries(
		Object.entries(FLOW_CORE_COMMANDS).map(([name, item]) => [
			name,
			{ ...item },
		]),
	);
	return { agent, command };
}

export function applyFlowConfig(config: MutableConfig): void {
	const entries = createFlowCoreConfigEntries();
	config.agent = {
		...(config.agent ?? {}),
		...entries.agent,
	};
	config.command = {
		...(config.command ?? {}),
		...entries.command,
	};
}

export function createConfigHook(_ctx: unknown) {
	return async (config: MutableConfig) => {
		applyFlowConfig(config);
	};
}
