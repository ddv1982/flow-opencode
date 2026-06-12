type AgentTools = {
	edit?: boolean;
	write?: boolean;
	bash?: boolean;
};

type AgentPermission = {
	edit?: string;
	bash?: string;
	external_directory?: string;
	task?: Record<string, string>;
};

export type AgentConfigShape = {
	mode?: string;
	description?: string;
	prompt?: string;
	tools?: AgentTools;
	permission?: AgentPermission;
	[key: string]: unknown;
};

export type CommandConfigShape = {
	description?: string;
	agent?: string;
	template?: string;
	[key: string]: unknown;
};

export type MutableConfig = {
	agent?: Record<string, AgentConfigShape>;
	command?: Record<string, CommandConfigShape>;
};

export type FlowPluginHooks = {
	hooks?: Record<string, unknown>;
};
