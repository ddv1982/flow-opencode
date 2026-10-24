import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
	SessionInterruptResponse,
	SessionMessageAssistant,
	SessionMessageInfo,
} from "@opencode/client";
import { deriveEnvironmentReserveState } from "../evals/environment-reserves.js";
import {
	deriveRetainedFailure,
	pseudonymizeEvalIds,
	RetainedScenarioEvidenceSchema,
	retainedFailureObservation,
	ScenarioGradeInputSchema,
} from "../evals/grader-input.js";
import type { EvalHost, Outcome } from "../evals/harness.js";
import { redactTranscript } from "../evals/provenance.js";
import { releaseCatalog, releaseCellsFor } from "../evals/release-policy.js";
import { deriveReleaseRunState } from "../evals/release-progress.js";
import type {
	AttemptRecordV2,
	CampaignPlan,
	ScheduledCell,
} from "../evals/report.js";

import {
	fixtureModel,
	messagePage,
	nativeAssistant,
	nativeHost,
	nativeHttpClient,
	nativeSession,
	nativeTool,
	sessionPage,
	sessionReply,
	useNativeFixtureBudget,
} from "./fixtures/native-eval-client.js";

useNativeFixtureBudget();

type Mode =
	| "text"
	| "reasoning"
	| "replacement"
	| "pending-raw"
	| "pending-input"
	| "running-input"
	| "silent"
	| "metadata"
	| "timestamps"
	| "completed-history"
	| "history-new-part"
	| "history-reopened"
	| "running-output"
	| "foreign-root-part"
	| "foreign-child-part"
	| "duplicate-part"
	| "deadline"
	| "oversize-proof"
	| "numeric-message"
	| "numeric-part"
	| "object-call"
	| "object-tool"
	| "object-pending-raw";
