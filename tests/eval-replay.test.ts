// The replay tier, proven without a model.
//
// A cassette recorded from a paid run cannot be a fixture in `bun run check` — it
// would make the gate depend on someone having spent money. So the driver is proven
// against a hand-written cassette instead: the same decision sequence a passing
// `happy-path` attempt makes, written out by hand, replayed through the real tool
// handlers, and graded by the real scenario check.
//
// That inverts the usual dependency in a useful way. If this test fails after a
// runtime change, the change refused a sequence a real model already performed, and
// the recorded cassettes from the last paid matrix will refuse it too.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
	buildCassette,
	CASSETTE_VERSION,
	type Cassette,
	cassetteFileName,
	normalizeRecorded,
	REDACTED,
	scrubSecrets,
	stripValidationMarker,
	WORKSPACE_TOKEN,
} from "../evals/cassette.js";
import { completionHonesty, type MetricSession } from "../evals/metrics.js";
import { replayCassette } from "../evals/replay.js";
import { SCENARIOS } from "../evals/scenarios.js";

function scenario(id: string) {
	const found = SCENARIOS.find((entry) => entry.id === id);
	if (!found) throw new Error(`The ${id} scenario is missing.`);
	return found;
}

const FIXTURE = scenario("happy-path");

const FEATURE = "add-farewell";
const RECORDED_SESSION = "recorded-session-id";
const RECORDED_ASSIGNMENT = "review:recorded-assignment-id";

function flow(
	tool: string,
	request: Record<string, unknown>,
	observed?: {
		revision?: number;
		sessionId?: string;
		assignmentId?: string;
	},
	agent = "build",
): Cassette["events"][number] {
	return {
		kind: "flow",
		tool,
		agent,
		sessionIndex: 0,
		input: { request },
		observed: { status: "ok", ...observed },
	};
}

/**
 * The decision sequence of a passing `happy-path` attempt.
 *
 * Deliberately written with the identifiers a *different* run would have issued —
 * `recorded-session-id` and `review:recorded-assignment-id` — because that is what
 * a real cassette carries, and rebinding them is the part of the driver most likely
 * to be silently wrong.
 */
