import type {
	FeatureRun,
	ReviewFinding,
	Session,
	SessionClosure,
} from "../domain/session.js";
import { isFeatureComplete } from "../domain/transitions.js";

export type DeliveryFeatureProjection = Readonly<{
	id: string;
	title: string;
	attempts: number;
	latestState: FeatureRun["state"] | "not-started";
	outcomeSummary: string | null;
	terminalFindings: ReadonlyArray<
		Readonly<Pick<ReviewFinding, "severity" | "summary">>
	>;
}>;

export type DeliveryProjection = Readonly<{
	goal: string;
	closure: Readonly<{
		kind: SessionClosure["kind"];
		summary: string;
	}>;
	progress: Readonly<{ completed: number; total: number }>;
	features: ReadonlyArray<DeliveryFeatureProjection>;
	reportedArtifacts: Readonly<{
		latestAttempts: ReadonlyArray<string>;
		supersededAttemptsOnly: ReadonlyArray<string>;
	}>;
}>;

export function deliveryProjection(session: Session): DeliveryProjection {
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
