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

export function collectTokenEfficiencyMeasurements() {
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
      status: "deferred",
      reason: "Compact summary work is gated behind Phase 1A prompt reductions and explicit no-regression verification.",
      thresholds: {
        minimumAverageSummaryReductionRatio: 0.25,
        minimumAverageCompactVsPhase1ABytesRemovedRatio: 0.1,
        allowSummaryRegressions: false,
      },
      inputs: {
        baselinePromptAndCommandBytes: totalPromptBytes + totalCommandBytes,
        baselineAverageSummaryBytes: averageSummaryBytes,
        baselineSummaryBytesByFixture: Object.fromEntries(
          Object.entries(summaryFixtureMeasurements).map(([name, value]) => [name, value.bytes]),
        ),
      },
    },
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(collectTokenEfficiencyMeasurements(), null, 2));
}
