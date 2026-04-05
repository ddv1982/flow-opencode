import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  FLOW_AUTO_AGENT_PROMPT,
  FLOW_CONTROL_AGENT_PROMPT,
  FLOW_PLANNER_AGENT_PROMPT,
  FLOW_REVIEWER_AGENT_PROMPT,
  FLOW_WORKER_AGENT_PROMPT,
} from "../src/prompts/agents";
import {
  FLOW_AUTO_COMMAND_TEMPLATE,
  FLOW_HISTORY_COMMAND_TEMPLATE,
  FLOW_PLAN_COMMAND_TEMPLATE,
  FLOW_RESET_COMMAND_TEMPLATE,
  FLOW_RUN_COMMAND_TEMPLATE,
  FLOW_SESSION_COMMAND_TEMPLATE,
  FLOW_STATUS_COMMAND_TEMPLATE,
} from "../src/prompts/commands";
import { getActiveSessionPath, getProjectTokenEfficiencyPath, getSessionTokenEfficiencyPath } from "../src/runtime/paths";
import { createSession } from "../src/runtime/session";
import { summarizeSession } from "../src/runtime/summary";
import { applyPlan, approvePlan, completeRun, recordReviewerDecision, startRun } from "../src/runtime/transitions";

type SessionSummary = ReturnType<typeof summarizeSession>;

type TextMeasurement = {
  bytes: number;
  lines: number;
};

type SummaryMeasurement = TextMeasurement & {
  status: string;
  nextCommand: string | null;
};

const SUMMARY_FIXTURE_NAMES = ["planning", "running", "blocked", "completed"] as const;

export const BASELINE_MEASUREMENTS_PATH = new URL("./token-efficiency-measurements.baseline.json", import.meta.url);

const BaselineSummaryMeasurementSchema = z.object({
  bytes: z.number().nonnegative(),
});

const BaselineMeasurementsSchema = z.object({
  schemaVersion: z.literal(1),
  totals: z.object({
    promptAndCommandBytes: z.number().nonnegative(),
    averageSummaryBytes: z.number().nonnegative(),
  }),
  summaries: z
    .object({
      planning: BaselineSummaryMeasurementSchema,
      running: BaselineSummaryMeasurementSchema,
      blocked: BaselineSummaryMeasurementSchema,
      completed: BaselineSummaryMeasurementSchema,
    })
    .strict(),
});

type BaselineMeasurements = z.infer<typeof BaselineMeasurementsSchema>;

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

function measureText(value: string): TextMeasurement {
  return {
    bytes: Buffer.byteLength(value),
    lines: value.split(/\r?\n/).length,
  };
}

