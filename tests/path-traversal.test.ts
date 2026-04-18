import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, statSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { join } from "node:path";
import {
	getFeatureDocPath,
	getFlowDir,
	getSessionPath,
	InvalidFlowPathInputError,
} from "../src/runtime/paths";
import { saveSession } from "../src/runtime/session";
import * as sessionHistory from "../src/runtime/session-history";
import * as sessionWorkspace from "../src/runtime/session-workspace";
import { createSampleSession } from "./fixtures";
import { createTempDirRegistry, createTestTools } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-path-traversal-",
);

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

function toolContext(worktree: string) {
	return { worktree } as Parameters<
		ReturnType<typeof createTestTools>["flow_status"]["execute"]
	>[1];
}

describe("path traversal hardening", () => {
	test("flow_history_show rejects traversal and absolute session ids without reading session files", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const sessionReadSpy = spyOn(
			sessionWorkspace,
			"readSessionFromPath",
		).mockImplementation(async () => {
			throw new Error("should not read sessions");
		});
		const archivedLookupSpy = spyOn(
			sessionHistory,
			"loadStoredSession",
		).mockImplementation(async () => {
			throw new Error("should not load stored session");
		});

		for (const sessionId of [
			"../escape",
			"../../etc/passwd",
			"/etc/passwd",
			"foo/bar",
			"",
		]) {
			const response = await tools.flow_history_show.execute(
				{ sessionId },
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);
			expect(parsed.status).toBe("error");
			expect(parsed.summary).toContain("sessionId");
		}

		expect(archivedLookupSpy).not.toHaveBeenCalled();
		expect(sessionReadSpy).not.toHaveBeenCalled();
	});

	test("flow_session_activate rejects malformed session ids without loading session files", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const readSessionSpy = spyOn(
			sessionWorkspace,
			"readSessionFromPath",
		).mockImplementation(async () => {
			throw new Error("should not read sessions");
		});

		for (const sessionId of ["..", "foo/bar", "  ", "../a"]) {
			const response = await tools.flow_session_activate.execute(
				{ sessionId },
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);
			expect(parsed.status).toBe("error");
			expect(parsed.summary).toContain("sessionId");
		}

		expect(readSessionSpy).not.toHaveBeenCalled();
	});

	test("flow_reset_feature rejects malformed feature ids without mutating .flow", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		await saveSession(worktree, createSampleSession("Safe goal"));
		const flowDir = getFlowDir(worktree);
		const before = statSync(flowDir).mtimeMs;

		for (const featureId of ["../foo", "FOO", "a/b", "  ", "a b", ""]) {
			const response = await tools.flow_reset_feature.execute(
				{ featureId },
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);
			expect(parsed.status).toBe("error");
			expect(parsed.summary).toContain("featureId");
		}

		expect(statSync(flowDir).mtimeMs).toBe(before);
	});

	test("derived path builders reject traversal and absolute inputs", () => {
		const worktree = makeTempDir();

		for (const sessionId of ["..", "../escape", "/tmp/x", "a/b", "a\\b"]) {
			expect(() => getSessionPath(worktree, sessionId)).toThrow(
				InvalidFlowPathInputError,
			);
		}

		for (const featureId of ["..", "../escape", "/tmp/x", "a/b", "a\\b"]) {
			expect(() =>
				getFeatureDocPath(worktree, "safe-session", featureId),
			).toThrow(InvalidFlowPathInputError);
		}

		const validSessionPath = getSessionPath(worktree, "safe-session");
		const validFeaturePath = getFeatureDocPath(
			worktree,
			"safe-session",
			"safe-feature",
		);
		expect(validSessionPath).toBe(
			join(worktree, ".flow", "sessions", "safe-session", "session.json"),
		);
		expect(validFeaturePath).toBe(
			join(
				worktree,
				".flow",
				"sessions",
				"safe-session",
				"docs",
				"features",
				"safe-feature.md",
			),
		);
	});

	test("flow_plan_start rejects whitespace-only goals before creating a session directory", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const sessionsDir = join(worktree, ".flow", "sessions");
		mkdirSync(sessionsDir, { recursive: true });
		const before = await fsPromises.readdir(sessionsDir);

		for (const goal of [" ", "\t", "\n\t "]) {
			const response = await tools.flow_plan_start.execute(
				{ goal },
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);
			expect(parsed.status).toBe("error");
			expect(parsed.summary).toContain("goal");
		}

		expect(await fsPromises.readdir(sessionsDir)).toEqual(before);
	});
});
