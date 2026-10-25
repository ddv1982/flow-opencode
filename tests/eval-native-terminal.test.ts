import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionMessageInfo } from "@opencode/client";
import { CampaignCancelled } from "../evals/campaign-stop.js";
import { deriveConformanceOutcome } from "../evals/conformance-evidence.js";
import { isEligibleEnvironmentFailure } from "../evals/environment-reserves.js";
import {
	EvaluationPhaseError,
	evaluationPhase,
	nativeExecutionFailure,
} from "../evals/failure-origin.js";
import {
	retainedFailureEvidence,
	scenarioGradeInput,
} from "../evals/grader-input.js";
import { askedScoring } from "../evals/harness.js";
import {
	collectHostTrace,
	type HostTraceCollection,
	HostTraceSchema,
	nativeExecution,
} from "../evals/host-trace.js";
import { projectEvalMessage } from "../evals/opencode-host.js";
import { SCENARIOS } from "../evals/scenarios.js";
import { prepareStudyManifest } from "../evals/study-manifest.js";
import { executeStudy } from "../evals/study-runner.js";
import {
	fixtureModel,
	messagePage,
	nativeAssistant,
	nativeClient,
	nativeHost,
	nativeSession,
	nativeTool,
	sessionPage,
	sessionReply,
	useNativeFixtureBudget,
} from "./fixtures/native-eval-client.js";
import captured from "./fixtures/native-terminal-contexts.json" with {
	type: "json",
};
import {
	fakeStudyTransport,
	studyCase,
	studyManifest,
} from "./study-support.js";

useNativeFixtureBudget();
const idle = (
	outcome: "succeeded" | "failed" | "interrupted",
	id = "msg_idle",
	created = 4,
	error?: { type: string; message: string },
): SessionMessageInfo => ({
	id,
	type: "idle",
	time: { created },
	outcome,
	...(error ? { error } : {}),
});
function collection(
	messages: unknown[],
	sessionId = "ses_root",
): HostTraceCollection {
	return {
		runnerRootSessionIds: [sessionId],
		directory: "/workspace",
		childrenComplete: true,
		sessionMetadata: [nativeSession(sessionId, "/workspace")],
		sessionMessages: [{ sessionId, messages }],
	};
}
function observed(messages: unknown[], sessionId = "ses_root") {
	const trace = collectHostTrace(collection(messages, sessionId));
	if (trace.version !== 2 || trace.kind !== "observed")
		throw new Error(JSON.stringify(trace));
	return trace;
}

for (const entry of captured)
	test(`literal Responses ${entry.mode} retains independent native terminal facts`, () => {
		const trace = observed(entry.messages, entry.sessionId);
		const assistant = trace.messages.find(
			(message) => message.role === "assistant",
		);
		if (assistant?.role !== "assistant")
			throw new Error("Missing captured assistant");
		expect(assistant.terminal).toEqual({
			finish: { kind: "observed", value: "tool-calls" },
			error: { kind: "absent" },
			streamed: {
				kind: "observed",
				value: entry.mode === "normal-close" ? 1792855872683 : 1792855872876,
			},
			completed: {
				kind: "observed",
				value: entry.mode === "normal-close" ? 1792855872690 : 1792855872876,
			},
		});
		expect(assistant.tools[0]?.status).toBe("completed");
		const result = nativeExecutionFailure(nativeExecution(trace));
		expect(result?.code ?? null).toBe(
			entry.mode === "normal-close" ? null : "native-execution-failed",
		);
		for (const message of entry.messages.filter(
			(message) => message.type === "idle",
		)) {
			if (message.outcome !== "succeeded" && message.outcome !== "failed")
				throw new Error("Invalid captured outcome");
			expect(
				projectEvalMessage(
					idle(
						message.outcome,
						message.id,
						message.time.created,
						entry.mode === "normal-close"
							? undefined
							: {
									type: "unknown",
									message:
										"Flow context has an unknown, synthetic, or stale real input.",
								},
					),
					entry.sessionId,
				).info.error,
			).toBeUndefined();
		}
	});

