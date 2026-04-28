import type { Session } from "../schema";
import { deriveSessionViewModel, type SessionGuidance } from "../summary";
import type { DoctorCheck } from "./doctor-checks";

export function renderSessionStatusSummary(
	session: Session | null,
	options?: { nextCommand?: string; nextStep?: string },
): string {
	const viewModel = deriveSessionViewModel(session);
	const lines = [
		`Flow ${viewModel.guidance.status}: ${viewModel.guidance.summary}`,
	];

	if (viewModel.session?.goal) {
		lines.push(`Goal: ${viewModel.session.goal}`);
	}

	if (viewModel.session?.activeFeature) {
		const activeFeature = viewModel.session.activeFeature;
		lines.push(
			`Active feature: ${activeFeature.id} — ${activeFeature.title} (${activeFeature.status})`,
		);
	}

	if (viewModel.session?.featureProgress) {
		lines.push(
			`Progress: ${viewModel.session.featureProgress.completed}/${viewModel.session.featureProgress.total} completed`,
		);
	}

	lines.push(`Phase: ${viewModel.guidance.phase}`);
	lines.push(`Lane: ${viewModel.guidance.lane}`);
	lines.push(`Lane reason: ${viewModel.guidance.laneReason}`);
	lines.push(`Reason: ${viewModel.guidance.reason}`);
	if (viewModel.guidance.blocker) {
		lines.push(`Blocker: ${viewModel.guidance.blocker}`);
	}
	lines.push(`Next: ${options?.nextStep ?? viewModel.guidance.nextStep}`);
	lines.push(
		`Command: ${options?.nextCommand ?? viewModel.guidance.nextCommand}`,
	);

	return lines.join("\n");
}

export function renderDoctorSummary(
	status: "ok" | "warn" | "fail",
	checks: DoctorCheck[],
	guidance: SessionGuidance,
	nextStep: string,
	nextCommand: string,
) {
	const firstIssue =
		checks.find((check) => check.status === "fail") ??
		checks.find((check) => check.status === "warn");

	if (!firstIssue) {
		return [
			"Flow doctor ok: No blocking readiness issues found.",
			`Phase: ${guidance.phase}`,
			`Lane: ${guidance.lane}`,
			`Lane reason: ${guidance.laneReason}`,
			`Reason: ${guidance.reason}`,
			...(guidance.blocker ? [`Blocker: ${guidance.blocker}`] : []),
			`Next: ${nextStep}`,
			`Command: ${nextCommand}`,
		].join("\n");
	}

	const lines = [`Flow doctor ${status}: ${firstIssue.summary}`];
	if (firstIssue.remediation) {
		lines.push(`Fix: ${firstIssue.remediation}`);
	}
	lines.push(`Phase: ${guidance.phase}`);
	lines.push(`Lane: ${guidance.lane}`);
	lines.push(`Lane reason: ${guidance.laneReason}`);
	lines.push(`Reason: ${guidance.reason}`);
	if (guidance.blocker) {
		lines.push(`Blocker: ${guidance.blocker}`);
	}
	lines.push(`Then: ${nextStep}`);
	lines.push(`Command: ${nextCommand}`);
	return lines.join("\n");
}
