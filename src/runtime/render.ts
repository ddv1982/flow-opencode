import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { getDocsDir, getFeatureDocPath, getFeaturesDocsDir, getIndexDocPath } from "./paths";
import type { Feature, Session } from "./schema";
import { deriveNextCommand } from "./summary";

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map((item) => `- ${toInlineText(item)}`).join("\n");
}

function maybeSection(title: string, items: string[]): string {
  if (items.length === 0) {
    return "";
  }

  return `## ${title}\n\n${bulletList(items)}\n\n`;
}

function maybeTitledList(title: string, items: string[], level = "##"): string {
  if (items.length === 0) {
    return "";
  }

  return `${level} ${title}\n\n${bulletList(items)}\n`;
}

function maybeApproachSection(session: Session): string {
  const approach = session.planning.implementationApproach;
  if (!approach) {
    return "";
  }

  return `## Implementation Approach

- chosen direction: ${toInlineText(approach.chosenDirection)}

### Key Constraints

${bulletList(approach.keyConstraints)}

### Validation Signals

${bulletList(approach.validationSignals)}

### Sources

${bulletList(approach.sources)}

`;
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

  return `## ${title}\n\n${toQuotedBlock(value)}\n\n`;
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

  return `#### ${title}\n\n- status: ${review.status}\n- summary: ${toInlineText(review.summary)}\n${review.blockingFindings.length > 0 ? `${bulletList(review.blockingFindings.map((item) => item.summary))}\n` : ""}\n`;
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

  return `## Feature Result\n\n- feature id: ${featureResult.featureId}\n- verification: ${featureResult.verificationStatus ?? "not_recorded"}\n${sections.length > 0 ? `\n${sections.join("\n")}` : "\n"}`;
}

function renderFeatureHistory(session: Session, feature: Feature): string {
  const entries = session.execution.history.filter((entry) => entry.featureId === feature.id);
  if (entries.length === 0) {
    return "## Execution History\n\n- none\n";
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

    return `### ${entry.recordedAt}

- status: ${entry.status}
- outcome: ${entry.outcomeKind ?? "none"}
- summary: ${toInlineText(entry.summary)}
- next step: ${entry.nextStep ? toInlineText(entry.nextStep) : "none"}
${sections.length > 0 ? `\n${sections.join("\n")}` : ""}`;
  });

  return `## Execution History\n\n${renderedEntries.join("\n")}`;
}

function renderIndexDoc(session: Session): string {
  const plan = session.plan;
  const features = plan?.features ?? [];
  const activeFeature = features.find((feature) => feature.id === session.execution.activeFeatureId) ?? null;
  const completedCount = features.filter((feature) => feature.status === "completed").length;

  return `# Flow Session

## Summary

- session id: ${session.id}
- goal: ${toInlineText(session.goal)}
- status: ${session.status}
- approval: ${session.approval}
- next command: ${deriveNextCommand(session)}
- next step: ${session.execution.lastNextStep ? toInlineText(session.execution.lastNextStep) : "none"}
- reviewer decision: ${session.execution.lastReviewerDecision ? `${session.execution.lastReviewerDecision.scope} | ${session.execution.lastReviewerDecision.status} | ${toInlineText(session.execution.lastReviewerDecision.summary)}` : "none"}
- created: ${session.timestamps.createdAt}
- updated: ${session.timestamps.updatedAt}

## Plan

- summary: ${toInlineText(plan?.summary ?? "No plan yet.")}
- overview: ${toInlineText(plan?.overview ?? "No plan yet.")}
- progress: ${completedCount}/${features.length} completed
- active feature: ${activeFeature ? activeFeature.id : "none"}


${maybeSection("Requirements", plan?.requirements ?? [])}${maybeSection("Architecture Decisions", plan?.architectureDecisions ?? [])}${maybeSection("Repo Profile", session.planning.repoProfile)}${maybeSection("Research", session.planning.research)}${maybeApproachSection(session)}## Features

${features.length === 0 ? "- none" : features.map(formatFeatureLine).join("\n")}

${session.execution.lastOutcome ? `## Outcome

${bulletList(renderOutcomeLines(session.execution.lastOutcome))}

` : ""}${renderFeatureResultDetails(session.execution.lastFeatureResult)}${maybeSection("Notes", session.notes)}${session.artifacts.length > 0 ? `## Changed Artifacts

${bulletList(session.artifacts.map((artifact) => (artifact.kind ? `${artifact.path} (${artifact.kind})` : artifact.path)))}

` : ""}${session.execution.lastValidationRun.length > 0 ? `## Last Validation Run

${bulletList(session.execution.lastValidationRun.map((item) => `${item.status} | ${item.command} | ${item.summary}`))}

` : ""}${session.execution.history.length > 0 ? `## Execution History

${bulletList(session.execution.history.map((item) => `${item.recordedAt} | ${item.featureId} | ${item.status} | ${item.summary}`))}

` : ""}`;
}

function renderFeatureDoc(session: Session, feature: Feature): string {
  const isActive = session.execution.activeFeatureId === feature.id;
  return `# Feature ${feature.id}

## Summary

- title: ${toInlineText(feature.title)}
- status: ${feature.status}
- active: ${isActive ? "yes" : "no"}
- goal: ${toInlineText(session.goal)}

## Description

${toQuotedBlock(feature.summary)}

${maybeQuotedSection("Latest Runtime Summary", session.execution.lastFeatureId === feature.id ? session.execution.lastSummary : null)}## File Targets

${bulletList(feature.fileTargets)}

## Verification

${bulletList(feature.verification)}

${maybeSection("Depends On", feature.dependsOn ?? [])}${maybeSection("Blocked By", feature.blockedBy ?? [])}${renderFeatureHistory(session, feature)}
`;
}

async function pruneFeatureDocs(worktree: string, activeFeatureIds: Set<string>): Promise<void> {
  const featuresDir = getFeaturesDocsDir(worktree);

  try {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .filter((entry) => !activeFeatureIds.has(entry.name.slice(0, -3)))
        .map((entry) => rm(getFeatureDocPath(worktree, entry.name.slice(0, -3)), { force: true })),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function renderSessionDocs(worktree: string, session: Session): Promise<void> {
  const docsDir = getDocsDir(worktree);
  const featuresDir = getFeaturesDocsDir(worktree);
  const features = session.plan?.features ?? [];

  await mkdir(docsDir, { recursive: true });
  await mkdir(featuresDir, { recursive: true });
  await writeFile(getIndexDocPath(worktree), renderIndexDoc(session), "utf8");

  await Promise.all(features.map((feature) => writeFile(getFeatureDocPath(worktree, feature.id), renderFeatureDoc(session, feature), "utf8")));
  await pruneFeatureDocs(worktree, new Set(features.map((feature) => feature.id)));
}

export async function deleteSessionDocs(worktree: string): Promise<void> {
  await rm(getDocsDir(worktree), { recursive: true, force: true });
}
