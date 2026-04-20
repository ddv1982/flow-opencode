import {
	InvalidFlowWorkspaceRootError,
	inspectWorkspaceContext,
	resolveMutableSessionRoot,
	toCompactJson,
	toJson,
} from "../../runtime/application";
import { loadSession } from "../../runtime/session";
import { explainSessionState, summarizeSession } from "../../runtime/summary";
import type { FlowDoctorArgs, ToolContext } from "../schemas";
import type { DoctorCheck } from "./doctor-checks";
import {
	buildGuidanceCheck,
	buildInstallCheck,
	buildSessionArtifactsCheck,
	buildWorkspaceCheck,
	summarizeDoctorChecks,
} from "./doctor-checks";
import { buildConfigCheck } from "./doctor-config";

function renderDoctorSummary(
	status: "ok" | "warn" | "fail",
	checks: DoctorCheck[],
	nextStep: string,
	nextCommand: string,
) {
	const firstIssue =
		checks.find((check) => check.status === "fail") ??
		checks.find((check) => check.status === "warn");

	if (!firstIssue) {
		return [
			"Flow doctor ok: No blocking readiness issues found.",
			`Next: ${nextStep}`,
			`Command: ${nextCommand}`,
		].join("\n");
	}

	const lines = [`Flow doctor ${status}: ${firstIssue.summary}`];
	if (firstIssue.remediation) {
		lines.push(`Fix: ${firstIssue.remediation}`);
	}
	lines.push(`Then: ${nextStep}`);
	lines.push(`Command: ${nextCommand}`);
	return lines.join("\n");
}

export async function buildDoctorReport(
	context: ToolContext,
	args: FlowDoctorArgs = {},
): Promise<string> {
	const installCheck = await buildInstallCheck();
	const configCheck = buildConfigCheck();
	const workspace = inspectWorkspaceContext(context);

	let workspaceRoot: string | null = null;
	let workspaceCheck: DoctorCheck;

	try {
		const mutableWorkspace = resolveMutableSessionRoot(context);
		workspaceRoot = mutableWorkspace.root;
		workspaceCheck = await buildWorkspaceCheck(mutableWorkspace);
	} catch (error) {
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

	const session = workspaceRoot ? await loadSession(workspaceRoot) : null;
	const sessionSummary = summarizeSession(session);
	const sessionGuidance = explainSessionState(session);
	const sessionArtifactsCheck = await buildSessionArtifactsCheck(
		workspaceRoot,
		session,
	);
	const guidanceCheck = buildGuidanceCheck(session, sessionGuidance);

	const checks = [
		installCheck,
		configCheck,
		workspaceCheck,
		sessionArtifactsCheck,
		guidanceCheck,
	];
	const overall = summarizeDoctorChecks(checks);
	const operatorSummary = renderDoctorSummary(
		overall.status,
		checks,
		sessionGuidance.nextStep,
		sessionGuidance.nextCommand,
	);

	if ((args.view ?? "detailed") === "compact") {
		return toCompactJson({
			status: overall.status,
			summary: overall.summary,
			guidance: sessionGuidance,
			operatorSummary,
			nextCommand: sessionGuidance.nextCommand,
			workspaceRoot: workspace.root,
			workspace,
			issues: checks
				.filter((check) => check.status === "warn" || check.status === "fail")
				.map((check) => ({
					id: check.id,
					label: check.label,
					status: check.status,
					summary: check.summary,
					remediation: check.remediation,
				})),
		});
	}

	return toJson({
		status: overall.status,
		summary: overall.summary,
		workspaceRoot: workspace.root,
		workspace,
		checks,
		session: sessionSummary.session ?? null,
		guidance: sessionGuidance,
		operatorSummary,
		nextCommand: sessionGuidance.nextCommand,
	});
}