const root = "ses_progressroot";
const child = "ses_progresschild";
const model = {
	routeProvider: "openai",
	gateway: null,
	family: "gpt-6.1-sol",
	model: "gpt-6.1-sol",
	revision: null,
};
async function observe(
	mode: Mode,
	afterWait?: (
		host: EvalHost,
		cancel: (reason: Error) => void,
	) => Promise<void>,
	outcomeRoots: readonly string[] = [root],
) {
	const project = await mkdtemp(join(tmpdir(), "flow-observed-progress-"));
	let now = 0;
	let aborts = 0;
	let aborted = false;
	const active = [
		"text",
		"reasoning",
		"replacement",
		"pending-raw",
		"pending-input",
		"running-input",
		"numeric-message",
		"numeric-part",
		"object-call",
		"object-tool",
		"object-pending-raw",
	].includes(mode);
	const completed = () => active && now >= 210_000;
	const taskInput = {
		subagent_type: "flow-reviewer",
		prompt:
			mode === "oversize-proof"
				? "x".repeat(256 * 1024)
				: `Inspect ${root} in ${project} and ${homedir()}/fixture-review.`,
		apiKey: "synthetic-private-token-for-redaction",
	};
	const user = (session: string): SessionMessageInfo => ({
		type: "user",
		id: session === root ? "msg_rootuser" : "msg_childuser",
		time: { created: 1 },
		text: "Inspect the fixture.",
	});
	const assistant = (session: string, id: string, history = false) =>
		nativeAssistant(id, {
			agent: session === root ? "build" : "flow-reviewer",
			model: { providerID: "openai", id: "gpt-6.1-sol" },
			time: {
				created: 2,
				...(history && !(mode === "history-reopened" && now >= 100_000)
					? { completed: 3 }
					: completed()
						? { completed: 210_000 }
						: {}),
			},
		});
	const rootMessages = (): SessionMessageInfo[] => {
		const task = nativeTool(
			"call_task",
			"task",
			aborted
				? {
						status: "error",
						input: taskInput,
						error: { type: "aborted", message: "Task cancelled" },
					}
				: completed()
					? {
							status: "completed",
							input: taskInput,
							content: [{ type: "text", text: "review complete" }],
						}
					: {
							status: "running",
							input: taskInput,
							metadata: {
								sessionId: child,
								parentSessionId: root,
								model: { providerID: "openai", id: "gpt-6.1-sol" },
								heartbeat: mode === "metadata" ? now : 0,
							},
						},
			{
				created: 2,
				...(aborted
					? { completed: now }
					: completed()
						? { completed: 210_000 }
						: {}),
			},
		);
		if (!aborted && !completed()) {
			if (mode === "object-call") Reflect.set(task, "id", { heartbeat: now });
			if (mode === "object-tool") Reflect.set(task, "name", { heartbeat: now });
		}
		const entry = { ...assistant(root, "msg_root"), content: [task] };
		if (mode === "foreign-root-part") entry.id = "msg_child";
		return [user(root), entry];
	};
	const childMessages = (): SessionMessageInfo[] => {
		const tick = Math.floor(Math.min(now, 210_000) / 2_000);
		const history = [
			"completed-history",
			"history-new-part",
			"history-reopened",
		].includes(mode);
		const tool = [
			"pending-raw",
			"pending-input",
			"running-input",
			"running-output",
			"object-pending-raw",
		].includes(mode);
		let part: SessionMessageAssistant["content"][number];
		if (tool) {
			const input = {
				page: mode === "pending-input" || mode === "running-input" ? tick : 0,
			};
			part = nativeTool(
				"call_read",
				"read",
				completed()
					? {
							status: "completed",
							input,
							content: [{ type: "text", text: "read complete" }],
						}
					: mode.startsWith("pending") || mode === "object-pending-raw"
						? {
								status: "streaming",
								input:
									mode === "pending-input"
										? JSON.stringify(input)
										: mode === "pending-raw"
											? `page:${tick}`
											: "page:0",
							}
						: { status: "running", input, metadata: {} },
				{ created: 2, ...(completed() ? { completed: 210_000 } : {}) },
			);
			if (mode === "running-output")
				Reflect.set(part.state, "content", [
					{ type: "text", text: `unsupported running output:${now}` },
				]);
			if (mode === "object-pending-raw" && !aborted && !completed())
				Reflect.set(part.state, "input", { heartbeat: now });
		} else {
			part = {
				type: mode === "reasoning" ? "reasoning" : "text",
				text:
					mode === "replacement"
						? `page${tick % 2}`
						: ["text", "reasoning", "deadline", "completed-history"].includes(
									mode,
								)
							? `evidence ${now}`
							: "evidence",
			};
			if (mode === "timestamps") Reflect.set(part, "time", { created: now });
		}
		const extra: SessionMessageAssistant["content"] =
			mode === "history-new-part"
				? Array.from({ length: tick }, (_, index) => ({
						type: "text",
						text: `old ${index}`,
					}))
				: mode === "duplicate-part"
					? [
							nativeTool("call_read", "read", {
								status: "running",
								input: {},
								metadata: {},
							}),
							nativeTool("call_read", "read", {
								status: "running",
								input: {},
								metadata: {},
							}),
						]
					: [];
		const entry = {
			...assistant(child, "msg_child", history),
			content: [part, ...extra],
		};
		if (!aborted && !completed()) {
			if (mode === "numeric-message") Reflect.set(entry, "id", 42);
			if (mode === "numeric-part")
				entry.content = [
					nativeTool("call_read", "read", {
						status: "running",
						input: {},
						metadata: {},
					}),
				];
			if (mode === "numeric-part" && entry.content[0])
				Reflect.set(entry.content[0], "id", 42);
		}
		if (mode === "foreign-child-part") entry.id = "msg_root";
		return [user(child), entry];
	};
	const server = nativeHttpClient(({ url, method }) => {
		const path = url.pathname;
		if (path === `/api/session/${root}/interrupt`) {
			expect(method).toBe("POST");
			expect(url.searchParams.get("resume")).toBe("false");
			aborts++;
			aborted = true;
			return Response.json({
				interrupted: true,
			} satisfies SessionInterruptResponse);
		}
		if (
			path === `/api/session/${root}/model` ||
			path === `/api/session/${root}/command`
		)
			return new Response(null, { status: 204 });
		if (path === "/api/session")
			return sessionPage([
				nativeSession(root, project, {
					model: { providerID: "openai", id: "gpt-6.1-sol" },
				}),
				nativeSession(child, project, {
					parentID: root,
					agent: "flow-reviewer",
					model: { providerID: "openai", id: "gpt-6.1-sol" },
				}),
			]);
		if (path === `/api/session/${root}`)
			return sessionReply(
				nativeSession(root, project, {
					model: { providerID: "openai", id: "gpt-6.1-sol" },
				}),
			);
		if (path === `/api/session/${child}`)
			return sessionReply(
				nativeSession(child, project, {
					parentID: root,
					agent: "flow-reviewer",
					model: { providerID: "openai", id: "gpt-6.1-sol" },
				}),
			);
		if (path === `/api/session/${root}/message`)
			return messagePage(rootMessages());
		if (path === `/api/session/${child}/message`)
			return messagePage(childMessages());
		throw new Error(`Unexpected native fixture endpoint ${method} ${path}`);
	});
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const sleep = spyOn(Bun, "sleep").mockImplementation(async () => {
		now += 2_000;
	});
	try {
		const controller = new AbortController();
		const host = nativeHost(project, server.client, controller.signal);
		const result: unknown = await host
			.runCommand(root, "flow-auto", "fixture", fixtureModel)
			.catch((error: unknown) => error);
		await afterWait?.(host, (reason) => controller.abort(reason));
		const outcome = await host.outcome(outcomeRoots, now);
		return { result, now, aborts, outcome, project };
	} finally {
		sleep.mockRestore();
		clock.mockRestore();
		server.stop();
		await rm(project, { recursive: true, force: true });
	}
}

