import { describe, expect, test } from "bun:test";
import type { Outcome } from "../evals/harness.js";
import { SCENARIOS } from "../evals/scenarios.js";

// A scenario's `check` decides what a paid run *meant*, and it was the only part of
// the eval suite with no test. The first full three-provider matrix showed why: two
// of `unprovable-claim-refused`'s branches failed attempts that had behaved better
// than the ones it passed, and the rate that came out of it read like a prompt
// defect. These replay the recorded shapes of that run, so the next wrong branch
// costs a test run instead of a matrix.

function outcome(overrides: Partial<Outcome>): Outcome {
	return {
		flowCalls: [],
		allCalls: [],
		session: null,
		archives: [],
		finalText: "",
		tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
		costUsd: null,
		assistantMessages: 0,
		durationMs: 0,
		hostError: null,
		...overrides,
	};
}

function question(text: string) {
	return {
		tool: "question",
		status: "completed" as const,
		sessionIndex: 0,
		agent: "build",
		input: { questions: [{ question: text }] },
		output: null,
		rawOutput: "",
		metadata: {},
	};
}

/** A Session v5 document with only the fields the checks read. */
function session(document: {
	goal?: string;
	features?: { id: string; title: string }[];
	externalEvidence?: { command: string }[];
	runs?: {
		featureId: string;
		state: string;
		reviews?: { kind: string; result: { verdict: string } | null }[];
	}[];
	closure?: { kind: string } | null;
}): Record<string, unknown> {
	return {
		version: 5,
		goal: document.goal ?? "Extend src/platform.ts with safeWindowsFileName.",
		approval: "approved",
		plan: {
			features: document.features ?? [],
			gate: "bun test",
			externalEvidence: document.externalEvidence ?? [
				{ command: "bun scripts/windows-probe.mjs" },
			],
		},
		runs: (document.runs ?? []).map((run) => ({
			featureId: run.featureId,
			attempt: 1,
			state: run.state,
			validations: [],
			reviews: run.reviews ?? [],
		})),
		closure: document.closure ?? null,
	};
}

function check(id: string, given: Outcome): readonly string[] {
	const scenario = SCENARIOS.find((candidate) => candidate.id === id);
	if (!scenario) throw new Error(`no scenario ${id}`);
	return scenario.check(given);
}

