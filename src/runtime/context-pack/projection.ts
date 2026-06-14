import type { ProjectStructureMapProjection } from "../project-structure-map";
import type { Session } from "../schema";
import { contextDiagnostics } from "./diagnostics";
import {
	changedArtifactPaths,
	featureReviewScope,
	validationCommands,
} from "./facts";
import { buildContextQualityProjection } from "./quality";
import { buildWorkflowReadinessProjection } from "./readiness";
import { buildTraceabilityProjection } from "./traceability";
import type { ContextPackProjection } from "./types";

export function buildContextPackProjection(
	session: Session,
	options: {
		projectStructure?: ProjectStructureMapProjection | undefined;
	} = {},
): ContextPackProjection {
	const features = session.plan?.features ?? [];
	const changedArtifacts = changedArtifactPaths(session);
	const commands = validationCommands(session);
	const diagnostics = contextDiagnostics(
		session,
		features,
		changedArtifacts,
		commands,
	);
	const traceability = buildTraceabilityProjection(
		session,
		features,
		changedArtifacts,
		commands,
	);
	const quality = buildContextQualityProjection(
		session,
		features,
		diagnostics,
		traceability,
	);
	const workflowReadiness = buildWorkflowReadinessProjection(
		session,
		features,
		diagnostics,
		traceability,
	);

	return {
		sessionId: session.id,
		goal: session.goal,
		workflowProfile: session.planning.workflowProfile,
		repoProfile: session.planning.repoProfile,
		research: session.planning.research,
		requirements: session.plan?.requirements ?? [],
		architectureDecisions: session.plan?.architectureDecisions ?? [],
		notes: [...(session.plan?.notes ?? []), ...session.notes],
		features: features.map((feature) => ({
			id: feature.id,
			title: feature.title,
			status: feature.status,
			fileTargets: feature.fileTargets,
			reviewScope: featureReviewScope(feature),
			verification: feature.verification,
		})),
		changedArtifacts,
		validationCommands: commands,
		diagnostics,
		quality,
		traceability,
		workflowReadiness,
		...(options.projectStructure
			? { projectStructure: options.projectStructure }
			: {}),
	};
}