for (const mode of [
	"text",
	"reasoning",
	"replacement",
	"pending-raw",
	"pending-input",
	"running-input",
] as const) {
	test(`real HTTP owned ${mode} activity can finish past three minutes without abort`, async () => {
		const observed = await observe(mode);
		expect(observed.result).toBe("quiet");
		expect(observed.now).toBeGreaterThanOrEqual(210_000);
		expect(observed.now).toBeLessThanOrEqual(240_000);
		expect(observed.aborts).toBe(0);
	});
}
for (const mode of [
	"silent",
	"metadata",
	"timestamps",
	"completed-history",
	"history-new-part",
	"history-reopened",
	"running-output",
] as const) {
	test(`real HTTP ${mode} cannot turn observable silence into activity`, async () => {
		const observed = await observe(mode);
		expect(observed.result).toBeInstanceOf(Error);
		expect(observed.now).toBe(182_000);
		expect(observed.aborts).toBe(1);
	});
}
for (const mode of [
	"foreign-root-part",
	"foreign-child-part",
	"duplicate-part",
	"numeric-message",
	"numeric-part",
	"object-call",
	"object-tool",
	"object-pending-raw",
] as const) {
	test(`real HTTP malformed ${mode} fails at the owned observation boundary`, async () => {
		const observed = await observe(mode);
		expect(observed.result).toBeInstanceOf(Error);
		expect(String(observed.result)).toContain("malformed");
		expect(observed.now).toBe(2_000);
		expect(observed.aborts).toBe(1);
	});
}
test("real HTTP continuous owned content retains the twenty-minute hard deadline", async () => {
	const observed = await observe("deadline");
	expect(observed.result).toBeInstanceOf(Error);
	expect(String(observed.result)).toContain("exceeded 1200000ms");
	expect(observed.now).toBeLessThanOrEqual(1_204_000);
	expect(observed.now).toBeGreaterThanOrEqual(1_200_000);
	expect(observed.aborts).toBe(1);
	const proof: unknown = Reflect.get(observed.outcome, "abortObservation");
	expect(proof).toBeDefined();
	expect(deriveRetainedFailure(evidence(observed.outcome, proof))).toEqual({
		origin: "host",
		code: "command-aborted",
		retryable: true,
	});
});

