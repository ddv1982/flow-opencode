import { describe, expect, test } from "bun:test";
import {
	dispatchSessionMutationAction,
	dispatchSessionReadAction,
	dispatchSessionWorkspaceAction,
	executeDispatchedSessionMutation,
	executeDispatchedSessionReadAction,
	executeDispatchedSessionWorkspaceAction,
	executeSessionMutation,
	missingSessionResponse,
	runDispatchedSessionMutationAction,
	runDispatchedSessionReadAction,
	runDispatchedSessionWorkspaceAction,
	runSessionMutationAction,
} from "../src/runtime/application";
import {
	SESSION_MUTATION_ACTION_HANDLERS,
	SESSION_MUTATION_ACTION_NAMES,
} from "../src/runtime/application/session-actions";
import {
	SESSION_READ_ACTION_HANDLERS,
	SESSION_READ_ACTION_NAMES,
} from "../src/runtime/application/session-read-actions";
import {
	SESSION_WORKSPACE_ACTION_HANDLERS,
	SESSION_WORKSPACE_ACTION_NAMES,
} from "../src/runtime/application/session-workspace-actions";
import { createSession } from "../src/runtime/session";
import { succeed } from "../src/runtime/transitions/shared";

describe("session engine boundary", () => {
	test("action handlers cover the named runtime mutation catalog", () => {
		expect(Object.keys(SESSION_MUTATION_ACTION_HANDLERS).sort()).toEqual(
			[...SESSION_MUTATION_ACTION_NAMES].sort(),
		);
	});

	test("read action handlers cover the named runtime read catalog", () => {
		expect(Object.keys(SESSION_READ_ACTION_HANDLERS).sort()).toEqual(
			[...SESSION_READ_ACTION_NAMES].sort(),
		);
	});

	test("workspace action handlers cover the named runtime workspace catalog", () => {
		expect(Object.keys(SESSION_WORKSPACE_ACTION_HANDLERS).sort()).toEqual(
			[...SESSION_WORKSPACE_ACTION_NAMES].sort(),
		);
	});

	test("dispatches named actions through the central handler map", () => {
		const action = dispatchSessionMutationAction("approve_plan", {
			featureIds: ["ship-it"],
		});

		expect(action.name).toBe("approve_plan");
	});

	test("dispatches named read actions through the central handler map", () => {
		const action = dispatchSessionReadAction("load_history_session", {
			sessionId: "session-123",
		});

		expect(action.name).toBe("load_history_session");
	});

	test("dispatches named workspace actions through the central handler map", () => {
		const action = dispatchSessionWorkspaceAction("close_session", {
			kind: "completed",
		});

		expect(action.name).toBe("close_session");
	});

	test("returns the configured missing-session response before running the action", async () => {
		const response = await executeSessionMutation(
			{ worktree: "/tmp/project" },
			{
				name: "apply_plan",
				run: () => {
					throw new Error("should not run");
				},
				getSession: (value: never) => value,
				onSuccess: () => ({ status: "ok" }),
				missingResponse: missingSessionResponse(
					"No planning session exists.",
					"/flow-plan <goal>",
				),
			},
			{
				loadSession: async () => null,
				saveSessionState: async () => {
					throw new Error("should not save");
				},
				syncSessionArtifacts: async () => {
					throw new Error("should not sync");
				},
			},
		);

		expect(JSON.parse(response)).toEqual({
			status: "missing_session",
			summary: "No planning session exists.",
			nextCommand: "/flow-plan <goal>",
		});
	});

	test("persists the returned session and formats the success response through one boundary", async () => {
		const baseSession = createSession("Build a workflow plugin");
		const savedSession = { ...baseSession, status: "ready" as const };
		let saved = false;
		let synced = false;

		const response = await executeSessionMutation(
			{ worktree: "/tmp/project" },
			{
				name: "approve_plan",
				run: (session) =>
					succeed({ session: { ...session, status: "ready" as const } }),
				getSession: (value: { session: typeof baseSession }) => value.session,
				onSuccess: (session) => ({
					status: "ok",
					summary: `Saved ${session.status}`,
				}),
			},
			{
				loadSession: async () => baseSession,
				saveSessionState: async (_worktree, session) => {
					saved = true;
					expect(session.status).toBe("ready");
					return savedSession;
				},
				syncSessionArtifacts: async () => {
					synced = true;
				},
			},
		);

		expect(saved).toBe(true);
		expect(synced).toBe(true);
		expect(JSON.parse(response)).toEqual({
			status: "ok",
			summary: "Saved ready",
		});
	});

	test("exposes a typed engine result before JSON serialization", async () => {
		const baseSession = createSession("Build a workflow plugin");
		const savedSession = { ...baseSession, status: "ready" as const };

		const result = await runSessionMutationAction(
			{ worktree: "/tmp/project" },
			{
				name: "approve_plan",
				run: (session) =>
					succeed({ session: { ...session, status: "ready" as const } }),
				getSession: (value) => value.session,
				onSuccess: (session) => ({
					status: "ok",
					summary: `Saved ${session.status}`,
				}),
			},
			{
				loadSession: async () => baseSession,
				saveSessionState: async () => savedSession,
				syncSessionArtifacts: async () => undefined,
			},
		);

		expect(result.kind).toBe("success");
		if (result.kind !== "success") return;
		expect(result.actionName).toBe("approve_plan");
		expect(result.savedSession.status).toBe("ready");
		expect(result.response).toEqual({
			status: "ok",
			summary: "Saved ready",
		});
	});

	test("runs named dispatched actions without tool-specific builder imports", async () => {
		const baseSession = createSession("Build a workflow plugin");
		const savedSession = {
			...baseSession,
			planning: {
				...baseSession.planning,
				research: ["Inspect runtime action dispatch"],
			},
		};

		const result = await runDispatchedSessionMutationAction(
			{ worktree: "/tmp/project" },
			"record_planning_context",
			{ research: ["Inspect runtime action dispatch"] },
			{
				loadSession: async () => baseSession,
				saveSessionState: async () => savedSession,
				syncSessionArtifacts: async () => undefined,
			},
		);

		expect(result.kind).toBe("success");
		if (result.kind !== "success") return;
		expect(result.actionName).toBe("record_planning_context");
		expect(result.savedSession.planning.research).toEqual([
			"Inspect runtime action dispatch",
		]);
	});

	test("serializes named dispatched actions through the central runtime path", async () => {
		const baseSession = createSession("Build a workflow plugin");
		const savedSession = {
			...baseSession,
			planning: {
				...baseSession.planning,
				research: ["Inspect runtime action dispatch"],
			},
		};

		const response = await executeDispatchedSessionMutation(
			{ worktree: "/tmp/project" },
			"record_planning_context",
			{ research: ["Inspect runtime action dispatch"] },
			{
				loadSession: async () => baseSession,
				saveSessionState: async () => savedSession,
				syncSessionArtifacts: async () => undefined,
			},
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("ok");
		expect(parsed.summary).toBe("Planning context recorded.");
	});

	test("runs named dispatched read actions through the central runtime path", async () => {
		const baseSession = createSession("Inspect history");

		const result = await runDispatchedSessionReadAction(
			{ worktree: "/tmp/project" },
			"load_status_session",
			undefined,
			{
				loadSession: async () => baseSession,
				listSessionHistory: async () => {
					throw new Error("should not list history");
				},
				loadStoredSession: async () => {
					throw new Error("should not load stored session");
				},
				listAuditReports: async () => {
					throw new Error("should not list audits");
				},
				loadAuditReport: async () => {
					throw new Error("should not load audit report");
				},
				compareAuditReports: async () => {
					throw new Error("should not compare audit reports");
				},
			},
		);

		expect(result.actionName).toBe("load_status_session");
		expect(result.value?.goal).toBe("Inspect history");
	});

	test("serializes named dispatched read responses", async () => {
		const baseSession = createSession("Inspect history");

		const response = await executeDispatchedSessionReadAction(
			{ worktree: "/tmp/project" },
			"load_status_session",
			undefined,
			{
				loadSession: async () => baseSession,
				listSessionHistory: async () => {
					throw new Error("should not list history");
				},
				loadStoredSession: async () => {
					throw new Error("should not load stored session");
				},
				listAuditReports: async () => {
					throw new Error("should not list audits");
				},
				loadAuditReport: async () => {
					throw new Error("should not load audit report");
				},
				compareAuditReports: async () => {
					throw new Error("should not compare audit reports");
				},
			},
		);

		expect(response).toEqual({
			status: "ok",
			session: baseSession,
		});
	});

	test("runs named audit comparison reads through the central runtime path", async () => {
		const result = await runDispatchedSessionReadAction(
			{ worktree: "/tmp/project" },
			"compare_audit_reports",
			{
				leftReportId: "left-audit",
				rightReportId: "right-audit",
			},
			{
				loadSession: async () => {
					throw new Error("should not load session");
				},
				listSessionHistory: async () => {
					throw new Error("should not list history");
				},
				loadStoredSession: async () => {
					throw new Error("should not load stored session");
				},
				listAuditReports: async () => {
					throw new Error("should not list audits");
				},
				loadAuditReport: async () => {
					throw new Error("should not load audit");
				},
				compareAuditReports: async (
					_worktree,
					leftReportId,
					rightReportId,
				) => ({
					leftReportId,
					rightReportId,
					left: null,
					right: null,
					comparison: null,
				}),
			},
		);

		expect(result.actionName).toBe("compare_audit_reports");
		expect(result.value).toEqual({
			leftReportId: "left-audit",
			rightReportId: "right-audit",
			left: null,
			right: null,
			comparison: null,
		});
		expect(result.response).toEqual({
			status: "missing_audit",
			comparison: {
				leftReportId: "left-audit",
				rightReportId: "right-audit",
				left: null,
				right: null,
				comparison: null,
			},
		});
	});

	test("runs named dispatched workspace actions through the central runtime path", async () => {
		const session = createSession("Resume this");

		const result = await runDispatchedSessionWorkspaceAction(
			{ worktree: "/tmp/project" },
			"activate_session",
			{ sessionId: session.id },
			{
				loadSession: async () => session,
				saveSessionState: async () => session,
				syncSessionArtifacts: async () => undefined,
				activateSession: async () => session,
				closeSession: async () => null,
				writeAuditReport: async () => ({
					reportDir: "/tmp/project/.flow/audits/demo",
					jsonPath: "/tmp/project/.flow/audits/demo/report.json",
					markdownPath: "/tmp/project/.flow/audits/demo/report.md",
					report: {} as never,
				}),
			},
		);

		expect(result.actionName).toBe("activate_session");
		expect(result.value?.id).toBe(session.id);
	});

	test("serializes named dispatched workspace responses", async () => {
		const response = await executeDispatchedSessionWorkspaceAction(
			{ worktree: "/tmp/project" },
			"close_session",
			{ kind: "completed", nextCommand: "/flow-plan <goal>" },
			{
				loadSession: async () => null,
				saveSessionState: async () => {
					throw new Error("should not save session state");
				},
				syncSessionArtifacts: async () => undefined,
				activateSession: async () => null,
				closeSession: async () => ({
					sessionId: "session-1",
					completedTo: ".flow/completed/session-1",
					closureKind: "completed",
				}),
				writeAuditReport: async () => ({
					reportDir: "/tmp/project/.flow/audits/demo",
					jsonPath: "/tmp/project/.flow/audits/demo/report.json",
					markdownPath: "/tmp/project/.flow/audits/demo/report.md",
					report: {} as never,
				}),
			},
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("ok");
		expect(parsed.completedSessionId).toBe("session-1");
	});

	test("writes audit reports through the dispatched workspace path", async () => {
		const result = await runDispatchedSessionWorkspaceAction(
			{ worktree: "/tmp/project" },
			"write_audit_report",
			{
				report: {
					requestedDepth: "deep_audit",
					achievedDepth: "deep_audit",
					repoSummary: "Reviewed one surface directly.",
					overallVerdict: "Deep audit completed.",
					discoveredSurfaces: [
						{
							name: "prompt surfaces",
							category: "source_runtime",
							reviewStatus: "directly_reviewed",
							evidence: ["src/prompts/agents.ts:1-50"],
						},
					],
					validationRun: [
						{
							command: "bun run check",
							status: "not_run",
							summary: "Read-only audit.",
						},
					],
					findings: [],
				},
			},
			{
				loadSession: async () => null,
				saveSessionState: async () => {
					throw new Error("should not save session state");
				},
				syncSessionArtifacts: async () => undefined,
				activateSession: async () => null,
				closeSession: async () => null,
				writeAuditReport: async () => ({
					reportDir: "/tmp/project/.flow/audits/demo",
					jsonPath: "/tmp/project/.flow/audits/demo/report.json",
					markdownPath: "/tmp/project/.flow/audits/demo/report.md",
					report: {
						requestedDepth: "deep_audit",
						achievedDepth: "deep_audit",
					} as never,
				}),
			},
		);

		expect(result.actionName).toBe("write_audit_report");
		expect(result.value.reportDir).toBe("/tmp/project/.flow/audits/demo");
		expect(result.response).toEqual({
			status: "ok",
			summary: "Persisted Flow audit report artifacts.",
			reportDir: "/tmp/project/.flow/audits/demo",
			jsonPath: "/tmp/project/.flow/audits/demo/report.json",
			markdownPath: "/tmp/project/.flow/audits/demo/report.md",
			report: {
				requestedDepth: "deep_audit",
				achievedDepth: "deep_audit",
			},
			nextCommand: "/flow-audit",
		});
	});
});
