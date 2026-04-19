import { toCompactJson, toJson } from "../../runtime/application";
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
import { resolveToolSessionRoot } from "./shared";

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

	let workspaceRoot: string | null = null;
	let workspaceCheck: DoctorCheck;

	try {
		workspaceRoot = resolveToolSessionRoot(context);
		workspaceCheck = await buildWorkspaceCheck(workspaceRoot);
	} catch (error) {
		workspaceCheck = {
			id: "workspace",
			label: "Writable workspace root",
			status: "fail",
			summary:
				error instanceof Error
					? error.message
					: "Flow could not resolve a writable workspace root.",
			remediation:
				"Run Flow from a writable project or worktree directory so it can manage .flow state.",
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
		workspaceRoot,
		checks,
		session: sessionSummary.session ?? null,
		guidance: sessionGuidance,
		operatorSummary,
		nextCommand: sessionGuidance.nextCommand,
	});
}
