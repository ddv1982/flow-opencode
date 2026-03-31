import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, deleteSession, loadSession, saveSession } from "../src/runtime/session";
import { getFeatureDocPath, getIndexDocPath } from "../src/runtime/paths";
import { summarizeSession } from "../src/runtime/summary";
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

function samplePlan() {
  return {
    summary: "Implement a small workflow feature set.",
    overview: "Create one setup feature and one execution feature.",
    requirements: ["Keep state durable", "Keep commands concise"],
    architectureDecisions: ["Persist a single session artifact", "Run one feature per worker invocation"],
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

describe("runtime transitions", () => {
  test("creates, saves, and loads a session", async () => {
    const worktree = makeTempDir();
    const created = createSession("Build a workflow plugin");
    await saveSession(worktree, created);

    const loaded = await loadSession(worktree);
    const indexDoc = await readFile(getIndexDocPath(worktree), "utf8");
    expect(loaded?.goal).toBe("Build a workflow plugin");
    expect(loaded?.status).toBe("planning");
    expect(indexDoc).toContain("# Flow Session");
    expect(indexDoc).toContain("goal: Build a workflow plugin");
  });

  test("renders feature docs for planned work", async () => {
    const worktree = makeTempDir();
    const session = createSession("Build a workflow plugin");
    const applied = applyPlan(session, samplePlan());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    await saveSession(worktree, applied.value);
    const featureDoc = await readFile(getFeatureDocPath(worktree, "setup-runtime"), "utf8");

    expect(featureDoc).toContain("# Feature setup-runtime");
    expect(featureDoc).toContain("Create runtime helpers");
    expect(featureDoc).toContain("src/runtime/session.ts");
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
    const indexDoc = await readFile(getIndexDocPath(worktree), "utf8");
    const featureDoc = await readFile(getFeatureDocPath(worktree, "setup-runtime"), "utf8");

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
    const featureDoc = await readFile(getFeatureDocPath(worktree, "setup-runtime"), "utf8");

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
    const indexDoc = await readFile(getIndexDocPath(worktree), "utf8");
    const featureDoc = await readFile(getFeatureDocPath(worktree, "setup-runtime"), "utf8");

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

    const indexDoc = await readFile(getIndexDocPath(worktree), "utf8");
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
    const indexDoc = await readFile(getIndexDocPath(worktree), "utf8");
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
    const indexDoc = await readFile(getIndexDocPath(worktree), "utf8");
    const featureDoc = await readFile(getFeatureDocPath(worktree, "setup-runtime"), "utf8");

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
    const indexDoc = await readFile(getIndexDocPath(worktree), "utf8");

    expect(parsed.status).toBe("ok");
    expect(refreshed?.execution.lastOutcome).toBeNull();
    expect(refreshed?.execution.lastNextStep).toBeNull();
    expect(refreshed?.execution.lastFeatureResult).toBeNull();
    expect(indexDoc).not.toContain("resolution hint: Set the API token and rerun the feature.");
    expect(indexDoc).toContain("next step: none");
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
    await deleteSession(worktree);
    const loaded = await loadSession(worktree);
    expect(loaded).toBeNull();
    await expect(readFile(getIndexDocPath(worktree), "utf8")).rejects.toThrow();
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
