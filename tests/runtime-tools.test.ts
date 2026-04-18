import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSession, deleteSession, loadSession, saveSession } from "../src/runtime/session";
import { getArchiveDir, getIndexDocPath } from "../src/runtime/paths";
import { approvePlan, applyPlan, completeRun, recordReviewerDecision, resetFeature, startRun } from "../src/runtime/transitions";
import { activeSessionId, createTempDirRegistry, createTestTools, samplePlan } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
  cleanupTempDirs();
});

function toolContext(worktree: string, directory?: string) {
  return (directory ? { worktree, directory } : { worktree }) as Parameters<ReturnType<typeof createTestTools>["flow_status"]["execute"]>[1];
}

describe("runtime tools and recovery", () => {
  test("flow_status returns a machine-readable missing-session summary", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
    const response = await tools.flow_status.execute({}, toolContext(worktree));
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("missing");
    expect(parsed.summary).toBe("No active Flow session found.");
  });

  test("flow_history returns a machine-readable missing-history summary", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
    const response = await tools.flow_history.execute({}, toolContext(worktree));
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("missing");
    expect(parsed.summary).toBe("No Flow session history found.");
    expect(parsed.history.activeSessionId).toBeNull();
    expect(parsed.history.sessions).toEqual([]);
    expect(parsed.history.archived).toEqual([]);
    expect(parsed.nextCommand).toBe("/flow-plan <goal>");
  });

  test("no-arg tools accept undefined args", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();

    const statusResponse = await tools.flow_status.execute(undefined as never, toolContext(worktree));
    const statusParsed = JSON.parse(statusResponse);
    expect(statusParsed.status).toBe("missing");

    const historyResponse = await tools.flow_history.execute(undefined as never, toolContext(worktree));
    const historyParsed = JSON.parse(historyResponse);
    expect(historyParsed.status).toBe("missing");

    const resetResponse = await tools.flow_reset_session.execute(undefined as never, toolContext(worktree));
    const resetParsed = JSON.parse(resetResponse);
    expect(resetParsed.status).toBe("ok");
    expect(resetParsed.summary).toBe("No active Flow session existed.");
  });

  test("flow_plan_start accepts an OpenCode-like context payload and persists under directory", async () => {
    const directory = makeTempDir();
    const tools = createTestTools();
    const context = {
      worktree: "///",
      directory,
      sessionId: "opaque-runtime-session-id",
      commandName: "flow-plan",
    } as unknown as Parameters<ReturnType<typeof createTestTools>["flow_status"]["execute"]>[1];

    const response = await tools.flow_plan_start.execute({ goal: "Build a workflow plugin" }, context);
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    await expect(readFile(join(directory, ".flow", "active"), "utf8")).resolves.toContain(parsed.session.id);
  });

  test("flow_history lists active and archived session runs", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
    const first = await saveSession(worktree, createSession("First goal"));
    const second = await saveSession(worktree, createSession("Second goal"));

    const resetResponse = await tools.flow_reset_session.execute({}, toolContext(worktree));
    const resetParsed = JSON.parse(resetResponse);
    expect(resetParsed.archivedSessionId).toBe(second.id);
    expect(resetParsed.archivedTo).toMatch(new RegExp(`^\\.flow/archive/${second.id}-`));
    await expect(readFile(join(worktree, resetParsed.archivedTo, "session.json"), "utf8")).resolves.toContain('"goal": "Second goal"');

    const response = await tools.flow_history.execute({}, toolContext(worktree));
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
    const tools = createTestTools();
    const first = await saveSession(worktree, createSession("First goal"));
    const second = await saveSession(worktree, createSession("Second goal"));

    const response = await tools.flow_history_show.execute({ sessionId: first.id }, toolContext(worktree));
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
    const tools = createTestTools();
    const saved = await saveSession(worktree, createSession("Archived goal"));

    const resetResponse = await tools.flow_reset_session.execute({}, toolContext(worktree));
    const resetParsed = JSON.parse(resetResponse);
    const response = await tools.flow_history_show.execute({ sessionId: saved.id }, toolContext(worktree));
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
    const tools = createTestTools();
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

    const response = await tools.flow_history_show.execute({ sessionId: saved.id }, toolContext(worktree));
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.source).toBe("sessions");
    expect(parsed.session.status).toBe("completed");
    expect(parsed.session.nextCommand).toBe("/flow-plan <goal>");
    expect(parsed.nextCommand).toBe("/flow-plan <goal>");
  });

  test("flow_session_activate switches the active session pointer", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
    const first = await saveSession(worktree, createSession("First goal"));
    const second = await saveSession(worktree, createSession("Second goal"));

    expect(await activeSessionId(worktree)).toBe(second.id);

    const response = await tools.flow_session_activate.execute({ sessionId: first.id }, toolContext(worktree));
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
    const tools = createTestTools();

    const showResponse = await tools.flow_history_show.execute({ sessionId: "missing-id" }, toolContext(worktree));
    const showParsed = JSON.parse(showResponse);
    expect(showParsed.status).toBe("missing_session");
    expect(showParsed.nextCommand).toBe("/flow-history");

    const activateResponse = await tools.flow_session_activate.execute({ sessionId: "missing-id" }, toolContext(worktree));
    const activateParsed = JSON.parse(activateResponse);
    expect(activateParsed.status).toBe("missing_session");
    expect(activateParsed.nextCommand).toBe("/flow-history");
  });

  test("flow_reset_session archives the active session and clears the active pointer", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
    const saved = await saveSession(worktree, createSession("Build a workflow plugin"));

    const response = await tools.flow_reset_session.execute({}, toolContext(worktree));
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("ok");
    expect(parsed.summary).toBe("Archived and cleared the active Flow session.");
    expect(parsed.archivedSessionId).toBe(saved.id);
    expect(parsed.archivedTo).toMatch(new RegExp(`^\\.flow/archive/${saved.id}-`));
    expect(parsed.nextCommand).toBe("/flow-plan <goal>");
    expect(await loadSession(worktree)).toBeNull();
    await expect(readFile(join(worktree, parsed.archivedTo, "session.json"), "utf8")).resolves.toContain('"goal": "Build a workflow plugin"');
    await expect(readFile(join(worktree, parsed.archivedTo, "docs", "index.md"), "utf8")).resolves.toContain("# Flow Session");
  });

  test("tools return machine-readable missing-session responses for plan, review, and reset operations", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
    const cases = [
      ["flow_plan_apply", { plan: samplePlan() }, "missing_session", "/flow-plan <goal>"],
      ["flow_plan_approve", {}, "missing_session", undefined],
      ["flow_plan_select_features", { featureIds: ["setup-runtime"] }, "missing_session", undefined],
      ["flow_review_record_feature", { scope: "feature", featureId: "setup-runtime", status: "approved", summary: "Looks good." }, "missing_session", undefined],
      ["flow_review_record_final", { scope: "final", status: "approved", summary: "Looks good." }, "missing_session", undefined],
      ["flow_reset_feature", { featureId: "setup-runtime" }, "missing_session", undefined],
    ] as const;

    for (const [toolName, args, expectedStatus, expectedNextCommand] of cases) {
      const response = await (tools[toolName] as { execute: (args: unknown, context: Parameters<ReturnType<typeof createTestTools>["flow_status"]["execute"]>[1]) => Promise<string> }).execute(args, toolContext(worktree));
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
    const tools = createTestTools();
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
    const response = await tools.flow_run_start.execute({ featureId: undefined }, toolContext(worktree));
    const parsed = JSON.parse(response);

    expect(parsed.status).toBe("error");
    expect(parsed.summary).toContain("already completed");
  });

  test("tool rejects the old nested worker payload shape", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
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
      } as never,
      toolContext(worktree),
    );

    const parsed = JSON.parse(response);
    expect(parsed.status).toBe("error");
    expect(parsed.summary).toContain("validation failed");
  });

  test("tool returns machine-readable recovery details for missing final reviewer approval", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
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
      toolContext(worktree),
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

  test("tool persists worker evidence when completion fails with retryable recovery", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
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
        status: "ok",
        summary: "Completed runtime setup.",
        artifactsChanged: [{ path: "src/runtime/session.ts" }],
        validationRun: [{ command: "bun test", status: "passed", summary: "Runtime tests passed." }],
        validationScope: "targeted",
        reviewIterations: 1,
        decisions: [{ summary: "Runtime wiring is complete." }],
        nextStep: "Run the next feature.",
        outcome: { kind: "completed" },
        featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
        featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
        finalReview: undefined,
      },
      toolContext(worktree),
    );

    const parsed = JSON.parse(response);
    expect(parsed.status).toBe("error");
    expect(parsed.recovery.errorCode).toBe("missing_feature_reviewer_decision");

    const persisted = await loadSession(worktree);
    expect(persisted?.execution.activeFeatureId).toBe("setup-runtime");
    expect(persisted?.execution.lastSummary).toBe("Completed runtime setup.");
    expect(persisted?.execution.lastFeatureResult?.featureId).toBe("setup-runtime");
    expect(persisted?.execution.lastValidationRun).toEqual([
      { command: "bun test", status: "passed", summary: "Runtime tests passed." },
    ]);
    expect(persisted?.execution.history).toHaveLength(1);
    expect(persisted?.execution.history[0]?.summary).toBe("Completed runtime setup.");
    expect(persisted?.artifacts).toEqual([{ path: "src/runtime/session.ts" }]);
    expect(persisted?.notes).toEqual(["Runtime wiring is complete."]);
  });

  test("tool returns machine-readable recovery details for missing broad validation", async () => {
    const worktree = makeTempDir();
    const tools = createTestTools();
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
      toolContext(worktree),
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

  test("missing targeted validation recovery stays status-only and points back to validation", () => {
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
      validationScope: "broad",
      reviewIterations: 1,
      decisions: [],
      nextStep: "Run the next feature.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "setup-runtime", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Looks good.", blockingFindings: [] },
    });

    expect(completed.ok).toBe(false);
    if (completed.ok) return;

    expect(completed.recovery?.errorCode).toBe("missing_targeted_validation");
    expect(completed.recovery?.recoveryStage).toBe("rerun_validation");
    expect(completed.recovery?.prerequisite).toBe("validation_rerun_required");
    expect(completed.recovery?.requiredArtifact).toBe("targeted_validation_result");
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
