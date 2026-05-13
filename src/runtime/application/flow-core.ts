import {
	executeDispatchedSessionMutation,
	runDispatchedSessionMutationAction,
	SESSION_MUTATION_ACTION_NAMES,
	type SessionMutationActionName,
	type SessionMutationPayloadMap,
	type SessionMutationValueMap,
} from "./session-actions";
import type {
	RuntimeToolResponse,
	SessionMutationResult,
	SessionReadResult,
	SessionReadRuntimePort,
	SessionRuntimePort,
	SessionWorkspaceResult,
	SessionWorkspaceRuntimePort,
} from "./session-engine";
import {
	executeDispatchedSessionReadAction,
	runDispatchedSessionReadAction,
	SESSION_READ_ACTION_NAMES,
	type SessionReadActionName,
	type SessionReadPayloadMap,
	type SessionReadValueMap,
} from "./session-read-actions";
import {
	executeDispatchedSessionWorkspaceAction,
	runDispatchedSessionWorkspaceAction,
	SESSION_WORKSPACE_ACTION_NAMES,
	type SessionWorkspaceActionName,
	type SessionWorkspacePayloadMap,
	type SessionWorkspaceValueMap,
} from "./session-workspace-actions";
import type { WorkspaceContext } from "./workspace-runtime";

/**
 * Flow Core vNext authority contract.
 *
 * This module is intentionally a facade, not a second state engine:
 * - commands are the compact write/lifecycle surface;
 * - queries are the compact read surface;
 * - session state remains the persisted `Session` snapshot;
 * - behavior remains owned by `src/runtime/transitions/**`;
 * - persistence remains owned by `session-engine` load -> transition -> save -> sync.
 */
export const FLOW_CORE_VNEXT_CONTRACT = {
	version: "flow-core-vnext/2026-05-07",
	commandAuthority: "src/runtime/application/session-actions.ts",
	workspaceCommandAuthority:
		"src/runtime/application/session-workspace-actions.ts",
	queryAuthority: "src/runtime/application/session-read-actions.ts",
	transitionAuthority: "src/runtime/transitions/**",
	persistenceAuthority: "src/runtime/application/session-engine.ts",
	persistenceMode: "snapshot-first",
} as const;

export const FLOW_CORE_COMMAND_NAMES = [
	...SESSION_WORKSPACE_ACTION_NAMES,
	...SESSION_MUTATION_ACTION_NAMES,
] as const;

export const FLOW_CORE_QUERY_NAMES = SESSION_READ_ACTION_NAMES;

export type FlowCoreCommandName =
	| SessionWorkspaceActionName
	| SessionMutationActionName;
export type FlowCoreQueryName = SessionReadActionName;

export type FlowCoreCommandPayloadMap = SessionWorkspacePayloadMap &
	SessionMutationPayloadMap;
export type FlowCoreCommandValueMap = SessionWorkspaceValueMap &
	SessionMutationValueMap;
export type FlowCoreQueryPayloadMap = SessionReadPayloadMap;
export type FlowCoreQueryValueMap = SessionReadValueMap;

export type FlowCoreCommandResult<Name extends FlowCoreCommandName> =
	Name extends SessionWorkspaceActionName
		? SessionWorkspaceResult<SessionWorkspaceValueMap[Name], Name>
		: Name extends SessionMutationActionName
			? SessionMutationResult<SessionMutationValueMap[Name], Name>
			: never;

export type FlowCoreQueryResult<Name extends FlowCoreQueryName> =
	SessionReadResult<SessionReadValueMap[Name], Name>;

const FLOW_CORE_WORKSPACE_COMMAND_NAME_SET = new Set<string>(
	SESSION_WORKSPACE_ACTION_NAMES,
);
const FLOW_CORE_MUTATION_COMMAND_NAME_SET = new Set<string>(
	SESSION_MUTATION_ACTION_NAMES,
);

export function isFlowCoreWorkspaceCommandName(
	name: string,
): name is SessionWorkspaceActionName {
	return FLOW_CORE_WORKSPACE_COMMAND_NAME_SET.has(name);
}

