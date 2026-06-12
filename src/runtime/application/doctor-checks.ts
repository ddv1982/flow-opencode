import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { applyFlowConfig } from "../../config";
import {
	FLOW_CORE_COMMANDS,
	FLOW_REASONING,
	type FlowReasoningEffort,
} from "../../config-shared";
import {
	detectPreNpmFlowPlugin,
	inspectFlowCommandAgentSyncState,
	inspectFlowSkillSyncState,
	resolveFlowHomeDir,
	resolveFlowPluginVersion,
} from "../../distribution/skill-sync";
import {
	getActiveSessionPath,
	getIndexDocPath,
	InvalidFlowPathInputError,
} from "../paths";
import type { Session } from "../schema";
import type { ResolvedSessionRoot } from "./workspace-runtime";

export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip";

export type DoctorCheck = {
	id: string;
	label: string;
	status: DoctorCheckStatus;
	summary: string;
	remediation: string | null;
	details?: Record<string, unknown>;
};

export type MutableConfig = {
	agent?: Record<
		string,
		{
			agent?: string;
			description?: string;
			reasoningEffort?: FlowReasoningEffort;
		}
	>;
	command?: Record<string, { agent?: string; description?: string }>;
};

const EXPECTED_FLOW_AGENT_REASONING = {
	"flow-reviewer": FLOW_REASONING.deep,
} as const satisfies Record<string, FlowReasoningEffort>;

async function pathExists(target: string, mode = constants.F_OK) {
	try {
		await access(target, mode);
		return true;
	} catch {
		return false;
	}
}

export async function buildInstallCheck(): Promise<DoctorCheck> {
	const homeDir = resolveFlowHomeDir();
	const preNpmCopy = await detectPreNpmFlowPlugin(homeDir);
	const skillState = await inspectFlowSkillSyncState(homeDir);
	const commandAgentState = await inspectFlowCommandAgentSyncState(homeDir);
	const unsyncedSkills = skillState.filter(
		(entry) => entry.state === "missing" || entry.state === "stale",
	);
	const unsyncedCommandsAndAgents = commandAgentState.filter(
		(entry) => entry.state === "missing" || entry.state === "stale",
	);
	const details = {
		distribution: "npm",
		// OpenCode caches plugin installs per spec string and never re-resolves,
		// so the running version is the one fact a stale install can't hide.
		pluginVersion: resolveFlowPluginVersion(),
		preNpmPluginPath: preNpmCopy?.path ?? null,
		skills: Object.fromEntries(
			skillState.map((entry) => [entry.name, entry.state]),
		),
		commandsAndAgents: Object.fromEntries(
			commandAgentState.map((entry) => [
				`${entry.kind}:${entry.name}`,
				entry.state,
			]),
		),
	};

	if (preNpmCopy) {
		return {
			id: "install",
			label: "Plugin distribution",
			status: "warn",
			summary: `A pre-npm Flow plugin copy exists at ${preNpmCopy.path}; Flow now loads from npm via the opencode.json plugin array, so the stale copy risks loading Flow twice.`,
			remediation:
				"Run `bunx opencode-plugin-flow uninstall` (or delete the pre-npm file) and keep `opencode-plugin-flow` in the opencode.json plugin array.",
			details,
		};
	}

	if (unsyncedSkills.length > 0) {
		return {
			id: "install",
			label: "Plugin distribution",
			status: "warn",
			summary: `Flow global skills are not in sync (${unsyncedSkills
				.map((entry) => `${entry.name}: ${entry.state}`)
				.join(", ")}).`,
			remediation:
				"Restart OpenCode so the Flow plugin re-syncs its global skills, and check that ~/.config/opencode/skills is writable.",
			details,
		};
	}

	if (unsyncedCommandsAndAgents.length > 0) {
		return {
			id: "install",
			label: "Plugin distribution",
			status: "warn",
			summary: `Flow global commands or agents are not in sync (${unsyncedCommandsAndAgents
				.map((entry) => `${entry.kind}:${entry.name}: ${entry.state}`)
				.join(", ")}).`,
			remediation:
				"Restart OpenCode so the Flow plugin re-syncs its global commands and agents, and check that ~/.config/opencode/commands and ~/.config/opencode/agents are writable.",
			details,
		};
	}

	return {
		id: "install",
		label: "Plugin distribution",
		status: "pass",
		summary: `Flow ${details.pluginVersion} is npm-distributed: no pre-npm plugin copy is present and Flow global skills, commands, and agents are in sync.`,
		remediation: null,
		details,
	};
}

export function buildConfigCheck(): DoctorCheck {
	const config: MutableConfig = {};
	applyFlowConfig(config);
	return evaluateConfigCheck(config);
}

