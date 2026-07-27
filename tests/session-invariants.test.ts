import { describe, expect, test } from "bun:test";
import { SessionSchema } from "../src/application/schema.js";
import { MAX_REVIEW_FINDINGS } from "../src/domain/limits.js";
import type { Session } from "../src/domain/session.js";
import { sessionInvariantIssues } from "../src/domain/session-invariants.js";
import {
	approveSession,
	deterministicEnvironment,
	expectOk,
	FEATURE,
	MemorySessionRepository,
	resetFeatureRun,
	startFeatureRun,
	startReviewedRun,
	submitReview,
} from "./runtime-test-support.js";

// `sessionInvariantIssues` had no direct coverage, which is the wrong way round:
// every other check in the repository asks whether a transition behaves, and this
// one is the only thing standing between a corrupt `.flow/session.json` and a
// runtime that trusts it. Nothing here can be reached by calling transitions,
// because a transition that produced any of these states would itself be the bug.
//
// So each test builds a genuine document through the real application boundary and
// then forges one field, which also makes the baseline load-bearing: if a real
// session ever reports an issue, every forgery below stops proving anything.

type Writable<T> = T extends readonly (infer Item)[]
	? Writable<Item>[]
	: T extends object
		? { -readonly [Key in keyof T]: Writable<T[Key]> }
		: T;

function forge(
	session: Session,
	corrupt: (draft: Writable<Session>) => void,
): Session {
	const draft = structuredClone(session) as Writable<Session>;
	corrupt(draft);
	return draft as Session;
}

/** A one-feature session carried to a passing final review. */
async function reviewedSession(): Promise<Session> {
	const repository = new MemorySessionRepository();
	const flow = await approveSession(repository, deterministicEnvironment());
	await startReviewedRun(flow, repository, { suffix: "kernel" });
	await submitReview(flow, repository, {
		suffix: "kernel",
		summary: "The kernel is implemented and verified.",
		verdict: "passed",
	});
	if (!repository.session) throw new Error("Expected an active session.");
	return repository.session;
}

/** The same session closed as `completed`, so closure rules have a subject. */
async function closedSession(): Promise<Session> {
	const repository = new MemorySessionRepository();
	const flow = await approveSession(repository, deterministicEnvironment());
	await startReviewedRun(flow, repository, { suffix: "kernel" });
	await submitReview(flow, repository, {
		suffix: "kernel",
		summary: "The kernel is implemented and verified.",
		verdict: "passed",
	});
	const sessionId = repository.session?.id ?? "";
	expectOk(
		await flow.sessionClose({
			request: {
				operationId: "close-kernel",
				expectedRevision: repository.session?.revision ?? 0,
				sessionId,
				kind: "completed" as const,
				summary: "Every feature is complete.",
			},
		}),
	);
	const archived = repository.archives.get(sessionId);
	if (!archived) throw new Error("Expected an archived session.");
	return archived;
}