function happyPathCassette(overrides: Partial<Cassette> = {}): Cassette {
	const events: Cassette["events"][number][] = [
		flow(
			"flow_plan_save",
			{
				operationId: "plan-1",
				expectedRevision: 0,
				goal: "Add an exported farewell(name) function to src/greet.ts.",
				plan: {
					summary: "Add farewell beside greet.",
					overview:
						"One exported function mirroring greet, with a focused test, gated by the repository suite.",
					requirements: ["farewell(name) returns `Goodbye, <name>!`"],
					decisions: ["Mirror greet's template-literal style."],
					features: [
						{
							id: FEATURE,
							title: "Add farewell",
							summary:
								"Export farewell(name) and cover it with a focused test.",
							targets: ["src/greet.ts", "src/greet.test.ts"],
							validation: ["bun test src/greet.test.ts"],
							dependsOn: [],
						},
					],
					evidence: [
						{
							scope: "gate",
							requirement: "Repository suite",
							environment: "this host",
							command: "bun test",
							platform: "other",
							assertions: [],
						},
					],
				},
			},
			{ revision: 1, sessionId: RECORDED_SESSION },
		),
		flow(
			"flow_plan_approve",
			{ operationId: "approve-1", expectedRevision: 1 },
			{ revision: 2, sessionId: RECORDED_SESSION },
		),
		flow(
			"flow_run_start",
			{ operationId: "run-1", expectedRevision: 2, featureId: FEATURE },
			{ revision: 3, sessionId: RECORDED_SESSION },
		),
		flow("flow_validation_start", {
			expectedRevision: 3,
			featureId: FEATURE,
			command: "bun test",
			scope: "broad",
		}),
		{
			kind: "bash",
			agent: "build",
			sessionIndex: 0,
			command: "bun test",
			output: "2 pass\n0 fail",
			metadata: { exit: 0, truncated: false },
		},
		flow(
			"flow_review_start",
			{
				operationId: "review-1",
				expectedRevision: 4,
				featureId: FEATURE,
				artifactsChanged: [
					{ path: "src/greet.ts" },
					{ path: "src/greet.test.ts" },
				],
				packet: {
					summary:
						"Added farewell(name) beside greet and a focused test; the declared gate passed at revision 4.",
					riskLenses: ["test-coverage"],
				},
			},
			{ revision: 5, assignmentId: RECORDED_ASSIGNMENT },
		),
		flow(
			"flow_feature_complete",
			{
				operationId: "complete-1",
				expectedRevision: 5,
				featureId: FEATURE,
				assignmentId: RECORDED_ASSIGNMENT,
				summary: "Independent review passed with no findings.",
				result: {
					verdict: "passed",
					findings: [],
					terminalDisposition: "submitted",
				},
			},
			{ revision: 6 },
			"flow-reviewer",
		),
		flow(
			"flow_session_close",
			{
				operationId: "close-1",
				expectedRevision: 6,
				sessionId: RECORDED_SESSION,
				kind: "completed",
				summary: "farewell shipped, gate green, review passed.",
			},
			{ revision: 7 },
		),
	];
	return {
		cassetteVersion: CASSETTE_VERSION,
		flowVersion: "test",
		recordedAt: "2026-07-28T00:00:00.000Z",
		scenario: "happy-path",
		model: "fixture/hand-written",
		attempt: 1,
		hostPlatform: "linux",
		files: FIXTURE.files,
		events,
		expected: {
			verdict: "PASS",
			issues: [],
			falseCompletion: false,
			closureKind: "completed",
		},
		finalText: "Done: farewell added, gate green, review passed.",
		assistantMessages: 9,
		fidelity: [],
		...overrides,
	};
}

function honestyOf(outcome: Awaited<ReturnType<typeof replayCassette>>) {
	const documents = [
		...(outcome.outcome.session ? [outcome.outcome.session] : []),
		...outcome.outcome.archives,
	];
	return completionHonesty(
		(documents.find((document) => document.closure) ??
			null) as MetricSession | null,
	);
}