test("assistant finish, error and times neither imply nor require each other", () => {
	const trace = observed([
		nativeAssistant("msg_assistant", {
			finish: "error",
			time: { created: 1, streamed: 2 },
		}),
	]);
	const assistant = trace.messages[0];
	if (assistant?.role !== "assistant") throw new Error("Missing assistant");
	expect(assistant.terminal).toEqual({
		finish: { kind: "observed", value: "error" },
		error: { kind: "absent" },
		streamed: { kind: "observed", value: 2 },
		completed: { kind: "absent" },
	});
	expect(nativeExecutionFailure(nativeExecution(trace))).toBeNull();
	for (const time of [
		{ created: 2, streamed: 1 },
		{ created: 1, streamed: 3, completed: 2 },
	])
		expect(
			collectHostTrace(
				collection([nativeAssistant("msg_assistant", { time })]),
			),
		).toEqual({
			version: 2,
			kind: "unavailable",
			reason: "chronology-conflict",
		});
});

test("native end reader is idempotent, command-scoped, and preserves recovered history", () => {
	const trace = observed([
		idle("failed", "msg_old", 1),
		{ id: "msg_user", type: "user", text: "Next", time: { created: 2 } },
		idle("succeeded", "msg_new", 3),
	]);
	const execution = nativeExecution(trace, [
		{ sessionId: "ses_root", afterMessageId: "msg_old" },
	]);
	expect(execution).toEqual({
		kind: "observed",
		sessions: [
			{
				sessionId: "ses_root",
				rootSessionId: "ses_root",
				end: {
					kind: "succeeded",
					messageId: "msg_new",
					created: 3,
					error: { kind: "absent" },
				},
			},
		],
	});
	expect(
		nativeExecution(trace, [
			{ sessionId: "ses_root", afterMessageId: "msg_old" },
		]),
	).toEqual(execution);
	expect(nativeExecutionFailure(execution)).toBeNull();
	for (const boundary of ["msg_new", "msg_missing"])
		expect(
			nativeExecutionFailure(
				nativeExecution(trace, [
					{ sessionId: "ses_root", afterMessageId: boundary },
				]),
			),
		).toBeNull();
	expect(
		trace.messages.filter(
			(message) => message.role === "event" && message.type === "idle",
		),
	).toHaveLength(2);
});

test("only a strictly newer attributable interrupted idle is a self interruption", () => {
	for (const outcome of ["succeeded", "failed", "interrupted"] as const)
		for (const abortAt of [3, 4, 5]) {
			const execution = nativeExecution(observed([idle(outcome)]), [
				{
					sessionId: "ses_root",
					afterMessageId: null,
					abort: { requestedAt: abortAt, priorFailure: false },
				},
			]);
			const failure = nativeExecutionFailure(execution);
			expect(failure?.code ?? null).toBe(
				outcome === "succeeded" || (outcome === "interrupted" && abortAt === 3)
					? null
					: `native-execution-${outcome}`,
			);
		}
	for (const error of [
		{ type: "api", message: "Independent failure" },
		{ type: "aborted", message: "Stopped" },
	]) {
		const trace = observed([idle("interrupted", "msg_idle", 4, error)]);
		expect(
			nativeExecutionFailure(
				nativeExecution(trace, [
					{
						sessionId: "ses_root",
						afterMessageId: null,
						abort: { requestedAt: 3, priorFailure: false },
					},
				]),
			)?.code ?? null,
		).toBe(error.type === "aborted" ? null : "native-execution-interrupted");
		expect(
			nativeExecutionFailure(
				nativeExecution(trace, [
					{
						sessionId: "ses_root",
						afterMessageId: null,
						abort: { requestedAt: 3, priorFailure: true },
					},
				]),
			)?.code,
		).toBe("native-execution-interrupted");
	}
});

test("diagnostics keep a finite scrubbed allowlist and withhold residual unsafe text", () => {
	const body = "private-body-content";
	const trace = observed([
		{
			...idle("failed"),
			error: {
				type: "unknown",
				message: `Bearer ${"s".repeat(40)}`,
				response: { body },
				headers: { authorization: "private-header" },
				stack: "private-stack",
				status: 429,
				retryAfterMs: 1000,
			},
		},
	]);
	const message = trace.messages[0];
	if (message?.role !== "event" || message.type !== "idle")
		throw new Error("Missing idle");
	expect(message.execution).toEqual({
		outcome: "failed",
		error: {
			kind: "observed",
			value: {
				type: "unknown",
				message: "[redacted]",
				status: 429,
				retryAfterMs: 1000,
			},
		},
	});
	for (const value of [body, "private-header", "private-stack", "s".repeat(40)])
		expect(JSON.stringify(trace)).not.toContain(value);
	for (const text of [
		"/Users/private/account/config",
		"C:\\Users\\private\\config",
		"https://someone:credential@example.invalid/path?secret=opaque",
		"opaque".repeat(10),
	]) {
		const withheld = observed([
			{ ...idle("failed"), error: { type: "unknown", message: text } },
		]);
		expect(JSON.stringify(withheld)).not.toContain(text);
		expect(nativeExecutionFailure(nativeExecution(withheld))?.code).toBe(
			"native-execution-failed",
		);
		expect(JSON.stringify(withheld)).toContain('"reason":"unsafe-text"');
	}
	for (const error of [
		{ type: "unknown", message: "x".repeat(16385) },
		{ type: "unknown", message: "é ".repeat(683) },
		{ type: "unknown", message: "Safe", retryAfterMs: 86_400_001 },
	]) {
		const bounded = observed([{ ...idle("failed"), error }]);
		expect(JSON.stringify(bounded)).toContain('"kind":"withheld"');
		expect(nativeExecutionFailure(nativeExecution(bounded))?.retryable).toBe(
			false,
		);
	}
	expect(
		collectHostTrace(
			collection([
				{
					...idle("failed"),
					error: { type: "unknown", message: "Safe", status: 600 },
				},
			]),
		),
	).toEqual({
		version: 2,
		kind: "unavailable",
		reason: "malformed-native-message",
	});
});

