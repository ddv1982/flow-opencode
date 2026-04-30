import type { Session } from "../schema";
import { deriveSessionViewModel, type SessionGuidance } from "../summary";
import type { DoctorCheck } from "./doctor-checks";

export function renderSessionStatusSummary(
	session: Session | null,
	options?: { nextCommand?: string; nextStep?: string },
): string {
	const viewModel = deriveSessionViewModel(session);
	const lines = [
		`Flow: ${viewModel.guidance.summary}`,
		`Next: ${options?.nextStep ?? viewModel.guidance.nextStep}`,
		`Command: ${options?.nextCommand ?? viewModel.guidance.nextCommand}`,
	];

	if (viewModel.guidance.blocker) {
		lines.splice(1, 0, `Blocker: ${viewModel.guidance.blocker}`);
	}

	if (viewModel.session?.activeFeature) {
		const activeFeature = viewModel.session.activeFeature;
		lines.push(
			`Working on: ${activeFeature.id} — ${activeFeature.title} (${activeFeature.status})`,
		);
	}

	if (viewModel.session?.featureProgress) {
		lines.push(
			`Progress: ${viewModel.session.featureProgress.completed}/${viewModel.session.featureProgress.total} completed`,
		);
	}

	if (viewModel.session?.finalReviewPolicy) {
		lines.push(`Final review policy: ${viewModel.session.finalReviewPolicy}`);
	}

	if (viewModel.session?.goal) {
		lines.push(`Goal: ${viewModel.session.goal}`);
	}

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
			"Flow doctor: Ready.",
			...(guidance.blocker ? [`Blocker: ${guidance.blocker}`] : []),
			`Next: ${nextStep}`,
			`Command: ${nextCommand}`,
		].join("\n");
	}

	const lines = [`Flow doctor ${status}: ${firstIssue.summary}`];
	if (firstIssue.remediation) {
		lines.push(`Fix: ${firstIssue.remediation}`);
	}
	if (guidance.blocker) {
		lines.push(`Blocker: ${guidance.blocker}`);
	}
	lines.push(`Next: ${nextStep}`);
	lines.push(`Command: ${nextCommand}`);
	return lines.join("\n");
}