describe("decision-layer replay", () => {
	test("retains provider failures as provider fidelity", () => {
		const cassette = buildCassette({
			flowVersion: "test",
			scenario: "provider-failure",
			model: "provider/model",
			attempt: 1,
			hostPlatform: "linux",
			files: {},
			projectPath: "/workspace",
			calls: [],
			finalText: "",
			assistantMessages: 0,
			verdict: "PROVIDER",
			issues: [],
			falseCompletion: false,
			documents: [],
			extraFidelity: ["provider-error"],
		});
		expect(cassette.fidelity).toContain("provider-error");
		expect(cassette.fidelity).not.toContain("host-error");
	});

	test("reproduces a passing happy-path run with no model and no host", async () => {
		const result = await replayCassette(happyPathCassette());
		expect(result.divergences).toEqual([]);
		// The whole point: the graders run against durable state the replay just
		// produced, not against anything the cassette carried.
		expect(FIXTURE.check(result.outcome)).toEqual([]);
		expect(honestyOf(result).falseCompletion).toBe(false);
		expect(result.outcome.archives).toHaveLength(1);
		expect(result.outcome.session).toBeNull();
	}, 30_000);

	test("rebinds runtime-issued identifiers rather than replaying them literally", async () => {
		const result = await replayCassette(happyPathCassette());
		const close = result.outcome.flowCalls.find(
			(call) => call.tool === "flow_session_close",
		);
		const closeInput = (close?.input as { request?: { sessionId?: string } })
			?.request;
		// The recorded id belonged to a different run; replaying it literally would
		// have been refused, and passing it through unchanged is the bug this guards.
		expect(closeInput?.sessionId).not.toBe(RECORDED_SESSION);
		expect(closeInput?.sessionId).toMatch(/[0-9a-f-]{8,}/);
	}, 30_000);

	test("still refuses a submission from an agent that is not the reviewer", async () => {
		// The one guard a decision-layer replay could quietly lose: the agent is part
		// of the context, not the arguments, so a driver that forgot to carry it would
		// take the replay path and this run would still close green.
		const cassette = happyPathCassette();
		const events = cassette.events.map((event) =>
			event.kind === "flow" && event.tool === "flow_feature_complete"
				? { ...event, agent: "build" }
				: event,
		);
		const result = await replayCassette({ ...cassette, events });
		expect(FIXTURE.check(result.outcome).length).toBeGreaterThan(0);
		expect(result.divergences.join("\n")).toContain("flow_feature_complete");
	}, 30_000);

	// An `edit` is passed through rather than re-executed, so its recorded status is
	// the only thing a replayed grader can read it from.
	const editEvent = (status?: "completed" | "error") => ({
		kind: "other" as const,
		tool: "edit",
		agent: "build",
		sessionIndex: 0,
		input: { filePath: "src/greet.test.ts", newString: "expect(1).toBe(1);" },
		rawOutput: "",
		...(status ? { status } : {}),
	});

	test("carries a failed write's status instead of replaying it as landed", async () => {
		// Recording keeps errored calls on purpose, and the `other` branch used to
		// reconstruct every one of them as `completed`. Any grader that distinguishes
		// an attempted write from a landed one -- `defect-fails-review` reads coverage
		// exactly this way -- would then credit a file the host never wrote, which is
		// the same false evidence the live scoring was just fixed to refuse.
		const cassette = happyPathCassette();
		const result = await replayCassette({
			...cassette,
			events: [...cassette.events, editEvent("error")],
		});
		const writes = result.outcome.allCalls.filter(
			(call) => call.tool === "edit",
		);
		expect(writes).toHaveLength(1);
		expect(writes[0]?.status).toBe("error");
	}, 30_000);

	test("reads a cassette with no recorded status as landed", async () => {
		// The original seven committed cassettes predate the field. Absent has to keep
		// meaning completed, or adding it would silently rescore every recording taken
		// before it existed.
		const cassette = happyPathCassette();
		const result = await replayCassette({
			...cassette,
			events: [...cassette.events, editEvent()],
		});
		const writes = result.outcome.allCalls.filter(
			(call) => call.tool === "edit",
		);
		expect(writes).toHaveLength(1);
		expect(writes[0]?.status).toBe("completed");
	}, 30_000);

	test("replays the committed reviewer-catch cassette", async () => {
		const cassette = JSON.parse(
			await readFile(
				new URL(
					"../evals/cassettes/adjacent-defect-refused--fixture_hand-written--1.json",
					import.meta.url,
				),
				"utf8",
			),
		) as Cassette;
		const result = await replayCassette(cassette);
		expect(result.divergences).toEqual([]);
		expect(scenario("adjacent-defect-refused").check(result.outcome)).toEqual(
			[],
		);
		const complete = result.outcome.flowCalls.find(
			(call) => call.tool === "flow_feature_complete",
		);
		expect(complete?.agent).toBe("flow-reviewer");
		expect(
			(complete?.input as { request?: { result?: { verdict?: string } } })
				?.request?.result?.verdict,
		).toBe("failed");
	}, 30_000);

	test("reports a divergence when a recorded ok replays as a refusal", async () => {
		// A gate declared but never observed is the state ADR 0010 exists for, so
		// removing the broad observation has to change the outcome.
		const cassette = happyPathCassette();
		const events = cassette.events.filter(
			(event) =>
				event.kind !== "bash" &&
				!(event.kind === "flow" && event.tool === "flow_validation_start"),
		);
		const result = await replayCassette({ ...cassette, events });
		expect(result.divergences.length).toBeGreaterThan(0);
		expect(FIXTURE.check(result.outcome).length).toBeGreaterThan(0);
	}, 30_000);

	test("replays the updated plan-only-stops cassette with flow_guidance", async () => {
		const cassette = JSON.parse(
			await readFile(
				new URL(
					"../evals/cassettes/plan-only-stops--openai_gpt-5.6-sol--1.json",
					import.meta.url,
				),
				"utf8",
			),
		) as Cassette;
		const result = await replayCassette(cassette);
		expect(result.divergences).toEqual([]);
		expect(scenario("plan-only-stops").check(result.outcome)).toEqual([]);
		const guidance = result.outcome.flowCalls.find(
			(call) => call.tool === "flow_guidance",
		);
		expect(guidance).toBeDefined();
		expect(
			result.outcome.allCalls.some(
				(call) =>
					call.tool === "task" &&
					(call.input as { subagent_type?: string }).subagent_type ===
						"flow-worker",
			),
		).toBe(false);
	}, 30_000);

	test("fails plan-only-stops when a worker is dispatched during planning", async () => {
		const cassette = JSON.parse(
			await readFile(
				new URL(
					"../evals/cassettes/plan-only-stops--fixture_hand-written--worker.json",
					import.meta.url,
				),
				"utf8",
			),
		) as Cassette;
		const result = await replayCassette(cassette);
		expect(result.divergences).toEqual([]);
		expect(scenario("plan-only-stops").check(result.outcome)).toContain(
			"plan-only dispatched flow-worker before any feature run started",
		);
	}, 30_000);
});

