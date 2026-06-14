import type { ContextPackProjection } from "../context-pack";
import { buildContextPackProjection } from "../context-pack";
import type { ProjectStructureMapProjection } from "../project-structure-map";
import type { Session } from "../schema";
import {
	bulletList,
	joinSections,
	maybeSection,
	toInlineText,
} from "./markdown";

function renderProjectStructureMap(
	projectStructure: ProjectStructureMapProjection | undefined,
): string {
	if (!projectStructure || projectStructure.entries.length === 0) {
		return "";
	}
	return `## Project Structure Map

- root: ${toInlineText(projectStructure.rootName)}
- entries: ${projectStructure.entryCount}
- truncated: ${projectStructure.truncated ? "yes" : "no"}
- ignore sources: ${projectStructure.ignoreSources.join(", ")}
- planned targets: ${projectStructure.focus.plannedTargets.length > 0 ? projectStructure.focus.plannedTargets.map(toInlineText).join(", ") : "none"}
- planned targets redacted: ${projectStructure.focus.plannedTargetsRedacted}
- changed artifacts: ${projectStructure.focus.changedArtifacts.length > 0 ? projectStructure.focus.changedArtifacts.map(toInlineText).join(", ") : "none"}
- changed artifacts redacted: ${projectStructure.focus.changedArtifactsRedacted}

${
	projectStructure.entries.length === 0
		? "- none"
		: bulletList(
				projectStructure.entries.map((entry) =>
					[
						`${"  ".repeat(Math.max(0, entry.depth - 1))}${entry.kind === "directory" ? `${entry.path}/` : entry.path}`,
						entry.role !== "other" ? `role: ${entry.role}` : "",
					]
						.filter(Boolean)
						.join(" | "),
				),
			)
}`;
}

export function renderContextPackProjectionDoc(
	contextPack: ContextPackProjection,
): string {
	return joinSections([
		"# Flow Context Pack",
		`## Summary

- session id: ${contextPack.sessionId}
- goal: ${toInlineText(contextPack.goal)}
- workflow profile: ${contextPack.workflowProfile}
- features: ${contextPack.features.length}
- diagnostics: ${contextPack.diagnostics.length}
- context quality: ${contextPack.quality.score}/100 (${contextPack.quality.rating})
- readiness: ${contextPack.workflowReadiness.state}
- readiness blocking: ${contextPack.workflowReadiness.blocking.length}
- readiness warnings: ${contextPack.workflowReadiness.warnings.length}
- next action: ${toInlineText(contextPack.workflowReadiness.nextAction)}`,
		`## Signal Authority

- hard gate: runtime refuses the action
- workflow blocker: \`workflowReadiness.state\` values starting with \`blocked_by_\` require resolution or explicit justification before proceeding
- advisory diagnostic: \`contextQuality\` and weak-context diagnostics inform review judgment but do not block by themselves
- factual projection: \`contextTraceability\` records persisted plan targets, changed artifacts, validation commands, and review records`,
		`## Context Quality

${bulletList(
	contextPack.quality.checks.map(
		(check) =>
			`${check.status} | ${check.id} | weight: ${check.weight} | ${toInlineText(check.summary)}`,
	),
)}`,
		contextPack.workflowReadiness.blocking.length > 0
			? `## Workflow Readiness

${bulletList(
	contextPack.workflowReadiness.blocking.map((item) =>
		[
			item.id,
			item.featureId ? `feature: ${item.featureId}` : "",
			toInlineText(item.summary),
			`remediation: ${toInlineText(item.remediation)}`,
		]
			.filter(Boolean)
			.join(" | "),
	),
)}`
			: "",
		maybeSection("Repo Profile", contextPack.repoProfile),
		maybeSection("Research", contextPack.research),
		maybeSection("Requirements", contextPack.requirements),
		maybeSection("Architecture Decisions", contextPack.architectureDecisions),
		maybeSection("Notes", contextPack.notes),
		renderProjectStructureMap(contextPack.projectStructure),
		`## Traceability Summary

- planned targets: ${contextPack.traceability.plannedTargetCount}
- changed artifacts: ${contextPack.traceability.changedArtifactCount}
- validation commands: ${contextPack.traceability.validationCommandCount}
- reviewed features: ${contextPack.traceability.reviewedFeatureCount}
- unplanned changed artifacts: ${contextPack.traceability.unplannedChangedArtifacts.length > 0 ? contextPack.traceability.unplannedChangedArtifacts.map(toInlineText).join(", ") : "none"}`,
		`## Feature Context

${
	contextPack.traceability.features.length === 0
		? "- none"
		: contextPack.traceability.features
				.map((feature) =>
					[
						`### ${feature.id}`,
						`- title: ${toInlineText(feature.title)}`,
						`- status: ${feature.status}`,
						`- file targets: ${feature.fileTargets.length > 0 ? feature.fileTargets.map(toInlineText).join(", ") : "none"}`,
						`- review scope: ${feature.reviewScope.length > 0 ? feature.reviewScope.map(toInlineText).join(", ") : "none"}`,
						`- verification: ${feature.verification.length > 0 ? feature.verification.map(toInlineText).join(", ") : "none"}`,
						`- changed artifacts: ${feature.changedArtifacts.length > 0 ? feature.changedArtifacts.map(toInlineText).join(", ") : "none"}`,
						`- validation commands: ${feature.validationCommands.length > 0 ? feature.validationCommands.map(toInlineText).join(", ") : "none"}`,
						`- reviewer decision: ${feature.reviewerDecisionStatus ?? "none"}`,
						`- feature review: ${feature.featureReviewStatus ?? "none"}`,
						`- final review: ${feature.finalReviewStatus ?? "none"}`,
						`- gaps: ${feature.gaps.length > 0 ? feature.gaps.map((gap) => `${gap.id}: ${toInlineText(gap.summary)}`).join("; ") : "none"}`,
					].join("\n"),
				)
				.join("\n\n")
}`,
		maybeSection("Changed Artifacts", contextPack.changedArtifacts),
		maybeSection("Validation Commands", contextPack.validationCommands),
		contextPack.diagnostics.length > 0
			? `## Context Diagnostics

${bulletList(
	contextPack.diagnostics.map((diagnostic) =>
		[
			diagnostic.severity,
			diagnostic.id,
			diagnostic.featureId ? `feature: ${diagnostic.featureId}` : "",
			toInlineText(diagnostic.summary),
			`remediation: ${toInlineText(diagnostic.remediation)}`,
		]
			.filter(Boolean)
			.join(" | "),
	),
)}`
			: "",
	]);
}

export function renderContextPackDoc(
	session: Session,
	projectStructure?: ProjectStructureMapProjection,
): string {
	return renderContextPackProjectionDoc(
		buildContextPackProjection(session, { projectStructure }),
	);
}