export function isFlowCoreMutationCommandName(
	name: string,
): name is SessionMutationActionName {
	return FLOW_CORE_MUTATION_COMMAND_NAME_SET.has(name);
}

function unknownFlowCoreCommandError(name: string): Error {
	return new Error(`Unknown Flow Core command '${name}'.`);
}

export function runFlowCoreCommand<Name extends SessionWorkspaceActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
	runtime?: SessionWorkspaceRuntimePort,
): Promise<SessionWorkspaceResult<SessionWorkspaceValueMap[Name], Name>>;
export function runFlowCoreCommand<Name extends SessionMutationActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionMutationPayloadMap[Name],
	runtime?: SessionRuntimePort,
): Promise<SessionMutationResult<SessionMutationValueMap[Name], Name>>;
export async function runFlowCoreCommand(
	context: WorkspaceContext,
	name: FlowCoreCommandName,
	payload:
		| SessionWorkspacePayloadMap[SessionWorkspaceActionName]
		| SessionMutationPayloadMap[SessionMutationActionName],
	runtime?: SessionWorkspaceRuntimePort | SessionRuntimePort,
): Promise<FlowCoreCommandResult<FlowCoreCommandName>> {
	if (isFlowCoreWorkspaceCommandName(name)) {
		return runDispatchedSessionWorkspaceAction(
			context,
			name,
			payload as SessionWorkspacePayloadMap[typeof name],
			runtime as SessionWorkspaceRuntimePort | undefined,
		) as Promise<FlowCoreCommandResult<FlowCoreCommandName>>;
	}

	if (!isFlowCoreMutationCommandName(name)) {
		throw unknownFlowCoreCommandError(name);
	}

	return runDispatchedSessionMutationAction(
		context,
		name,
		payload as SessionMutationPayloadMap[typeof name],
		runtime as SessionRuntimePort | undefined,
	) as Promise<FlowCoreCommandResult<FlowCoreCommandName>>;
}

export function executeFlowCoreCommand<Name extends SessionWorkspaceActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionWorkspacePayloadMap[Name],
	runtime?: SessionWorkspaceRuntimePort,
): Promise<string>;
export function executeFlowCoreCommand<Name extends SessionMutationActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionMutationPayloadMap[Name],
	runtime?: SessionRuntimePort,
): Promise<string>;
export async function executeFlowCoreCommand(
	context: WorkspaceContext,
	name: FlowCoreCommandName,
	payload:
		| SessionWorkspacePayloadMap[SessionWorkspaceActionName]
		| SessionMutationPayloadMap[SessionMutationActionName],
	runtime?: SessionWorkspaceRuntimePort | SessionRuntimePort,
): Promise<string> {
	if (isFlowCoreWorkspaceCommandName(name)) {
		return executeDispatchedSessionWorkspaceAction(
			context,
			name,
			payload as SessionWorkspacePayloadMap[typeof name],
			runtime as SessionWorkspaceRuntimePort | undefined,
		);
	}

	if (!isFlowCoreMutationCommandName(name)) {
		throw unknownFlowCoreCommandError(name);
	}

	return executeDispatchedSessionMutation(
		context,
		name,
		payload as SessionMutationPayloadMap[typeof name],
		runtime as SessionRuntimePort | undefined,
	);
}

export function runFlowCoreQuery<Name extends FlowCoreQueryName>(
	context: WorkspaceContext,
	name: Name,
	payload: FlowCoreQueryPayloadMap[Name],
	runtime?: SessionReadRuntimePort,
): Promise<FlowCoreQueryResult<Name>> {
	return runDispatchedSessionReadAction(context, name, payload, runtime);
}

export function executeFlowCoreQuery<Name extends FlowCoreQueryName>(
	context: WorkspaceContext,
	name: Name,
	payload: FlowCoreQueryPayloadMap[Name],
	runtime?: SessionReadRuntimePort,
): Promise<RuntimeToolResponse> {
	return executeDispatchedSessionReadAction(context, name, payload, runtime);
}
