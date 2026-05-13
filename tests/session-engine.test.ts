import { describe, expect, test } from "bun:test";
import {
	dispatchSessionMutationAction,
	dispatchSessionReadAction,
	dispatchSessionWorkspaceAction,
	executeDispatchedSessionMutation,
	executeDispatchedSessionReadAction,
	executeDispatchedSessionWorkspaceAction,
	executeFlowCoreCommand,
	executeFlowCoreQuery,
	FLOW_CORE_COMMAND_NAMES,
	FLOW_CORE_QUERY_NAMES,
	FLOW_CORE_VNEXT_CONTRACT,
	isFlowCoreMutationCommandName,
	isFlowCoreWorkspaceCommandName,
	runDispatchedSessionMutationAction,
	runDispatchedSessionReadAction,
	runDispatchedSessionWorkspaceAction,
	runFlowCoreCommand,
	runFlowCoreQuery,
} from "../src/runtime/application";
import {
	SESSION_MUTATION_ACTION_HANDLERS,
	SESSION_MUTATION_ACTION_NAMES,
} from "../src/runtime/application/session-actions";
import {
	executeSessionMutationAtRoot,
	executeTransitionAtRoot,
	runSessionMutationActionAtRoot,
	runSessionReadActionAtRoot,
	runSessionWorkspaceActionAtRoot,
} from "../src/runtime/application/session-engine";
import {
	SESSION_READ_ACTION_HANDLERS,
	SESSION_READ_ACTION_NAMES,
} from "../src/runtime/application/session-read-actions";
import {
	SESSION_WORKSPACE_ACTION_HANDLERS,
	SESSION_WORKSPACE_ACTION_NAMES,
} from "../src/runtime/application/session-workspace-actions";
import type { LatestFailedFlowAttempt } from "../src/runtime/schema";
import { createSession } from "../src/runtime/session";
import { fail, succeed } from "../src/runtime/transitions/shared";

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

	test("flow core contract exposes compact command and query catalogs", () => {
		expect(FLOW_CORE_VNEXT_CONTRACT.transitionAuthority).toBe(
			"src/runtime/transitions/**",
		);
		expect(FLOW_CORE_VNEXT_CONTRACT.persistenceMode).toBe("snapshot-first");
		expect([...FLOW_CORE_COMMAND_NAMES].sort()).toEqual(
			[
				...SESSION_WORKSPACE_ACTION_NAMES,
				...SESSION_MUTATION_ACTION_NAMES,
			].sort(),
		);
		expect([...FLOW_CORE_QUERY_NAMES].sort()).toEqual(
			[...SESSION_READ_ACTION_NAMES].sort(),
		);
		expect(isFlowCoreWorkspaceCommandName("plan_start")).toBe(true);
		expect(isFlowCoreMutationCommandName("start_run")).toBe(true);
		expect(isFlowCoreMutationCommandName("not_a_flow_command")).toBe(false);
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
		const response = await executeSessionMutationAtRoot(
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

		expect(response).toEqual({
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

		const response = await executeSessionMutationAtRoot(
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
		expect(response).toEqual({
			status: "ok",
			summary: "Saved ready",
		});
	});

	test("exposes a typed engine result before JSON serialization", async () => {
		const baseSession = createSession("Build a workflow plugin");
		const savedSession = { ...baseSession, status: "ready" as const };

		const result = await runSessionMutationActionAtRoot(
			"/tmp/project",
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

	test("flow core command facade delegates mutations through session engine persistence", async () => {
		const baseSession = createSession("Build a compact core");
		const savedSession = {
			...baseSession,
			planning: {
				...baseSession.planning,
				research: ["Freeze transition authority"],
			},
		};
		let saved = false;
		let synced = false;

		const result = await runFlowCoreCommand(
			{ worktree: "/tmp/project" },
			"record_planning_context",
			{ research: ["Freeze transition authority"] },
			{
				loadSession: async () => baseSession,
				saveSessionState: async (_worktree, session) => {
					saved = true;
					expect(session.planning.research).toEqual([
						"Freeze transition authority",
					]);
					return savedSession;
				},
				syncSessionArtifacts: async (_worktree, session) => {
					synced = true;
					expect(session).toBe(savedSession);
				},
			},
		);

		expect(result.kind).toBe("success");
		if (result.kind !== "success") return;
		expect(saved).toBe(true);
		expect(synced).toBe(true);
		expect(result.actionName).toBe("record_planning_context");
		expect(result.savedSession).toBe(savedSession);
	});

	test("flow core command facade preserves existing serialized mutation responses", async () => {
		const baseSession = createSession("Build a compact core");
		const savedSession = {
			...baseSession,
			planning: {
				...baseSession.planning,
				research: ["Freeze transition authority"],
			},
		};

		const response = await executeFlowCoreCommand(
			{ worktree: "/tmp/project" },
			"record_planning_context",
			{ research: ["Freeze transition authority"] },
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

	test("mutation finalization saves and syncs failures that carry a session", async () => {
		const failedSession = createSession("Persist failed mutation state");
		const savedSession = {
			...failedSession,
			notes: ["saved failure projection"],
		};
		let saved = false;
		let synced = false;

		const transition = fail<never>(
			"Completion failed",
			undefined,
			failedSession,
		);
		if (transition.ok) throw new Error("expected failure transition");
		const result = await executeTransitionAtRoot(
			"complete_feature",
			"/tmp/project",
			transition,
			(value: never) => value,
			() => ({ status: "ok" }),
			(failure) => ({ status: "error", summary: failure.message }),
			undefined,
			{
				loadSession: async () => null,
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
		expect(result.actionName).toBe("complete_feature");
		expect(result.response).toEqual({
			status: "error",
			summary: "Completion failed",
		});
		expect(result.transition).toBe(transition);
		expect(result.savedSession).toBe(savedSession);
	});

	test("mutation finalization does not save or sync failures without a session", async () => {
		const transition = fail<never>("No active plan");
		if (transition.ok) throw new Error("expected failure transition");

		const result = await executeTransitionAtRoot(
			"start_run",
			"/tmp/project",
			transition,
			(value: never) => value,
			() => ({ status: "ok" }),
			(failure) => ({ status: "error", summary: failure.message }),
			undefined,
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

		expect(result.kind).toBe("failure");
		if (result.kind !== "failure") return;
		expect(result.actionName).toBe("start_run");
		expect(result.response).toEqual({
			status: "error",
			summary: "No active plan",
		});
		expect(result.transition).toBe(transition);
		expect(result.savedSession).toBeUndefined();
	});

	test("recordFailure projection is persisted through the mutation boundary", async () => {
		const baseSession = createSession("Record latest failed mutation");
		const projectedFailure = {
			tool: "flow_run_complete_feature" as const,
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

		const result = await runSessionMutationActionAtRoot(
			"/tmp/project",
			{
				name: "complete_feature",
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

		const result = await runSessionMutationActionAtRoot(
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

		const result = await runSessionMutationActionAtRoot(
			"/tmp/project",
			{
				name: "complete_feature",
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
			tool: "flow_run_complete_feature",
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

		await runSessionMutationActionAtRoot(
			"/tmp/project",
			{
				name: "complete_feature",
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
			tool: "flow_run_complete_feature",
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
			{ tool: "flow_run_complete_feature" as const },
			{ tool: "flow_review_record_feature" as const },
		]) {
			await runSessionMutationActionAtRoot(
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

		const result = await runSessionMutationActionAtRoot(
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

	test("explicit empty transition options preserve current no-sync behavior", async () => {
		const baseSession = createSession("Explicit empty options");
		let synced = false;

		const result = await executeTransitionAtRoot(
			"approve_plan",
			"/tmp/project",
			succeed(baseSession),
			(session) => session,
			() => ({ status: "ok" }),
			(failure) => ({ status: "error", summary: failure.message }),
			{},
			{
				loadSession: async () => baseSession,
				saveSessionState: async () => baseSession,
				syncSessionArtifacts: async () => {
					synced = true;
				},
			},
		);

		expect(result.kind).toBe("success");
		expect(synced).toBe(false);
	});

	test("read runner preserves the generic action result envelope", async () => {
		const runtime = {
			loadSession: async () => createSession("Inspect direct read runner"),
			listSessionHistory: async () => ({
				activeSessionId: null,
				active: null,
				stored: [],
				completed: [],
			}),
			loadStoredSession: async () => null,
		};
		const value = { status: "ready", count: 2 };
		const result = await runSessionReadActionAtRoot(
			"/tmp/project",
			{
				name: "direct_read_envelope",
				run: async (worktree, receivedRuntime) => {
					expect(worktree).toBe("/tmp/project");
					expect(receivedRuntime).toBe(runtime);
					return value;
				},
				onSuccess: (receivedValue) => ({
					status: "ok",
					value: receivedValue,
				}),
			},
			runtime,
		);

		expect(result).toEqual({
			actionName: "direct_read_envelope",
			value,
			response: { status: "ok", value },
		});
	});

	test("workspace runner preserves the generic action result envelope", async () => {
		const session = createSession("Inspect direct workspace runner");
		const runtime = {
			loadSession: async () => session,
			saveSessionState: async () => session,
			syncSessionArtifacts: async () => undefined,
			activateSession: async () => session,
			closeSession: async () => null,
		};
		const value = { sessionId: session.id, activated: true };
		const result = await runSessionWorkspaceActionAtRoot(
			"/tmp/project",
			{
				name: "direct_workspace_envelope",
				run: async (worktree, receivedRuntime) => {
					expect(worktree).toBe("/tmp/project");
					expect(receivedRuntime).toBe(runtime);
					return value;
				},
				onSuccess: (receivedValue) => ({
					status: "ok",
					value: receivedValue,
				}),
			},
			runtime,
		);

		expect(result).toEqual({
			actionName: "direct_workspace_envelope",
			value,
			response: { status: "ok", value },
		});
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
			},
		);

		expect(response).toEqual({
			status: "ok",
			session: baseSession,
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
			},
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("ok");
		expect(parsed.completedSessionId).toBe("session-1");
	});
});
