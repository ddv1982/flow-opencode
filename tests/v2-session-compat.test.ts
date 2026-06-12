// Acceptance coverage: a v2-era persisted session (schema version 1 with
// retired accounting keys such as reviewScopeLedger, evidencePackets on
// reviewer decisions and history entries, behaviorChecks/validationCoverage
// on final reviews, and pre-consolidation tool names in failed-attempt
// records) must load and resume cleanly under the v3 runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSession } from "../src/runtime/lifecycle";
import {
	createTempDirRegistry,
	createTestTools,
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-v2-session-compat-",
);

afterEach(() => {
	cleanupTempDirs();
});

const V2_SESSION_ID = "v2-era-session";

async function installV2SessionFixture(worktree: string): Promise<void> {
	const fixture = await readFile(
		join(import.meta.dir, "fixtures", "v2-session.json"),
		"utf8",
	);
	const sessionDir = join(worktree, ".flow", "active", V2_SESSION_ID);
	await mkdir(sessionDir, { recursive: true });
	await writeFile(join(sessionDir, "session.json"), fixture, "utf8");
}

describe("v2 session compatibility", () => {
	test("a v2-era session file loads with retired accounting keys stripped", async () => {
		const worktree = makeTempDir();
		await installV2SessionFixture(worktree);

		const session = await loadSession(worktree);

		expect(session).not.toBeNull();
		if (!session) return;
		expect(session.version).toBe(1);
		expect(session.id).toBe(V2_SESSION_ID);
		expect(session.goal).toBe(
			"Migrate the report generator to streaming output",
		);
		expect(session.status).toBe("ready");
		expect(session.approval).toBe("approved");
		expect(session.plan?.features.map((feature) => feature.status)).toEqual([
			"completed",
			"pending",
		]);

		// Retired v2 accounting keys are stripped on load instead of failing.
		expect(session.execution.lastReviewerDecision).not.toHaveProperty(
			"reviewScopeLedger",
		);
		expect(session.execution.lastReviewerDecision).not.toHaveProperty(
			"evidencePackets",
		);
		const historyEntry = session.execution.history[0];
		expect(historyEntry).toBeDefined();
		expect(historyEntry).not.toHaveProperty("reviewFindingClosures");
		expect(historyEntry).not.toHaveProperty("evidencePackets");
		expect(historyEntry?.finalReview).not.toHaveProperty("behaviorChecks");
		expect(historyEntry?.finalReview).not.toHaveProperty("validationCoverage");
		expect(historyEntry?.finalReview?.status).toBe("passed");

		// Failed-attempt records written with pre-consolidation tool names load.
		expect(session.execution.lastFailedMutation?.tool).toBe(
			"flow_run_complete_feature",
		);
	});

	test("a v2-era session resumes cleanly through flow_status and flow_run_start", async () => {
		const worktree = makeTempDir();
		await installV2SessionFixture(worktree);
		const tools = createTestTools();

		const status = JSON.parse(
			await tools.flow_status.execute({}, toolContext(worktree)),
		);
		expect(status.status).toBe("ready");
		expect(status.session.id).toBe(V2_SESSION_ID);
		expect(status.session.featureProgress).toEqual({
			completed: 1,
			total: 2,
		});
		expect(status.latestFailedAttempt).toMatchObject({
			tool: "flow_run_complete_feature",
			failureCategory: "missing_review_scope_accounting",
		});

		const started = JSON.parse(
			await tools.flow_run_start.execute({}, toolContext(worktree)),
		);
		expect(started.status).toBe("ok");
		expect(started.feature?.id).toBe("stream-cli");
		expect(started.session.status).toBe("running");

		const resumed = await loadSession(worktree);
		expect(resumed?.execution.activeFeatureId).toBe("stream-cli");
		expect(resumed?.plan?.features.map((feature) => feature.status)).toEqual([
			"completed",
			"in_progress",
		]);
	});
});
