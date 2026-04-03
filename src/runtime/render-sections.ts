import type { Feature, Session } from "./schema";
import { deriveNextCommand } from "./summary";

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map((item) => `- ${toInlineText(item)}`).join("\n");
}

function joinSections(sections: string[]): string {
  return `${sections.filter(Boolean).join("\n\n")}\n`;
}

function maybeSection(title: string, items: string[]): string {
  if (items.length === 0) {
    return "";
  }

  return `## ${title}\n\n${bulletList(items)}`;
}

function maybeTitledList(title: string, items: string[], level = "##"): string {
  if (items.length === 0) {
    return "";
  }

  return `${level} ${title}\n\n${bulletList(items)}`;
}

function maybeApproachSection(session: Session): string {
  const approach = session.planning.implementationApproach;
  if (!approach) {
    return "";
  }

  return joinSections([
    "## Implementation Approach\n\n" + `- chosen direction: ${toInlineText(approach.chosenDirection)}`,
    maybeTitledList("Key Constraints", approach.keyConstraints, "###"),
    maybeTitledList("Validation Signals", approach.validationSignals, "###"),
    maybeTitledList("Sources", approach.sources, "###"),
  ]).trimEnd();
}

function formatFeatureLine(feature: Feature): string {
  return `- ${feature.id} | ${feature.status} | ${toInlineText(feature.title)}`;
}

function toInlineText(value: string): string {
  return value.replace(/\r?\n+/g, " / ").trim();
}

function toQuotedBlock(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "> none";
  }

  return normalized
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function maybeQuotedSection(title: string, value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return `## ${title}\n\n${toQuotedBlock(value)}`;
}

function renderReviewBlock(
  title: string,
  review:
    | {
        status: string;
        summary: string;
        blockingFindings: Array<{ summary: string }>;
      }
    | undefined,
): string {
  if (!review) {
    return "";
  }

  const lines = [
    `- status: ${review.status}`,
    `- summary: ${toInlineText(review.summary)}`,
    ...(review.blockingFindings.length > 0 ? [bulletList(review.blockingFindings.map((item) => item.summary))] : []),
  ];

  return `#### ${title}\n\n${lines.join("\n")}`;
}

function renderOutcomeLines(
  outcome:
    | {
        kind: string;
        category?: string;
        summary?: string;
        resolutionHint?: string;
        retryable?: boolean;
        autoResolvable?: boolean;
        needsHuman?: boolean;
      }
    | null
    | undefined,
): string[] {
  if (!outcome) {
    return [];
  }

  return [
    `kind: ${outcome.kind}`,
    ...(outcome.category ? [`category: ${toInlineText(outcome.category)}`] : []),
    ...(outcome.summary ? [`summary: ${toInlineText(outcome.summary)}`] : []),
    ...(outcome.resolutionHint ? [`resolution hint: ${toInlineText(outcome.resolutionHint)}`] : []),
    ...(outcome.retryable !== undefined ? [`retryable: ${outcome.retryable ? "yes" : "no"}`] : []),
    ...(outcome.autoResolvable !== undefined ? [`auto resolvable: ${outcome.autoResolvable ? "yes" : "no"}`] : []),
    ...(outcome.needsHuman !== undefined ? [`needs human: ${outcome.needsHuman ? "yes" : "no"}`] : []),
  ];
}

function renderFeatureResultDetails(
  featureResult:
    | {
        featureId: string;
        verificationStatus?: string;
        notes?: Array<{ note: string }>;
        followUps?: Array<{ summary: string; severity?: string }>;
      }
    | null
    | undefined,
): string {
  if (!featureResult) {
    return "";
  }

  const sections = [
    maybeTitledList("Notes", featureResult.notes?.map((item) => item.note) ?? [], "###"),
    maybeTitledList(
      "Follow Ups",
      featureResult.followUps?.map((item) => (item.severity ? `${item.summary} (${item.severity})` : item.summary)) ?? [],
      "###",
    ),
  ].filter(Boolean);

  return joinSections([
    `## Feature Result\n\n- feature id: ${featureResult.featureId}\n- verification: ${featureResult.verificationStatus ?? "not_recorded"}`,
    ...sections,
  ]).trimEnd();
}

function renderFeatureHistory(session: Session, feature: Feature): string {
  const entries = session.execution.history.filter((entry) => entry.featureId === feature.id);
  if (entries.length === 0) {
    return "## Execution History\n\n- none";
  }

  const renderedEntries = entries.map((entry) => {
    const sections = [
      maybeTitledList(
        "Changed Artifacts",
        entry.artifactsChanged.map((artifact) => (artifact.kind ? `${artifact.path} (${artifact.kind})` : artifact.path)),
        "####",
      ),
      maybeTitledList(
        "Validation",
        entry.validationRun.map((item) => `${item.status} | ${item.command} | ${item.summary}`),
        "####",
      ),
      maybeTitledList("Decisions", entry.decisions.map((item) => item.summary), "####"),
      entry.reviewerDecision
        ? maybeTitledList(
            "Reviewer Decision",
            [
              `scope: ${entry.reviewerDecision.scope}`,
              ...(entry.reviewerDecision.featureId ? [`feature id: ${entry.reviewerDecision.featureId}`] : []),
              `status: ${entry.reviewerDecision.status}`,
              `summary: ${entry.reviewerDecision.summary}`,
            ],
            "####",
          )
        : "",
      entry.outcome ? maybeTitledList("Outcome", renderOutcomeLines(entry.outcome), "####") : "",
      maybeTitledList("Notes", entry.featureResult?.notes?.map((item) => item.note) ?? [], "####"),
      maybeTitledList(
        "Follow Ups",
        entry.featureResult?.followUps?.map((item) => (item.severity ? `${item.summary} (${item.severity})` : item.summary)) ?? [],
        "####",
      ),
      renderReviewBlock("Feature Review", entry.featureReview),
      renderReviewBlock("Final Review", entry.finalReview),
    ].filter(Boolean);

    return joinSections([
      `### ${entry.recordedAt}\n\n- status: ${entry.status}\n- outcome: ${entry.outcomeKind ?? "none"}\n- summary: ${toInlineText(entry.summary)}\n- next step: ${entry.nextStep ? toInlineText(entry.nextStep) : "none"}`,
      ...sections,
    ]).trimEnd();
  });

  return `## Execution History\n\n${renderedEntries.join("\n\n")}`;
}