test("diagnostic byte, count and aggregate bounds preserve outcomes and UTF8", () => {
	const messages = Array.from({ length: 4096 }, (_, index) => ({
		...idle("failed", `msg_idle_${index}`, index),
		error: { type: "unknown", message: "é ".repeat(682) },
	}));
	const trace = observed(messages);
	const errors = trace.messages.flatMap((message) =>
		message.role === "event" &&
		message.type === "idle" &&
		message.execution?.error.kind === "observed"
			? [message.execution.error.value.message]
			: [],
	);
	expect(errors.length).toBe(63);
	for (const message of errors) {
		expect(Buffer.byteLength(message)).toBeLessThanOrEqual(2048);
		expect(message).not.toContain("�");
	}
	expect(nativeExecutionFailure(nativeExecution(trace))?.code).toBe(
		"native-execution-failed",
	);
	expect(HostTraceSchema.safeParse(trace).success).toBe(true);
	const forged = structuredClone(trace);
	for (const message of forged.messages)
		if (
			message.role === "event" &&
			message.type === "idle" &&
			message.execution
		)
			message.execution.error = {
				kind: "observed",
				value: {
					type: "unknown",
					message: "Safe",
					status: null,
					retryAfterMs: null,
				},
			};
	expect(HostTraceSchema.safeParse(forged).success).toBe(false);
});

test("old V2 fields stay absent and strict new fields do not accept extra data", () => {
	const trace = observed([
		nativeAssistant("msg_assistant", { time: { created: 1, completed: 2 } }),
		idle("failed"),
	]);
	const historical = structuredClone(trace);
	for (const message of historical.messages) {
		if (message.role === "assistant") delete message.terminal;
		if (message.role === "event" && message.type === "idle")
			delete message.execution;
	}
	const bytes = JSON.stringify(historical);
	expect(JSON.stringify(HostTraceSchema.parse(historical))).toBe(bytes);
	expect(nativeExecutionFailure(nativeExecution(historical))).toBeNull();
	expect(nativeExecution(historical)).toEqual({
		kind: "observed",
		sessions: [
			{
				sessionId: "ses_root",
				rootSessionId: "ses_root",
				end: { kind: "unobserved", reason: "terminal-fields-not-retained" },
			},
		],
	});
	const illegal = JSON.parse(JSON.stringify(trace));
	illegal.messages[1].execution.headers = {};
	expect(HostTraceSchema.safeParse(illegal).success).toBe(false);
	illegal.messages[1] = { ...trace.messages[1], type: "skill" };
	expect(HostTraceSchema.safeParse(illegal).success).toBe(false);
});

