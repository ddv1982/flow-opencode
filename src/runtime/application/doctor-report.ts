import { deriveSessionViewModel } from "../summary";
import { InvalidFlowWorkspaceRootError } from "../workspace-root";
import {
	buildConfigCheck,
	buildGuidanceCheck,
	buildInstallCheck,
	buildSessionArtifactsCheck,
	buildWorkspaceCheck,
	type DoctorCheck,
	summarizeDoctorChecks,
} from "./doctor-checks";
import { renderDoctorSummary } from "./operator-presenters";
import { runDispatchedSessionReadAction } from "./session-read-actions";
import {
	inspectWorkspaceContext,
	resolveMutableSessionRoot,
	toCompactJson,
	toJson,
	type WorkspaceContext,
} from "./workspace-runtime";

type FlowDoctorView = "detailed" | "compact";

export async function buildDoctorReport(
	context: WorkspaceContext,
	args: { view?: FlowDoctorView } = {},
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

	const session = workspaceRoot
		? (
				await runDispatchedSessionReadAction(
					{ worktree: workspaceRoot },
					"load_status_session",
					undefined,
				)
			).value
		: null;
	const sessionViewModel = deriveSessionViewModel(session);
	const sessionSummary = sessionViewModel.session;
	const sessionGuidance = sessionViewModel.guidance;
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
		sessionGuidance,
		sessionGuidance.nextStep,
		sessionGuidance.nextCommand,
	);

	if ((args.view ?? "detailed") === "compact") {
		return toCompactJson({
			status: overall.status,
			summary: overall.summary,
			phase: sessionGuidance.phase,
			lane: sessionGuidance.lane,
			blocker: sessionGuidance.blocker,
			reason: sessionGuidance.reason,
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
		phase: sessionGuidance.phase,
		lane: sessionGuidance.lane,
		blocker: sessionGuidance.blocker,
		reason: sessionGuidance.reason,
		workspaceRoot: workspace.root,
		workspace,
		checks,
		session: sessionSummary,
		guidance: sessionGuidance,
		operatorSummary,
		nextCommand: sessionGuidance.nextCommand,
	});
}
