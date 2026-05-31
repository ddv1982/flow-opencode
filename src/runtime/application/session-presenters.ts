import type { loadStoredSession } from "../lifecycle";
import type { Session } from "../schema";
import { deriveSessionOperatorState } from "../session-operator-state";
import { deriveSessionViewModel, explainSessionState } from "../summary";
import { renderSessionStatusSummary } from "./operator-presenters";
import {
	activeFeatureDrilldownSource,
	storedFeatureDrilldownSource,
	withFeatureDrilldowns,
} from "./session-presenter-drilldowns";
import { guidanceFields } from "./session-presenter-shared";
import {
	toCompactJson,
	toJson,
	type WorkspaceContextSummary,
} from "./workspace-runtime";

type StoredSessionRecord = Awaited<ReturnType<typeof loadStoredSession>>;
type StatusView = "detailed" | "compact";

export { historyResponse } from "./session-history-presenters";

function storedSessionGuidance(
	found: NonNullable<StoredSessionRecord>,
	nextCommand: string,
) {
	const guidance = explainSessionState(found.session);
	if (found.active || found.session.status === "completed") {
		return { ...guidance, nextCommand };
	}
	return {
		...guidance,
		nextStep: "Activate this session to continue it in the current worktree.",
		nextCommand,
	};
}

function storedSessionInactiveWarning(
	found: NonNullable<StoredSessionRecord>,
): string | null {
	return found.source === "stored" && found.session.status !== "completed"
		? "Stored session is parked/inactive; activate it before continuing. Direct work outside Flow will not update this session's runtime state, reviewer records, validation records, or completion artifacts."
		: null;
}

function parkedStoredTaskProgressRows(
	found: NonNullable<StoredSessionRecord>,
	rows: NonNullable<
		ReturnType<typeof deriveSessionViewModel>["session"]
	>["taskProgress"],
	nextStep: string,
) {
	if (
		found.source !== "stored" ||
		found.active ||
		found.session.status === "completed"
	) {
		return rows;
	}
	return rows.map((row) =>
		row.status === "completed" ? row : { ...row, next: nextStep },
	);
}

export function missingStoredSessionResponse(
	sessionId: string,
	nextCommand: string,
) {
	const operator = deriveSessionOperatorState(null);
	return toJson({
		status: "missing_session",
		summary: `No stored Flow session exists for id '${sessionId}'.`,
		operator,
		...guidanceFields(operator),
		nextCommand,
	});
}

export async function storedSessionResponse(
	sessionId: string,
	found: NonNullable<StoredSessionRecord>,
	nextCommand: string,
	workspace?: WorkspaceContextSummary,
): Promise<string> {
	const viewModel = deriveSessionViewModel(found.session);
	const summarizedSession = viewModel.session
		? await withFeatureDrilldowns(
				viewModel.session,
				storedFeatureDrilldownSource(found, workspace),
			)
		: null;
	if (!summarizedSession) {
		throw new Error("Stored Flow session summary unexpectedly missing.");
	}
	const guidance = storedSessionGuidance(found, nextCommand);
	const operator = deriveSessionOperatorState(found.session);
	const historySession = found.active
		? summarizedSession
		: { ...summarizedSession, nextCommand };
	const inactiveWarning = storedSessionInactiveWarning(found);
	const parkedAwareSession = {
		...historySession,
		taskProgress: parkedStoredTaskProgressRows(
			found,
			historySession.taskProgress,
			guidance.nextStep,
		),
	};
	return toJson({
		status: "ok",
		summary: inactiveWarning
			? `Showing parked Flow session '${sessionId}'.`
			: `Showing ${found.source} Flow session '${sessionId}'.`,
		source: found.source,
		active: found.active,
		parked:
			found.source === "stored" &&
			!found.active &&
			found.session.status !== "completed",
		path: found.path,
		completedPath: found.completedPath ?? null,
		completedAt: found.completedAt ?? null,
		closure: found.session.closure ?? null,
		operator,
		...guidanceFields(guidance),
		session: parkedAwareSession,
		guidance,
		...(inactiveWarning ? { warning: inactiveWarning } : {}),
		operatorSummary: renderSessionStatusSummary(found.session, {
			nextCommand: guidance.nextCommand,
			nextStep: guidance.nextStep,
			taskProgressOverride: parkedAwareSession.taskProgress,
		}),
		nextCommand,
	});
}

export async function statusResponse(
	session: Session | null | undefined,
	view: StatusView = "detailed",
	workspace?: WorkspaceContextSummary,
): Promise<string> {
	const viewModel = deriveSessionViewModel(session ?? null);
	const normalizedSession = session ?? null;
	const guidance = viewModel.guidance;
	const presentedSession = viewModel.session
		? await withFeatureDrilldowns(
				viewModel.session,
				activeFeatureDrilldownSource(normalizedSession, workspace),
			)
		: null;
	const operatorSummary = renderSessionStatusSummary(
		normalizedSession,
		presentedSession
			? { taskProgressOverride: presentedSession.taskProgress }
			: undefined,
	);
	const workspaceRoot = workspace?.root ?? null;
	const activeFeatureDrilldown =
		presentedSession?.activeFeature?.featureDrilldown ?? null;
	if (view === "compact") {
		return toCompactJson({
			status: viewModel.status,
			summary: viewModel.summary,
			finalReviewPolicy: presentedSession?.finalReviewPolicy ?? null,
			...(presentedSession?.latestFailedAttempt
				? { latestFailedAttempt: presentedSession.latestFailedAttempt }
				: {}),
			...(activeFeatureDrilldown ? { activeFeatureDrilldown } : {}),
			...guidanceFields(guidance),
			guidance,
			operatorSummary,
			nextCommand: guidance.nextCommand,
			workspaceRoot,
			workspace: workspace ?? null,
		});
	}
	return toJson({
		status: viewModel.status,
		summary: viewModel.summary,
		finalReviewPolicy: presentedSession?.finalReviewPolicy ?? null,
		...(presentedSession?.latestFailedAttempt
			? { latestFailedAttempt: presentedSession.latestFailedAttempt }
			: {}),
		...(activeFeatureDrilldown ? { activeFeatureDrilldown } : {}),
		...(presentedSession ? { session: presentedSession } : {}),
		...guidanceFields(guidance),
		guidance,
		operatorSummary,
		workspaceRoot,
		workspace: workspace ?? null,
	});
}