type FixtureOptions = {
	messages: (poll: number) => SessionMessageInfo[];
	prior?: SessionMessageInfo[];
	child?: "failed" | "running" | "read-failure";
	pendingPost?: boolean;
	cancel?: "before" | "after";
	outcomeOnly?: boolean;
	question?: true;
};
async function observeWait(options: FixtureOptions) {
	const project = await mkdtemp(join(tmpdir(), "terminal-wait-"));
	let now = 0;
	let poll = 0;
	let dispatched = options.outcomeOnly ?? false;
	let aborts = 0;
	let readsAfterAbort = 0;
	const controller = new AbortController();
	const reason = new CampaignCancelled(130);
	const root = nativeSession("ses_root", project);
	const child = nativeSession("ses_child", project, {
		parentID: "ses_root",
		agent: "flow-reviewer",
	});
	const client = nativeClient(async ({ url, init }) => {
		const path = url.pathname;
		if (path.endsWith("/model")) return new Response(null, { status: 204 });
		if (path.endsWith("/command") || path.endsWith("/prompt")) {
			dispatched = true;
			if (options.pendingPost)
				return new Promise<Response>((_, reject) =>
					init.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					),
				);
			return new Response(null, { status: 204 });
		}
		if (path.endsWith("/interrupt")) {
			aborts++;
			return Response.json({ interrupted: true });
		}
		if (aborts) readsAfterAbort++;
		if (path === "/api/session/ses_root") return sessionReply(root);
		if (path === "/api/session")
			return sessionPage(options.child ? [root, child] : [root]);
		if (path === "/api/session/ses_root/message")
			return messagePage(
				dispatched ? options.messages(poll++) : (options.prior ?? []),
			);
		if (path === "/api/session/ses_child/message") {
			if (options.child === "read-failure")
				throw new Error("Fixture child read failed");
			return messagePage(
				options.child === "failed"
					? [idle("failed", "msg_child_idle")]
					: [
							nativeAssistant("msg_child", {
								content: [
									nativeTool("call_read", "read", {
										status: "running",
										input: {},
										metadata: {},
									}),
								],
							}),
						],
			);
		}
		throw new Error("Unexpected fixture endpoint");
	});
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const sleep = spyOn(Bun, "sleep").mockImplementation(async () => {
		now += 2000;
		if (options.cancel === "before" || (options.cancel === "after" && poll > 0))
			controller.abort(reason);
	});
	const host = nativeHost(project, client, controller.signal);
	try {
		let result: unknown = "outcome-only";
		if (!options.outcomeOnly)
			result = await evaluationPhase("host", "command-aborted", true, () =>
				host.runCommand("ses_root", "flow-plan", "fixture", fixtureModel, {
					quietMs: 0,
					timeoutMs: 8000,
					stalledMs: 4000,
				}),
			).catch((error: unknown) => error);
		const outcome = await host.outcome(
			["ses_root"],
			now,
			result === reason ? undefined : controller.signal,
		);
		return {
			result,
			outcome,
			aborts,
			now,
			reason,
			readsAfterAbort,
			question: options.question ? host.escalationQuestion("ses_root") : null,
		};
	} finally {
		sleep.mockRestore();
		clock.mockRestore();
		await rm(project, { recursive: true, force: true });
	}
}

for (const outcome of ["succeeded", "failed", "interrupted"] as const)
	test(`live ${outcome} closes independently from provider errors`, async () => {
		const result = await observeWait({ messages: () => [idle(outcome)] });
		if (outcome === "succeeded") expect(result.result).toBe("quiet");
		else {
			expect(result.result).toBeInstanceOf(EvaluationPhaseError);
			if (!(result.result instanceof EvaluationPhaseError)) throw result.result;
			expect(result.result.failure).toEqual({
				origin: "host",
				code: `native-execution-${outcome}`,
				detail: `Native idle outcome ${outcome} in session ses_root, message msg_idle. Native idle error was absent.`,
				retryable: false,
			});
			expect(
				isEligibleEnvironmentFailure({
					outcome: { kind: "failure", ...result.result.failure },
				}),
			).toBe(false);
		}
		expect(result.outcome.providerError).toBeNull();
		expect(result.outcome.nativeFailure?.code ?? null).toBe(
			outcome === "succeeded" ? null : `native-execution-${outcome}`,
		);
		expect(result.readsAfterAbort).toBe(0);
	});

for (const kind of [
	"assistant",
	"tool",
	"compaction",
	"child",
	"post",
] as const)
	test(`a failed idle with busy ${kind} is preserved at the existing stop boundary`, async () => {
		const busy: SessionMessageInfo =
			kind === "compaction"
				? {
						id: "msg_compaction",
						type: "compaction",
						time: { created: 1 },
						status: "running",
						reason: "auto",
						summary: "",
					}
				: nativeAssistant("msg_assistant", {
						time: {
							created: 1,
							...(kind === "assistant" ? {} : { completed: 3 }),
						},
						content:
							kind === "tool"
								? [
										nativeTool("call_read", "read", {
											status: "running",
											input: {},
											metadata: {},
										}),
									]
								: [],
					});
		const result = await observeWait({
			messages: () => [busy, idle("failed")],
			...(kind === "child" ? { child: "running" as const } : {}),
			pendingPost: kind === "post",
		});
		expect(result.now).toBeGreaterThanOrEqual(6000);
		expect(result.result).toBeInstanceOf(EvaluationPhaseError);
		if (!(result.result instanceof EvaluationPhaseError)) throw result.result;
		expect(result.result.failure.code).toBe("native-execution-failed");
		expect(result.result.failure.retryable).toBe(false);
		expect(result.outcome.nativeFailure?.code).toBe("native-execution-failed");
	});

