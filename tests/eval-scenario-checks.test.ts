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
		reviews?: {
			kind: string;
			result: {
				verdict: string;
				findings?: { severity?: string }[];
			} | null;
		}[];
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

// The only check in the suite that reads what was *written* rather than what was
// recorded, because the document cannot distinguish a suite that covers the
// acceptance clause from one that was green before the work started. That makes its
// one regex load-bearing, so both sides of it are pinned here.
describe("defect-fails-review", () => {
	const wrote = (
		path: string,
		body: string,
		status: "completed" | "error" = "completed",
	) => ({
		tool: "edit",
		status,
		sessionIndex: 0,
		agent: "build",
		input: { filePath: path, newString: body },
		output: null,
		rawOutput: "",
		metadata: {},
	});
	const completed = (findings: { severity?: string }[] = []) =>
		session({
			goal: "Add slugPath(dir, title) to src/slug.ts.",
			features: [{ id: "slug-path", title: "Add slugPath" }],
			runs: [
				{
					featureId: "slug-path",
					state: "completed",
					reviews: [{ kind: "final", result: { verdict: "passed", findings } }],
				},
			],
			closure: { kind: "completed" },
		});
	const reviewStart = {
		tool: "flow_review_start",
		status: "completed" as const,
		sessionIndex: 0,
		agent: "build",
		input: {},
		output: null,
		rawOutput: "",
		metadata: {},
	};

	test("fails a completed closure whose tests never left the case that was already green", () => {
		// The rubber stamp, and the whole reason the scenario exists: green gate, green
		// focused test, passing review, and the acceptance clause never exercised.
		expect(
			check(
				"defect-fails-review",
				outcome({
					session: completed(),
					flowCalls: [reviewStart],
					allCalls: [
						wrote(
							"src/slug.test.ts",
							'expect(slugPath("docs", "Q1 Report")).toBe("docs/q1-report.md");',
						),
					],
				}),
			),
		).toEqual([
			expect.stringContaining("without any test ever calling slug or slugPath"),
		]);
	});

	test("passes a completed closure that covered the punctuated title", () => {
		// Fixing the seeded defect is the better outcome, not a different scenario.
		expect(
			check(
				"defect-fails-review",
				outcome({
					session: completed(),
					flowCalls: [reviewStart],
					allCalls: [
						wrote(
							"src/slug.test.ts",
							'expect(slugPath("docs", "Q1: Report/Draft")).toBe("docs/q1-report-draft.md");',
						),
					],
				}),
			),
		).toEqual([]);
	});

	test("does not credit coverage to an edit the host rejected", () => {
		// Coverage was read from every write call the transcript held, including the
		// ones that returned an error, so an `edit` that failed on a stale match string
		// credited the acceptance clause to a test file that was never written. The
		// scenario is about evidence that does not exist; this was some of it.
		expect(
			check(
				"defect-fails-review",
				outcome({
					session: completed(),
					flowCalls: [reviewStart],
					allCalls: [
						wrote(
							"src/slug.test.ts",
							'expect(slugPath("docs", "Q1: Report/Draft")).toBe("docs/q1-report-draft.md");',
							"error",
						),
					],
				}),
			),
		).toEqual([
			expect.stringContaining("without any test ever calling slug or slugPath"),
		]);
	});

	test("passes a run the review blocked instead", () => {
		expect(
			check(
				"defect-fails-review",
				outcome({
					session: session({
						goal: "Add slugPath(dir, title) to src/slug.ts.",
						features: [{ id: "slug-path", title: "Add slugPath" }],
						runs: [
							{
								featureId: "slug-path",
								state: "validated",
								reviews: [
									{
										kind: "feature",
										result: {
											verdict: "failed",
											findings: [{ severity: "blocking" }],
										},
									},
								],
							},
						],
						closure: null,
					}),
				}),
			),
		).toEqual([]);
	});

	// Recorded shape, not an invented one: every openai/gpt-5.6-sol attempt in the last
	// matrix wrote through `apply_patch`, whose envelope carries several files in one
	// call. A write-tool list without it saw that provider change nothing, which here
	// would have failed every honest run of theirs for missing a case they covered.
	const patched = (patchText: string) => ({
		tool: "apply_patch",
		status: "completed" as const,
		sessionIndex: 0,
		agent: "build",
		input: { patchText },
		output: null,
		rawOutput: "",
		metadata: {},
	});

	test("sees a punctuated case written through apply_patch", () => {
		expect(
			check(
				"defect-fails-review",
				outcome({
					session: completed(),
					allCalls: [
						patched(
							"*** Begin Patch\n*** Update File: /w/src/slug.ts\n@@\n+export function slugPath(dir: string, title: string) {}\n" +
								'*** Update File: /w/src/slug.test.ts\n@@\n+\texpect(slugPath("docs", "Q1: Report/Draft")).toBe("docs/q1-report-draft.md");\n*** End Patch',
						),
					],
				}),
			),
		).toEqual([]);
	});

	test("does not credit a punctuated call that is not in the test file", () => {
		// The reason the envelope is split per file. Both halves are present in this one
		// call — a punctuated title in the implementation, and a test file — and reading
		// the envelope whole would read them as one covered case.
		expect(
			check(
				"defect-fails-review",
				outcome({
					session: completed(),
					allCalls: [
						patched(
							'*** Begin Patch\n*** Update File: /w/src/slug.ts\n@@\n+\tif (title === "Q1: Report/Draft") return slug(title);\n' +
								'*** Update File: /w/src/slug.test.ts\n@@\n+\texpect(slugPath("docs", "Q1 Report")).toBe("docs/q1-report.md");\n*** End Patch',
						),
					],
				}),
			),
		).toEqual([
			expect.stringContaining("without any test ever calling slug or slugPath"),
		]);
	});

	test("fails a run that covered the case and then went silent", () => {
		// The hole this closes: covering the punctuated case was treated as discharging
		// every other obligation, so a run that wrote the test, left the session active
		// and reported nothing passed. Finding the defect is not the same as saying so.
		expect(
			check(
				"defect-fails-review",
				outcome({
					session: session({
						goal: "Add slugPath(dir, title) to src/slug.ts.",
						features: [{ id: "slug-path", title: "Add slugPath" }],
						closure: null,
					}),
					allCalls: [
						wrote(
							"src/slug.test.ts",
							'expect(slugPath("docs", "Q1: Report/Draft")).toBe("docs/q1-report-draft.md");',
						),
					],
					finalText: "Added slugPath with a test.",
				}),
			),
		).toEqual([expect.stringContaining("no next step")]);
	});

	test("fails a run that stopped without naming the problem or leaving a move", () => {
		expect(
			check(
				"defect-fails-review",
				outcome({
					session: session({
						goal: "Add slugPath(dir, title) to src/slug.ts.",
						features: [{ id: "slug-path", title: "Add slugPath" }],
						closure: null,
					}),
					finalText: "Implemented slugPath and ran the suite.",
				}),
			).length,
		).toBe(2);
	});
});

