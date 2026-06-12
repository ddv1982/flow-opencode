import type { Session } from "../schema";
import { InvalidFlowWorkspaceRootError } from "../workspace-root";
import {
	buildConfigCheck,
	buildInstallCheck,
	buildSessionArtifactsCheck,
	buildWorkspaceCheck,
	type DoctorCheck,
	summarizeDoctorChecks,
} from "./doctor-checks";
import {
	inspectWorkspaceContext,
	resolveMutableSessionRoot,
	type WorkspaceContext,
} from "./workspace-runtime";

export type WorkspaceReadiness = {
	status: "ok" | "warn" | "fail";
	summary: string;
	checks: DoctorCheck[];
};

/**
 * Doctor-style readiness checks folded into `flow_status` output: install
 * state, config injection, writable workspace root, and active session
 * artifacts. Non-destructive.
 */
export async function buildWorkspaceReadiness(
	context: WorkspaceContext,
	session: Session | null,
): Promise<WorkspaceReadiness> {
	const installCheck = await buildInstallCheck();
	const configCheck = buildConfigCheck();
	const workspace = inspectWorkspaceContext(context);

	let workspaceRoot: string | null = null;
	let workspaceCheck: DoctorCheck;

	try {
		const mutableWorkspace = resolveMutableSessionRoot(context);
		workspaceRoot = mutableWorkspace.root;
		workspaceCheck = await buildWorkspaceCheck(mutableWorkspace);
	} catch (error: unknown) {
		const workspaceDetails =
			error instanceof InvalidFlowWorkspaceRootError
				? {
						workspaceRoot: error.details.root,
						workspaceSource: error.details.source,
						trusted: error.details.trusted,
						rejectionReason: error.details.rejectionReason,
					}
				: workspace.root
					? {
							workspaceRoot: workspace.root,
							workspaceSource: workspace.source,
							trusted: workspace.trusted,
							rejectionReason: workspace.rejectionReason,
						}
					: null;
		workspaceCheck = {
			id: "workspace",
			label: "Writable workspace root",
			status: "fail",
			summary:
				error instanceof InvalidFlowWorkspaceRootError
					? error.summary
					: error instanceof Error
						? error.message
						: "Flow could not resolve a writable workspace root.",
			remediation:
				error instanceof InvalidFlowWorkspaceRootError
					? error.remediation
					: "Run Flow from a writable project or worktree directory so it can manage .flow state.",
			...(workspaceDetails ? { details: workspaceDetails } : {}),
		};
	}

	const sessionArtifactsCheck = await buildSessionArtifactsCheck(
		workspaceRoot,
		session,
	);

	const checks = [
		installCheck,
		configCheck,
		workspaceCheck,
		sessionArtifactsCheck,
	];
	const overall = summarizeDoctorChecks(checks);
	return { status: overall.status, summary: overall.summary, checks };
}

export function compactWorkspaceReadiness(readiness: WorkspaceReadiness) {
	return {
		status: readiness.status,
		summary: readiness.summary,
		issues: readiness.checks
			.filter((check) => check.status === "warn" || check.status === "fail")
			.map((check) => ({
				id: check.id,
				label: check.label,
				status: check.status,
				summary: check.summary,
				remediation: check.remediation,
			})),
	};
}