function renderIndexSummarySection(session: Session): string {
  const reviewerDecision = session.execution.lastReviewerDecision;

  return `## Summary

- session id: ${session.id}
- goal: ${toInlineText(session.goal)}
- status: ${session.status}
- approval: ${session.approval}
- next command: ${deriveNextCommand(session)}
- next step: ${session.execution.lastNextStep ? toInlineText(session.execution.lastNextStep) : "none"}
- reviewer decision: ${reviewerDecision ? `${reviewerDecision.scope} | ${reviewerDecision.status} | ${toInlineText(reviewerDecision.summary)}` : "none"}
- created: ${session.timestamps.createdAt}
- updated: ${session.timestamps.updatedAt}`;
}

function renderPlanSection(session: Session, features: Feature[]): string {
  const plan = session.plan;
  const activeFeature = features.find((feature) => feature.id === session.execution.activeFeatureId) ?? null;
  const completedCount = features.filter((feature) => feature.status === "completed").length;

  return joinSections([
    `## Plan

- summary: ${toInlineText(plan?.summary ?? "No plan yet.")}
- overview: ${toInlineText(plan?.overview ?? "No plan yet.")}
- progress: ${completedCount}/${features.length} completed
- active feature: ${activeFeature ? activeFeature.id : "none"}`,
    maybeSection("Requirements", plan?.requirements ?? []),
    maybeSection("Architecture Decisions", plan?.architectureDecisions ?? []),
    maybeSection("Repo Profile", session.planning.repoProfile),
    maybeSection("Research", session.planning.research),
    maybeApproachSection(session),
  ]).trimEnd();
}

function renderFeaturesSection(features: Feature[]): string {
  return `## Features\n\n${features.length === 0 ? "- none" : features.map(formatFeatureLine).join("\n")}`;
}

function renderOutcomeSection(session: Session): string {
  if (!session.execution.lastOutcome) {
    return "";
  }

  return `## Outcome\n\n${bulletList(renderOutcomeLines(session.execution.lastOutcome))}`;
}

function renderChangedArtifactsSection(session: Session): string {
  if (session.artifacts.length === 0) {
    return "";
  }

  return `## Changed Artifacts\n\n${bulletList(session.artifacts.map((artifact) => (artifact.kind ? `${artifact.path} (${artifact.kind})` : artifact.path)))}`;
}

function renderLastValidationRunSection(session: Session): string {
  if (session.execution.lastValidationRun.length === 0) {
    return "";
  }

  return `## Last Validation Run\n\n${bulletList(session.execution.lastValidationRun.map((item) => `${item.status} | ${item.command} | ${item.summary}`))}`;
}

function renderExecutionHistoryOverviewSection(session: Session): string {
  if (session.execution.history.length === 0) {
    return "";
  }

  return `## Execution History\n\n${bulletList(session.execution.history.map((item) => `${item.recordedAt} | ${item.featureId} | ${item.status} | ${item.summary}`))}`;
}

export function renderIndexDoc(session: Session): string {
  const features = session.plan?.features ?? [];

  return joinSections([
    "# Flow Session",
    renderIndexSummarySection(session),
    renderPlanSection(session, features),
    renderFeaturesSection(features),
    renderOutcomeSection(session),
    renderFeatureResultDetails(session.execution.lastFeatureResult),
    maybeSection("Notes", session.notes),
    renderChangedArtifactsSection(session),
    renderLastValidationRunSection(session),
    renderExecutionHistoryOverviewSection(session),
  ]);
}

function renderFeatureSummarySection(session: Session, feature: Feature): string {
  const isActive = session.execution.activeFeatureId === feature.id;

  return `## Summary

- title: ${toInlineText(feature.title)}
- status: ${feature.status}
- active: ${isActive ? "yes" : "no"}
- goal: ${toInlineText(session.goal)}`;
}

function renderFeatureDescriptionSection(feature: Feature): string {
  return `## Description\n\n${toQuotedBlock(feature.summary)}`;
}

function renderFeatureTargetsSection(feature: Feature): string {
  return `## File Targets\n\n${bulletList(feature.fileTargets)}`;
}

function renderFeatureVerificationSection(feature: Feature): string {
  return `## Verification\n\n${bulletList(feature.verification)}`;
}

export function renderFeatureDoc(session: Session, feature: Feature): string {
  return joinSections([
    `# Feature ${feature.id}`,
    renderFeatureSummarySection(session, feature),
    renderFeatureDescriptionSection(feature),
    maybeQuotedSection("Latest Runtime Summary", session.execution.lastFeatureId === feature.id ? session.execution.lastSummary : null),
    renderFeatureTargetsSection(feature),
    renderFeatureVerificationSection(feature),
    maybeSection("Depends On", feature.dependsOn ?? []),
    maybeSection("Blocked By", feature.blockedBy ?? []),
    renderFeatureHistory(session, feature),
  ]);
}