export function evaluateConfigCheck(config: MutableConfig): DoctorCheck {
	const requiredAgents = Object.keys(EXPECTED_FLOW_AGENT_REASONING);
	const requiredCommands = Object.keys(FLOW_CORE_COMMANDS);
	const missingAgents = requiredAgents.filter((name) => !config.agent?.[name]);
	const missingCommands = requiredCommands.filter(
		(name) => !config.command?.[name],
	);
	const reviewAgent = config.command?.["flow-review"]?.agent;
	const agentReasoningEffort = Object.fromEntries(
		requiredAgents.map((name) => [
			name,
			config.agent?.[name]?.reasoningEffort ?? null,
		]),
	);
	const reasoningMismatches = Object.entries(EXPECTED_FLOW_AGENT_REASONING)
		.filter(
			([name, expected]) => config.agent?.[name]?.reasoningEffort !== expected,
		)
		.map(([name, expected]) => ({
			agent: name,
			expected,
			actual: config.agent?.[name]?.reasoningEffort ?? null,
		}));

	if (
		missingAgents.length === 0 &&
		missingCommands.length === 0 &&
		reviewAgent === "flow-reviewer" &&
		reasoningMismatches.length === 0
	) {
		return {
			id: "config",
			label: "Command and agent injection",
			status: "pass",
			summary:
				"Flow can inject the expected commands, agents, and Flow-owned reasoningEffort budgets.",
			remediation: null,
			details: {
				agentCount: Object.keys(config.agent ?? {}).length,
				commandCount: Object.keys(config.command ?? {}).length,
				commandRouting: {
					"flow-review": reviewAgent,
				},
				agentReasoningEffort,
			},
		};
	}

	return {
		id: "config",
		label: "Command and agent injection",
		status: "fail",
		summary:
			"Flow's injected command, agent, or Flow-owned reasoningEffort surface is incomplete or misrouted.",
		remediation:
			"Rebuild or reinstall Flow, then confirm /flow-review is routed through flow-reviewer and Flow agents carry the expected Flow-injected reasoningEffort budgets.",
		details: {
			missingAgents,
			missingCommands,
			commandRouting: {
				"flow-review": reviewAgent ?? null,
			},
			agentReasoningEffort,
			reasoningMismatches,
		},
	};
}

export async function buildWorkspaceCheck(
	workspace: ResolvedSessionRoot,
): Promise<DoctorCheck> {
	await access(workspace.root, constants.W_OK);
	return {
		id: "workspace",
		label: "Writable workspace root",
		status: "pass",
		summary: workspace.trusted
			? `Flow can resolve and write to the trusted workspace root: ${workspace.root}.`
			: `Flow can resolve and write to the current workspace root: ${workspace.root}.`,
		remediation: null,
		details: {
			workspaceRoot: workspace.root,
			workspaceSource: workspace.source,
			trusted: workspace.trusted,
		},
	};
}

export async function buildSessionArtifactsCheck(
	workspaceRoot: string | null,
	session: Session | null,
): Promise<DoctorCheck> {
	if (!workspaceRoot) {
		return {
			id: "session_artifacts",
			label: "Active session artifacts",
			status: "skip",
			summary:
				"Skipped session artifact checks because Flow could not resolve the workspace root.",
			remediation: null,
		};
	}

	if (!session) {
		return {
			id: "session_artifacts",
			label: "Active session artifacts",
			status: "skip",
			summary:
				"No active Flow session exists, so there are no session artifacts to inspect.",
			remediation: null,
		};
	}

	let sessionPath: string;
	let indexDocPath: string;
	try {
		sessionPath = getActiveSessionPath(workspaceRoot, session.id);
		indexDocPath = getIndexDocPath(workspaceRoot, session.id);
	} catch (error) {
		// A persisted session with a malformed id must degrade to a failing
		// check; throwing here would make flow_status itself unreadable.
		if (error instanceof InvalidFlowPathInputError) {
			return {
				id: "session_artifacts",
				label: "Active session artifacts",
				status: "fail",
				summary: `The active session has a malformed id ('${session.id}'), so Flow cannot resolve its persisted artifacts.`,
				remediation:
					"Inspect `.flow/active/` and repair the session file's id or remove the corrupted session before continuing.",
				details: { sessionId: session.id },
			};
		}
		throw error;
	}
	const hasSessionPath = await pathExists(sessionPath, constants.R_OK);
	const hasIndexDocPath = await pathExists(indexDocPath, constants.R_OK);

	return hasSessionPath && hasIndexDocPath
		? {
				id: "session_artifacts",
				label: "Active session artifacts",
				status: "pass",
				summary:
					"Active session state and rendered docs are both present and readable.",
				remediation: null,
				details: { sessionPath, indexDocPath, sessionId: session.id },
			}
		: {
				id: "session_artifacts",
				label: "Active session artifacts",
				status: "fail",
				summary:
					"Flow found an active session, but one or more persisted session artifacts are missing.",
				remediation:
					"Inspect the active session under `.flow/active/<session-id>/` and repair or recreate the missing artifact before continuing.",
				details: {
					sessionId: session.id,
					sessionPath,
					sessionPathReadable: hasSessionPath,
					indexDocPath,
					indexDocReadable: hasIndexDocPath,
				},
			};
}

export function summarizeDoctorChecks(checks: DoctorCheck[]) {
	const counts = {
		pass: checks.filter((check) => check.status === "pass").length,
		warn: checks.filter((check) => check.status === "warn").length,
		fail: checks.filter((check) => check.status === "fail").length,
		skip: checks.filter((check) => check.status === "skip").length,
	};

	const status = counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "ok";
	const parts = [
		`${counts.pass} passing`,
		`${counts.warn} warning${counts.warn === 1 ? "" : "s"}`,
		`${counts.fail} failure${counts.fail === 1 ? "" : "s"}`,
	];
	if (counts.skip > 0) {
		parts.push(`${counts.skip} skipped`);
	}

	return {
		status: status as "ok" | "warn" | "fail",
		summary: `Flow readiness checks completed with ${parts.join(", ")}.`,
	};
}
