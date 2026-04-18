import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { getIndexDocPath } from "../src/runtime/paths";
import { createSession, saveSession } from "../src/runtime/session";
import { deriveNextCommand, summarizeSession } from "../src/runtime/summary";
import { approvePlan, applyPlan, completeRun, recordReviewerDecision, startRun } from "../src/runtime/transitions";
import { activeSessionId, createTempDirRegistry, createTestTools, samplePlan } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
  cleanupTempDirs();
});

function toolContext(worktree: string, directory?: string) {
  return (directory ? { worktree, directory } : { worktree }) as Parameters<ReturnType<typeof createTestTools>["flow_status"]["execute"]>[1];
}

async function activeIndexDocPath(worktree: string): Promise<string> {
  return getIndexDocPath(worktree, await activeSessionId(worktree));
}

function assertOk<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.value;
}

function buildSummaryFixtureSessions() {
  const planning = assertOk(applyPlan(createSession("Build a workflow plugin"), samplePlan()));
  const approved = assertOk(approvePlan(planning));
  const running = assertOk(startRun(approved)).session;
  const blocked = assertOk(
    completeRun(running, {
      contractVersion: "1",
      status: "needs_input",
      summary: "Waiting on an operator decision.",
      artifactsChanged: [],
      validationRun: [],
      validationScope: "targeted",
      reviewIterations: 0,
      decisions: [{ summary: "External API credentials are missing." }],
      nextStep: "Ask the operator to provide API credentials.",
      outcome: {
        kind: "needs_operator_input",
        summary: "Credentials are required before work can continue.",
        resolutionHint: "Set the API token and rerun the feature.",
        retryable: true,
        needsHuman: true,
      },
      featureResult: {
        featureId: "setup-runtime",
        verificationStatus: "not_recorded",
        notes: [{ note: "No code changes were made." }],
        followUps: [{ summary: "Provide the missing API token.", severity: "high" }],
      },
      featureReview: { status: "needs_followup", summary: "Blocked by missing credentials.", blockingFindings: [] },
    }),
  );

  const finalPlan = {
    ...samplePlan(),
    completionPolicy: {
      minCompletedFeatures: 1,
      requireFinalReview: true,
    },
    features: [samplePlan().features[0]],
  };
  const completed = assertOk(
    completeRun(
      assertOk(
        recordReviewerDecision(
          assertOk(startRun(assertOk(approvePlan(assertOk(applyPlan(createSession("Build a workflow plugin"), finalPlan)))))).session,
          {
            scope: "final",
            status: "approved",
            summary: "Final review looks good.",
          },
        ),
      ),
      {
        contractVersion: "1",
        status: "ok",
        summary: "Completed runtime setup.",
        artifactsChanged: [],
        validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
        validationScope: "broad",
        reviewIterations: 1,
        decisions: [],
        nextStep: "Session should complete.",
        outcome: { kind: "completed" },
        featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
        featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
        finalReview: { status: "passed", summary: "Repo-wide validation is clean.", blockingFindings: [] },
      },
    ),
  );

  return {
    planning,
    running,
    blocked,
    completed,
  };
}

function buildSummaryFixtures() {
  const sessions = buildSummaryFixtureSessions();

  return {
    planning: summarizeSession(sessions.planning),
    running: summarizeSession(sessions.running),
    blocked: summarizeSession(sessions.blocked),
    completed: summarizeSession(sessions.completed),
  };
}

function normalizeSummaryFixture(summary: ReturnType<typeof summarizeSession>) {
  if (!summary.session) {
    return summary;
  }

  const planning =
    summary.session.planning.implementationApproach === undefined
      ? {
          repoProfile: summary.session.planning.repoProfile,
          research: summary.session.planning.research,
        }
      : summary.session.planning;

  return {
    ...summary,
    session: {
      ...summary.session,
      id: "<session-id>",
      planning,
    },
  };
}

