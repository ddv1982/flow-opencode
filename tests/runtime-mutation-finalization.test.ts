import { describe, expect, test } from "bun:test";
import {
	runMutationActionAtRoot,
	type SessionMutationAction,
} from "../src/runtime/application/action-engine";
import { createSession } from "../src/runtime/lifecycle";
import type { Session } from "../src/runtime/schema";
import { fail, succeed } from "../src/runtime/transitions/shared";

describe("runtime mutation finalization", () => {
	test("reports partial success when artifact sync fails after saving a successful mutation", async () => {
		const baseSession = createSession("Persist before artifact sync fails");
		const transitionSession = { ...baseSession, status: "ready" as const };
		const savedSession = {
			...transitionSession,
			notes: ["saved mutation survived artifact failure"],
		};
		let savedState: Session | undefined;

		const action: SessionMutationAction<{ session: Session }> = {
			name: "approve_plan",
			run: () => succeed({ session: transitionSession }),
			getSession: (value) => value.session,
			onSuccess: (_session, value) => ({
				status: "ok",
				summary: value.session.notes[0] ?? "missing saved note",
			}),
		};

		const result = await runMutationActionAtRoot("/tmp/project", action, {
			loadSession: async () => baseSession,
			saveSessionState: async (_worktree, session) => {
				savedState = session;
				return savedSession;
			},
			syncSessionArtifacts: async () => {
				throw new Error("injected artifact sync failure");
			},
		});

		expect(savedState?.status).toBe("ready");
		expect(result.kind).toBe("success_artifact_sync_failed");
		if (result.kind !== "success_artifact_sync_failed") return;
		expect(result.savedSession).toBe(savedSession);
		expect(result.value.session).toBe(savedSession);
		expect(result.response).toEqual({
			status: "partial_success",
			summary: "saved mutation survived artifact failure",
			persistedMutation: true,
			artifactSync: {
				status: "failed",
				error: "injected artifact sync failure",
			},
		});
		expect(result.artifactSync).toEqual({
			status: "failed",
			error: "injected artifact sync failure",
		});
	});

	test("preserves mutation failure while reporting artifact sync failure after saving failure state", async () => {
		const baseSession = createSession(
			"Persist failure before artifact sync fails",
		);
		const failureSession = {
			...baseSession,
			notes: ["failure state recorded"],
		};
		let savedState: Session | undefined;

		const action: SessionMutationAction<Session> = {
			name: "complete_run",
			run: () => fail("Completion failed", undefined, failureSession),
			getSession: (value) => value,
			onSuccess: () => ({ status: "ok" }),
			onError: (failure) => ({ status: "error", summary: failure.message }),
		};

		const result = await runMutationActionAtRoot("/tmp/project", action, {
			loadSession: async () => baseSession,
			saveSessionState: async (_worktree, session) => {
				savedState = session;
				return session;
			},
			syncSessionArtifacts: async () => {
				throw new Error("injected artifact sync failure");
			},
		});

		expect(savedState).toBe(failureSession);
		expect(result.kind).toBe("failure");
		if (result.kind !== "failure") return;
		expect(result.savedSession).toBe(failureSession);
		expect(result.response).toEqual({
			status: "error",
			summary: "Completion failed",
			persistedMutation: true,
			artifactSync: {
				status: "failed",
				error: "injected artifact sync failure",
			},
		});
		expect(result.artifactSync).toEqual({
			status: "failed",
			error: "injected artifact sync failure",
		});
	});

	test("reports partial success when noop artifact sync fails without saving again", async () => {
		const baseSession = createSession("Noop artifact sync fails");
		let saved = false;

		const action: SessionMutationAction<{
			alreadyRunning: boolean;
			session: Session;
		}> = {
			name: "start_run",
			run: (session) => succeed({ alreadyRunning: true, session }),
			getSession: (value) => value.session,
			onSuccess: () => ({ status: "ok", summary: "saved" }),
			isNoopSuccess: () => true,
			onNoopSuccess: (session, value) => ({
				status: "ok",
				summary: `${session.goal}: ${value.alreadyRunning}`,
			}),
		};

		const result = await runMutationActionAtRoot("/tmp/project", action, {
			loadSession: async () => baseSession,
			saveSessionState: async () => {
				saved = true;
				throw new Error("should not save noop success");
			},
			syncSessionArtifacts: async () => {
				throw new Error("injected artifact sync failure");
			},
		});

		expect(saved).toBe(false);
		expect(result.kind).toBe("success_artifact_sync_failed");
		if (result.kind !== "success_artifact_sync_failed") return;
		expect(result.savedSession).toBe(baseSession);
		expect(result.response).toEqual({
			status: "partial_success",
			summary: "Noop artifact sync fails: true",
			persistedMutation: false,
			artifactSync: {
				status: "failed",
				error: "injected artifact sync failure",
			},
		});
	});
});
