import { applyFlowConfig } from "../../config";
import type { DoctorCheck } from "./doctor-checks";

type MutableConfig = {
	agent?: Record<string, { agent?: string; description?: string }>;
	command?: Record<string, { agent?: string; description?: string }>;
};

export function buildConfigCheck(): DoctorCheck {
	const config: MutableConfig = {};
	applyFlowConfig(config);

	const requiredAgents = [
		"flow-planner",
		"flow-worker",
		"flow-auto",
		"flow-reviewer",
		"flow-control",
	];
	const requiredCommands = [
		"flow-plan",
		"flow-run",
		"flow-auto",
		"flow-status",
		"flow-doctor",
		"flow-history",
		"flow-session",
		"flow-reset",
	];
	const missingAgents = requiredAgents.filter((name) => !config.agent?.[name]);
	const missingCommands = requiredCommands.filter(
		(name) => !config.command?.[name],
	);
	const doctorAgent = config.command?.["flow-doctor"]?.agent;

	if (
		missingAgents.length === 0 &&
		missingCommands.length === 0 &&
		doctorAgent === "flow-control"
	) {
		return {
			id: "config",
			label: "Command and agent injection",
			status: "pass",
			summary:
				"Flow can inject the expected commands and agents, including /flow-doctor through flow-control.",
			remediation: null,
			details: {
				agentCount: Object.keys(config.agent ?? {}).length,
				commandCount: Object.keys(config.command ?? {}).length,
			},
		};
	}

	return {
		id: "config",
		label: "Command and agent injection",
		status: "fail",
		summary:
			"Flow's injected command or agent surface is incomplete or misrouted.",
		remediation:
			"Rebuild or reinstall Flow, then confirm /flow-doctor is routed through flow-control.",
		details: {
			missingAgents,
			missingCommands,
			doctorAgent: doctorAgent ?? null,
		},
	};
}