function evidence(outcome: Outcome, abortObservation: unknown) {
	const gradeInput = ScenarioGradeInputSchema.parse({
		schemaVersion: 1 as const,
		allCalls: outcome.allCalls,
		flowCalls: outcome.flowCalls,
		hostTrace: outcome.hostTrace,
		session: outcome.session,
		archives: outcome.archives,
		finalText: outcome.finalText,
		providerErrors: [],
	});
	const input = {
		origin: "host" as const,
		code: "command-aborted",
		retryable: true,
		detail: "Actual watchdog abort",
		gradeInput,
		abortObservation,
	};
	return RetainedScenarioEvidenceSchema.parse({
		schemaVersion: 1,
		attempt: {
			attemptId: "attempt-progress",
			cellId: "cell-progress",
			caseId: "happy-path",
			repetition: 0,
			model,
		},
		actors: [
			{
				role: "manager",
				sessionIds: [root],
				actualModel: {
					kind: "observed",
					value: { providerID: "openai", modelID: "gpt-6.1-sol" },
				},
				requestedModelId: "openai/gpt-6.1-sol",
				requestedModel: model,
			},
		],
		guidanceLoads: [],
		gradeInput,
		failure: { origin: "host", code: "command-aborted", retryable: true },
		failureObservation: retainedFailureObservation(input),
		usage: { durationMs: outcome.durationMs, outputTokens: 1, costUsd: null },
	});
}
async function captured() {
	const observed = await observe("silent");
	const proof: unknown = Reflect.get(observed.outcome, "abortObservation");
	expect(proof).toBeDefined();
	const task = observed.outcome.allCalls.find((call) => call.tool === "task");
	expect(task?.status).toBe("error");
	expect(task?.rawOutput).toBe("Task cancelled");
	expect(task?.metadata.interrupted).toBeUndefined();
	return { ...observed, proof, retained: evidence(observed.outcome, proof) };
}
test("actual pre-abort pending proof survives native self-cancellation without manufactured metadata", async () => {
	const observed = await captured();
	expect(deriveRetainedFailure(observed.retained)).toEqual({
		origin: "host",
		code: "command-aborted",
		retryable: true,
	});
});
test("pre-abort input binding survives the real persistence redaction pipeline", async () => {
	const observed = await captured();
	const value = JSON.parse(
		redactTranscript({
			projectPath: observed.project,
			value: pseudonymizeEvalIds(observed.retained),
		}).text,
	);
	const persisted = RetainedScenarioEvidenceSchema.parse(value);
	expect(deriveRetainedFailure(persisted)).toEqual({
		origin: "host",
		code: "command-aborted",
		retryable: true,
	});
	expect(JSON.stringify(value)).not.toContain(observed.project);
	expect(JSON.stringify(value)).not.toContain(homedir());
	expect(JSON.stringify(value)).not.toContain(
		"synthetic-private-token-for-redaction",
	);
	expect(JSON.stringify(value)).not.toContain(root);
});