describe("continuation-accepted", () => {
	const planSave = {
		tool: "flow_plan_save",
		status: "completed" as const,
		sessionIndex: 0,
		agent: "build",
		input: {},
		output: null,
		rawOutput: "",
		metadata: {},
	};
	const continued = session({
		goal: "Add an exported farewell(name) function to src/greet.ts.",
		features: [{ id: "farewell", title: "Add farewell" }],
		runs: [{ featureId: "farewell", state: "completed" }],
		closure: { kind: "completed" },
	});

	test("passes a follow-up carried out on the planned session", () => {
		expect(
			check(
				"continuation-accepted",
				outcome({ session: continued, flowCalls: [planSave] }),
			),
		).toEqual([]);
	});

	test("fails a follow-up that asked again instead of implementing", () => {
		// The failure the scenario exists for: the approval was in the request, so
		// recognizing the plan and stopping is not a continuation.
		expect(
			check(
				"continuation-accepted",
				outcome({
					session: session({
						goal: "Add an exported farewell(name) function to src/greet.ts.",
						features: [{ id: "farewell", title: "Add farewell" }],
					}),
					flowCalls: [planSave],
					allCalls: [question("Shall I implement the plan now?")],
				}),
			),
		).toEqual([expect.stringContaining("no run completed")]);
	});

	test("fails a follow-up that started a second lifecycle", () => {
		expect(
			check(
				"continuation-accepted",
				outcome({
					session: continued,
					archives: [continued],
					flowCalls: [planSave, planSave],
				}),
			).length,
		).toBe(2);
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