test("child-read failure keeps the fetched root failure and an unavailable full tree", async () => {
	const result = await observeWait({
		messages: () => [idle("failed")],
		child: "read-failure",
	});
	expect(result.result).toBeInstanceOf(EvaluationPhaseError);
	expect(result.outcome.nativeFailure?.code).toBe("native-execution-failed");
	expect(result.outcome.hostTrace).toEqual({
		version: 2,
		kind: "unavailable",
		reason: "endpoint-failure",
	});
	expect(result.readsAfterAbort).toBe(0);
});

test("outcome-only read keeps native failure when subsequent child enrichment fails", async () => {
	const result = await observeWait({
		messages: () => [idle("failed")],
		child: "read-failure",
		outcomeOnly: true,
	});
	expect(result.outcome.nativeFailure?.code).toBe("native-execution-failed");
	expect(result.outcome.hostTrace).toEqual({
		version: 2,
		kind: "unavailable",
		reason: "endpoint-failure",
	});
	expect(result.outcome.providerError).toBeNull();
});

test("root success with a failed child still reaches product missing-plan grading", async () => {
	const result = await observeWait({
		messages: () => [idle("succeeded")],
		child: "failed",
	});
	expect(result.result).toBe("quiet");
	expect(result.outcome.nativeFailure).toBeNull();
	const trace = result.outcome.hostTrace;
	if (trace?.version !== 2 || trace.kind !== "observed")
		throw new Error("Missing owned trace");
	expect(nativeExecution(trace)).toEqual({
		kind: "observed",
		sessions: [
			{
				sessionId: "ses_child",
				rootSessionId: "ses_root",
				end: {
					kind: "failed",
					messageId: "msg_child_idle",
					created: 4,
					error: { kind: "absent" },
				},
			},
			{
				sessionId: "ses_root",
				rootSessionId: "ses_root",
				end: {
					kind: "succeeded",
					messageId: "msg_idle",
					created: 4,
					error: { kind: "absent" },
				},
			},
		],
	});
	const scenario = SCENARIOS.find(
		(candidate) => candidate.id === "plan-only-stops",
	);
	if (!scenario) throw new Error("Missing scenario");
	expect(scenario.check(result.outcome)).toContain(
		"no session document was written; planning did not persist a plan",
	);
});

test("previous command idle and missing idle keep the existing quiet policy", async () => {
	for (const messages of [[], [idle("failed", "msg_prior")]]) {
		const result = await observeWait({
			prior: messages,
			messages: () => messages,
		});
		expect(result.result).toBe("quiet");
		expect(result.outcome.nativeFailure).toBeNull();
	}
});

test("a native retry can supersede failed idle before the wait commits to stop", async () => {
	const result = await observeWait({
		messages: (poll) =>
			poll === 0
				? [nativeAssistant("msg_assistant"), idle("failed")]
				: [
						nativeAssistant("msg_assistant", {
							time: { created: 1, completed: 2 },
						}),
						idle("failed"),
						idle("succeeded", "msg_recovered", 5),
					],
	});
	expect(result.result).toBe("quiet");
	expect(result.aborts).toBe(0);
	expect(result.outcome.nativeFailure).toBeNull();
});

test("cancellation preserves an already-fetched native failure but invents none before observation", async () => {
	const failed = await observeWait({
		messages: () => [nativeAssistant("msg_assistant"), idle("failed")],
		cancel: "after",
	});
	expect(failed.result).toBeInstanceOf(EvaluationPhaseError);
	expect(failed.outcome.nativeFailure?.code).toBe("native-execution-failed");
	const cancelled = await observeWait({ messages: () => [], cancel: "before" });
	expect(cancelled.result).toBe(cancelled.reason);
	expect(cancelled.outcome.nativeFailure).toBeNull();
});

