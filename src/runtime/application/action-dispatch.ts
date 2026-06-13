import type {
	RuntimeToolResponse,
	SessionMutationResult,
	SessionReadResult,
	SessionReadRuntimePort,
	SessionRuntimePort,
	SessionWorkspaceResult,
	SessionWorkspaceRuntimePort,
} from "./action-engine";
import {
	DEFAULT_SESSION_READ_RUNTIME_PORT,
	DEFAULT_SESSION_RUNTIME_PORT,
	DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT,
	runMutationActionAtRoot,
	runRuntimeActionAtRoot,
} from "./action-engine";
import {
	buildMutationAction,
	SESSION_MUTATION_ACTION_NAMES,
	type SessionMutationActionName,
	type SessionMutationPayloadMap,
	type SessionMutationValueMap,
} from "./session-mutation-actions";
import {
	buildReadAction,
	type SessionReadActionName,
	type SessionReadPayloadMap,
	type SessionReadValueMap,
} from "./session-read-actions";
import {
	buildWorkspaceAction,
	SESSION_WORKSPACE_ACTION_NAMES,
	type SessionWorkspaceActionName,
	type SessionWorkspacePayloadMap,
	type SessionWorkspaceValueMap,
} from "./session-workspace-actions";
import {
	resolveMutableSessionRoot,
	resolveReadableSessionRoot,
	type WorkspaceContext,
} from "./workspace-runtime";

type FlowCoreCommandName =
	| SessionWorkspaceActionName
	| SessionMutationActionName;

const WORKSPACE_COMMAND_NAME_SET = new Set<string>(
	SESSION_WORKSPACE_ACTION_NAMES,
);
const MUTATION_COMMAND_NAME_SET = new Set<string>(
	SESSION_MUTATION_ACTION_NAMES,
);

function isWorkspaceCommandName(
	name: string,
): name is SessionWorkspaceActionName {
	return WORKSPACE_COMMAND_NAME_SET.has(name);
}

function isMutationCommandName(
	name: string,
): name is SessionMutationActionName {
	return MUTATION_COMMAND_NAME_SET.has(name);
}

async function runCommand(
	context: WorkspaceContext,
	name: FlowCoreCommandName,
	payload: unknown,
	runtime?: SessionWorkspaceRuntimePort | SessionRuntimePort,
): Promise<
	| SessionWorkspaceResult<
			SessionWorkspaceValueMap[SessionWorkspaceActionName],
			SessionWorkspaceActionName
	  >
	| SessionMutationResult<
			SessionMutationValueMap[SessionMutationActionName],
			SessionMutationActionName
	  >
> {
	const root = resolveMutableSessionRoot(context).root;
	if (isWorkspaceCommandName(name)) {
		return runRuntimeActionAtRoot(
			root,
			buildWorkspaceAction(
				name,
				payload as SessionWorkspacePayloadMap[typeof name],
			),
			(runtime as SessionWorkspaceRuntimePort | undefined) ??
				DEFAULT_SESSION_WORKSPACE_RUNTIME_PORT,
		);
	}
	if (!isMutationCommandName(name)) {
		throw new Error(`Unknown Flow Core command '${name}'.`);
	}
	return runMutationActionAtRoot(
		root,
		buildMutationAction(
			name,
			payload as SessionMutationPayloadMap[typeof name],
		),
		(runtime as SessionRuntimePort | undefined) ?? DEFAULT_SESSION_RUNTIME_PORT,
	) as Promise<
		SessionMutationResult<
			SessionMutationValueMap[SessionMutationActionName],
			SessionMutationActionName
		>
	>;
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
	payload: unknown,
	runtime?: SessionWorkspaceRuntimePort | SessionRuntimePort,
): Promise<unknown> {
	return runCommand(context, name, payload, runtime);
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
	payload: unknown,
	runtime?: SessionWorkspaceRuntimePort | SessionRuntimePort,
): Promise<string> {
	const result = await runCommand(context, name, payload, runtime);
	return JSON.stringify(result.response, null, 2);
}

export async function runFlowCoreQuery<Name extends SessionReadActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionReadPayloadMap[Name],
	runtime: SessionReadRuntimePort = DEFAULT_SESSION_READ_RUNTIME_PORT,
): Promise<SessionReadResult<SessionReadValueMap[Name], Name>> {
	return runRuntimeActionAtRoot(
		resolveReadableSessionRoot(context).root,
		buildReadAction(name, payload),
		runtime,
	);
}

export async function executeFlowCoreQuery<Name extends SessionReadActionName>(
	context: WorkspaceContext,
	name: Name,
	payload: SessionReadPayloadMap[Name],
	runtime?: SessionReadRuntimePort,
): Promise<RuntimeToolResponse> {
	return (await runFlowCoreQuery(context, name, payload, runtime)).response;
}
