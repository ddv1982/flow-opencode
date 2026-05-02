export const FLOW_READ_ONLY_PERMISSION = {
	edit: "deny",
	bash: "deny",
	task: {
		"*": "deny",
	},
} as const;