describe("durable session invariants", () => {
	test("accepts documents the transitions actually produced", async () => {
		expect(sessionInvariantIssues(await reviewedSession())).toEqual([]);
		expect(sessionInvariantIssues(await closedSession())).toEqual([]);
	});

	test("rejects a document from another schema version", async () => {
		const session = await reviewedSession();
		// Checked before anything else, because a v4 document is not a broken v5 one
		// and reporting it as twelve violated v5 rules would say the wrong thing.
		expect(
			sessionInvariantIssues(
				forge(session, (draft) => {
					draft.version = 4 as typeof draft.version;
				}),
			),
		).toEqual(["Session version must be 5."]);
	});

	test("rejects a ledger that outran the state it records", async () => {
		const session = await reviewedSession();
		const issues = sessionInvariantIssues(
			forge(session, (draft) => {
				const operation = draft.operations[0];
				if (!operation) throw new Error("Expected a recorded operation.");
				draft.operations.push({ ...operation });
				operation.committedRevision = draft.revision + 1;
			}),
		);
		// A duplicate id makes two operations indistinguishable, so the next replay of
		// either one matches the wrong record.
		expect(issues).toContain(
			`Duplicate operation id '${session.operations[0]?.id}'.`,
		);
		expect(issues).toContain(
			`Operation '${session.operations[0]?.id}' has an invalid revision.`,
		);
	});

	test("rejects runs stored out of their durable start order", async () => {
		const repository = new MemorySessionRepository();
		const flow = await approveSession(repository, deterministicEnvironment());
		await startReviewedRun(flow, repository, { suffix: "first" });
		await submitReview(flow, repository, {
			suffix: "first",
			summary: "First attempt failed review.",
			verdict: "failed",
			findings: [
				{
					severity: "blocking",
					summary: "The kernel drops a revision.",
					evidence: "tests/session-invariants.test.ts",
				},
			],
		});
		// A reset supersedes the failed attempt; the retry is a second run, and the
		// two are told apart only by where they sit in the array.
		await resetFeatureRun(flow, repository, FEATURE, "second");
		await startFeatureRun(flow, repository, FEATURE, "second");
		if (!repository.session) throw new Error("Expected an active session.");
		const session = repository.session;
		expect(session.runs.length).toBe(2);
		expect(sessionInvariantIssues(session)).toEqual([]);

		// Order is the retry lineage. Reversed, the array no longer says which attempt
		// superseded which, and every reader that takes the last run reads the first.
		expect(
			sessionInvariantIssues(
				forge(session, (draft) => {
					draft.runs.reverse();
				}),
			),
		).toContain("Runs must remain in their durable start order.");
	});

	test("rejects evidence that predates the run it vouches for", async () => {
		const session = await reviewedSession();
		const issues = sessionInvariantIssues(
			forge(session, (draft) => {
				const validation = draft.runs[0]?.validations[0];
				if (!validation) throw new Error("Expected a recorded validation.");
				validation.recordedRevision = draft.runs[0]?.startedRevision ?? 0;
			}),
		);
		// A validation recorded before its run started describes a workspace that run
		// had not touched, which is how stale evidence discharges fresh work.
		expect(issues).toContain(
			`Validation '${session.runs[0]?.validations[0]?.id}' predates its run.`,
		);
	});

	test("rejects a final review with no broad validation", async () => {
		const session = await reviewedSession();
		// ADR 0009 read from the document side: `completed` closure rests on a final
		// review, so a hand-edited document must not be able to relabel the evidence
		// that review cited down to a single feature's own tests.
		expect(
			sessionInvariantIssues(
				forge(session, (draft) => {
					const validation = draft.runs[0]?.validations[0];
					if (!validation) throw new Error("Expected a recorded validation.");
					validation.scope = "focused";
				}),
			),
		).toContain(
			`Final review '${session.runs[0]?.reviews[0]?.id}' lacks broad validation.`,
		);
	});

	test("rejects a run state its reviews do not support", async () => {
		const session = await reviewedSession();
		// `state` is a stored field, and closure, retry eligibility and the projection
		// all trust it. These four rules are the only place it is checked against the
		// review that was supposed to have produced it.
		const runId = session.runs[0]?.id;
		expect(
			sessionInvariantIssues(
				forge(session, (draft) => {
					const run = draft.runs[0];
					if (!run) throw new Error("Expected a run.");
					run.state = "blocked";
				}),
			),
		).toEqual([`Blocked run '${runId}' lacks a failed review.`]);
		expect(
			sessionInvariantIssues(
				forge(session, (draft) => {
					const run = draft.runs[0];
					if (!run) throw new Error("Expected a run.");
					run.state = "superseded";
				}),
			),
		).toEqual([`Superseded run '${runId}' cannot retain a passing review.`]);
	});

	test("reports the plan's own rules through the shared primitive", async () => {
		const session = await reviewedSession();
		// The plan rules live in `planIssue`, which `savePlan` throws and this
		// collects. Both must read the same primitive, or a plan `savePlan` would
		// refuse becomes loadable by writing it to disk directly.
		expect(
			sessionInvariantIssues(
				forge(session, (draft) => {
					const feature = draft.plan?.features[0];
					if (!feature || !draft.plan) throw new Error("Expected a feature.");
					draft.plan.features.push({ ...feature });
				}),
			),
		).toContain(`Duplicate feature id '${FEATURE}'.`);
	});

	test("reports one review-result issue, as the transition would have", async () => {
		const session = await reviewedSession();
		const issues = sessionInvariantIssues(
			forge(session, (draft) => {
				const result = draft.runs[0]?.reviews[0]?.result;
				if (!result) throw new Error("Expected a review result.");
				result.findings = Array.from(
					{ length: MAX_REVIEW_FINDINGS + 1 },
					(_unused, index) => ({
						severity: "blocking" as const,
						summary: `Finding ${index}.`,
						evidence: "src/domain/session-invariants.ts",
					}),
				);
			}),
		);
		// The forgery breaks two rules at once, and only the first is reported --
		// matching `completeFeature`, which throws on the first and never reaches the
		// second. A passed review holding blocking findings is the rule not reported.
		expect(issues).toEqual([
			`A review may contain at most ${MAX_REVIEW_FINDINGS} findings.`,
		]);
	});

	test("rejects a completed closure over incomplete work", async () => {
		const session = await closedSession();
		expect(
			sessionInvariantIssues(
				forge(session, (draft) => {
					const run = draft.runs[0];
					if (!run?.reviews[0]?.result) {
						throw new Error("Expected a reviewed run.");
					}
					// Forged consistent on its own terms -- a blocked run holding a failed
					// review with a blocking finding breaks no other rule. Only the closure
					// is left contradicting it, which is the point: `completed` is the one
					// closure that asserts something about work it does not itself contain.
					run.state = "blocked";
					run.reviews[0].result.verdict = "failed";
					run.reviews[0].result.findings = [
						{
							severity: "blocking",
							summary: "The kernel drops a revision.",
							evidence: "tests/session-invariants.test.ts",
						},
					];
				}),
			),
		).toEqual(["A completed closure requires every feature to be complete."]);
	});

	test("refuses to load a forged document at all", async () => {
		const session = await reviewedSession();
		// The reason any of this runs: `SessionSchema` is the only door into the
		// runtime, and it reports invariant failures as schema issues rather than
		// repairing them.
		const parsed = SessionSchema.safeParse(
			forge(session, (draft) => {
				const run = draft.runs[0];
				if (!run) throw new Error("Expected a run.");
				run.state = "blocked";
			}),
		);
		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
			`Blocked run '${session.runs[0]?.id}' lacks a failed review.`,
		);
	});
});
