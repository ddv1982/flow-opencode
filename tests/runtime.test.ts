import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, deleteSession, deleteSessionArtifacts, deleteSessionState, loadSession, saveSession, saveSessionState, syncSessionArtifacts } from "../src/runtime/session";
import { getActiveSessionPath, getArchiveDir, getFeatureDocPath, getIndexDocPath, getLegacySessionPath, getSessionPath } from "../src/runtime/paths";
import { deriveNextCommand, summarizeSession } from "../src/runtime/summary";
import { adaptFlowRunCompleteFeatureInput, adaptReviewerDecisionInput } from "../src/runtime/adapters";
import { createTools } from "../src/tools";
import { approvePlan, applyPlan, completeRun, recordReviewerDecision, resetFeature, selectPlanFeatures, startRun } from "../src/runtime/transitions";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-opencode-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

async function activeSessionId(worktree: string): Promise<string> {
  return (await readFile(getActiveSessionPath(worktree), "utf8")).trim();
}

async function activeSessionPath(worktree: string): Promise<string> {
  return getSessionPath(worktree, await activeSessionId(worktree));
}

async function activeIndexDocPath(worktree: string): Promise<string> {
  return getIndexDocPath(worktree, await activeSessionId(worktree));
}

async function activeFeatureDocPath(worktree: string, featureId: string): Promise<string> {
  return getFeatureDocPath(worktree, await activeSessionId(worktree), featureId);
}