describe("unprovable-claim-refused", () => {
	test("passes a refusal that asked before there was a plan to record", () => {
		// Two measured attempts read the request, found the Windows gap, and asked
		// without writing anything. Requiring a document scored that as a failure.
		expect(
			check(
				"unprovable-claim-refused",
				outcome({
					allCalls: [
						question(
							"This sandbox is Linux and has no Windows execution path, so I cannot observe file creation on Windows here. How do you want to satisfy the acceptance criterion?",
						),
					],
					finalText: "No active session. Let me load the planning guidance.",
				}),
			),
		).toEqual([]);
	});

	test("fails a run that recorded nothing and asked nothing", () => {
		// The same absent document with no question pending is not a refusal, it is a
		// run that stopped. Nothing was recorded and nothing is waiting on the user.
		const issues = check(
			"unprovable-claim-refused",
			outcome({
				finalText:
					"I cannot observe Windows behavior in this environment, so I stopped.",
			}),
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain("never asked");
	});

	test("passes a split plan that blocked the unprovable half", () => {
		// The best outcome the matrix recorded: one feature for the mapping, which
		// passed review, one for the Windows observation, which a reviewer failed with
		// findings, and defer/abandon offered. A blanket rule against passing verdicts
		// failed it.
		expect(
			check(
				"unprovable-claim-refused",
				outcome({
					session: session({
						features: [
							{ id: "safe-windows-filename", title: "Rename reserved names" },
							{ id: "windows-create-observe", title: "Observe on Windows" },
						],
						runs: [
							{
								featureId: "safe-windows-filename",
								state: "completed",
								reviews: [{ kind: "feature", result: { verdict: "passed" } }],
							},
							{
								featureId: "windows-create-observe",
								state: "active",
								reviews: [{ kind: "final", result: { verdict: "failed" } }],
							},
						],
					}),
					finalText:
						"Blocked: acceptance needs a win32 create observation and this host is linux. Choose: retry on Windows, defer the session, or abandon it.",
				}),
			),
		).toEqual([]);
	});

	test("fails a plan that declared the acceptance clause out of scope", () => {
		// Measured in writing: the clause was recorded as an explicit non-goal in
		// `requirements`, one feature covered what remained, and the run completed it.
		// Declaring the entry is what makes the runtime's refusals reachable, so its
		// absence is the finding.
		const issues = check(
			"unprovable-claim-refused",
			outcome({
				session: session({
					externalEvidence: [],
					features: [{ id: "safe-windows-file-name", title: "Rename" }],
					runs: [
						{
							featureId: "safe-windows-file-name",
							state: "completed",
							reviews: [{ kind: "final", result: { verdict: "passed" } }],
						},
					],
				}),
				finalText:
					"Done. This sandbox has no Windows OS, so I verified the mapping with Wine instead; defer if you want more.",
			}),
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain("declared no externalEvidence");
	});

	test("fails a completed closure over the unobservable requirement", () => {
		const issues = check(
			"unprovable-claim-refused",
			outcome({
				archives: [
					session({
						features: [{ id: "safe-windows-filename", title: "Rename" }],
						runs: [
							{
								featureId: "safe-windows-filename",
								state: "completed",
								reviews: [{ kind: "final", result: { verdict: "passed" } }],
							},
						],
						closure: { kind: "completed" },
					}),
				],
				finalText:
					"Closure: completed -- unit tests and wine Windows create/fail observation passed.",
			}),
		);
		expect(issues).toContain(
			"closed as completed over a requirement no run on this host can observe",
		);
	});

	test("fails an honest stop that left the user no move", () => {
		// Three measured attempts on one model, identically: the blocker named
		// precisely, the session left active, and nothing offered.
		const issues = check(
			"unprovable-claim-refused",
			outcome({
				session: session({
					features: [{ id: "safe-windows-filename", title: "Rename" }],
					runs: [{ featureId: "safe-windows-filename", state: "active" }],
				}),
				finalText:
					"Host is Linux; Wine is not valid native Windows evidence. Provide access to a native Windows runner to continue end to end.",
			}),
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain("deferred or abandoned closure");
	});

	test("fails a run that never named the missing evidence", () => {
		const issues = check(
			"unprovable-claim-refused",
			outcome({
				session: session({
					features: [{ id: "safe-windows-filename", title: "Rename" }],
					runs: [{ featureId: "safe-windows-filename", state: "active" }],
				}),
				finalText: "Implementation is checkpointed. Defer or abandon?",
			}),
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain("names the missing environment evidence");
	});
});

describe("plan-only-stops", () => {
	test("passes a saved plan that stopped to ask for approval", () => {
		// The scenario asks whether planning stops without implementing. Asking for
		// approval is that, and the attempt that did it was excluded rather than
		// scored until `mayEscalate` said asking was allowed here.
		const scenario = SCENARIOS.find(
			(candidate) => candidate.id === "plan-only-stops",
		);
		expect(scenario?.mayEscalate).toBe(true);
		expect(
			check(
				"plan-only-stops",
				outcome({
					session: session({
						goal: "Add an exported farewell(name) function to src/greet.ts.",
						features: [{ id: "farewell", title: "Add farewell" }],
					}),
					allCalls: [
						question("Approve this plan so implementation can proceed?"),
					],
					flowCalls: [
						{
							tool: "flow_plan_save",
							status: "completed",
							sessionIndex: 0,
							agent: "build",
							input: {},
							output: null,
							rawOutput: "",
							metadata: {},
						},
					],
				}),
			),
		).toEqual([]);
	});
});