test("legacy final cancellation without a pre-abort proof remains nonretryable", async () => {
	const observed = await observe("silent");
	expect(
		deriveRetainedFailure(evidence(observed.outcome, undefined)),
	).toBeNull();
});
for (const mutation of [
	"root",
	"input",
	"native",
	"time",
	"stale-observation",
	"trigger",
	"completed",
	"empty",
	"trace",
	"provider",
] as const) {
	test(`durable pending proof refuses contradictory ${mutation}`, async () => {
		const observed = await captured();
		const value = structuredClone(observed.retained);
		const observation = Reflect.get(
			value.failureObservation ?? {},
			"abortObservation",
		) as Record<string, unknown>;
		if (mutation === "root") observation.rootSessionId = "ses_foreign";
		if (mutation === "time") observation.abortRequestedAt = 0;
		if (mutation === "trigger")
			observation.trigger = {
				kind: "stall",
				unchangedMs: 1,
				thresholdMs: 180_000,
			};
		const task = value.gradeInput.allCalls.find((call) => call.tool === "task");
		if (!task?.native) throw new Error("Missing native fixture task.");
		if (mutation === "stale-observation")
			observation.observedAt = task.native.startedAt;
		if (mutation === "input") Reflect.set(task, "input", { different: true });
		if (mutation === "native") task.native.messageId = "msg_different";
		if (mutation === "completed") Reflect.set(task, "status", "completed");
		if (mutation === "empty") observation.pending = [];
		if (mutation === "trace")
			Reflect.deleteProperty(value.gradeInput, "hostTrace");
		if (mutation === "provider")
			value.gradeInput.providerErrors.push({
				sessionId: root,
				name: "APIError",
				message: "Provider failed.",
			});
		const parsed = RetainedScenarioEvidenceSchema.safeParse(value);
		expect(
			parsed.success ? deriveRetainedFailure(parsed.data) : null,
		).toBeNull();
	});
}

test("replayed native abort proof continues scheduling and uses only the predeclared reserve", async () => {
	const observed = await captured();
	const failure = deriveRetainedFailure(observed.retained);
	expect(failure).toEqual({
		origin: "host",
		code: "command-aborted",
		retryable: true,
	});
	if (!failure) throw new Error("Missing replay-derived host failure.");
	const cells = releaseCellsFor([model], "9.6.0").filter(
		(cell) => cell.caseId === "happy-path",
	);
	const catalog = releaseCatalog("9.6.0").filter(
		(policy) => policy.caseId === "happy-path",
	);
	const plan: CampaignPlan = {
		schemaVersion: 1,
		planId: "native-abort-reserve",
		planSha256: `sha256:${"0".repeat(64)}`,
		randomizationSeed: "fixture",
		cells,
		abortPolicy: { retry: "environment-only", maxReplacementBlocks: 1 },
		stoppingRule: { kind: "fixed-attempts", count: 3 },
		analysis: {
			kind: "rate",
			primaryOutcome: "conformance-pass",
			versionSha256: `sha256:${"1".repeat(64)}`,
		},
		budget: {
			maxUsd: null,
			unknownCostPolicy: "token-wall-clock-bounds",
			maxOutputTokens: 1000,
			maxWallClockMs: 1200000,
			maxAttempts: cells.length,
		},
	};
	const product: AttemptRecordV2["outcome"] = {
		kind: "product",
		passed: true,
		issues: [],
		endedBy: "quiet",
		evidence: {
			kind: "conformance",
			falseCompletion: false,
			unsubmittedReviews: 0,
			facts: {},
		},
	};
	const attempt = (
		cell: ScheduledCell,
		outcome: AttemptRecordV2["outcome"],
	): AttemptRecordV2 => ({
		schemaVersion: 2,
		attemptId: `attempt-${cell.cellId}`,
		cellId: cell.cellId,
		blockId: cell.blockId,
		caseId: cell.caseId,
		caseVersion: cell.caseVersion,
		armToken: cell.armToken,
		repetition: cell.repetition,
		artifact: {
			packageVersion: "9.6.0",
			sourceCommit: "fixture",
			sourceTreeSha256: `sha256:${"2".repeat(64)}`,
			tarballSha256: `sha256:${"3".repeat(64)}`,
			unpackedManifestSha256: `sha256:${"4".repeat(64)}`,
		},
		evaluator: {
			sourceCommit: "fixture",
			caseCatalogSha256: `sha256:${"5".repeat(64)}`,
			policyCatalogSha256: `sha256:${"6".repeat(64)}`,
			graderBundleSha256: `sha256:${"7".repeat(64)}`,
		},
		hostConfigSha256: `sha256:${"8".repeat(64)}`,
		actors: [],
		instructions: [],
		transcript: null,
		outcome,
		usage: { durationMs: 1, outputTokens: 1, costUsd: null },
	});
	const primary = cells.filter((cell) => cell.schedule === "primary");
	const reserve = cells.find((cell) => cell.schedule === "environment-reserve");
	if (!primary[0] || !reserve)
		throw new Error("Missing maintained scheduling fixture.");
	const first = attempt(primary[0], { kind: "failure", ...failure });
	expect(deriveReleaseRunState({ plan, catalog, attempts: [first] })).toEqual({
		kind: "continue",
	});
	const attempts = [
		first,
		...primary.slice(1).map((cell) => attempt(cell, product)),
	];
	expect(
		deriveEnvironmentReserveState(plan, attempts).nextReserveCellIds,
	).toEqual([reserve.cellId]);
	attempts.push(attempt(reserve, product));
	expect(deriveEnvironmentReserveState(plan, attempts).targetsSatisfied).toBe(
		true,
	);
	expect(deriveReleaseRunState({ plan, catalog, attempts })).toEqual({
		kind: "complete",
	});
	expect(attempts[0]?.outcome.kind).toBe("failure");
});