function samplePlan() {
  return {
    summary: "Implement a small workflow feature set.",
    overview: "Create one setup feature and one execution feature.",
    requirements: ["Keep state durable", "Keep commands concise"],
    architectureDecisions: ["Persist session history under .flow/sessions/<id>", "Run one feature per worker invocation"],
    features: [
      {
        id: "setup-runtime",
        title: "Create runtime helpers",
        summary: "Add runtime helper files and state persistence.",
        fileTargets: ["src/runtime/session.ts"],
        verification: ["bun test"],
      },
      {
        id: "execute-feature",
        title: "Implement execution flow",
        summary: "Wire runtime tools to feature execution.",
        fileTargets: ["src/tools.ts"],
        verification: ["bun test"],
        dependsOn: ["setup-runtime"],
      },
    ],
  };
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

describe("runtime transitions", () => {
  test("creates, saves, and loads a session", async () => {
    const worktree = makeTempDir();
    const created = createSession("Build a workflow plugin");
    await saveSession(worktree, created);

    const loaded = await loadSession(worktree);
    const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
    expect(loaded?.goal).toBe("Build a workflow plugin");
    expect(loaded?.status).toBe("planning");
    expect(indexDoc).toContain("# Flow Session");
    expect(indexDoc).toContain("goal: Build a workflow plugin");
  });

  test("stores active and historical sessions under .flow/sessions", async () => {
    const worktree = makeTempDir();
    const first = await saveSession(worktree, createSession("First goal"));

    expect(await activeSessionId(worktree)).toBe(first.id);
    await expect(readFile(getSessionPath(worktree, first.id), "utf8")).resolves.toContain('"goal": "First goal"');
    await expect(readFile(getIndexDocPath(worktree, first.id), "utf8")).resolves.toContain("goal: First goal");

    const second = await saveSession(worktree, createSession("Second goal"));

    expect(await activeSessionId(worktree)).toBe(second.id);
    await expect(readFile(getSessionPath(worktree, first.id), "utf8")).resolves.toContain('"goal": "First goal"');
    await expect(readFile(getSessionPath(worktree, second.id), "utf8")).resolves.toContain('"goal": "Second goal"');
    await expect(readFile(getIndexDocPath(worktree, second.id), "utf8")).resolves.toContain("goal: Second goal");
  });

  test("migrates a legacy .flow/session.json into the session-history layout", async () => {
    const worktree = makeTempDir();
    const legacy = createSession("Legacy goal");

    mkdirSync(join(worktree, ".flow"), { recursive: true });
    await writeFile(getLegacySessionPath(worktree), JSON.stringify(legacy, null, 2) + "\n", "utf8");

    const loaded = await loadSession(worktree);

    expect(loaded?.id).toBe(legacy.id);
    expect(await activeSessionId(worktree)).toBe(legacy.id);
    await expect(readFile(getLegacySessionPath(worktree), "utf8")).rejects.toThrow();
    await expect(readFile(getSessionPath(worktree, legacy.id), "utf8")).resolves.toContain('"goal": "Legacy goal"');
    await expect(readFile(getIndexDocPath(worktree, legacy.id), "utf8")).resolves.toContain("goal: Legacy goal");
  });

  test("rejects malformed persisted session data", async () => {
    const worktree = makeTempDir();
    const sessionId = "malformed-session";
    mkdirSync(join(worktree, ".flow", "sessions", sessionId), { recursive: true });
    await writeFile(getActiveSessionPath(worktree), `${sessionId}\n`, "utf8");
    await writeFile(getSessionPath(worktree, sessionId), "{not valid json", "utf8");

    await expect(loadSession(worktree)).rejects.toThrow();
  });

  test("saveSession refreshes updatedAt while preserving createdAt", async () => {
    const worktree = makeTempDir();
    const created = createSession("Build a workflow plugin");
    const firstSave = await saveSession(worktree, created);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondSave = await saveSession(worktree, firstSave);

    expect(secondSave.timestamps.createdAt).toBe(firstSave.timestamps.createdAt);
    expect(new Date(secondSave.timestamps.updatedAt).getTime()).toBeGreaterThan(new Date(firstSave.timestamps.updatedAt).getTime());
  });

  test("saveSessionState persists source-of-truth session state without rendering docs", async () => {
    const worktree = makeTempDir();
    const created = createSession("Build a workflow plugin");

    const saved = await saveSessionState(worktree, created);

    await expect(readFile(await activeSessionPath(worktree), "utf8")).resolves.toContain('"goal": "Build a workflow plugin"');
    await expect(readFile(await activeIndexDocPath(worktree), "utf8")).rejects.toThrow();
    expect(saved.goal).toBe("Build a workflow plugin");
  });

  test("syncSessionArtifacts renders docs from persisted session state", async () => {
    const worktree = makeTempDir();
    const created = createSession("Build a workflow plugin");
    const saved = await saveSessionState(worktree, created);

    await syncSessionArtifacts(worktree, saved);

    await expect(readFile(await activeIndexDocPath(worktree), "utf8")).resolves.toContain("# Flow Session");
  });

  test("deleteSessionState and deleteSessionArtifacts can clean persistence and docs independently", async () => {
    const worktree = makeTempDir();
    const created = createSession("Build a workflow plugin");
    const saved = await saveSession(worktree, created);
    expect(saved.goal).toBe("Build a workflow plugin");

    await deleteSessionState(worktree);
    await expect(readFile(await activeSessionPath(worktree), "utf8")).rejects.toThrow();
    await expect(readFile(await activeIndexDocPath(worktree), "utf8")).resolves.toContain("# Flow Session");

    await deleteSessionArtifacts(worktree);
    await expect(readFile(await activeIndexDocPath(worktree), "utf8")).rejects.toThrow();
  });

  test("renders feature docs for planned work", async () => {
    const worktree = makeTempDir();
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    await saveSession(worktree, applied.value);
    const featureDoc = await readFile(await activeFeatureDocPath(worktree, "setup-runtime"), "utf8");

    expect(featureDoc).toContain("# Feature setup-runtime");
    expect(featureDoc).toContain("Create runtime helpers");
    expect(featureDoc).toContain("src/runtime/session.ts");
  });

  test("prunes stale feature docs when a plan is narrowed", async () => {
    const worktree = makeTempDir();
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    await saveSession(worktree, applied.value);
    await expect(readFile(await activeFeatureDocPath(worktree, "execute-feature"), "utf8")).resolves.toContain("# Feature execute-feature");

    const selected = selectPlanFeatures(applied.value, ["setup-runtime"]);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    await saveSession(worktree, selected.value);

    await expect(readFile(await activeFeatureDocPath(worktree, "setup-runtime"), "utf8")).resolves.toContain("# Feature setup-runtime");
    await expect(readFile(await activeFeatureDocPath(worktree, "execute-feature"), "utf8")).rejects.toThrow();
  });

  test("renders multiline content without breaking markdown structure", async () => {
    const worktree = makeTempDir();
    const session = createSession("Build a workflow plugin\nwith multiline context");
    const applied = applyPlan(session, {
      ...samplePlan(),
      summary: "Implement docs\nwithout malformed markdown",
      features: [
        {
          id: "setup-runtime",
          title: "Create runtime helpers\ncarefully",
          summary: "Line one\n## not a real heading\nLine three",
          fileTargets: ["src/runtime/session.ts"],
          verification: ["bun test\nwith extra notes"],
        },
      ],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    await saveSession(worktree, applied.value);
    const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
    const featureDoc = await readFile(await activeFeatureDocPath(worktree, "setup-runtime"), "utf8");

    expect(indexDoc).toContain("goal: Build a workflow plugin / with multiline context");
    expect(indexDoc).toContain("summary: Implement docs / without malformed markdown");
    expect(featureDoc).toContain("> ## not a real heading");
    expect(featureDoc).toContain("- bun test / with extra notes");
  });

  test("applies and approves a plan", () => {
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    expect(approved.value.approval).toBe("approved");
    expect(approved.value.status).toBe("ready");
  });

  test("selects a dependency-consistent subset of features", () => {
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const selected = selectPlanFeatures(applied.value, ["setup-runtime"]);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    expect(selected.value.plan?.features).toHaveLength(1);
    expect(selected.value.plan?.features[0]?.id).toBe("setup-runtime");
  });

  test("rejects mixed valid and invalid requested feature ids", () => {
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const selected = selectPlanFeatures(applied.value, ["setup-runtime", "missing-feature"]);
    expect(selected.ok).toBe(false);
    if (selected.ok) return;

    expect(selected.message).toContain("Unknown feature ids");
  });

  test("starts the next runnable feature", () => {
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

    expect(started.value.feature?.id).toBe("setup-runtime");
    expect(started.value.session.status).toBe("running");
  });

  test("rejects starting a second run while one feature is active", () => {
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

    const restarted = startRun(started.value.session);
    expect(restarted.ok).toBe(false);
    if (restarted.ok) return;

    expect(restarted.message).toContain("already in progress");
  });

  test("rejects plan approval after execution has started", () => {
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

    const reapproved = approvePlan(started.value.session);
    expect(reapproved.ok).toBe(false);
    if (reapproved.ok) return;

    expect(reapproved.message).toContain("already executing work");
  });

  test("does not block the session on an invalid requested feature id", () => {
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value, "missing-feature");
    expect(started.ok).toBe(false);
    if (started.ok) return;

    expect(started.message).toContain("was not found");
    expect(approved.value.status).toBe("ready");
  });

  test("completes a feature and advances the session", () => {
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "feature",
      featureId: "setup-runtime",
      status: "approved",
      summary: "Looks correct.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [{ path: "src/runtime/session.ts" }],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [{ summary: "Kept a single session artifact." }],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks correct.", blockingFindings: [] },
    });

    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    expect(completed.value.status).toBe("ready");
    expect(completed.value.plan?.features[0]?.status).toBe("completed");
  });

  test("renders per-feature execution history and review evidence", async () => {
    const worktree = makeTempDir();
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "feature",
      featureId: "setup-runtime",
      status: "approved",
      summary: "Looks correct.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [{ path: "src/runtime/session.ts", kind: "updated" }],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [{ summary: "Kept a single session artifact." }],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks correct.", blockingFindings: [] },
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    await saveSession(worktree, completed.value);
    const featureDoc = await readFile(await activeFeatureDocPath(worktree, "setup-runtime"), "utf8");

    expect(featureDoc).toContain("## Execution History");
    expect(featureDoc).toContain("Completed runtime setup.");
    expect(featureDoc).toContain("#### Changed Artifacts");
    expect(featureDoc).toContain("src/runtime/session.ts (updated)");
    expect(featureDoc).toContain("#### Validation");
    expect(featureDoc).toContain("passed | bun test | Runtime tests passed.");
    expect(featureDoc).toContain("#### Feature Review");
    expect(featureDoc).toContain("Looks correct.");
  });

  test("preserves execution history when replanning the same session", async () => {
    const worktree = makeTempDir();
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "feature",
      featureId: "setup-runtime",
      status: "approved",
      summary: "Looks correct.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [{ path: "src/runtime/session.ts" }],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [{ summary: "Kept a single session artifact." }],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks correct.", blockingFindings: [] },
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    await saveSession(worktree, completed.value);

    const replanned = applyPlan(completed.value, {
      ...samplePlan(),
      summary: "Refined the workflow plan.",
      features: [
        ...samplePlan().features,
        {
          id: "write-docs",
          title: "Write docs",
          summary: "Document the refined workflow.",
          fileTargets: ["README.md"],
          verification: ["bun test"],
        },
      ],
    });
    expect(replanned.ok).toBe(true);
    if (!replanned.ok) return;

    await saveSession(worktree, replanned.value);
    const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
    const featureDoc = await readFile(await activeFeatureDocPath(worktree, "setup-runtime"), "utf8");

    expect(replanned.value.execution.history).toHaveLength(1);
    expect(indexDoc).toContain("Completed runtime setup.");
    expect(featureDoc).toContain("## Execution History");
    expect(featureDoc).toContain("Completed runtime setup.");
  });

  test("clears execution history when starting a new goal", async () => {
    const worktree = makeTempDir();
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "feature",
      featureId: "setup-runtime",
      status: "approved",
      summary: "Looks correct.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [{ path: "src/runtime/session.ts" }],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [{ summary: "Kept a single session artifact." }],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks correct.", blockingFindings: [] },
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    await saveSession(worktree, completed.value);

    const tools = createTools({}) as any;
    const response = await tools.flow_plan_start.execute({ goal: "Different goal" }, { worktree });
    const parsed = JSON.parse(response);
    const nextSession = await loadSession(worktree);

    expect(parsed.status).toBe("ok");
    expect(nextSession?.goal).toBe("Different goal");
    expect(nextSession?.execution.history).toHaveLength(0);

    const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
    expect(indexDoc).not.toContain("Completed runtime setup.");
  });

  test("flow_auto_prepare returns missing_goal for empty input without a session", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;

    const response = await tools.flow_auto_prepare.execute({}, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("missing_goal");
    expect(parsed.mode).toBe("missing_goal");
    expect(parsed.nextCommand).toBe("/flow-auto <goal>");
  });

  test("flow_auto_prepare resumes an existing session for empty input", async () => {
    const worktree = makeTempDir();
    await saveSession(worktree, createSession("Build a workflow plugin"));
    const tools = createTools({}) as any;

    const response = await tools.flow_auto_prepare.execute({}, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.mode).toBe("resume");
    expect(parsed.goal).toBe("Build a workflow plugin");
  });

  test("flow_auto_prepare does not resume a completed session", async () => {
    const worktree = makeTempDir();
    const session = createSession("Build a workflow plugin");
    session.status = "completed";
    session.approval = "approved";
    session.timestamps.completedAt = new Date().toISOString();
    await saveSession(worktree, session);
    const tools = createTools({}) as any;

    const response = await tools.flow_auto_prepare.execute({}, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("missing_goal");
    expect(parsed.mode).toBe("missing_goal");
    expect(parsed.nextCommand).toBe("/flow-auto <goal>");
  });

  test("flow_auto_prepare treats resume as missing_goal when no session exists", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;

    const response = await tools.flow_auto_prepare.execute({ argumentString: "resume" }, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("missing_goal");
    expect(parsed.mode).toBe("missing_goal");
  });

  test("flow_auto_prepare classifies explicit goals as start_new_goal", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;

    const response = await tools.flow_auto_prepare.execute(
      { argumentString: "Improve Flow recovery behavior" },
      { worktree },
    );
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.mode).toBe("start_new_goal");
    expect(parsed.goal).toBe("Improve Flow recovery behavior");
  });

  test("returns to planning when the worker requires replanning", () => {
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value, "execute-feature");
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.message).toContain("not runnable");

    const firstStarted = startRun(approved.value);
    expect(firstStarted.ok).toBe(true);
    if (!firstStarted.ok) return;

    const replanned = completeRun(firstStarted.value.session, {
      contractVersion: "1",
      status: "needs_input",
      summary: "The feature needs to be split further.",
      artifactsChanged: [],
      validationRun: [],
      validationScope: "targeted",
      reviewIterations: 0,
      decisions: [{ summary: "Feature is too broad after inspection." }],
      nextStep: "Create a refined plan.",
      outcome: { kind: "replan_required", needsHuman: false },
      featureResult: { featureId: "setup-runtime", verificationStatus: "not_recorded" },
      featureReview: { status: "needs_followup", summary: "No code changed.", blockingFindings: [] },
    });

    expect(replanned.ok).toBe(true);
    if (!replanned.ok) return;

    expect(replanned.value.status).toBe("planning");
    expect(replanned.value.approval).toBe("pending");
    expect(replanned.value.plan).toBeNull();
    expect(summarizeSession(replanned.value).session?.nextCommand).toBe("/flow-plan <goal>");
  });

  test("renders replanned sessions with a new planning command", async () => {
    const worktree = makeTempDir();
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

    const replanned = completeRun(started.value.session, {
      contractVersion: "1",
      status: "needs_input",
      summary: "The feature needs to be split further.",
      artifactsChanged: [],
      validationRun: [],
      validationScope: "targeted",
      reviewIterations: 0,
      decisions: [{ summary: "Feature is too broad after inspection." }],
      nextStep: "Create a refined plan.",
      outcome: { kind: "replan_required", needsHuman: false },
      featureResult: { featureId: "setup-runtime", verificationStatus: "not_recorded" },
      featureReview: { status: "needs_followup", summary: "No code changed.", blockingFindings: [] },
    });
    expect(replanned.ok).toBe(true);
    if (!replanned.ok) return;

    await saveSession(worktree, replanned.value);
    const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
    expect(indexDoc).toContain("next command: /flow-plan <goal>");
  });

  test("persists and renders actionable needs_input metadata", async () => {
    const worktree = makeTempDir();
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
    });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;

    expect(blocked.value.execution.lastNextStep).toBe("Ask the operator to provide API credentials.");
    expect(blocked.value.execution.lastOutcome?.resolutionHint).toBe("Set the API token and rerun the feature.");
    expect(blocked.value.execution.lastFeatureResult?.notes?.[0]?.note).toBe("No code changes were made.");

    const summary = summarizeSession(blocked.value);
    expect(summary.session?.lastNextStep).toBe("Ask the operator to provide API credentials.");
    expect(summary.session?.lastOutcome?.kind).toBe("needs_operator_input");
    expect(summary.session?.nextCommand).toBe("/flow-status");

    await saveSession(worktree, blocked.value);
    const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
    const featureDoc = await readFile(await activeFeatureDocPath(worktree, "setup-runtime"), "utf8");

    expect(indexDoc).toContain("next step: Ask the operator to provide API credentials.");
    expect(indexDoc).toContain("resolution hint: Set the API token and rerun the feature.");
    expect(featureDoc).toContain("#### Outcome");
    expect(featureDoc).toContain("needs human: yes");
    expect(featureDoc).toContain("#### Follow Ups");
    expect(featureDoc).toContain("Provide the missing API token. (high)");
  });

  test("same-goal planning refresh clears last actionable metadata", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
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
    });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;

    await saveSession(worktree, blocked.value);
    const response = await tools.flow_plan_start.execute({ goal: "Build a workflow plugin" }, { worktree });
    const parsed = JSON.parse(response);
    const refreshed = await loadSession(worktree);
    const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");

    expect(parsed.status).toBe("ok");
    expect(refreshed?.execution.lastOutcome).toBeNull();
    expect(refreshed?.execution.lastNextStep).toBeNull();
    expect(refreshed?.execution.lastFeatureResult).toBeNull();
    expect(indexDoc).not.toContain("resolution hint: Set the API token and rerun the feature.");
    expect(indexDoc).toContain("next step: none");
  });

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
    const tools = createTools({}) as any;

    for (const session of Object.values(buildSummaryFixtureSessions())) {
      const worktree = makeTempDir();
      await saveSession(worktree, session);

      const response = await tools.flow_status.execute({}, { worktree });
      const parsed = JSON.parse(response);

      expect(normalizeSummaryFixture(parsed)).toEqual(normalizeSummaryFixture(summarizeSession(session)));
    }
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

  test("rejects inconsistent ok status with replan outcome", () => {
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "feature",
      featureId: "setup-runtime",
      status: "approved",
      summary: "Looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [],
      nextStep: "Create a refined plan.",
      outcome: { kind: "replan_required", needsHuman: false },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks correct.", blockingFindings: [] },
    });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;
    expect(completed.message).toContain("validation failed");
  });

  test("final-path reviewer failures return final recovery metadata even without final payload fields", () => {
    const session = createSession("Build a workflow plugin");
    const plan = {
      ...samplePlan(),
      completionPolicy: {
        minCompletedFeatures: 1,
        requireFinalReview: true,
      },
      features: [samplePlan().features[0]],
    };

    const applied = applyPlan(session, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const completed = completeRun(started.value.session, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [],
      nextStep: "Session should complete.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
    });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;

    expect(completed.recovery?.errorCode).toBe("missing_final_reviewer_decision");
    expect(completed.recovery?.recoveryStage).toBe("record_review");
    expect(completed.recovery?.prerequisite).toBe("reviewer_result_required");
    expect(completed.recovery?.requiredArtifact).toBe("final_reviewer_decision");
    expect(completed.recovery?.nextCommand).toBe("/flow-status");
    expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
  });

  test("rejects malformed dependency graphs during plan apply", () => {
    const session = createSession("Build a workflow plugin");
    const invalidPlan = {
      ...samplePlan(),
      features: [
        {
          id: "setup-runtime",
          title: "Create runtime helpers",
          summary: "Add runtime helper files and state persistence.",
          fileTargets: ["src/runtime/session.ts"],
          verification: ["bun test"],
          dependsOn: ["missing-feature"],
        },
      ],
    };

    const applied = applyPlan(session, invalidPlan);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;

    expect(applied.message).toContain("unknown feature");
  });

  test("rejects unsafe feature ids during plan apply", () => {
    const session = createSession("Build a workflow plugin");
    const invalidPlan = {
      ...samplePlan(),
      features: [
        {
          id: "../escape",
          title: "Bad feature id",
          summary: "Should be rejected.",
          fileTargets: [],
          verification: [],
        },
      ],
    };

    const applied = applyPlan(session, invalidPlan);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;

    expect(applied.message).toContain("Feature ids must be lowercase kebab-case");
  });

  test("rejects successful worker results when review failed", () => {
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "feature",
      featureId: "setup-runtime",
      status: "approved",
      summary: "Looks correct.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: {
        status: "failed",
        summary: "Blocking issues remain.",
        blockingFindings: [{ summary: "A blocking review issue remains." }],
      },
    });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;

    expect(completed.message).toContain("featureReview");
  });

  test("rejects successful worker results when validation does not fully pass", () => {
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "final",
      status: "approved",
      summary: "Final review looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [],
      validationRun: [{ command: "bun test", status: "partial", summary: "Some checks remain unresolved." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "partial" },
      featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
    });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;

    expect(completed.message).toContain("validation did not fully pass");
  });

  test("allows final completion when broad validation and final review both pass", () => {
    const session = createSession("Build a workflow plugin");
    const plan = {
      ...samplePlan(),
      completionPolicy: {
        minCompletedFeatures: 1,
        requireFinalReview: true,
      },
      features: [samplePlan().features[0]],
    };

    const applied = applyPlan(session, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "final",
      status: "approved",
      summary: "Final review looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
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
    });

    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    expect(completed.value.status).toBe("completed");
  });

  test("requires broad validation before final session completion", () => {
    const session = createSession("Build a workflow plugin");
    const plan = {
      ...samplePlan(),
      completionPolicy: {
        minCompletedFeatures: 1,
      },
      features: [samplePlan().features[0]],
    };

    const applied = applyPlan(session, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "final",
      status: "approved",
      summary: "Final review looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [],
      nextStep: "Session should complete.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
      finalReview: { status: "passed", summary: "Feature review is clean.", blockingFindings: [] },
    });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;

    expect(completed.message).toContain("broad final validation");
  });

  test("does not allow a completed session to start more work", () => {
    const session = createSession("Build a workflow plugin");
    const plan = {
      ...samplePlan(),
      completionPolicy: {
        minCompletedFeatures: 1,
      },
    };

    const applied = applyPlan(session, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "final",
      status: "approved",
      summary: "Final review looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
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
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    expect(completed.value.status).toBe("completed");

    const restarted = startRun(completed.value);
    expect(restarted.ok).toBe(false);
    if (restarted.ok) return;

    expect(restarted.message).toContain("already completed");
  });

  test("tool accepts the documented top-level worker payload", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "feature",
      featureId: "setup-runtime",
      status: "approved",
      summary: "Looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    await saveSession(worktree, reviewed.value);
    const response = await tools.flow_run_complete_feature.execute(
      {
        contractVersion: "1",
        status: "ok",
        summary: "Completed runtime setup.",
        artifactsChanged: [],
        validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
        validationScope: "targeted",
        reviewIterations: 1,
        decisions: [],
        nextStep: "Run the next feature.",
        outcome: { kind: "completed" },
        featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
        featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
      },
      { worktree },
    );

    const parsed = JSON.parse(response);
    expect(parsed.status).toBe("ok");
    expect(parsed.session.lastOutcomeKind).toBe("completed");
  });

  test("worker completion adapter preserves the documented payload shape for runtime parsing", () => {
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "feature",
      featureId: "setup-runtime",
      status: "approved",
      summary: "Looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const adapted = adaptFlowRunCompleteFeatureInput({
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [{ path: "src/runtime/session.ts" }],
      validationRun: [{ command: "bun test", status: "passed", summary: "Tests passed." }],
      validationScope: "targeted",
      decisions: [{ summary: "Kept the runtime contract stable." }],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
    });

    const parsed = completeRun(reviewed.value, adapted);

    expect(parsed.ok).toBe(true);
  });

  test("worker completion adapter preserves all optional worker-result fields", () => {
    const adapted = adaptFlowRunCompleteFeatureInput({
      contractVersion: "1",
      status: "needs_input",
      summary: "Waiting on operator input.",
      artifactsChanged: [{ path: "src/runtime/session.ts", kind: "source" }],
      validationRun: [{ command: "bun test", status: "partial", summary: "One manual check remains." }],
      validationScope: "broad",
      reviewIterations: 2,
      decisions: [{ summary: "Stopped before unsafe completion." }],
      nextStep: "Ask the operator to confirm migration timing.",
      outcome: {
        kind: "needs_operator_input",
        category: "release",
        summary: "Manual release approval required.",
        resolutionHint: "Confirm the rollout window.",
        retryable: true,
        autoResolvable: false,
        needsHuman: true,
      },
      featureResult: {
        featureId: "setup-runtime",
        verificationStatus: "partial",
        notes: [{ note: "Manual verification remains." }],
        followUps: [{ summary: "Confirm rollout timing", severity: "medium" }],
      },
      featureReview: {
        status: "needs_followup",
        summary: "Needs operator confirmation.",
        blockingFindings: [{ summary: "Release timing not approved." }],
      },
      finalReview: {
        status: "needs_followup",
        summary: "Final approval still pending.",
        blockingFindings: [{ summary: "Awaiting operator sign-off." }],
      },
    });

    expect(adapted).toEqual({
      contractVersion: "1",
      status: "needs_input",
      summary: "Waiting on operator input.",
      artifactsChanged: [{ path: "src/runtime/session.ts", kind: "source" }],
      validationRun: [{ command: "bun test", status: "partial", summary: "One manual check remains." }],
      validationScope: "broad",
      reviewIterations: 2,
      decisions: [{ summary: "Stopped before unsafe completion." }],
      nextStep: "Ask the operator to confirm migration timing.",
      outcome: {
        kind: "needs_operator_input",
        category: "release",
        summary: "Manual release approval required.",
        resolutionHint: "Confirm the rollout window.",
        retryable: true,
        autoResolvable: false,
        needsHuman: true,
      },
      featureResult: {
        featureId: "setup-runtime",
        verificationStatus: "partial",
        notes: [{ note: "Manual verification remains." }],
        followUps: [{ summary: "Confirm rollout timing", severity: "medium" }],
      },
      featureReview: {
        status: "needs_followup",
        summary: "Needs operator confirmation.",
        blockingFindings: [{ summary: "Release timing not approved." }],
      },
      finalReview: {
        status: "needs_followup",
        summary: "Final approval still pending.",
        blockingFindings: [{ summary: "Awaiting operator sign-off." }],
      },
    });
  });

  test("reviewer decision adapter preserves optional reviewer payload fields", () => {
    expect(
      adaptReviewerDecisionInput({
        scope: "feature",
        featureId: "setup-runtime",
        status: "needs_fix",
        summary: "Needs another pass.",
        blockingFindings: [{ summary: "Validation evidence is incomplete." }],
        followUps: [{ summary: "Rerun targeted tests", severity: "medium" }],
        suggestedValidation: ["bun test tests/runtime.test.ts"],
      }),
    ).toEqual({
      scope: "feature",
      featureId: "setup-runtime",
      status: "needs_fix",
      summary: "Needs another pass.",
      blockingFindings: [{ summary: "Validation evidence is incomplete." }],
      followUps: [{ summary: "Rerun targeted tests", severity: "medium" }],
      suggestedValidation: ["bun test tests/runtime.test.ts"],
    });
  });

  test("reviewer decision tool accepts the adapted top-level payload for final review", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
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

    await saveSession(worktree, started.value.session);

    const response = await tools.flow_review_record_final.execute(
      {
        scope: "final",
        status: "approved",
        summary: "Final state looks good.",
        blockingFindings: [],
        followUps: [],
        suggestedValidation: ["bun run check"],
      },
      { worktree },
    );

    const parsed = JSON.parse(response);
    expect(parsed.status).toBe("ok");
    expect(parsed.session.lastReviewerDecision.scope).toBe("final");
    expect(parsed.session.lastReviewerDecision.suggestedValidation).toEqual(["bun run check"]);
  });

  test("flow_status returns a machine-readable missing-session summary", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const response = await tools.flow_status.execute({}, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("missing");
    expect(parsed.summary).toBe("No active Flow session found.");
  });

  test("flow_history returns a machine-readable missing-history summary", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const response = await tools.flow_history.execute({}, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("missing");
    expect(parsed.summary).toBe("No Flow session history found.");
    expect(parsed.history.activeSessionId).toBeNull();
    expect(parsed.history.sessions).toEqual([]);
    expect(parsed.history.archived).toEqual([]);
    expect(parsed.nextCommand).toBe("/flow-plan <goal>");
  });

  test("flow_history lists active and archived session runs", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const first = await saveSession(worktree, createSession("First goal"));
    const second = await saveSession(worktree, createSession("Second goal"));

    const resetResponse = await tools.flow_reset_session.execute({}, { worktree });
    const resetParsed = JSON.parse(resetResponse);
    expect(resetParsed.archivedSessionId).toBe(second.id);
    expect(resetParsed.archivedTo).toMatch(new RegExp(`^\\.flow/archive/${second.id}-`));
    await expect(readFile(join(worktree, resetParsed.archivedTo, "session.json"), "utf8")).resolves.toContain('"goal": "Second goal"');

    const response = await tools.flow_history.execute({}, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.summary).toContain("2 Flow session entries");
    expect(parsed.history.activeSessionId).toBeNull();
    expect(parsed.history.sessions).toHaveLength(1);
    expect(parsed.history.sessions[0]).toMatchObject({
      id: first.id,
      goal: "First goal",
      active: false,
      path: `.flow/sessions/${first.id}`,
    });
    expect(parsed.history.archived).toHaveLength(1);
    expect(parsed.history.archived[0]).toMatchObject({
      id: second.id,
      goal: "Second goal",
      active: false,
      archivePath: resetParsed.archivedTo,
    });
    expect(parsed.history.archived[0].path).toBe(resetParsed.archivedTo);
    expect(parsed.nextCommand).toBe(`/flow-session activate ${first.id}`);
    expect(getArchiveDir(worktree)).toContain(".flow/archive");
  });

  test("flow_history_show returns active stored session details by id", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const first = await saveSession(worktree, createSession("First goal"));
    const second = await saveSession(worktree, createSession("Second goal"));

    const response = await tools.flow_history_show.execute({ sessionId: first.id }, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.source).toBe("sessions");
    expect(parsed.active).toBe(false);
    expect(parsed.path).toBe(`.flow/sessions/${first.id}`);
    expect(parsed.archivePath).toBeNull();
    expect(parsed.session.id).toBe(first.id);
    expect(parsed.session.goal).toBe("First goal");
    expect(parsed.session.nextCommand).toBe(`/flow-session activate ${first.id}`);
    expect(parsed.nextCommand).toBe(`/flow-session activate ${first.id}`);
    expect(await activeSessionId(worktree)).toBe(second.id);
  });

  test("flow_history_show returns archived session details by id", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const saved = await saveSession(worktree, createSession("Archived goal"));

    const resetResponse = await tools.flow_reset_session.execute({}, { worktree });
    const resetParsed = JSON.parse(resetResponse);
    const response = await tools.flow_history_show.execute({ sessionId: saved.id }, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.source).toBe("archive");
    expect(parsed.active).toBe(false);
    expect(parsed.path).toBe(resetParsed.archivedTo);
    expect(parsed.archivePath).toBe(resetParsed.archivedTo);
    expect(parsed.session.id).toBe(saved.id);
    expect(parsed.session.goal).toBe("Archived goal");
    expect(parsed.session.nextCommand).toBe("/flow-history");
    expect(parsed.nextCommand).toBe("/flow-history");
  });

  test("flow_history_show does not suggest activation for completed stored sessions", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const completed = createSession("Completed goal");
    const saved = await saveSession(worktree, {
      ...completed,
      status: "completed",
      timestamps: {
        ...completed.timestamps,
        completedAt: new Date().toISOString(),
      },
    });
    await saveSession(worktree, createSession("Current active goal"));

    const response = await tools.flow_history_show.execute({ sessionId: saved.id }, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.source).toBe("sessions");
    expect(parsed.session.status).toBe("completed");
    expect(parsed.session.nextCommand).toBe("/flow-plan <goal>");
    expect(parsed.nextCommand).toBe("/flow-plan <goal>");
  });

  test("flow_session_activate switches the active session pointer", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const first = await saveSession(worktree, createSession("First goal"));
    const second = await saveSession(worktree, createSession("Second goal"));

    expect(await activeSessionId(worktree)).toBe(second.id);

    const response = await tools.flow_session_activate.execute({ sessionId: first.id }, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.summary).toBe("Activated Flow session: First goal");
    expect(parsed.session.id).toBe(first.id);
    expect(parsed.nextCommand).toBe("/flow-status");
    expect(await activeSessionId(worktree)).toBe(first.id);
    expect((await loadSession(worktree))?.id).toBe(first.id);
  });

  test("history show and session activate report missing ids clearly", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;

    const showResponse = await tools.flow_history_show.execute({ sessionId: "missing-id" }, { worktree });
    const showParsed = JSON.parse(showResponse);
    expect(showParsed.status).toBe("missing_session");
    expect(showParsed.nextCommand).toBe("/flow-history");

    const activateResponse = await tools.flow_session_activate.execute({ sessionId: "missing-id" }, { worktree });
    const activateParsed = JSON.parse(activateResponse);
    expect(activateParsed.status).toBe("missing_session");
    expect(activateParsed.nextCommand).toBe("/flow-history");
  });

  test("flow_reset_session archives the active session and clears the active pointer", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const saved = await saveSession(worktree, createSession("Build a workflow plugin"));

    const response = await tools.flow_reset_session.execute({}, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.summary).toBe("Archived and cleared the active Flow session.");
    expect(parsed.archivedSessionId).toBe(saved.id);
    expect(parsed.archivedTo).toMatch(new RegExp(`^\.flow/archive/${saved.id}-`));
    expect(parsed.nextCommand).toBe("/flow-plan <goal>");
    expect(await loadSession(worktree)).toBeNull();
    await expect(readFile(join(worktree, parsed.archivedTo, "session.json"), "utf8")).resolves.toContain('"goal": "Build a workflow plugin"');
    await expect(readFile(join(worktree, parsed.archivedTo, "docs", "index.md"), "utf8")).resolves.toContain("# Flow Session");
  });

  test("tools return machine-readable missing-session responses for plan, review, and reset operations", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const cases = [
      ["flow_plan_apply", { plan: samplePlan() }, "missing_session", "/flow-plan <goal>"],
      ["flow_plan_approve", {}, "missing_session", undefined],
      ["flow_plan_select_features", { featureIds: ["setup-runtime"] }, "missing_session", undefined],
      ["flow_review_record_feature", { scope: "feature", featureId: "setup-runtime", status: "approved", summary: "Looks good." }, "missing_session", undefined],
      ["flow_review_record_final", { scope: "final", status: "approved", summary: "Looks good." }, "missing_session", undefined],
      ["flow_reset_feature", { featureId: "setup-runtime" }, "missing_session", undefined],
    ] as const;

    for (const [toolName, args, expectedStatus, expectedNextCommand] of cases) {
      const response = await tools[toolName].execute(args, { worktree });
      const parsed = JSON.parse(response);

      expect(parsed.status).toBe(expectedStatus);
      expect(parsed.summary).toContain("No active Flow");
      if (expectedNextCommand) {
        expect(parsed.nextCommand).toBe(expectedNextCommand);
      }
    }
  });

  test("tool rejects flow_run_start for completed sessions", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const session = createSession("Build a workflow plugin");
    const plan = {
      ...samplePlan(),
      completionPolicy: {
        minCompletedFeatures: 1,
      },
    };

    const applied = applyPlan(session, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "final",
      status: "approved",
      summary: "Final review looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
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
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    await saveSession(worktree, completed.value);
    const response = await tools.flow_run_start.execute({}, { worktree });
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("error");
    expect(parsed.summary).toContain("already completed");
  });

  test("tool rejects the old nested worker payload shape", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
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

    await saveSession(worktree, started.value.session);

    const response = await tools.flow_run_complete_feature.execute(
      {
        contractVersion: "1",
        result: {
          status: "ok",
          summary: "Completed runtime setup.",
          artifactsChanged: [],
          validationRun: [],
          decisions: [],
          nextStep: "Run the next feature.",
          outcome: { kind: "completed" },
          featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
          featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
        },
      },
      { worktree },
    );

    const parsed = JSON.parse(response);
    expect(parsed.status).toBe("error");
    expect(parsed.summary).toContain("validation failed");
  });

  test("tool returns machine-readable recovery details for missing final reviewer approval", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const session = createSession("Build a workflow plugin");
    const plan = {
      ...samplePlan(),
      completionPolicy: {
        minCompletedFeatures: 1,
        requireFinalReview: true,
      },
      features: [samplePlan().features[0]],
    };

    const applied = applyPlan(session, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await saveSession(worktree, started.value.session);
    const response = await tools.flow_run_complete_feature.execute(
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
      { worktree },
    );

    const parsed = JSON.parse(response);
    expect(parsed.status).toBe("error");
    expect(parsed.recovery.errorCode).toBe("missing_final_reviewer_decision");
    expect(parsed.recovery.recoveryStage).toBe("record_review");
    expect(parsed.recovery.prerequisite).toBe("reviewer_result_required");
    expect(parsed.recovery.requiredArtifact).toBe("final_reviewer_decision");
    expect(parsed.recovery.nextCommand).toBe("/flow-status");
    expect(parsed.recovery.nextRuntimeTool).toBeUndefined();
    expect(parsed.recovery.retryable).toBe(true);
  });

  test("tool returns machine-readable recovery details for missing broad validation", async () => {
    const worktree = makeTempDir();
    const tools = createTools({}) as any;
    const session = createSession("Build a workflow plugin");
    const plan = {
      ...samplePlan(),
      completionPolicy: {
        minCompletedFeatures: 1,
      },
      features: [samplePlan().features[0]],
    };

    const applied = applyPlan(session, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "final",
      status: "approved",
      summary: "Final review looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    await saveSession(worktree, reviewed.value);
    const response = await tools.flow_run_complete_feature.execute(
      {
        contractVersion: "1",
        status: "ok",
        summary: "Completed runtime setup.",
        artifactsChanged: [],
        validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
        validationScope: "targeted",
        reviewIterations: 1,
        decisions: [],
        nextStep: "Session should complete.",
        outcome: { kind: "completed" },
        featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
        featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
        finalReview: { status: "passed", summary: "Repo-wide validation is clean.", blockingFindings: [] },
      },
      { worktree },
    );

    const parsed = JSON.parse(response);
    expect(parsed.status).toBe("error");
    expect(parsed.recovery.errorCode).toBe("missing_broad_validation");
    expect(parsed.recovery.recoveryStage).toBe("rerun_validation");
    expect(parsed.recovery.prerequisite).toBe("validation_rerun_required");
    expect(parsed.recovery.requiredArtifact).toBe("broad_validation_result");
    expect(parsed.recovery.nextCommand).toBe("/flow-status");
    expect(parsed.recovery.nextRuntimeTool).toBeUndefined();
    expect(parsed.recovery.autoResolvable).toBe(true);
  });

  test("feature reviewer recovery exposes runtime tool guidance without suggesting flow-run", () => {
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

    const completed = completeRun(started.value.session, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
    });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;

    expect(completed.recovery?.errorCode).toBe("missing_feature_reviewer_decision");
    expect(completed.recovery?.prerequisite).toBe("reviewer_result_required");
    expect(completed.recovery?.requiredArtifact).toBe("feature_reviewer_decision");
    expect(completed.recovery?.nextCommand).toBe("/flow-status");
    expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
    expect(completed.recovery?.nextRuntimeArgs).toBeUndefined();
  });

  test("missing final review payload exposes prerequisite instead of fake retry action", () => {
    const session = createSession("Build a workflow plugin");
    const plan = {
      ...samplePlan(),
      completionPolicy: {
        minCompletedFeatures: 1,
        requireFinalReview: true,
      },
      features: [samplePlan().features[0]],
    };

    const applied = applyPlan(session, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const started = startRun(approved.value);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "final",
      status: "approved",
      summary: "Final review looks good.",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const completed = completeRun(reviewed.value, {
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
    });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;

    expect(completed.recovery?.errorCode).toBe("missing_final_review_payload");
    expect(completed.recovery?.recoveryStage).toBe("retry_completion");
    expect(completed.recovery?.prerequisite).toBe("completion_payload_rebuild_required");
    expect(completed.recovery?.requiredArtifact).toBe("final_review_payload");
    expect(completed.recovery?.nextCommand).toBe("/flow-status");
    expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
  });

  test("requires a recorded reviewer approval before successful completion", () => {
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

    const completed = completeRun(started.value.session, {
      contractVersion: "1",
      status: "ok",
      summary: "Completed runtime setup.",
      artifactsChanged: [],
      validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
      validationScope: "targeted",
      reviewIterations: 1,
      decisions: [],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
    });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;

    expect(completed.message).toContain("recorded approved reviewer decision");
  });

  test("records reviewer decisions for the active feature", () => {
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

    const reviewed = recordReviewerDecision(started.value.session, {
      scope: "feature",
      featureId: "setup-runtime",
      status: "needs_fix",
      summary: "A follow-up fix is required.",
      blockingFindings: [{ summary: "Adjust one failing branch." }],
      suggestedValidation: ["bun test"],
    });

    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    expect(reviewed.value.execution.lastReviewerDecision?.status).toBe("needs_fix");
    expect(reviewed.value.execution.lastReviewerDecision?.featureId).toBe("setup-runtime");
  });

  test("resets a feature and clears session files", async () => {
    const worktree = makeTempDir();
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    approved.value.plan!.features[0]!.status = "completed";
    const reset = resetFeature(approved.value, "setup-runtime");
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;

    expect(reset.value.plan?.features[0]?.status).toBe("pending");

    await saveSession(worktree, reset.value);
    const sessionId = await activeSessionId(worktree);
    await deleteSession(worktree);
    const loaded = await loadSession(worktree);
    expect(loaded).toBeNull();
    await expect(readFile(getIndexDocPath(worktree, sessionId), "utf8")).rejects.toThrow();
  });

  test("resetting a prerequisite also resets dependent features", () => {
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    approved.value.plan!.features[0]!.status = "completed";
    approved.value.plan!.features[1]!.status = "completed";

    const reset = resetFeature(approved.value, "setup-runtime");
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;

    expect(reset.value.plan?.features[0]?.status).toBe("pending");
    expect(reset.value.plan?.features[1]?.status).toBe("pending");
    expect(reset.value.artifacts).toHaveLength(0);
    expect(reset.value.notes).toHaveLength(0);
    expect(reset.value.execution.lastValidationRun).toHaveLength(0);
  });

  test("resetting an unrelated feature preserves the last run projections", () => {
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, {
      ...samplePlan(),
      features: [
        ...samplePlan().features,
        {
          id: "write-docs",
          title: "Write docs",
          summary: "Document the workflow.",
          fileTargets: ["README.md"],
          verification: ["bun test"],
        },
      ],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const approved = approvePlan(applied.value);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    approved.value.plan!.features[0]!.status = "completed";
    approved.value.plan!.features[1]!.status = "completed";
    approved.value.plan!.features[2]!.status = "completed";
    approved.value.execution.lastFeatureId = "write-docs";
    approved.value.execution.lastValidationRun = [{ command: "bun test", status: "passed", summary: "Still valid." }];
    approved.value.artifacts = [{ path: "README.md" }];
    approved.value.notes = ["Docs feature completed cleanly."];

    const reset = resetFeature(approved.value, "setup-runtime");
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;

    expect(reset.value.execution.lastFeatureId).toBe("write-docs");
    expect(reset.value.execution.lastValidationRun).toHaveLength(1);
    expect(reset.value.artifacts).toHaveLength(1);
    expect(reset.value.notes).toHaveLength(1);
  });
});
