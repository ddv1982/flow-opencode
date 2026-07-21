import type { Session } from "../domain/session.js";
import { isFeatureComplete } from "../domain/transitions.js";

export function deliveryProjection(session: Session): Record<string, unknown> {
	if (!session.closure) {
		throw new Error("A delivery projection requires a recorded closure.");
	}
	const planFeatures = session.plan?.features ?? [];
	const featureRuns = planFeatures.map((feature) => ({
		feature,
		runs: session.runs.filter((run) => run.featureId === feature.id),
	}));
	const latestRuns = featureRuns.flatMap(({ runs }) => runs.slice(-1));
	const latestArtifacts = new Set(
		latestRuns.flatMap((run) =>
			run.artifactsChanged.map((artifact) => artifact.path),
		),
	);
	const allArtifacts = new Set(
		session.runs.flatMap((run) =>
			run.artifactsChanged.map((artifact) => artifact.path),
		),
	);
	const completed = planFeatures.filter((feature) =>
		isFeatureComplete(session, feature.id),
	).length;
	return {
		goal: session.goal,
		closure: {
			kind: session.closure.kind,
			summary: session.closure.summary,
		},
		progress: { completed, total: planFeatures.length },
		features: featureRuns.map(({ feature, runs }) => {
			const latest = runs.at(-1);
			const terminalResult = latest?.reviews.at(-1)?.result;
			return {
				id: feature.id,
				title: feature.title,
				attempts: runs.length,
				latestState: latest?.state ?? "not-started",
				outcomeSummary: latest?.summary ?? null,
				terminalFindings:
					terminalResult?.findings.map((finding) => ({
						severity: finding.severity,
						summary: finding.summary,
					})) ?? [],
			};
		}),
		reportedArtifacts: {
			latestAttempts: [...latestArtifacts].sort(),
			supersededAttemptsOnly: [...allArtifacts]
				.filter((path) => !latestArtifacts.has(path))
				.sort(),
		},
	};
}