function measureSummary(summary: SessionSummary): SummaryMeasurement {
  const serialized = JSON.stringify(summary);
  return {
    ...measureText(serialized),
    status: summary.status,
    nextCommand: summary.session?.nextCommand ?? null,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeFilePath(path: URL): string {
  try {
    return fileURLToPath(path);
  } catch {
    return path.pathname;
  }
}

export function readBaselineMeasurements(path: URL = BASELINE_MEASUREMENTS_PATH): BaselineMeasurements {
  const filePath = describeFilePath(path);
  let serialized: string;

  try {
    serialized = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Failed to read token-efficiency baseline at ${filePath}: ${describeError(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Failed to parse token-efficiency baseline at ${filePath}: ${describeError(error)}`);
  }

  const result = BaselineMeasurementsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid token-efficiency baseline at ${filePath}: ${z.prettifyError(result.error)}`,
    );
  }

  return result.data;
}

export function normalizeTokenEfficiencyMeasurements<T extends { recordedAt: string }>(measurements: T): Omit<T, "recordedAt"> {
  const { recordedAt: _recordedAt, ...rest } = measurements;
  return rest;
}

function readActiveSessionIdSync(worktree: string): string | null {
  try {
    const value = readFileSync(getActiveSessionPath(worktree), "utf8").trim();
    return value || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function resolveTokenEfficiencyArtifactPath(worktree = process.cwd()): URL {
  const resolvedWorktree = resolve(worktree);
  const activeSessionId = readActiveSessionIdSync(resolvedWorktree);
  const artifactPath = activeSessionId
    ? getSessionTokenEfficiencyPath(resolvedWorktree, activeSessionId)
    : getProjectTokenEfficiencyPath(resolvedWorktree);
  return pathToFileURL(artifactPath);
}

export function buildSummaryFixtureSessions() {
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
        recordReviewerDecision(assertOk(startRun(assertOk(approvePlan(assertOk(applyPlan(createSession("Build a workflow plugin"), finalPlan)))))).session, {
          scope: "final",
          status: "approved",
          summary: "Final review looks good.",
        }),
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

export function buildSummaryFixtures() {
  const sessions = buildSummaryFixtureSessions();

  return {
    planning: summarizeSession(sessions.planning),
    running: summarizeSession(sessions.running),
    blocked: summarizeSession(sessions.blocked),
    completed: summarizeSession(sessions.completed),
  };
}

export function collectTokenEfficiencyMeasurements(options?: { baselinePath?: URL }) {
  const agentPrompts = {
    FLOW_PLANNER_AGENT_PROMPT,
    FLOW_WORKER_AGENT_PROMPT,
    FLOW_AUTO_AGENT_PROMPT,
    FLOW_REVIEWER_AGENT_PROMPT,
    FLOW_CONTROL_AGENT_PROMPT,
  } as const;
  const commandTemplates = {
    FLOW_PLAN_COMMAND_TEMPLATE,
    FLOW_RUN_COMMAND_TEMPLATE,
    FLOW_AUTO_COMMAND_TEMPLATE,
    FLOW_STATUS_COMMAND_TEMPLATE,
    FLOW_HISTORY_COMMAND_TEMPLATE,
    FLOW_SESSION_COMMAND_TEMPLATE,
    FLOW_RESET_COMMAND_TEMPLATE,
  } as const;
  const summaryFixtures = buildSummaryFixtures();

  const promptFixtures = Object.fromEntries(
    Object.entries(agentPrompts).map(([name, value]) => [name, measureText(value)]),
  );
  const commandFixtures = Object.fromEntries(
    Object.entries(commandTemplates).map(([name, value]) => [name, measureText(value)]),
  );
  const summaryFixtureMeasurements = Object.fromEntries(
    Object.entries(summaryFixtures).map(([name, value]) => [name, measureSummary(value)]),
  );

  const totalPromptBytes = Object.values(promptFixtures).reduce((sum, item) => sum + item.bytes, 0);
  const totalCommandBytes = Object.values(commandFixtures).reduce((sum, item) => sum + item.bytes, 0);
  const summaryBytes = Object.values(summaryFixtureMeasurements).map((item) => item.bytes);
  const averageSummaryBytes = summaryBytes.reduce((sum, value) => sum + value, 0) / summaryBytes.length;
  const baseline = readBaselineMeasurements(options?.baselinePath);
  const missingBaselineFixtures = SUMMARY_FIXTURE_NAMES.filter((name) => baseline.summaries[name] === undefined);
  if (missingBaselineFixtures.length > 0) {
    throw new Error(
      `Token-efficiency baseline is missing summary fixtures: ${missingBaselineFixtures.join(", ")}`,
    );
  }

  const baselinePromptAndCommandBytes = baseline.totals.promptAndCommandBytes;
  const baselineAverageSummaryBytes = baseline.totals.averageSummaryBytes;
  const baselineSummaryBytesByFixture = Object.fromEntries(
    SUMMARY_FIXTURE_NAMES.map((name) => [name, baseline.summaries[name].bytes]),
  );
  const phase1aPromptAndCommandBytesRemoved = baselinePromptAndCommandBytes - (totalPromptBytes + totalCommandBytes);

  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    prompts: promptFixtures,
    commands: commandFixtures,
    summaries: summaryFixtureMeasurements,
    totals: {
      promptBytes: totalPromptBytes,
      commandBytes: totalCommandBytes,
      promptAndCommandBytes: totalPromptBytes + totalCommandBytes,
      averageSummaryBytes,
    },
    phase1bGate: {
      status: "no_go",
      reason:
        phase1aPromptAndCommandBytesRemoved > 0
          ? "Phase 1A prompt reductions landed, but compact-v1 measurements are still absent, so the Phase 1B gate remains no-go."
          : "Phase 1A prompt reductions are not yet reflected in the baseline comparison, so the Phase 1B gate remains no-go.",
      missingEvidence: ["compactV1SummaryBytesByFixture"],
      thresholds: {
        minimumAverageSummaryReductionRatio: 0.25,
        minimumAverageCompactVsPhase1ABytesRemovedRatio: 0.1,
        allowSummaryRegressions: false,
      },
      inputs: {
        baselinePromptAndCommandBytes,
        baselineAverageSummaryBytes,
        baselineSummaryBytesByFixture,
        phase1aPromptAndCommandBytesRemoved,
      },
    },
  };
}

export function renderTokenEfficiencyMeasurements() {
  return `${JSON.stringify(collectTokenEfficiencyMeasurements(), null, 2)}\n`;
}

export function writeTokenEfficiencyMeasurementsArtifact(options?: { path?: URL; worktree?: string }) {
  const path = options?.path ?? resolveTokenEfficiencyArtifactPath(options?.worktree);
  mkdirSync(new URL(".", path), { recursive: true });
  writeFileSync(path, renderTokenEfficiencyMeasurements(), "utf8");
  return path;
}

function parseWorktreeArg(argv: string[]): string | undefined {
  const index = argv.findIndex((value) => value === "--worktree");
  if (index === -1) {
    return process.env.FLOW_WORKTREE;
  }

  return argv[index + 1] ?? process.env.FLOW_WORKTREE;
}

if (import.meta.main) {
  if (process.argv.includes("--write")) {
    writeTokenEfficiencyMeasurementsArtifact({ worktree: parseWorktreeArg(process.argv.slice(2)) });
  } else {
    process.stdout.write(renderTokenEfficiencyMeasurements());
  }
}
