import {
	resolveMutableSessionRoot,
	resolveReadableSessionRoot,
	toJson,
	type WorkspaceContext,
} from "../../runtime/application/workspace-runtime";
import type { AuditReportArgs } from "../schema";
import {
	type AuditReadAction,
	type AuditReadResult,
	type AuditReadRuntimePort,
	type AuditWorkspaceAction,
	type AuditWorkspaceResult,
	type AuditWorkspaceRuntimePort,
	DEFAULT_AUDIT_READ_RUNTIME_PORT,
	DEFAULT_AUDIT_WORKSPACE_RUNTIME_PORT,
	executeAuditReadActionAtRoot,
	executeAuditWorkspaceActionAtRoot,
	runAuditReadActionAtRoot,
	runAuditWorkspaceActionAtRoot,
} from "./audit-engine";

export const AUDIT_READ_ACTION_NAMES = [
	"list_audit_reports",
	"load_audit_report",
	"compare_audit_reports",
] as const;

export type AuditReadActionName = (typeof AUDIT_READ_ACTION_NAMES)[number];

export type AuditReadPayloadMap = {
	list_audit_reports: undefined;
	load_audit_report: { reportId: string };
	compare_audit_reports: { leftReportId: string; rightReportId: string };
};

export type AuditReadValueMap = {
	list_audit_reports: Awaited<
		ReturnType<AuditReadRuntimePort["listAuditReports"]>
	>;
	load_audit_report: Awaited<
		ReturnType<AuditReadRuntimePort["loadAuditReport"]>
	>;
	compare_audit_reports: Awaited<
		ReturnType<AuditReadRuntimePort["compareAuditReports"]>
	>;
};

export const AUDIT_WORKSPACE_ACTION_NAMES = ["write_audit_report"] as const;
export type AuditWorkspaceActionName =
	(typeof AUDIT_WORKSPACE_ACTION_NAMES)[number];

export type AuditWorkspacePayloadMap = {
	write_audit_report: {
		report: AuditReportArgs;
		nextCommand?: string;
	};
};

export type AuditWorkspaceValueMap = {
	write_audit_report: Awaited<
		ReturnType<AuditWorkspaceRuntimePort["writeAuditReport"]>
	>;
};

type AuditReadActionHandlerMap = {
	[Name in AuditReadActionName]: (
		payload: AuditReadPayloadMap[Name],
	) => AuditReadAction<AuditReadValueMap[Name], Name>;
};

type AuditWorkspaceActionHandlerMap = {
	[Name in AuditWorkspaceActionName]: (
		payload: AuditWorkspacePayloadMap[Name],
	) => AuditWorkspaceAction<AuditWorkspaceValueMap[Name], Name>;
};

export const AUDIT_READ_ACTION_HANDLERS: AuditReadActionHandlerMap = {
	list_audit_reports() {
		return {
			name: "list_audit_reports",
			run: (worktree, runtime) => runtime.listAuditReports(worktree),
			onSuccess: (history) => ({ status: "ok", history }),
		};
	},
	load_audit_report({ reportId }) {
		return {
			name: "load_audit_report",
			run: (worktree, runtime) => runtime.loadAuditReport(worktree, reportId),
			onSuccess: (report) => ({
				status: report ? "ok" : "missing_audit",
				report,
			}),
		};
	},
	compare_audit_reports({ leftReportId, rightReportId }) {
		return {
			name: "compare_audit_reports",
			run: (worktree, runtime) =>
				runtime.compareAuditReports(worktree, leftReportId, rightReportId),
			onSuccess: (comparison) => ({
				status: comparison.comparison ? "ok" : "missing_audit",
				comparison,
			}),
		};
	},
};

export const AUDIT_WORKSPACE_ACTION_HANDLERS: AuditWorkspaceActionHandlerMap = {
	write_audit_report({ report, nextCommand }) {
		return {
			name: "write_audit_report",
			run: (worktree, runtime) => runtime.writeAuditReport(worktree, report),
			onSuccess: (value) => ({
				status: "ok",
				summary: "Persisted Flow audit report artifacts.",
				reportDir: value.reportDir,
				jsonPath: value.jsonPath,
				markdownPath: value.markdownPath,
				report: value.report,
				...(nextCommand ? { nextCommand } : {}),
			}),
		};
	},
};

export function dispatchAuditReadAction<Name extends AuditReadActionName>(
	name: Name,
	payload: AuditReadPayloadMap[Name],
): AuditReadAction<AuditReadValueMap[Name], Name> {
	return AUDIT_READ_ACTION_HANDLERS[name](payload);
}

export function dispatchAuditWorkspaceAction<
	Name extends AuditWorkspaceActionName,
>(
	name: Name,
	payload: AuditWorkspacePayloadMap[Name],
): AuditWorkspaceAction<AuditWorkspaceValueMap[Name], Name> {
	return AUDIT_WORKSPACE_ACTION_HANDLERS[name](payload);
}

export async function executeDispatchedAuditReadAction<
	Name extends AuditReadActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: AuditReadPayloadMap[Name],
	runtime: AuditReadRuntimePort = DEFAULT_AUDIT_READ_RUNTIME_PORT,
) {
	return executeAuditReadActionAtRoot(
		resolveReadableSessionRoot(context).root,
		dispatchAuditReadAction(name, payload),
		runtime,
	);
}

export async function runDispatchedAuditReadAction<
	Name extends AuditReadActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: AuditReadPayloadMap[Name],
	runtime: AuditReadRuntimePort = DEFAULT_AUDIT_READ_RUNTIME_PORT,
): Promise<AuditReadResult<AuditReadValueMap[Name], Name>> {
	return runAuditReadActionAtRoot(
		resolveReadableSessionRoot(context).root,
		dispatchAuditReadAction(name, payload),
		runtime,
	);
}

export async function executeDispatchedAuditWorkspaceAction<
	Name extends AuditWorkspaceActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: AuditWorkspacePayloadMap[Name],
	runtime: AuditWorkspaceRuntimePort = DEFAULT_AUDIT_WORKSPACE_RUNTIME_PORT,
): Promise<string> {
	const response = await executeAuditWorkspaceActionAtRoot(
		resolveMutableSessionRoot(context).root,
		dispatchAuditWorkspaceAction(name, payload),
		runtime,
	);
	return toJson(response);
}

export async function runDispatchedAuditWorkspaceAction<
	Name extends AuditWorkspaceActionName,
>(
	context: WorkspaceContext,
	name: Name,
	payload: AuditWorkspacePayloadMap[Name],
	runtime: AuditWorkspaceRuntimePort = DEFAULT_AUDIT_WORKSPACE_RUNTIME_PORT,
): Promise<AuditWorkspaceResult<AuditWorkspaceValueMap[Name], Name>> {
	return runAuditWorkspaceActionAtRoot(
		resolveMutableSessionRoot(context).root,
		dispatchAuditWorkspaceAction(name, payload),
		runtime,
	);
}