describe("runtime summary", () => {
  test("summarizeSession reports missing state when no session exists", () => {
    expect(summarizeSession(null)).toEqual({
      status: "missing",
      summary: "No active Flow session found.",
    });
  });

  test("summarizeSession preserves the default planning/running/blocked/completed payloads", () => {
    expect(
      Object.fromEntries(
        Object.entries(buildSummaryFixtures()).map(([name, summary]) => [name, normalizeSummaryFixture(summary)]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "blocked": {
          "session": {
            "activeFeature": null,
            "approval": "approved",
            "artifacts": [],
            "completion": {
              "activeFeatureTriggersSessionCompletion": false,
              "canCompleteWithPendingFeatures": false,
              "completedFeatures": 0,
              "remainingBeyondTarget": 0,
              "requiresFinalReview": false,
              "targetCompletedFeatures": 2,
              "totalFeatures": 2,
            },
            "featureLines": [
              "setup-runtime (blocked): Create runtime helpers",
              "execute-feature (pending): Implement execution flow",
            ],
            "featureProgress": {
              "completed": 0,
              "total": 2,
            },
            "features": [
              {
                "id": "setup-runtime",
                "status": "blocked",
                "summary": "Add runtime helper files and state persistence.",
                "title": "Create runtime helpers",
              },
              {
                "id": "execute-feature",
                "status": "pending",
                "summary": "Wire runtime tools to feature execution.",
                "title": "Implement execution flow",
              },
            ],
            "goal": "Build a workflow plugin",
            "id": "<session-id>",
            "lastFeatureResult": {
              "featureId": "setup-runtime",
              "followUps": [
                {
                  "severity": "high",
                  "summary": "Provide the missing API token.",
                },
              ],
              "notes": [
                {
                  "note": "No code changes were made.",
                },
              ],
              "verificationStatus": "not_recorded",
            },
            "lastNextStep": "Ask the operator to provide API credentials.",
            "lastOutcome": {
              "kind": "needs_operator_input",
              "needsHuman": true,
              "resolutionHint": "Set the API token and rerun the feature.",
              "retryable": true,
              "summary": "Credentials are required before work can continue.",
            },
            "lastOutcomeKind": "needs_operator_input",
            "lastReviewerDecision": null,
            "lastValidationRun": [],
            "nextCommand": "/flow-status",
            "notes": [
              "External API credentials are missing.",
            ],
            "planOverview": "Create one setup feature and one execution feature.",
            "planSummary": "Implement a small workflow feature set.",
            "planning": {
              "repoProfile": [],
              "research": [],
            },
            "status": "blocked",
          },
          "status": "blocked",
          "summary": "Waiting on an operator decision.",
        },
        "completed": {
          "session": {
            "activeFeature": null,
            "approval": "approved",
            "artifacts": [],
            "completion": {
              "activeFeatureTriggersSessionCompletion": false,
              "canCompleteWithPendingFeatures": false,
              "completedFeatures": 1,
              "remainingBeyondTarget": 0,
              "requiresFinalReview": true,
              "targetCompletedFeatures": 1,
              "totalFeatures": 1,
            },
            "featureLines": [
              "setup-runtime (completed): Create runtime helpers",
            ],
            "featureProgress": {
              "completed": 1,
              "total": 1,
            },
            "features": [
              {
                "id": "setup-runtime",
                "status": "completed",
                "summary": "Add runtime helper files and state persistence.",
                "title": "Create runtime helpers",
              },
            ],
            "goal": "Build a workflow plugin",
            "id": "<session-id>",
            "lastFeatureResult": {
              "featureId": "setup-runtime",
              "verificationStatus": "passed",
            },
            "lastNextStep": "Session should complete.",
            "lastOutcome": {
              "kind": "completed",
            },
            "lastOutcomeKind": "completed",
            "lastReviewerDecision": {
              "blockingFindings": [],
              "followUps": [],
              "scope": "final",
              "status": "approved",
              "suggestedValidation": [],
              "summary": "Final review looks good.",
            },
            "lastValidationRun": [
              {
                "command": "bun test",
                "status": "passed",
                "summary": "Runtime tests passed.",
              },
            ],
            "nextCommand": "/flow-plan <goal>",
            "notes": [],
            "planOverview": "Create one setup feature and one execution feature.",
            "planSummary": "Implement a small workflow feature set.",
            "planning": {
              "repoProfile": [],
              "research": [],
            },
            "status": "completed",
          },
          "status": "completed",
          "summary": "Completed runtime setup.",
        },
        "planning": {
          "session": {
            "activeFeature": null,
            "approval": "pending",
            "artifacts": [],
            "completion": {
              "activeFeatureTriggersSessionCompletion": false,
              "canCompleteWithPendingFeatures": false,
              "completedFeatures": 0,
              "remainingBeyondTarget": 0,
              "requiresFinalReview": false,
              "targetCompletedFeatures": 2,
              "totalFeatures": 2,
            },
            "featureLines": [
              "setup-runtime (pending): Create runtime helpers",
              "execute-feature (pending): Implement execution flow",
            ],
            "featureProgress": {
              "completed": 0,
              "total": 2,
            },
            "features": [
              {
                "id": "setup-runtime",
                "status": "pending",
                "summary": "Add runtime helper files and state persistence.",
                "title": "Create runtime helpers",
              },
              {
                "id": "execute-feature",
                "status": "pending",
                "summary": "Wire runtime tools to feature execution.",
                "title": "Implement execution flow",
              },
            ],
            "goal": "Build a workflow plugin",
            "id": "<session-id>",
            "lastFeatureResult": null,
            "lastNextStep": null,
            "lastOutcome": null,
            "lastOutcomeKind": null,
            "lastReviewerDecision": null,
            "lastValidationRun": [],
            "nextCommand": "/flow-plan",
            "notes": [],
            "planOverview": "Create one setup feature and one execution feature.",
            "planSummary": "Implement a small workflow feature set.",
            "planning": {
              "repoProfile": [],
              "research": [],
            },
            "status": "planning",
          },
          "status": "planning",
          "summary": "Implement a small workflow feature set.",
        },
        "running": {
          "session": {
            "activeFeature": {
              "fileTargets": [
                "src/runtime/session.ts",
              ],
              "id": "setup-runtime",
              "status": "in_progress",
              "summary": "Add runtime helper files and state persistence.",
              "title": "Create runtime helpers",
              "verification": [
                "bun test",
              ],
            },
            "approval": "approved",
            "artifacts": [],
            "completion": {
              "activeFeatureTriggersSessionCompletion": false,
              "canCompleteWithPendingFeatures": false,
              "completedFeatures": 0,
              "remainingBeyondTarget": 0,
              "requiresFinalReview": false,
              "targetCompletedFeatures": 2,
              "totalFeatures": 2,
            },
            "featureLines": [
              "setup-runtime (in_progress): Create runtime helpers",
              "execute-feature (pending): Implement execution flow",
            ],
            "featureProgress": {
              "completed": 0,
              "total": 2,
            },
            "features": [
              {
                "id": "setup-runtime",
                "status": "in_progress",
                "summary": "Add runtime helper files and state persistence.",
                "title": "Create runtime helpers",
              },
              {
                "id": "execute-feature",
                "status": "pending",
                "summary": "Wire runtime tools to feature execution.",
                "title": "Implement execution flow",
              },
            ],
            "goal": "Build a workflow plugin",
            "id": "<session-id>",
            "lastFeatureResult": null,
            "lastNextStep": null,
            "lastOutcome": null,
            "lastOutcomeKind": null,
            "lastReviewerDecision": null,
            "lastValidationRun": [],
            "nextCommand": "/flow-run",
            "notes": [],
            "planOverview": "Create one setup feature and one execution feature.",
            "planSummary": "Implement a small workflow feature set.",
            "planning": {
              "repoProfile": [],
              "research": [],
            },
            "status": "running",
          },
          "status": "running",
          "summary": "Running feature 'setup-runtime'.",
        },
      }
    `);
  });

  test("flow_status returns the unchanged default summary shape for planning/running/blocked/completed fixtures", async () => {
    const tools = createTestTools();

    for (const session of Object.values(buildSummaryFixtureSessions())) {
      const worktree = makeTempDir();
      await saveSession(worktree, session);

      const response = await tools.flow_status.execute({}, toolContext(worktree));
      const parsed = JSON.parse(response);

      expect(normalizeSummaryFixture(parsed)).toEqual(normalizeSummaryFixture(summarizeSession(session)));
    }
  });

  test("summarizeSession exposes threshold-based final completion context while other features remain pending", async () => {
    const worktree = makeTempDir();
    const thresholdPlan = {
      ...samplePlan(),
      completionPolicy: {
        minCompletedFeatures: 1,
        requireFinalReview: true,
      },
    };

    const running = assertOk(startRun(assertOk(approvePlan(assertOk(applyPlan(createSession("Build a workflow plugin"), thresholdPlan)))))).session;
    const summary = summarizeSession(running);

    expect(summary.session?.completion).toEqual({
      activeFeatureTriggersSessionCompletion: true,
      canCompleteWithPendingFeatures: true,
      completedFeatures: 0,
      remainingBeyondTarget: 1,
      requiresFinalReview: true,
      targetCompletedFeatures: 1,
      totalFeatures: 2,
    });

    await saveSession(worktree, running);
    const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
    expect(indexDoc).toContain("completion target: 1/2 features");
    expect(indexDoc).toContain("pending allowed at completion: yes");
    expect(indexDoc).toContain("active feature triggers session completion: yes");
  });

  test("deriveNextCommand covers planning, runnable, blocked-human, and completed branches", () => {
    const planning = createSession("Build a workflow plugin");
    expect(deriveNextCommand(planning)).toBe("/flow-plan <goal>");

    const applied = applyPlan(planning, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    expect(deriveNextCommand(applied.value)).toBe("/flow-plan");

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    expect(deriveNextCommand(approved.value)).toBe("/flow-run");

    const running = startRun(approved.value);
    expect(running.ok).toBe(true);
    if (!running.ok) return;

    expect(deriveNextCommand(running.value.session)).toBe("/flow-run");

    const blocked = {
      ...approved.value,
      status: "blocked" as const,
      execution: {
        ...approved.value.execution,
        lastFeatureId: "setup-runtime",
        lastOutcome: {
          kind: "blocked_external" as const,
          summary: "Waiting on human decision.",
          needsHuman: true,
        },
      },
    };

    expect(deriveNextCommand(blocked)).toBe("/flow-status");

    const completed = { ...approved.value, status: "completed" as const };
    expect(deriveNextCommand(completed)).toBe("/flow-plan <goal>");
  });

  test("suggests resetting blocked features when the outcome is retryable", () => {
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const blocked = completeRun(started.value.session, {
      contractVersion: "1",
      status: "needs_input",
      summary: "Validation exposed a recoverable repo issue.",
      artifactsChanged: [],
      validationRun: [{ command: "bun test", status: "failed", summary: "A repo test failed." }],
      validationScope: "broad",
      reviewIterations: 1,
      decisions: [{ summary: "Investigate and repair the failing path." }],
      nextStep: "Research the failure, fix it, and rerun the feature.",
      outcome: {
        kind: "contract_error",
        summary: "The runtime completion path needs another iteration.",
        resolutionHint: "Reset the feature and rerun it after fixing the issue.",
        retryable: true,
        autoResolvable: true,
        needsHuman: false,
      },
      featureResult: { featureId: "setup-runtime", verificationStatus: "failed" },
      featureReview: { status: "needs_followup", summary: "More work is required.", blockingFindings: [] },
    });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;

    expect(summarizeSession(blocked.value).session?.nextCommand).toBe("/flow-reset feature setup-runtime");
  });

});
