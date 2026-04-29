import type { AuditReportComparisonLookup } from "../../runtime/audit-compare";
import { compareAuditReports } from "../../runtime/audit-compare";
import type { StoredAuditReport } from "../../runtime/audit-history";
import { listAuditReports, loadAuditReport } from "../../runtime/audit-history";
import type { WrittenAuditReport } from "../../runtime/audit-report";
import { writeAuditReport } from "../../runtime/audit-report";
import type { AuditReportArgs } from "../schema";

export type AuditToolResponse = Record<string, unknown>;

export interface AuditReadRuntimePort {
	listAuditReports: typeof listAuditReports;
	loadAuditReport: typeof loadAuditReport;
	compareAuditReports: typeof compareAuditReports;
}

export interface AuditWorkspaceRuntimePort extends AuditReadRuntimePort {
	writeAuditReport: (
		worktree: string,
		report: AuditReportArgs,
	) => Promise<WrittenAuditReport>;
}

export type AuditReadAction<T, Name extends string = string> = {
	name: Name;
	run: (worktree: string, runtime: AuditReadRuntimePort) => Promise<T>;
	onSuccess: (value: T) => AuditToolResponse;
};

export type AuditReadResult<T, Name extends string = string> = {
	actionName: Name;
	value: T;
	response: AuditToolResponse;
};

export type AuditWorkspaceAction<T, Name extends string = string> = {
	name: Name;
	run: (worktree: string, runtime: AuditWorkspaceRuntimePort) => Promise<T>;
	onSuccess: (value: T) => AuditToolResponse;
};

export type AuditWorkspaceResult<T, Name extends string = string> = {
	actionName: Name;
	value: T;
	response: AuditToolResponse;
};

type RuntimeAction<Name extends string, T, Port> = {
	name: Name;
	run: (worktree: string, runtime: Port) => Promise<T>;
	onSuccess: (value: T) => AuditToolResponse;
};

export const DEFAULT_AUDIT_READ_RUNTIME_PORT: AuditReadRuntimePort = {
	listAuditReports,
	loadAuditReport,
	compareAuditReports,
};

export const DEFAULT_AUDIT_WORKSPACE_RUNTIME_PORT: AuditWorkspaceRuntimePort = {
	...DEFAULT_AUDIT_READ_RUNTIME_PORT,
	writeAuditReport,
};

function actionSuccessResult<T, Name extends string>(
	actionName: Name,
	value: T,
	response: AuditToolResponse,
) {
	return { actionName, value, response };
}

async function runRuntimeActionAtRoot<T, Name extends string, Port>(
	worktree: string,
	action: RuntimeAction<Name, T, Port>,
	runtime: Port,
) {
	const value = await action.run(worktree, runtime);
	return actionSuccessResult(action.name, value, action.onSuccess(value));
}

export async function runAuditReadActionAtRoot<T, Name extends string>(
	worktree: string,
	action: AuditReadAction<T, Name>,
	runtime: AuditReadRuntimePort = DEFAULT_AUDIT_READ_RUNTIME_PORT,
): Promise<AuditReadResult<T, Name>> {
	return runRuntimeActionAtRoot(worktree, action, runtime);
}

export async function executeAuditReadActionAtRoot<T, Name extends string>(
	worktree: string,
	action: AuditReadAction<T, Name>,
	runtime: AuditReadRuntimePort = DEFAULT_AUDIT_READ_RUNTIME_PORT,
): Promise<AuditToolResponse> {
	return (await runAuditReadActionAtRoot(worktree, action, runtime)).response;
}

export async function runAuditWorkspaceActionAtRoot<T, Name extends string>(
	worktree: string,
	action: AuditWorkspaceAction<T, Name>,
	runtime: AuditWorkspaceRuntimePort = DEFAULT_AUDIT_WORKSPACE_RUNTIME_PORT,
): Promise<AuditWorkspaceResult<T, Name>> {
	return runRuntimeActionAtRoot(worktree, action, runtime);
}

export async function executeAuditWorkspaceActionAtRoot<T, Name extends string>(
	worktree: string,
	action: AuditWorkspaceAction<T, Name>,
	runtime: AuditWorkspaceRuntimePort = DEFAULT_AUDIT_WORKSPACE_RUNTIME_PORT,
): Promise<AuditToolResponse> {
	return (await runAuditWorkspaceActionAtRoot(worktree, action, runtime))
		.response;
}

export type {
	AuditReportComparisonLookup,
	StoredAuditReport,
	WrittenAuditReport,
};
