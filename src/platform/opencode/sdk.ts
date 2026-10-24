export { Agent, Model, Plugin, Provider } from "@opencode/plugin";
export type { Context as PluginContext } from "@opencode/plugin/promise/plugin";
export type {
	Info as NativeToolDefinition,
	ToolContext,
} from "@opencode/plugin/promise/tool";
export type NativeToolHook = Parameters<
	Parameters<
		import("@opencode/plugin/promise/plugin").Context["tool"]["hook"]
	>[1]
>[0];
export type NativeToolBefore = Exclude<NativeToolHook, { status: string }>;
export type NativeToolAfter = Extract<NativeToolHook, { status: string }>;
export type {
	OpenCodeEvent,
	SessionInfo,
	SessionMessageInfo,
} from "@opencode/client";
export type { Registration } from "@opencode/plugin/promise/registration";
export type {
	SessionContext,
	SessionPrompt,
} from "@opencode/plugin/promise/session";
export {
	CallID,
	Error as NativeToolError,
} from "@opencode/plugin/promise/tool";
export { AbsolutePath } from "@opencode/schema/schema";
export { Session } from "@opencode/schema/session";
export { SessionMessage } from "@opencode/schema/session-message";
