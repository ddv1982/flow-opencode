import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolveInstallTarget } from "../../installer";
import type { ResolvedSessionRoot } from "../../runtime/application";
import { getActiveSessionPath, getIndexDocPath } from "../../runtime/paths";
import type { Session } from "../../runtime/schema";
import type { SessionGuidance } from "../../runtime/summary";

export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip";

export type DoctorCheck = {
	id: string;
	label: string;
	status: DoctorCheckStatus;
	summary: string;
	remediation: string | null;
	details?: Record<string, unknown>;
};

async function pathExists(target: string, mode = constants.F_OK) {
	try {
		await access(target, mode);
		return true;
	} catch {
		return false;
	}
}

export async function buildInstallCheck(): Promise<DoctorCheck> {
	const installPath = resolveInstallTarget({
		homeDir: process.env.HOME ?? homedir(),
	});

	return (await pathExists(installPath))
		? {
				id: "install",
				label: "Canonical install path",
				status: "pass",
				summary: `Found the canonical Flow plugin install at ${installPath}.`,
				remediation: null,
				details: { installPath },
			}
		: {
				id: "install",
				label: "Canonical install path",
				status: "warn",
				summary: `The canonical Flow plugin file was not found at ${installPath}.`,
				remediation:
					"Run `bun run install:opencode` from the Flow repo or reinstall the latest release if OpenCode cannot load Flow.",
				details: { installPath },
			};
}

export async function buildWorkspaceCheck(
	workspace: ResolvedSessionRoot,
): Promise<DoctorCheck> {
	await access(workspace.root, constants.W_OK);
	return {
		id: "workspace",
		label: "Writable workspace root",
		status: "pass",
		summary: workspace.trusted
			? `Flow can resolve and write to the trusted workspace root: ${workspace.root}.`
			: `Flow can resolve and write to the current workspace root: ${workspace.root}.`,
		remediation: null,
		details: {
			workspaceRoot: workspace.root,
			workspaceSource: workspace.source,
			trusted: workspace.trusted,
		},
	};
}

export async function buildSessionArtifactsCheck(
	workspaceRoot: string | null,
	session: Session | null,
): Promise<DoctorCheck> {
	if (!workspaceRoot) {
		return {
			id: "session_artifacts",
			label: "Active session artifacts",
			status: "skip",
			summary:
				"Skipped session artifact checks because Flow could not resolve the workspace root.",
			remediation: null,
		};
	}

	if (!session) {
		return {
			id: "session_artifacts",
			label: "Active session artifacts",
			status: "skip",
			summary:
				"No active Flow session exists, so there are no session artifacts to inspect.",
			remediation: null,
		};
	}

	const sessionPath = getActiveSessionPath(workspaceRoot, session.id);
	const indexDocPath = getIndexDocPath(workspaceRoot, session.id);
	const hasSessionPath = await pathExists(sessionPath, constants.R_OK);
	const hasIndexDocPath = await pathExists(indexDocPath, constants.R_OK);

	return hasSessionPath && hasIndexDocPath
		? {
				id: "session_artifacts",
				label: "Active session artifacts",
				status: "pass",
				summary:
					"Active session state and rendered docs are both present and readable.",
				remediation: null,
				details: { sessionPath, indexDocPath, sessionId: session.id },
			}
		: {
				id: "session_artifacts",
				label: "Active session artifacts",
				status: "fail",
				summary:
					"Flow found an active session, but one or more persisted session artifacts are missing.",
				remediation:
					"Inspect the active session under `.flow/active/<session-id>/` and repair or recreate the missing artifact before continuing.",
				details: {
					sessionId: session.id,
					sessionPath,
					sessionPathReadable: hasSessionPath,
					indexDocPath,
					indexDocReadable: hasIndexDocPath,
				},
			};
}

export function buildGuidanceCheck(
	session: Session | null,
	sessionGuidance: SessionGuidance,
): DoctorCheck {
	return !session
		? {
				id: "guidance",
				label: "Runtime guidance",
				status: "skip",
				summary:
					"No active Flow session exists, so runtime blocker guidance is not needed yet.",
				remediation: null,
				details: sessionGuidance,
			}
		: {
				id: "guidance",
				label: "Runtime guidance",
				status: "pass",
				summary: sessionGuidance.summary,
				remediation: null,
				details: sessionGuidance,
			};
}

export function summarizeDoctorChecks(checks: DoctorCheck[]) {
	const counts = {
		pass: checks.filter((check) => check.status === "pass").length,
		warn: checks.filter((check) => check.status === "warn").length,
		fail: checks.filter((check) => check.status === "fail").length,
		skip: checks.filter((check) => check.status === "skip").length,
	};

	const status = counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "ok";
	const parts = [
		`${counts.pass} passing`,
		`${counts.warn} warning${counts.warn === 1 ? "" : "s"}`,
		`${counts.fail} failure${counts.fail === 1 ? "" : "s"}`,
	];
	if (counts.skip > 0) {
		parts.push(`${counts.skip} skipped`);
	}

	return {
		status: status as "ok" | "warn" | "fail",
		summary: `Flow doctor completed with ${parts.join(", ")}.`,
	};
}
