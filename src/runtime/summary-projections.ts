import type { FeatureDocDrilldownTarget } from "./feature-doc-drilldown";
import type { Feature, Session } from "./schema";

export {
	projectTaskProgress,
	type TaskProgressRow,
} from "./summary-task-progress";
export {
	selectFeatureTaskProgressRows,
	selectIndexTaskProgressRows,
	selectOperatorTaskProgressRows,
} from "./summary-task-progress-selection";

export type SummarizedFeature = {
	id: string;
	title: string;
	status: Feature["status"];
	summary: string;
	featureDrilldown?: FeatureDocDrilldownTarget;
};

export type SummarizedPlanning = Pick<
	Session["planning"],
	| "repoProfile"
	| "stackProfile"
	| "standardsProfile"
	| "research"
	| "implementationApproach"
	| "decisionLog"
	| "replanLog"
	| "evidencePackets"
> & {
	packageManager?: Session["planning"]["packageManager"];
	packageManagerAmbiguous?: true;
};

export function summarizeFeature(feature: Feature): string {
	return `${feature.id} (${feature.status}): ${feature.title}`;
}

export function projectFeature(feature: Feature): SummarizedFeature {
	return {
		id: feature.id,
		title: feature.title,
		status: feature.status,
		summary: feature.summary,
	};
}

export function projectActiveFeature(
	feature: Feature | null,
): SummarizedFeature | null {
	return feature ? projectFeature(feature) : null;
}

export function sessionFeatures(session: Session): Feature[] {
	return session.plan?.features ?? [];
}

export function summarizePlanning(session: Session): SummarizedPlanning {
	return {
		repoProfile: session.planning.repoProfile,
		stackProfile: session.planning.stackProfile,
		standardsProfile: session.planning.standardsProfile,
		research: session.planning.research,
		implementationApproach: session.planning.implementationApproach,
		decisionLog: session.planning.decisionLog,
		replanLog: session.planning.replanLog,
		...(session.planning.packageManager
			? { packageManager: session.planning.packageManager }
			: {}),
		...(session.planning.packageManagerAmbiguous
			? { packageManagerAmbiguous: true as const }
			: {}),
		...(session.planning.evidencePackets
			? { evidencePackets: session.planning.evidencePackets }
			: {}),
	};
}

export function activeFeatureForSession(
	session: Session,
	features: Feature[] = sessionFeatures(session),
): Feature | null {
	return (
		features.find(
			(feature) => feature.id === session.execution.activeFeatureId,
		) ?? null
	);
}
