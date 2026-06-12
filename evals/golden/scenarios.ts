// Golden-transcript eval scenarios for the Flow driving loop.
//
// Each scenario drives `opencode run` headless against a fixture workspace and
// asserts observable outcomes from the persisted `.flow/**` state — never from
// transcript text. Sessions are parsed with the runtime's own zod schema
// (src/runtime/schema.ts) so assertions stay type-safe against schema v1.

import type { Session } from "../../src/runtime/schema";

export type SessionLocation = "active" | "stored" | "completed";

export type SessionRecord = {
	dirName: string;
	location: SessionLocation;
	session: Session;
};

export type FlowStateSnapshot = {
	workspace: string;
	active: SessionRecord[];
	stored: SessionRecord[];
	completed: SessionRecord[];
};

export type GoldenScenario = {
	name: string;
	fixture: string;
	summary: string;
	prompt: string;
	timeoutMs?: number;
	assert: (snapshot: FlowStateSnapshot) => void | Promise<void>;
};

export const SEEDED_SESSION_ID = "golden-recovery-session";

export function allSessions(snapshot: FlowStateSnapshot): SessionRecord[] {
	return [...snapshot.active, ...snapshot.stored, ...snapshot.completed];
}

function expect(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function describeSessions(records: SessionRecord[]): string {
	if (records.length === 0) {
		return "none";
	}
	return records
		.map((record) => `${record.location}/${record.session.id}`)
		.join(", ");
}

function theOnlySession(snapshot: FlowStateSnapshot): Session {
	const records = allSessions(snapshot);
	expect(
		records.length === 1,
		`Expected exactly one Flow session in .flow/**, found ${records.length} (${describeSessions(records)}).`,
	);
	const record = records[0];
	expect(record !== undefined, "Expected a session record.");
	return record.session;
}

function parseInstant(value: string, label: string): number {
	const instant = Date.parse(value);
	expect(
		!Number.isNaN(instant),
		`Expected ${label} to be a parseable timestamp, got '${value}'.`,
	);
	return instant;
}

const APPROVAL_PREAMBLE =
	"Load the flow skill and drive this task with the Flow workflow (flow_* tools). " +
	"This run is headless: you have my up-front approval for the plan and every confirmation, so never wait for user input. ";

const CLOSE_INSTRUCTION =
	" Validate with `bun test` and record the validation evidence when completing the feature, then close the Flow session as completed.";

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
	{
		name: "plan-approved-before-run",
		fixture: "hello-lib",
		summary:
			"Plan is persisted and approved before any execution history is recorded.",
		prompt:
			`${APPROVAL_PREAMBLE}Plan the following change as a single Flow feature, save and approve the plan, and only then run it to completion: ` +
			"add an exported `multiply(a, b)` function to src/math.ts with a test in tests/math.test.ts." +
			CLOSE_INSTRUCTION,
		assert: (snapshot) => {
			const session = theOnlySession(snapshot);
			expect(session.plan !== null, "No plan was persisted to session.json.");
			expect(
				session.plan.features.length >= 1,
				"Persisted plan has no features.",
			);
			expect(
				session.approval === "approved",
				`Expected approval 'approved', found '${session.approval}'.`,
			);
			const approvedAt = session.timestamps.approvedAt;
			expect(
				approvedAt !== null,
				"Plan was never approved: timestamps.approvedAt is null.",
			);
			const approvedInstant = parseInstant(approvedAt, "timestamps.approvedAt");
			expect(
				session.execution.history.length >= 1,
				"Expected at least one execution history entry after the approved run.",
			);
			for (const entry of session.execution.history) {
				const recordedInstant = parseInstant(
					entry.recordedAt,
					`history entry for '${entry.featureId}'`,
				);
				expect(
					recordedInstant >= approvedInstant,
					`Execution history entry for '${entry.featureId}' was recorded before plan approval (${entry.recordedAt} < ${approvedAt}).`,
				);
			}
		},
	},
	{
		name: "validation-evidence-before-complete",
		fixture: "hello-lib",
		summary:
			"Every completed feature carries recorded validation evidence in execution history.",
		prompt:
			`${APPROVAL_PREAMBLE}Plan the following change as a single Flow feature, approve the plan, and run it to completion: ` +
			"add an exported `clamp(value, min, max)` function to src/math.ts with a test in tests/math.test.ts." +
			CLOSE_INSTRUCTION,
		assert: (snapshot) => {
			const session = theOnlySession(snapshot);
			expect(session.plan !== null, "No plan was persisted to session.json.");
			const completedFeatures = session.plan.features.filter(
				(feature) => feature.status === "completed",
			);
			expect(
				completedFeatures.length >= 1,
				"No feature reached status 'completed'.",
			);
			for (const feature of completedFeatures) {
				const evidenceEntries = session.execution.history.filter(
					(entry) =>
						entry.featureId === feature.id && entry.validationRun.length > 0,
				);
				expect(
					evidenceEntries.length >= 1,
					`Feature '${feature.id}' is completed but no execution history entry records validation evidence (validationRun) for it.`,
				);
			}
		},
	},
	{
		name: "strict-review-decision-recorded",
		fixture: "hello-lib",
		summary:
			"Under deliveryPolicy.strictReview, a reviewer decision is recorded before completion.",
		prompt:
			`${APPROVAL_PREAMBLE}Plan the following change as a single Flow feature and set deliveryPolicy.strictReview to true when saving the plan. ` +
			"Approve the plan, run the feature to completion, then perform the review lane: record a feature-scope reviewer decision and a final-scope reviewer decision with flow_review_record before closing. The change: " +
			"add an exported `negate(a)` function to src/math.ts with a test in tests/math.test.ts." +
			CLOSE_INSTRUCTION,
		assert: (snapshot) => {
			const session = theOnlySession(snapshot);
			expect(session.plan !== null, "No plan was persisted to session.json.");
			expect(
				session.plan.deliveryPolicy?.strictReview === true,
				"Plan was not saved with deliveryPolicy.strictReview set to true.",
			);
			const historyDecisions = session.execution.history
				.map((entry) => entry.reviewerDecision)
				.filter(
					(decision): decision is NonNullable<typeof decision> =>
						decision !== null && decision !== undefined,
				);
			const lastDecision = session.execution.lastReviewerDecision;
			const decisions =
				lastDecision !== null
					? [...historyDecisions, lastDecision]
					: historyDecisions;
			expect(
				decisions.length >= 1,
				"No reviewer decision was recorded despite the strict review policy.",
			);
			if (session.closure?.kind === "completed") {
				const hasFinalDecision =
					decisions.some((decision) => decision.scope === "final") ||
					session.execution.history.some(
						(entry) =>
							entry.finalReview !== null && entry.finalReview !== undefined,
					);
				expect(
					hasFinalDecision,
					"Session closed as completed without a final-scope reviewer decision under the strict review policy.",
				);
			}
		},
	},
	{
		name: "session-closes-completed",
		fixture: "hello-lib",
		summary:
			"When all features finish, the session lands under .flow/completed/ with closure kind 'completed'.",
		prompt:
			`${APPROVAL_PREAMBLE}Plan the following change as a single Flow feature, approve the plan, and run it to completion: ` +
			"add an exported `square(a)` function to src/math.ts with a test in tests/math.test.ts." +
			CLOSE_INSTRUCTION,
		assert: (snapshot) => {
			expect(
				snapshot.active.length === 0,
				`Expected no active sessions after a clean close, found: ${describeSessions(snapshot.active)}.`,
			);
			expect(
				snapshot.stored.length === 0,
				`Expected no stored (parked) sessions after a clean close, found: ${describeSessions(snapshot.stored)}.`,
			);
			expect(
				snapshot.completed.length === 1,
				`Expected exactly one completed session, found ${snapshot.completed.length} (${describeSessions(snapshot.completed)}).`,
			);
			const record = snapshot.completed[0];
			expect(record !== undefined, "Expected a completed session record.");
			const session = record.session;
			expect(
				session.status === "completed",
				`Expected session status 'completed', found '${session.status}'.`,
			);
			expect(
				session.closure !== null,
				"Completed session has no closure record.",
			);
			expect(
				session.closure.kind === "completed",
				`Expected closure kind 'completed', found '${session.closure.kind}'.`,
			);
			expect(
				session.timestamps.completedAt !== null,
				"Completed session has no completedAt timestamp.",
			);
			expect(session.plan !== null, "Completed session has no plan.");
			const unfinished = session.plan.features.filter(
				(feature) => feature.status !== "completed",
			);
			expect(
				unfinished.length === 0,
				`Session closed as completed with unfinished features: ${unfinished
					.map((feature) => `${feature.id} (${feature.status})`)
					.join(", ")}.`,
			);
		},
	},
	{
		name: "recovery-resumes-seeded-session",
		fixture: "hello-lib-seeded",
		summary:
			"A pre-seeded in-flight session is surfaced via flow_status and resumed instead of duplicated.",
		prompt:
			`${APPROVAL_PREAMBLE}This repository already contains an in-flight Flow session under .flow/. ` +
			"Check flow_status first, resume that existing session, run its remaining feature to completion, and close the session as completed. " +
			"Do not create a new Flow session. Validate with `bun test` and record the validation evidence when completing the feature.",
		assert: (snapshot) => {
			const records = allSessions(snapshot);
			expect(
				records.length === 1,
				`Expected the seeded session to remain the only one, found ${records.length} (${describeSessions(records)}).`,
			);
			const record = records[0];
			expect(record !== undefined, "Expected a session record.");
			expect(
				record.session.id === SEEDED_SESSION_ID,
				`Expected the run to resume seeded session '${SEEDED_SESSION_ID}', found '${record.session.id}'.`,
			);
			const advanced =
				record.session.execution.history.length >= 1 ||
				record.session.status !== "ready";
			expect(
				advanced,
				"Seeded session shows no progress: the run neither advanced nor closed it.",
			);
		},
	},
];