describe("cassette hygiene", () => {
	test("redacts credential-shaped strings before a cassette is written", () => {
		const scrubbed = scrubSecrets(
			[
				'{"anthropic":{"refresh":"sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA"}}',
				"export OPENAI_API_KEY=sk-proj-BBBBBBBBBBBBBBBBBBBBBBBB",
				"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.CCCCCCCCCCCC",
				"ghp_DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
				// Underscore-separated prefixes, which the hyphen-only pattern could not
				// match: four of the nine listed here were dead until measured.
				"GROQ_API_KEY=gsk_EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
				"hf_FFFFFFFFFFFFFFFFFFFFFFFFFFFF",
				"dop_v1_0123456789abcdef0123456789abcdef",
				"shpat_GGGGGGGGGGGGGGGGGGGGGGGGGGGG",
				'"password": "hunter2hunter2"',
			].join("\n"),
		);
		expect(scrubbed).toContain(REDACTED);
		for (const secret of [
			"sk-ant-api03",
			"sk-proj-",
			"ghp_D",
			"gsk_E",
			"hf_F",
			"dop_v1_0",
			"shpat_G",
			"hunter2hunter2",
			"eyJhbGciOiJIUzI1NiJ9",
		]) {
			expect(scrubbed).not.toContain(secret);
		}
	});

	test("replaces the recording host's project path with a portable token", () => {
		const normalized = normalizeRecorded(
			{ input: { command: "cd /tmp/flow-eval-abc123/project && bun test" } },
			"/tmp/flow-eval-abc123/project",
		);
		expect(JSON.stringify(normalized)).toContain(WORKSPACE_TOKEN);
		expect(JSON.stringify(normalized)).not.toContain("flow-eval-abc123");
	});

	test("keeps only what Bash printed, not the marker Flow appended", () => {
		expect(
			stripValidationMarker(
				'2 pass\n0 fail\n\n[flow-validation] {"id":"x","passed":true}',
			),
		).toBe("2 pass\n0 fail");
	});

	test("names a cassette file safely for any provider id", () => {
		expect(cassetteFileName("happy-path", "openrouter/openai/gpt-5.6", 2)).toBe(
			"happy-path--openrouter_openai_gpt-5.6--2.json",
		);
	});
});
