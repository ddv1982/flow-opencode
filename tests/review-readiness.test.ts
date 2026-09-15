import { describe, expect, test } from "bun:test";
import { reviewReadiness } from "../src/domain/review-readiness.js";
import type { Session } from "../src/domain/session.js";
import { activeRun } from "../src/domain/session-queries.js";
import { recordValidation } from "../src/domain/transitions.js";
import {
	deterministicEnvironment,
	MemorySessionRepository,
	OUTPUT,
	SOURCE_A,
	SOURCE_B,
	startSession,
} from "./runtime-test-support.js";

/** An approved single-feature plan with its one run active, via the real service. */
async function runningSession(): Promise<Session> {
	const repository = new MemorySessionRepository();
	await startSession(repository, deterministicEnvironment());
	if (!repository.session) throw new Error("expected an active session");
	return repository.session;
}

function withValidation(
	session: Session,
	options: Readonly<{
		exitCode: number;
		scope: "focused" | "broad";
		digest?: typeof SOURCE_A;
	}>,
): Session {
	const run = activeRun(session);
	if (!run) throw new Error("expected an active run");
	return recordValidation(session, {
		captureId: `capture-${session.revision}`,
		featureId: run.featureId,
		runId: run.id,
		scope: options.scope,
		command: "bun test",
		sourceDigest: options.digest ?? SOURCE_A,
		exitCode: options.exitCode,
		outputDigest: OUTPUT,
		outputComplete: true,
		hostPlatform: "linux",
	}).session;
}

describe("reviewReadiness", () => {
	test("needs validation when the run has none", async () => {
		const session = await runningSession();
		const run = activeRun(session);
		if (!run) throw new Error("expected an active run");
		expect(reviewReadiness(session, run, SOURCE_A)).toEqual({
			kind: "needs-validation",
			reviewKind: "final",
		});
	});

	test("is ready after a passing broad observation for the current source", async () => {
		const session = withValidation(await runningSession(), {
			exitCode: 0,
			scope: "broad",
		});
		const run = activeRun(session);
		if (!run) throw new Error("expected an active run");
		const readiness = reviewReadiness(session, run, SOURCE_A);
		expect(readiness.kind).toBe("ready");
		if (readiness.kind !== "ready") return;
		expect(readiness.reviewKind).toBe("final");
		expect(readiness.applicable.map((v) => v.scope)).toEqual(["broad"]);
	});

	test("reports the vetoed command after a failed gate run", async () => {
		const session = withValidation(await runningSession(), {
			exitCode: 1,
			scope: "broad",
		});
		const run = activeRun(session);
		if (!run) throw new Error("expected an active run");
		expect(reviewReadiness(session, run, SOURCE_A)).toEqual({
			kind: "vetoed",
			commands: ["bun test"],
		});
	});

	test("needs validation again when the source moved after the pass", async () => {
		const session = withValidation(await runningSession(), {
			exitCode: 0,
			scope: "broad",
		});
		const run = activeRun(session);
		if (!run) throw new Error("expected an active run");
		expect(reviewReadiness(session, run, SOURCE_B)).toEqual({
			kind: "needs-validation",
			reviewKind: "final",
		});
	});
});
