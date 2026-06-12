import { describe, expect, test } from "bun:test";
import {
	executeFlowCoreCommand,
	executeFlowCoreQuery,
	runFlowCoreCommand,
	runFlowCoreQuery,
	SESSION_MUTATION_ACTION_NAMES,
	SESSION_READ_ACTION_NAMES,
	SESSION_WORKSPACE_ACTION_NAMES,
} from "../src/runtime/application";
import { runMutationActionAtRoot } from "../src/runtime/application/action-engine";
import { createSession } from "../src/runtime/lifecycle";
import type { LatestFailedFlowAttempt } from "../src/runtime/schema";
import { fail, succeed } from "../src/runtime/transitions/shared";

describe("action engine boundary", () => {
	test("action name catalogs stay disjoint and non-empty", () => {
		expect(SESSION_MUTATION_ACTION_NAMES.length).toBeGreaterThan(0);
		expect(SESSION_WORKSPACE_ACTION_NAMES.length).toBeGreaterThan(0);
		expect(SESSION_READ_ACTION_NAMES.length).toBeGreaterThan(0);
		const all = [
			...SESSION_MUTATION_ACTION_NAMES,
			...SESSION_WORKSPACE_ACTION_NAMES,
			...SESSION_READ_ACTION_NAMES,
		];
		expect(new Set(all).size).toBe(all.length);
	});

	test("flow core run command rejects unknown command names before dispatch", async () => {
		let dispatched = false;
		const invalidRunFlowCoreCommand = runFlowCoreCommand as unknown as (
			context: { worktree: string },
			name: string,
			payload: unknown,
			runtime: unknown,
		) => Promise<unknown>;
		const runtime = {
			loadSession: async () => {
				dispatched = true;
				throw new Error("should not load");
			},
			saveSessionState: async () => {
				dispatched = true;
				throw new Error("should not save");
			},
			syncSessionArtifacts: async () => {
				dispatched = true;
				throw new Error("should not sync");
			},
			activateSession: async () => {
				dispatched = true;
				throw new Error("should not activate");
			},
			closeSession: async () => {
				dispatched = true;
				throw new Error("should not close");
			},
		};

		await expect(
			invalidRunFlowCoreCommand(
				{ worktree: "/tmp/project" },
				"not_a_flow_command",
				undefined,
				runtime,
			),
		).rejects.toThrow("Unknown Flow Core command 'not_a_flow_command'.");
		expect(dispatched).toBe(false);
	});

	test("flow core execute command rejects unknown command names before dispatch", async () => {
		let dispatched = false;
		const invalidExecuteFlowCoreCommand = executeFlowCoreCommand as unknown as (
			context: { worktree: string },
			name: string,
			payload: unknown,
			runtime: unknown,
		) => Promise<unknown>;
		const runtime = {
			loadSession: async () => {
				dispatched = true;
				throw new Error("should not load");
			},
			saveSessionState: async () => {
				dispatched = true;
				throw new Error("should not save");
			},
			syncSessionArtifacts: async () => {
				dispatched = true;
				throw new Error("should not sync");
			},
			activateSession: async () => {
				dispatched = true;
				throw new Error("should not activate");
			},
			closeSession: async () => {
				dispatched = true;
				throw new Error("should not close");
			},
		};

		await expect(
			invalidExecuteFlowCoreCommand(
				{ worktree: "/tmp/project" },
				"not_a_flow_command",
				undefined,
				runtime,
			),
		).rejects.toThrow("Unknown Flow Core command 'not_a_flow_command'.");
		expect(dispatched).toBe(false);
	});

	test("flow core run query rejects unknown query names before dispatch", async () => {
		let dispatched = false;
		const invalidRunFlowCoreQuery = runFlowCoreQuery as unknown as (
			context: { worktree: string },
			name: string,
			payload: unknown,
			runtime: unknown,
		) => Promise<unknown>;
		const runtime = {
			loadSession: async () => {
				dispatched = true;
				throw new Error("should not load");
			},
			listSessionHistory: async () => {
				dispatched = true;
				throw new Error("should not list history");
			},
			loadStoredSession: async () => {
				dispatched = true;
				throw new Error("should not load stored session");
			},
		};

		await expect(
			invalidRunFlowCoreQuery(
				{ worktree: "/tmp/project" },
				"not_a_flow_query",
				undefined,
				runtime,
			),
		).rejects.toThrow();
		expect(dispatched).toBe(false);
	});

	test("returns the configured missing-session response before running the action", async () => {
		const response = await runMutationActionAtRoot(
			"/tmp/project",
			{
				name: "apply_plan",
				run: () => {
					throw new Error("should not run");
				},
				getSession: (value: never) => value,
				onSuccess: () => ({ status: "ok" }),
				missingResponse: {
					status: "missing_session",
					summary: "No planning session exists.",
					nextCommand: "/flow-plan <goal>",
				},
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

		expect(response.kind).toBe("missing");
		expect(response.response).toEqual({
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

		const result = await runMutationActionAtRoot(
			"/tmp/project",
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
		expect(result.kind).toBe("success");
		if (result.kind !== "success") return;
		expect(result.actionName).toBe("approve_plan");
		expect(result.savedSession.status).toBe("ready");
		expect(result.response).toEqual({
			status: "ok",
			summary: "Saved ready",
		});
	});

	test("runs named dispatched mutations without tool-specific builder imports", async () => {
		const baseSession = createSession("Build a workflow plugin");
		const savedSession = {
			...baseSession,
			planning: {
				...baseSession.planning,
				research: ["Inspect runtime action dispatch"],
			},
		};

		const result = await runFlowCoreCommand(
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

	test("serializes named dispatched mutations through the central runtime path", async () => {
		const baseSession = createSession("Build a workflow plugin");
		const savedSession = {
			...baseSession,
			planning: {
				...baseSession.planning,
				research: ["Inspect runtime action dispatch"],
			},
		};

		const response = await executeFlowCoreCommand(
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

	test("plan_save returns partial success when artifact sync fails after saving", async () => {
		const savedSession = createSession("Build a workflow plugin");
		const events: string[] = [];

		const response = await executeFlowCoreCommand(
			{ worktree: "/tmp/project" },
			"plan_save",
			{ goal: "Build a workflow plugin" },
			{
				loadSession: async () => null,
				saveSessionState: async (_worktree, session) => {
					events.push("save");
					expect(session.goal).toBe("Build a workflow plugin");
					return savedSession;
				},
				syncSessionArtifacts: async (_worktree, session) => {
					events.push("sync");
					expect(session).toBe(savedSession);
					throw new Error("injected artifact sync failure");
				},
				activateSession: async () => {
					throw new Error("should not activate");
				},
				closeSession: async () => {
					throw new Error("should not close");
				},
			},
		);

		const parsed = JSON.parse(response);
		expect(events).toEqual(["save", "sync"]);
		expect(parsed.status).toBe("partial_success");
		expect(parsed.persistedMutation).toBe(true);
		expect(parsed.artifactSync).toEqual({
			status: "failed",
			error: "injected artifact sync failure",
		});
		expect(parsed.summary).toBe(
			"Planning session ready for goal: Build a workflow plugin",
		);
		expect(parsed.session.goal).toBe("Build a workflow plugin");
	});

	test("plan_save throws persistence failures without syncing artifacts", async () => {
		let synced = false;

		await expect(
			executeFlowCoreCommand(
				{ worktree: "/tmp/project" },
				"plan_save",
				{ goal: "Build a workflow plugin" },
				{
					loadSession: async () => null,
					saveSessionState: async () => {
						throw new Error("injected persistence failure");
					},
					syncSessionArtifacts: async () => {
						synced = true;
						throw new Error("should not sync");
					},
					activateSession: async () => {
						throw new Error("should not activate");
					},
					closeSession: async () => {
						throw new Error("should not close");
					},
				},
			),
		).rejects.toThrow("injected persistence failure");
		expect(synced).toBe(false);
	});

	test("plan_save without a goal or existing session asks for a goal", async () => {
		const response = await executeFlowCoreCommand(
			{ worktree: "/tmp/project" },
			"plan_save",
			{},
			{
				loadSession: async () => null,
				saveSessionState: async () => {
					throw new Error("should not save");
				},
				syncSessionArtifacts: async () => undefined,
				activateSession: async () => {
					throw new Error("should not activate");
				},
				closeSession: async () => {
					throw new Error("should not close");
				},
			},
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("missing_goal");
		expect(parsed.nextCommand).toBe("/flow-plan <goal>");
	});

	test("mutation failures that carry a session are persisted and synced", async () => {
		const baseSession = createSession("Persist failed mutation state");
		const failedSession = {
			...baseSession,
			notes: ["failure projection"],
		};
		const savedSession = {
			...failedSession,
			notes: ["saved failure projection"],
		};
		let saved = false;
		let synced = false;

		const result = await runMutationActionAtRoot(
			"/tmp/project",
			{
				name: "complete_run",
				run: () => fail<never>("Completion failed", undefined, failedSession),
				getSession: (value: never) => value,
				onSuccess: () => ({ status: "ok" }),
				onError: (failure) => ({ status: "error", summary: failure.message }),
			},
			{
				loadSession: async () => baseSession,
				saveSessionState: async (_worktree, session) => {
					saved = true;
					expect(session).toBe(failedSession);
					return savedSession;
				},
				syncSessionArtifacts: async (_worktree, session) => {
					synced = true;
					expect(session).toBe(savedSession);
				},
			},
		);

		expect(saved).toBe(true);
		expect(synced).toBe(true);
		expect(result.kind).toBe("failure");
		if (result.kind !== "failure") return;
		expect(result.actionName).toBe("complete_run");
		expect(result.response).toEqual({
			status: "error",
			summary: "Completion failed",
		});
		expect(result.savedSession).toBe(savedSession);
	});

	test("mutation failures without a session are not saved or synced", async () => {
		const baseSession = createSession("No active plan");

		const result = await runMutationActionAtRoot(
			"/tmp/project",
			{
				name: "start_run",
				run: () => fail<never>("No active plan"),
				getSession: (value: never) => value,
				onSuccess: () => ({ status: "ok" }),
				onError: (failure) => ({ status: "error", summary: failure.message }),
			},
			{
				loadSession: async () => baseSession,
				saveSessionState: async () => {
					throw new Error("should not save");
				},
				syncSessionArtifacts: async () => {
					throw new Error("should not sync");
				},
			},
		);

		expect(result.kind).toBe("failure");
		if (result.kind !== "failure") return;
		expect(result.actionName).toBe("start_run");
		expect(result.response).toEqual({
			status: "error",
			summary: "No active plan",
		});
		expect(result.savedSession).toBeUndefined();
	});

	test("recordFailure projection is persisted through the mutation boundary", async () => {
		const baseSession = createSession("Record latest failed mutation");
		const projectedFailure = {
			tool: "flow_feature_complete" as const,
			phase: "execution" as const,
			status: "error" as const,
			failureCategory: "failing_validation",
			summary: "Validation failed.",
			recoveryHint: "Rerun validation.",
		};
		const projectedSession = {
			...baseSession,
			execution: {
				...baseSession.execution,
				lastFailedMutation: projectedFailure,
			},
		};
		let synced = false;

		const result = await runMutationActionAtRoot(
			"/tmp/project",
			{
				name: "complete_run",
				run: () => fail<never>("Completion failed"),
				getSession: (value: never) => value,
				onSuccess: () => ({ status: "ok" }),
				onError: (failure) => ({ status: "error", summary: failure.message }),
				recordFailure: (session, failure) => {
					expect(session).toBe(baseSession);
					expect(failure.message).toBe("Completion failed");
					return projectedSession;
				},
			},
			{
				loadSession: async () => baseSession,
				saveSessionState: async (_worktree, session) => {
					expect(session).toBe(projectedSession);
					return session;
				},
				syncSessionArtifacts: async (_worktree, session) => {
					synced = true;
					expect(session).toBe(projectedSession);
				},
			},
		);

		expect(result.kind).toBe("failure");
		if (result.kind !== "failure") return;
		expect(synced).toBe(true);
		expect(result.savedSession?.execution.lastFailedMutation).toEqual(
			projectedFailure,
		);
	});

	test("noop mutation success syncs by default, skips save, and uses the noop response", async () => {
		const baseSession = createSession("Already selected feature");
		let synced = false;

		const result = await runMutationActionAtRoot(
			"/tmp/project",
			{
				name: "start_run",
				run: (session) => succeed({ alreadyRunning: true, session }),
				getSession: (value) => value.session,
				onSuccess: () => ({ status: "ok", summary: "saved" }),
				isNoopSuccess: () => true,
				onNoopSuccess: (session, value) => ({
					status: "ok",
					summary: `${session.goal}: ${value.alreadyRunning}`,
				}),
			},
			{
				loadSession: async () => baseSession,
				saveSessionState: async () => {
					throw new Error("should not save noop success");
				},
				syncSessionArtifacts: async (_worktree, session) => {
					synced = true;
					expect(session).toBe(baseSession);
				},
			},
		);

		expect(result.kind).toBe("success");
		if (result.kind !== "success") return;
		expect(synced).toBe(true);
		expect(result.savedSession).toBe(baseSession);
		expect(result.response).toEqual({
			status: "ok",
			summary: "Already selected feature: true",
		});
	});

	test("noop mutation success with syncArtifacts false skips save and sync", async () => {
		const baseSession = createSession("Already complete");

		const result = await runMutationActionAtRoot(
			"/tmp/project",
			{
				name: "complete_run",
				run: (session) => succeed(session),
				getSession: (session) => session,
				onSuccess: () => ({ status: "ok" }),
				isNoopSuccess: () => true,
				onNoopSuccess: () => ({ status: "ok", summary: "noop" }),
				syncArtifacts: false,
			},
			{
				loadSession: async () => baseSession,
				saveSessionState: async () => {
					throw new Error("should not save noop success");
				},
				syncSessionArtifacts: async () => {
					throw new Error("should not sync noop success");
				},
			},
		);

		expect(result.kind).toBe("success");
		if (result.kind !== "success") return;
		expect(result.savedSession).toBe(baseSession);
		expect(result.response).toEqual({ status: "ok", summary: "noop" });
	});

	test("success clear policy clears all failed attempts when set to true", async () => {
		const failedAttempt: LatestFailedFlowAttempt = {
			tool: "flow_feature_complete",
			phase: "execution",
			status: "error",
			failureCategory: "failing_validation",
			summary: "Validation failed.",
		};
		const emptySession = createSession("Clear failed attempt");
		const baseSession = {
			...emptySession,
			execution: {
				...emptySession.execution,
				lastFailedMutation: failedAttempt,
			},
		};
		let savedFailedAttempt: LatestFailedFlowAttempt | null | undefined;

		await runMutationActionAtRoot(
			"/tmp/project",
			{
				name: "complete_run",
				run: (session) => succeed(session),
				getSession: (session) => session,
				onSuccess: () => ({ status: "ok" }),
				clearFailedAttemptOnSuccess: true,
			},
			{
				loadSession: async () => baseSession,
				saveSessionState: async (_worktree, session) => {
					savedFailedAttempt = session.execution.lastFailedMutation;
					return session;
				},
				syncSessionArtifacts: async () => undefined,
			},
		);

		expect(savedFailedAttempt).toBeNull();
	});

	test("success clear policy only clears matching failed-attempt tools", async () => {
		const failedAttempt: LatestFailedFlowAttempt = {
			tool: "flow_feature_complete",
			phase: "execution",
			status: "error",
			failureCategory: "failing_validation",
			summary: "Validation failed.",
		};
		const baseSession = createSession("Clear matching failed attempt");
		const sessionWithFailure = {
			...baseSession,
			execution: {
				...baseSession.execution,
				lastFailedMutation: failedAttempt,
			},
		};
		const savedFailedAttempts: Array<LatestFailedFlowAttempt | null> = [];

		for (const policy of [
			{ tool: "flow_feature_complete" as const },
			{ tool: "flow_review_record" as const },
		]) {
			await runMutationActionAtRoot(
				"/tmp/project",
				{
					name: "record_review",
					run: (session) => succeed(session),
					getSession: (session) => session,
					onSuccess: () => ({ status: "ok" }),
					clearFailedAttemptOnSuccess: policy,
				},
				{
					loadSession: async () => sessionWithFailure,
					saveSessionState: async (_worktree, session) => {
						savedFailedAttempts.push(session.execution.lastFailedMutation);
						return session;
					},
					syncSessionArtifacts: async () => undefined,
				},
			);
		}

		expect(savedFailedAttempts).toEqual([null, failedAttempt]);
	});

	test("success response value is substituted with the saved session when the transition value is the session", async () => {
		const baseSession = createSession("Substitute saved session response");
		const transitionSession = { ...baseSession, status: "running" as const };
		const savedSession = {
			...transitionSession,
			notes: ["saved object"],
		};

		const result = await runMutationActionAtRoot(
			"/tmp/project",
			{
				name: "start_run",
				run: () => succeed(transitionSession),
				getSession: (session) => session,
				onSuccess: (_session, value) => ({
					status: "ok",
					summary: value.notes[0] ?? "missing saved note",
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
		expect(result.value).toBe(savedSession);
		expect(result.savedSession).toBe(savedSession);
		expect(result.response).toEqual({
			status: "ok",
			summary: "saved object",
		});
	});

	test("success response value substitutes saved session in composite values", async () => {
		const baseSession = createSession("Substitute saved apply plan response");
		const transitionSession = { ...baseSession, status: "ready" as const };
		const savedSession = {
			...transitionSession,
			notes: ["saved composite"],
		};

		const result = await runMutationActionAtRoot(
			"/tmp/project",
			{
				name: "apply_plan",
				run: () => succeed({ session: transitionSession, autoApproved: true }),
				getSession: (value) => value.session,
				onSuccess: (_session, value) => ({
					status: "ok",
					summary: value.session.notes[0] ?? "missing saved note",
					autoApproved: value.autoApproved,
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
		expect(result.value.session).toBe(savedSession);
		expect(result.value.autoApproved).toBe(true);
		expect(result.savedSession).toBe(savedSession);
		expect(result.response).toEqual({
			status: "ok",
			summary: "saved composite",
			autoApproved: true,
		});
	});

	test("flow core query facade delegates reads without mutation persistence", async () => {
		const baseSession = createSession("Inspect history");

		const result = await runFlowCoreQuery(
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
			},
		);

		expect(result.actionName).toBe("load_status_session");
		expect(result.value).toBe(baseSession);

		const response = await executeFlowCoreQuery(
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
			},
		);

		expect(response).toEqual({ status: "ok", session: baseSession });
	});

	test("flow core command facade delegates workspace commands through workspace runtime", async () => {
		let closed = false;

		const response = await executeFlowCoreCommand(
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
				closeSession: async () => {
					closed = true;
					return {
						sessionId: "session-1",
						completedTo: ".flow/completed/session-1",
						closureKind: "completed",
					};
				},
			},
		);

		const parsed = JSON.parse(response);
		expect(closed).toBe(true);
		expect(parsed.status).toBe("ok");
		expect(parsed.completedSessionId).toBe("session-1");
	});

	test("runs named workspace actions through the central runtime path", async () => {
		const session = createSession("Resume this");

		const result = await runFlowCoreCommand(
			{ worktree: "/tmp/project" },
			"activate_session",
			{ sessionId: session.id },
			{
				loadSession: async () => session,
				saveSessionState: async () => session,
				syncSessionArtifacts: async () => undefined,
				activateSession: async () => session,
				closeSession: async () => null,
			},
		);

		expect(result.actionName).toBe("activate_session");
		const parsed = result.response as { status?: string; summary?: string };
		expect(parsed.status).toBe("ok");
		expect(parsed.summary).toBe(`Activated Flow session: ${session.goal}`);
	});
});
