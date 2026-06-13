/**
 * Compatibility facade for Flow application actions. The registries live in
 * focused modules by action boundary; this file keeps the public import path
 * stable for adapters and tests.
 */
export {
	executeFlowCoreCommand,
	executeFlowCoreQuery,
	runFlowCoreCommand,
	runFlowCoreQuery,
} from "./action-dispatch";
export type {
	SessionMutationActionName,
	SessionMutationPayloadMap,
} from "./session-mutation-actions";
export { SESSION_MUTATION_ACTION_NAMES } from "./session-mutation-actions";
export type {
	SessionReadActionName,
	SessionReadPayloadMap,
	SessionReadValueMap,
} from "./session-read-actions";
export { SESSION_READ_ACTION_NAMES } from "./session-read-actions";
export type {
	SessionWorkspaceActionName,
	SessionWorkspacePayloadMap,
	SessionWorkspaceValueMap,
} from "./session-workspace-actions";
export { SESSION_WORKSPACE_ACTION_NAMES } from "./session-workspace-actions";
