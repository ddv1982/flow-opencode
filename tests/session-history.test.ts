import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
	closeSession,
	createSession,
	listSessionHistory,
	saveSession,
} from "../src/runtime/session";
import * as time from "../src/runtime/util";
import { createTempDirRegistry } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

describe("session history completed parsing", () => {
	test("listSessionHistory includes latest failed attempt projections", async () => {
		const worktree = makeTempDir();
		const session = createSession("Failed completion history");
		session.execution.lastFailedMutation = {
			tool: "flow_run_complete_feature",
			phase: "execution",
			status: "error",
			failureCategory: "missing_review_scope_accounting",
			summary: "Completion failed before persistence.",
			recoveryHint: "Repair reviewScopeLedger evidence.",
			occurredAt: "2026-05-10T12:00:00.000Z",
		};
		await saveSession(worktree, session);

		const history = await listSessionHistory(worktree);
		expect(history.active?.latestFailedAttempt).toMatchObject({
			tool: "flow_run_complete_feature",
			failureCategory: "missing_review_scope_accounting",
		});
		expect(history.stored).toEqual([]);
		expect(history.completed).toEqual([]);
	});

	test("listSessionHistory parses millisecond completed timestamps and sorts descending", async () => {
		const worktree = makeTempDir();
		const first = createSession("Older completed session");
		const second = createSession("Newer completed session");

		spyOn(time, "completedTimestampNow")
			.mockReturnValueOnce("20250405T194213.482")
			.mockReturnValueOnce("20250405T194213.483");
		await saveSession(worktree, first);
		const olderCompleted = await closeSession(worktree, "completed");
		expect(olderCompleted).not.toBeNull();

		await saveSession(worktree, second);
		const newerCompleted = await closeSession(worktree, "completed");
		expect(newerCompleted).not.toBeNull();

		const history = await listSessionHistory(worktree);
		expect(history.activeSessionId).toBeNull();
		expect(history.active).toBeNull();
		expect(history.stored).toEqual([]);
		expect(history.completed).toHaveLength(2);
		expect(history.completed.map((entry) => entry.id)).toEqual([
			second.id,
			first.id,
		]);
		expect(history.completed.map((entry) => entry.completedAt)).toEqual([
			"20250405T194213.483",
			"20250405T194213.482",
		]);
		expect(history.completed.map((entry) => entry.completedPath)).toEqual([
			expect.any(String),
			expect.any(String),
		]);
		expect(history.completed[0]?.completedPath).toBe(
			newerCompleted?.completedTo,
		);
		expect(history.completed[1]?.completedPath).toBe(
			olderCompleted?.completedTo,
		);
	});
});