for (const method of ["runCommand", "runPrompt"] as const) {
	test(`a new ${method} that fails before dispatch cannot borrow prior abort proof`, async () => {
		const observed = await observe("silent", async (host, cancel) => {
			const before = await host.outcome([root], 182000);
			expect(Reflect.get(before, "abortObservation")).toBeDefined();
			cancel(new Error("Fixture pre-dispatch rejection."));
			const request =
				method === "runCommand"
					? host.runCommand(root, "flow-auto", "fixture", fixtureModel)
					: host.runPrompt(root, "fixture", fixtureModel);
			await expect(request).rejects.toThrow("Fixture pre-dispatch rejection.");
		});
		expect(Reflect.get(observed.outcome, "abortObservation")).toBeUndefined();
	});
}
test("outcome for a different root cannot borrow the original abort proof", async () => {
	const observed = await observe("silent", undefined, [child]);
	expect(Reflect.get(observed.outcome, "abortObservation")).toBeUndefined();
});
test("oversize native input declines proof instead of truncating into reserve authority", async () => {
	const observed = await observe("oversize-proof");
	expect(observed.aborts).toBe(1);
	expect(Reflect.get(observed.outcome, "abortObservation")).toBeUndefined();
	expect(
		deriveRetainedFailure(evidence(observed.outcome, undefined)),
	).toBeNull();
});

for (const kind of ["stall", "deadline"] as const) {
	test(`replay refuses ${kind} proof exceeding the established suspension-credit cap`, async () => {
		const observed = await captured();
		const value = structuredClone(observed.retained);
		const proof = Reflect.get(
			value.failureObservation ?? {},
			"abortObservation",
		) as Record<string, unknown>;
		proof.startedAt = 0;
		proof.excludedMs = 1_300_000;
		proof.observedAt = 2_502_000;
		proof.abortRequestedAt = 2_502_000;
		proof.trigger =
			kind === "stall"
				? {
						kind,
						lastActivityAt: 2_322_000,
						unchangedMs: 180_000,
						thresholdMs: 180_000,
					}
				: { kind, observedElapsedMs: 1_202_000, timeoutMs: 1_200_000 };
		value.usage.durationMs = 2_502_000;
		const task = value.gradeInput.allCalls.find((call) => call.tool === "task");
		const trace = value.gradeInput.hostTrace;
		if (!task?.native || trace?.kind !== "observed")
			throw new Error("Missing native clock-proof fixture.");
		task.native.completedAt = 2_502_000;
		for (const message of trace.messages)
			if (message.role === "assistant")
				for (const tool of message.tools)
					if (tool.callId === task.native.callId) tool.completedAt = 2_502_000;
		expect(
			deriveRetainedFailure(RetainedScenarioEvidenceSchema.parse(value)),
		).toBeNull();
	});
}
