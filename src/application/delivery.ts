import type {
	FeatureRun,
	ReviewFinding,
	Session,
	SessionClosure,
} from "../domain/session.js";
import { isFeatureComplete } from "../domain/transitions.js";

type DeliveryFeatureProjection = Readonly<{
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
	/**
	 * The handoff, already formatted, for the caller to report verbatim.
	 *
	 * Formatting the same fields in the same order used to be prose restated across
	 * four prompt surfaces, including the artifact qualifier that must not be
	 * dropped. Rendering it here makes the shape a runtime guarantee instead of an
	 * instruction each surface has to repeat and each model has to follow.
	 */
	report: ReadonlyArray<string>;
}>;

const NO_ARTIFACTS = "none reported";

function formatFeature(feature: DeliveryFeatureProjection): string[] {
	const findings = feature.terminalFindings.map(
		(finding) => `  - ${finding.severity}: ${finding.summary}`,
	);
	return [
		`- ${feature.id} — ${feature.title}`,
		`  attempts: ${feature.attempts}; latest state: ${feature.latestState}`,
		`  outcome: ${feature.outcomeSummary ?? "none recorded"}`,
		findings.length > 0 ? "  terminal findings:" : "  terminal findings: none",
		...findings,
	];
}

function formatReport(delivery: Omit<DeliveryProjection, "report">): string[] {
	const artifacts = delivery.reportedArtifacts;
	return [
		`Goal: ${delivery.goal}`,
		`Closure: ${delivery.closure.kind}${
			delivery.closure.summary ? ` — ${delivery.closure.summary}` : ""
		}`,
		`Progress: ${delivery.progress.completed} of ${delivery.progress.total} features complete`,
		"Features:",
		...delivery.features.flatMap(formatFeature),
		"Artifacts as reported by Flow from caller declarations, not an exact or exhaustive Git delta:",
		`- latest attempts: ${artifacts.latestAttempts.join(", ") || NO_ARTIFACTS}`,
		`- superseded attempts only: ${
			artifacts.supersededAttemptsOnly.join(", ") || NO_ARTIFACTS
		}`,
	];
}

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
	const delivery = {
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
	} satisfies Omit<DeliveryProjection, "report">;
	return { ...delivery, report: formatReport(delivery) };
}