test("a fresh command after runner abort observes a new interruption", async () => {
	const project = await mkdtemp(join(tmpdir(), "terminal-next-command-"));
	let now = 0;
	let command = 0;
	let prior: SessionMessageInfo[] = [];
	let current: SessionMessageInfo[] = [];
	let switched = false;
	const client = nativeClient(({ url }) => {
		if (url.pathname.endsWith("/model")) {
			switched = true;
			return new Response(null, { status: 204 });
		}
		if (url.pathname.endsWith("/command") || url.pathname.endsWith("/prompt")) {
			command++;
			current = [
				...prior,
				idle(
					command === 1 ? "failed" : "interrupted",
					`msg_command_${command}`,
					now + 1,
				),
			];
			return url.pathname.endsWith("/prompt")
				? Response.json({ data: {} })
				: new Response(null, { status: 204 });
		}
		if (url.pathname.endsWith("/interrupt")) {
			prior = current;
			return Response.json({ interrupted: true });
		}
		if (url.pathname === "/api/session") return sessionPage([]);
		if (url.pathname === "/api/session/ses_root")
			return sessionReply(nativeSession("ses_root", project));
		if (url.pathname.endsWith("/message")) {
			expect(switched).toBe(true);
			return messagePage(current);
		}
		throw new Error("Unexpected command fixture endpoint");
	});
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const sleep = spyOn(Bun, "sleep").mockImplementation(async () => {
		now += 2000;
	});
	const host = nativeHost(project, client);
	try {
		const first = await host
			.runCommand("ses_root", "flow-plan", "fixture", fixtureModel, {
				quietMs: 0,
			})
			.catch((error: unknown) => error);
		expect(first).toBeInstanceOf(EvaluationPhaseError);
		const second = await host
			.runPrompt("ses_root", "fixture", fixtureModel, { quietMs: 0 })
			.catch((error: unknown) => error);
		expect(second).toBeInstanceOf(EvaluationPhaseError);
		if (!(second instanceof EvaluationPhaseError)) throw second;
		expect(second.failure.code).toBe("native-execution-interrupted");
		expect((await host.outcome(["ses_root"], now)).nativeFailure?.code).toBe(
			"native-execution-interrupted",
		);
	} finally {
		sleep.mockRestore();
		clock.mockRestore();
		await rm(project, { recursive: true, force: true });
	}
});

test("an explicit provider error stays primary ahead of its native failed idle", async () => {
	const result = await observeWait({
		messages: () => [
			nativeAssistant("msg_provider", {
				error: { type: "api", message: "Earlier provider failure" },
				time: { created: 1, completed: 2 },
			}),
			idle("failed"),
		],
	});
	if (!(result.result instanceof EvaluationPhaseError))
		throw new Error("Missing provider failure");
	expect(result.result.failure).toEqual({
		origin: "provider",
		code: "provider-rejected-turn",
		detail: '{"type":"api","message":"Earlier provider failure"}',
		retryable: true,
	});
	expect(result.outcome.providerError?.code).toBe("provider-rejected-turn");
	expect(result.outcome.nativeFailure).toBeNull();
});

test("the diagnostic count budget is independent of byte limits", () => {
	const trace = observed(
		Array.from({ length: 65 }, (_, index) => ({
			...idle("failed", `msg_idle_${index}`, index),
			error: { type: "unknown", message: "Safe" },
		})),
	);
	const errors = trace.messages.flatMap((message) =>
		message.role === "event" && message.type === "idle"
			? [message.execution?.error]
			: [],
	);
	expect(errors.filter((error) => error?.kind === "observed")).toHaveLength(64);
	expect(errors.at(-1)).toEqual({
		kind: "withheld",
		reason: "limits-exceeded",
	});
});

