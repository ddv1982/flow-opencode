import { describe, expect, test } from "bun:test";
import {
	executeTransitionAtRoot,
	runSessionMutationActionAtRoot,
} from "../src/runtime/application/session-engine";
import type { Session } from "../src/runtime/schema";
import { createSession } from "../src/runtime/session";
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

		const result = await runSessionMutationActionAtRoot(
			"/tmp/project",
			{
				name: "approve_plan",
				run: () => succeed({ session: transitionSession }),
				getSession: (value) => value.session,
				onSuccess: (_session, value) => ({
					status: "ok",
					summary: value.session.notes[0] ?? "missing saved note",
				}),
			},
			{
				loadSession: async () => baseSession,
				saveSessionState: async (_worktree, session) => {
					savedState = session;
					return savedSession;
				},
				syncSessionArtifacts: async () => {
					throw new Error("injected artifact sync failure");
				},
			},
		);

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
		const failureSession = createSession(
			"Persist failure before artifact sync fails",
		);
		const transition = fail<never>(
			"Completion failed",
			undefined,
			failureSession,
		);
		if (transition.ok) throw new Error("expected failure transition");
		let savedState: Session | undefined;

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
					savedState = session;
					return session;
				},
				syncSessionArtifacts: async () => {
					throw new Error("injected artifact sync failure");
				},
			},
		);

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
					saved = true;
					throw new Error("should not save noop success");
				},
				syncSessionArtifacts: async () => {
					throw new Error("injected artifact sync failure");
				},
			},
		);

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
