import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, saveSession } from "../src/runtime/session";
import { summarizeSession } from "../src/runtime/summary";
import { createTools } from "../src/tools";
import { applyPlan, approvePlan, completeRun, recordReviewerDecision, startRun } from "../src/runtime/transitions";
import type { Session } from "../src/runtime/schema";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-opencode-token-eff-"));
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
    summary: "Reduce token usage without weakening Flow strictness.",
    overview: "Lock current behavior before any compact-summary experimentation.",
    requirements: ["Preserve default status output", "Keep reviewer checkpoints mandatory"],
    architectureDecisions: ["Treat compact summaries as opt-in only after the numeric gate passes"],
    features: [
      {
        id: "preserve-status-shape",
        title: "Preserve default status shape",
        summary: "Freeze the current flow_status output contract.",
        fileTargets: ["src/runtime/summary.ts", "src/tools.ts"],
        verification: ["bun test tests/runtime.test.ts"],
      },
    ],
  };
}

function unwrapValue<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.value;
}

function buildPlanningSession(): Session {
  return unwrapValue(applyPlan(createSession("Reduce token usage safely"), samplePlan()));
}

function buildRunningSession(): Session {
  const approved = unwrapValue(approvePlan(buildPlanningSession()));
  return unwrapValue(startRun(approved)).session;
}

function buildBlockedSession(): Session {
  return unwrapValue(
    completeRun(buildRunningSession(), {
      contractVersion: "1",
      status: "needs_input",
      summary: "Waiting on a maintainer decision.",
      artifactsChanged: [],
      validationRun: [],
      validationScope: "targeted",
      reviewIterations: 0,
      decisions: [{ summary: "Need confirmation before changing the default status contract." }],
      nextStep: "Keep the current default status output unchanged until the Phase 1B gate passes.",
      outcome: {
        kind: "needs_operator_input",
        summary: "Default status output is intentionally frozen in Phase 1A.",
        resolutionHint: "Review the measurements and only enable compact output if the numeric gate passes.",
        retryable: true,
        needsHuman: true,
      },
      featureResult: {
        featureId: "preserve-status-shape",
        verificationStatus: "not_recorded",
        notes: [{ note: "No runtime compaction was applied." }],
        followUps: [{ summary: "Wait for the measurement artifact before deciding on compact-v1.", severity: "medium" }],
      },
      featureReview: {
        status: "needs_followup",
        summary: "Blocked until the numeric gate is evaluated.",
        blockingFindings: [],
      },
    }),
  );
}

function buildCompletedSession(): Session {
  const plan = {
    ...samplePlan(),
    completionPolicy: {
      minCompletedFeatures: 1,
      requireFinalReview: true,
    },
  };
  const planned = unwrapValue(applyPlan(createSession("Reduce token usage safely"), plan));
  const approved = unwrapValue(approvePlan(planned));
  const running = unwrapValue(startRun(approved)).session;
  const reviewed = unwrapValue(
    recordReviewerDecision(running, {
      scope: "final",
      status: "approved",
      summary: "Default status behavior is preserved and the verification evidence is clean.",
    }),
  );

  return unwrapValue(
    completeRun(reviewed, {
      contractVersion: "1",
      status: "ok",
      summary: "Kept the default status output stable.",
      artifactsChanged: [{ path: "tests/token-efficiency-verification.test.ts", kind: "added" }],
      validationRun: [{ command: "bun run check", status: "passed", summary: "Typecheck, tests, and build are green." }],
      validationScope: "broad",
      reviewIterations: 1,
      decisions: [{ summary: "Compact output remains gated behind explicit Phase 1B approval." }],
      nextStep: "Use the measurement artifact to decide whether compact-v1 may proceed.",
      outcome: { kind: "completed" },
      featureResult: { featureId: "preserve-status-shape", verificationStatus: "passed" },
      featureReview: { status: "passed", summary: "Default behavior remains intact.", blockingFindings: [] },
      finalReview: { status: "passed", summary: "Broad validation is clean.", blockingFindings: [] },
    }),
  );
}

async function flowStatusSnapshot(session: Session | null, args?: unknown) {
  const worktree = makeTempDir();
  if (session) {
    await saveSession(worktree, session);
  }

  const tools = createTools({}) as any;
  return JSON.parse(await tools.flow_status.execute(args, { worktree }));
}

type GateMetrics = {
  promptAndCommandBytesRemoved: number;
  baselineSummaryBytes: [number, number, number, number];
  compactSummaryBytes: [number, number, number, number];
};

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluatePhase1BGate(metrics: GateMetrics) {
  const averageBaselineBytes = average(metrics.baselineSummaryBytes);
  const averageCompactBytes = average(metrics.compactSummaryBytes);
  const averageBytesSaved = average(metrics.baselineSummaryBytes.map((baseline, index) => baseline - metrics.compactSummaryBytes[index]));
  const noRegression = metrics.compactSummaryBytes.every((compact, index) => compact <= metrics.baselineSummaryBytes[index]);
  const reductionRatio = averageBaselineBytes === 0 ? 0 : (averageBaselineBytes - averageCompactBytes) / averageBaselineBytes;
  const promptSavingsThreshold = metrics.promptAndCommandBytesRemoved * 0.1;

  return {
    passes: reductionRatio >= 0.25 && noRegression && averageBytesSaved >= promptSavingsThreshold,
    reductionRatio,
    noRegression,
    averageBytesSaved,
    promptSavingsThreshold,
  };
}

describe("token-efficiency verification scaffold", () => {
  test("Phase 1A keeps the default flow_status output stable across fixture states", async () => {
    const fixtures = [
      { name: "missing", session: null },
      { name: "planning", session: buildPlanningSession() },
      { name: "running", session: buildRunningSession() },
      { name: "blocked", session: buildBlockedSession() },
      { name: "completed", session: buildCompletedSession() },
    ] as const;

    for (const fixture of fixtures) {
      const fromEmptyArgs = await flowStatusSnapshot(fixture.session, {});
      const fromOmittedArgs = await flowStatusSnapshot(fixture.session, undefined);
      const expected = summarizeSession(fixture.session);

      expect(fromEmptyArgs).toEqual(expected);
      expect(fromOmittedArgs).toEqual(expected);
    }
  });

  test("pre-gate compact-v1 requests must not change the default status shape", async () => {
    const fixtures = [buildPlanningSession(), buildRunningSession(), buildBlockedSession(), buildCompletedSession()];

    for (const fixture of fixtures) {
      const defaultStatus = await flowStatusSnapshot(fixture, {});
      const compactRequest = await flowStatusSnapshot(fixture, { format: "compact-v1" });

      expect(compactRequest).toEqual(defaultStatus);
    }
  });

  test("Phase 1B go/no-go scaffold enforces the numeric gate", () => {
    const passes = evaluatePhase1BGate({
      promptAndCommandBytesRemoved: 600,
      baselineSummaryBytes: [200, 180, 220, 200],
      compactSummaryBytes: [120, 125, 150, 120],
    });
    expect(passes.passes).toBe(true);
    expect(passes.reductionRatio).toBeGreaterThanOrEqual(0.25);
    expect(passes.noRegression).toBe(true);
    expect(passes.averageBytesSaved).toBeGreaterThanOrEqual(passes.promptSavingsThreshold);

    const fails = evaluatePhase1BGate({
      promptAndCommandBytesRemoved: 400,
      baselineSummaryBytes: [200, 180, 220, 200],
      compactSummaryBytes: [120, 125, 240, 120],
    });
    expect(fails.passes).toBe(false);
    expect(fails.noRegression).toBe(false);
  });
});
