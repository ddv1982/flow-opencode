import {
	type FeatureDocDrilldownSource,
	type FeatureDocDrilldownTarget,
	resolveFeatureDocDrilldownTarget,
} from "../feature-doc-drilldown";
import type { loadStoredSession } from "../lifecycle";
import type { Session } from "../schema";
import type { SummarizedSessionDetails } from "../summary";
import type { WorkspaceContextSummary } from "./workspace-runtime";

type StoredSessionRecord = Awaited<ReturnType<typeof loadStoredSession>>;
type SessionFeatureDrilldownSource = FeatureDocDrilldownSource | null;

export function activeFeatureDrilldownSource(
	session: Session | null,
	workspace?: WorkspaceContextSummary,
): SessionFeatureDrilldownSource {
	if (!session || !workspace?.root) {
		return null;
	}
	return {
		location: "active",
		worktree: workspace.root,
		sessionId: session.id,
	};
}

export function storedFeatureDrilldownSource(
	found: NonNullable<StoredSessionRecord>,
	workspace?: WorkspaceContextSummary,
): SessionFeatureDrilldownSource {
	if (!workspace?.root) {
		return null;
	}
	return {
		location: found.source,
		worktree: workspace.root,
		sessionDir: found.completedPath ?? found.path,
		sessionId: found.session.id,
	};
}

function collectFeatureDrilldownIds(
	session: SummarizedSessionDetails,
): string[] {
	return Array.from(
		new Set(
			[
				session.activeFeature?.id,
				...session.taskProgress.map((row) => row.featureId),
			].filter((id): id is string => Boolean(id)),
		),
	);
}

async function resolveFeatureDrilldownMap(
	session: SummarizedSessionDetails,
	source: SessionFeatureDrilldownSource,
): Promise<Map<string, FeatureDocDrilldownTarget>> {
	if (!source) {
		return new Map();
	}
	const entries = await Promise.all(
		collectFeatureDrilldownIds(session).map(async (featureId) => {
			try {
				return [
					featureId,
					await resolveFeatureDocDrilldownTarget({ featureId, source }),
				] as const;
			} catch {
				// Drilldowns are best-effort presenter metadata. Invalid or
				// unavailable drilldown resolution must not fail the primary
				// status/history response.
				return null;
			}
		}),
	);
	return new Map(
		entries.filter(
			(entry): entry is readonly [string, FeatureDocDrilldownTarget] =>
				entry !== null,
		),
	);
}

function featureDrilldownField(
	drilldowns: Map<string, FeatureDocDrilldownTarget>,
	featureId: string | undefined,
): { featureDrilldown: FeatureDocDrilldownTarget } | Record<string, never> {
	if (!featureId) {
		return {};
	}
	const featureDrilldown = drilldowns.get(featureId);
	return featureDrilldown ? { featureDrilldown } : {};
}

export async function withFeatureDrilldowns(
	session: SummarizedSessionDetails,
	source: SessionFeatureDrilldownSource,
): Promise<SummarizedSessionDetails> {
	const drilldowns = await resolveFeatureDrilldownMap(session, source);
	if (drilldowns.size === 0) {
		return session;
	}
	return {
		...session,
		activeFeature: session.activeFeature
			? {
					...session.activeFeature,
					...featureDrilldownField(drilldowns, session.activeFeature.id),
				}
			: null,
		taskProgress: session.taskProgress.map((row) => ({
			...row,
			...featureDrilldownField(drilldowns, row.featureId),
		})),
	};
}