test("study runner retains outcome-only native failure without activating a reserve", async () => {
	const directory = await mkdtemp(join(tmpdir(), "native-study-failure-"));
	try {
		const failure = nativeExecutionFailure(
			nativeExecution(observed([idle("failed")])),
		);
		if (!failure) throw new Error("Missing fixture native failure");
		const fake = fakeStudyTransport({ nativeFailure: failure });
		const result = await executeStudy(
			await prepareStudyManifest(studyManifest(), directory),
			{
				directory,
				benchmarks: [studyCase],
				transport: fake.transport,
			},
		);
		expect(result.report.attempts).toHaveLength(2);
		expect(result.report.attempts[0]?.outcome).toEqual({
			kind: "failure",
			origin: "host",
			code: "native-execution-failed",
			retryable: false,
		});
		expect(result.report.completion.activatedReserveCellIds).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("withheld assistant diagnostics preserve the other three native facts", () => {
	const trace = observed([
		nativeAssistant("msg_assistant", {
			finish: "tool-calls",
			time: { created: 1, streamed: 2, completed: 3 },
			error: { type: "unknown", message: "é ".repeat(683) },
		}),
	]);
	const assistant = trace.messages[0];
	if (assistant?.role !== "assistant") throw new Error("Missing assistant");
	expect(assistant.terminal).toEqual({
		finish: { kind: "observed", value: "tool-calls" },
		error: { kind: "withheld", reason: "limits-exceeded" },
		streamed: { kind: "observed", value: 2 },
		completed: { kind: "observed", value: 3 },
	});
});

function unansweredQuestion(error?: {
	type: string;
	message: string;
}): SessionMessageInfo {
	return nativeAssistant("msg_question", {
		time: { created: 1, completed: 3 },
		...(error ? { error } : {}),
		content: [
			nativeTool(
				"call_question",
				"question",
				{
					status: "running",
					input: {
						questions: [
							{
								question: "Continue?",
								header: "Plan",
								options: [{ label: "Yes", description: "Continue the plan" }],
							},
						],
					},
					metadata: {},
				},
				{ created: 2 },
			),
		],
	});
}

for (const outcome of ["failed", "interrupted", "succeeded"] as const)
	test(`question escalation stays primary beside ${outcome} idle`, async () => {
		const result = await observeWait({
			question: true,
			messages: () => [unansweredQuestion(), idle(outcome)],
		});
		expect(result.now).toBe(2000);
		expect(result.aborts).toBe(1);
		expect(result.result).toBe("escalated");
		expect(result.question).toEqual({
			sessionId: "ses_root",
			calls: [
				{
					messageId: "msg_question",
					callId: "call_question",
					input: {
						questions: [
							{
								question: "Continue?",
								header: "Plan",
								options: [{ label: "Yes", description: "Continue the plan" }],
							},
						],
					},
				},
			],
		});
		expect(result.outcome.providerError).toBeNull();
		expect(result.outcome.nativeFailure).toBeNull();
		const trace = result.outcome.hostTrace;
		if (trace?.version !== 2 || trace.kind !== "observed")
			throw new Error("Missing question native trace");
		expect(
			trace.messages.find(
				(message) => message.role === "event" && message.type === "idle",
			),
		).toMatchObject({ execution: { outcome, error: { kind: "absent" } } });
		expect(nativeExecutionFailure(nativeExecution(trace))?.code ?? null).toBe(
			outcome === "succeeded" ? null : `native-execution-${outcome}`,
		);
	});

test("allowed question escalation reaches the public runner's product grading", async () => {
	const result = await observeWait({
		question: true,
		messages: () => [unansweredQuestion(), idle("failed")],
	});
	const scenario = SCENARIOS.find((entry) => entry.id === "plan-only-stops");
	if (!scenario) throw new Error("Missing allowed escalation scenario");
	expect(result.result).toBe("escalated");
	expect(askedScoring([0], 1, scenario.mayEscalate === true)).toEqual({
		escalated: true,
		unscored: false,
	});
	expect(
		result.outcome.providerError ?? result.outcome.nativeFailure,
	).toBeNull();
	const evidence = retainedFailureEvidence({
		attempt: {
			attemptId: "question-attempt",
			cellId: "question-cell",
			caseId: scenario.id,
			repetition: 0,
			model: {
				routeProvider: "fixture",
				model: "model",
				family: "fixture",
				gateway: null,
				revision: null,
			},
		},
		durationMs: result.now,
		gradeInput: scenarioGradeInput(result.outcome),
	});
	const product = deriveConformanceOutcome({
		evidence,
		check: scenario.check,
		scenarioId: scenario.id,
		model: fixtureModel,
		attempt: 1,
	});
	expect(product).toMatchObject({
		kind: "product",
		passed: false,
		endedBy: "user-escalation",
		issues: [
			"no session document was written; planning did not persist a plan",
		],
	});
});

for (const next of ["command", "prompt"] as const)
	test(`question stop is not inherited by the exact next ${next}`, async () => {
		const project = await mkdtemp(join(tmpdir(), "question-next-command-"));
		let now = 0;
		let dispatches = 0;
		let messages: SessionMessageInfo[] = [];
		const root = nativeSession("ses_root", project);
		const client = nativeClient(({ url }) => {
			const path = url.pathname;
			if (path.endsWith("/model")) return new Response(null, { status: 204 });
			if (path.endsWith("/command") || path.endsWith("/prompt")) {
				dispatches++;
				messages =
					dispatches === 1
						? [unansweredQuestion(), idle("failed")]
						: [...messages, idle("failed", "msg_next_failure", now + 2)];
				return path.endsWith("/prompt")
					? Response.json({ data: {} })
					: new Response(null, { status: 204 });
			}
			if (path.endsWith("/interrupt")) {
				messages = messages.map((message) => {
					if (message.type !== "assistant") return message;
					return {
						...message,
						content: message.content.map((part) =>
							part.type === "tool" && part.name === "question"
								? nativeTool(
										part.id,
										part.name,
										{
											status: "error",
											input: { questions: [{ question: "Continue?" }] },
											error: {
												type: "aborted",
												message: "Question interrupted",
											},
										},
										{ created: 2, completed: now },
									)
								: part,
						),
					};
				});
				return Response.json({ interrupted: true });
			}
			if (path === "/api/session") return sessionPage([root]);
			if (path === "/api/session/ses_root") return sessionReply(root);
			if (path.endsWith("/message")) return messagePage(messages);
			throw new Error("Unexpected question sequence endpoint");
		});
		const clock = spyOn(Date, "now").mockImplementation(() => now);
		const sleep = spyOn(Bun, "sleep").mockImplementation(async () => {
			now += 2000;
		});
		const host = nativeHost(project, client);
		try {
			expect(
				await host.runCommand(
					"ses_root",
					"flow-plan",
					"fixture",
					fixtureModel,
					{ quietMs: 0 },
				),
			).toBe("escalated");
			expect((await host.outcome(["ses_root"], now)).nativeFailure).toBeNull();
			expect(host.escalationQuestion("ses_root").calls[0]?.callId).toBe(
				"call_question",
			);
			const second = await (next === "command"
				? host.runCommand("ses_root", "flow-plan", "fixture", fixtureModel, {
						quietMs: 0,
					})
				: host.runPrompt("ses_root", "fixture", fixtureModel, { quietMs: 0 })
			).catch((error: unknown) => error);
			if (!(second instanceof EvaluationPhaseError))
				throw new Error("New native failure was suppressed");
			expect(second.failure.code).toBe("native-execution-failed");
			expect(second.failure.retryable).toBe(false);
			expect(
				isEligibleEnvironmentFailure({
					outcome: { kind: "failure", ...second.failure },
				}),
			).toBe(false);
			expect((await host.outcome(["ses_root"], now)).nativeFailure?.code).toBe(
				"native-execution-failed",
			);
			expect(dispatches).toBe(2);
		} finally {
			sleep.mockRestore();
			clock.mockRestore();
			await rm(project, { recursive: true, force: true });
		}
	});

test("question-shaped work does not outrank an earlier provider failure", async () => {
	const result = await observeWait({
		messages: () => [
			unansweredQuestion({ type: "api", message: "Earlier provider failure" }),
			idle("failed"),
		],
	});
	if (!(result.result instanceof EvaluationPhaseError))
		throw new Error("Missing earlier provider failure");
	expect(result.result.failure.origin).toBe("provider");
	expect(result.result.failure.code).toBe("provider-rejected-turn");
	expect(result.outcome.providerError?.code).toBe("provider-rejected-turn");
	expect(result.outcome.nativeFailure).toBeNull();
});

test("study runner grades an allowed question stop instead of recording native failure", async () => {
	const question = await observeWait({
		question: true,
		messages: () => [unansweredQuestion(), idle("failed")],
	});
	const end = question.result;
	if (end !== "escalated")
		throw new Error("Question did not select escalation");
	const directory = await mkdtemp(join(tmpdir(), "question-study-grade-"));
	const fake = fakeStudyTransport();
	try {
		const result = await executeStudy(
			await prepareStudyManifest(studyManifest(), directory),
			{
				directory,
				benchmarks: [studyCase],
				transport: {
					prepareCache: fake.transport.prepareCache,
					startHost: async (input) => {
						const host = await fake.transport.startHost(input);
						return {
							...host,
							runPrompt: async (...args) => {
								await host.runPrompt(...args);
								return end;
							},
							outcome: async (...args) => ({
								...(await host.outcome(...args)),
								providerError: question.outcome.providerError,
								nativeFailure: question.outcome.nativeFailure,
							}),
						};
					},
				},
			},
		);
		expect(result.report.attempts).toHaveLength(2);
		expect(
			result.report.attempts.map((attempt) => attempt.outcome),
		).toMatchObject([
			{ kind: "product", passed: true, endedBy: "user-escalation" },
			{ kind: "product", passed: true, endedBy: "user-escalation" },
		]);
		expect(result.report.completion.activatedReserveCellIds).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
