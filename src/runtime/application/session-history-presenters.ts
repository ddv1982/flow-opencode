import type { listSessionHistory } from "../lifecycle";
import { deriveSessionOperatorState } from "../session-operator-state";
import { explainSessionState } from "../summary";
import { guidanceFields } from "./session-presenter-shared";
import { toJson } from "./workspace-runtime";

type SessionHistory = Awaited<ReturnType<typeof listSessionHistory>>;
type SessionHistoryEntry = NonNullable<SessionHistory["active"]>;
type LatestFailedAttempt = SessionHistoryEntry["latestFailedAttempt"];

function collectHistoryEntries(history: SessionHistory): SessionHistoryEntry[] {
	return [
		...(history.active ? [history.active] : []),
		...history.stored,
		...history.completed,
	];
}

function latestHistoryFailedAttempt(
	history: SessionHistory,
): LatestFailedAttempt {
	return (
		collectHistoryEntries(history)
			.filter((entry) => entry.latestFailedAttempt)
			.sort((left, right) =>
				(right.latestFailedAttempt?.occurredAt ?? "").localeCompare(
					left.latestFailedAttempt?.occurredAt ?? "",
				),
			)[0]?.latestFailedAttempt ?? null
	);
}

function historyFailedAttemptGroups(history: SessionHistory) {
	const groups = new Map<
		string,
		{
			tool: NonNullable<LatestFailedAttempt>["tool"];
			failureCategory: string;
			count: number;
			sessionIds: string[];
			latestOccurredAt: string | null;
			recoveryHint?: string;
		}
	>();
	for (const entry of collectHistoryEntries(history)) {
		const failure = entry.latestFailedAttempt;
		if (!failure) continue;
		const key = `${failure.tool}:${failure.failureCategory}`;
		const existing = groups.get(key);
		const attemptCount = failure.sameCategoryFailureCount ?? 1;
		if (existing) {
			existing.count += attemptCount;
			existing.sessionIds.push(entry.id);
			if ((failure.occurredAt ?? "") > (existing.latestOccurredAt ?? "")) {
				existing.latestOccurredAt = failure.occurredAt ?? null;
				if (failure.recoveryHint) {
					existing.recoveryHint = failure.recoveryHint;
				}
			}
			continue;
		}
		groups.set(key, {
			tool: failure.tool,
			failureCategory: failure.failureCategory,
			count: attemptCount,
			sessionIds: [entry.id],
			latestOccurredAt: failure.occurredAt ?? null,
			...(failure.recoveryHint ? { recoveryHint: failure.recoveryHint } : {}),
		});
	}
	return [...groups.values()].sort((left, right) =>
		(right.latestOccurredAt ?? "").localeCompare(left.latestOccurredAt ?? ""),
	);
}

export function historyResponse(history: SessionHistory, nextCommand: string) {
	const activeCount = history.active ? 1 : 0;
	const totalCount =
		activeCount + history.stored.length + history.completed.length;
	const parkedCount = history.stored.filter(
		(session) => session.status !== "completed",
	).length;
	const latestFailedAttempt = latestHistoryFailedAttempt(history);
	const failedAttemptGroups = historyFailedAttemptGroups(history);
	const metadata = {
		totalCount,
		activeCount,
		storedCount: history.stored.length,
		parkedCount,
		completedCount: history.completed.length,
		failedAttemptGroupCount: failedAttemptGroups.length,
	};
	if (totalCount === 0) {
		const guidance = explainSessionState(null);
		const operator = deriveSessionOperatorState(null);
		return {
			payload: toJson({
				status: "missing",
				summary: "No Flow session history found.",
				operator,
				...guidanceFields(guidance),
				history,
				latestFailedAttempt,
				failedAttemptGroups,
				nextCommand,
			}),
			metadata,
		};
	}
	return {
		payload: toJson({
			status: "ok",
			summary: `Found ${totalCount} Flow session ${totalCount === 1 ? "entry" : "entries"} (${activeCount} active, ${history.stored.length} stored/${parkedCount} parked, ${history.completed.length} completed).`,
			history,
			latestFailedAttempt,
			failedAttemptGroups,
			...(parkedCount > 0
				? {
						warning:
							"Stored non-completed sessions are parked/inactive snapshots. Activate a stored session before continuing it; direct work outside Flow will not update its runtime records.",
					}
				: {}),
			nextCommand,
		}),
		metadata,
	};
}
