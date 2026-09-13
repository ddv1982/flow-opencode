import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	durableReviewerSubmission,
	readDurableReviewerSubmission,
	seedReviewerAssignment,
} from "../evals/reviewer-assignment.js";
import { REVIEWER_CASES } from "../evals/reviewer-cases.js";
import { reportReviewerActor, reviewerOutcome } from "../evals/reviewer-run.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import { createWorkspaceFlowService } from "../src/infrastructure/fs/workspace-flow-service.js";

async function gitFixture(
	files: Readonly<Record<string, string>>,
): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), "flow-reviewer-test-"));
	for (const [relativePath, contents] of Object.entries(files)) {
		const path = join(workspace, relativePath);
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, contents, "utf8");
	}
	for (const command of [
		["git", "init", "--initial-branch=main"],
		["git", "config", "user.email", "eval@example.com"],
		["git", "config", "user.name", "Flow Eval"],
		["git", "add", "-A"],
		["git", "commit", "-m", "fixture"],
	]) {
		const process = Bun.spawn(command, {
			cwd: workspace,
			stdout: "ignore",
			stderr: "pipe",
		});
		if ((await process.exited) !== 0) {
			throw new Error(await new Response(process.stderr).text());
		}
	}
	return workspace;
}

describe("reviewer pilot adapters", () => {
	test("scores only durable submissions and preserves command endings", () => {
		const defect = REVIEWER_CASES[0];
		const clean = REVIEWER_CASES[1];
		if (!defect || !clean) throw new Error("Expected fixed reviewer cases.");
		expect(
			reviewerOutcome(
				defect,
				{
					kind: "submitted",
					verdict: "failed",
					findings: [
						{
							severity: "blocking",
							summary: "Wrong result for input 7",
							evidence: "src/value.ts:2 value(7) returns 6 instead of 8.",
						},
					],
				},
				"quiet",
			),
		).toMatchObject({ kind: "product", passed: true, endedBy: "quiet" });
		expect(
			reviewerOutcome(
				clean,
				{
					kind: "submitted",
					verdict: "failed",
					findings: [
						{
							severity: "blocking",
							summary: "False alarm",
							evidence: "src/value.ts",
						},
					],
				},
				"quiet",
			),
		).toMatchObject({ kind: "product", passed: false });
		expect(
			reviewerOutcome(clean, { kind: "unsubmitted" }, "escalated"),
		).toMatchObject({
			kind: "product",
			passed: false,
			endedBy: "user-escalation",
			evidence: { submitted: false, verdict: null },
		});
	});

	test.each([
		{ summary: "Missing API documentation", evidence: "src/value.ts:1" },
		{ summary: "Wrong result", evidence: "src/value.ts" },
		{
			summary: "Seven maps to six, although its successor is eight.",
			evidence: "src/value.ts:2",
		},
		{
			summary: "Wrong result for input 17",
			evidence: "src/value.ts:2 returns 6 instead of 8.",
		},
		{
			summary: "Wrong result for input 7",
			evidence: "src/other.ts:2 returns 6 instead of 8.",
		},
		{
			summary: "value(7) does not return 6, expected 8",
			evidence: "src/value.ts:2",
		},
		{
			summary: "value(7) never returns 6, expected 8.",
			evidence: "src/value.ts:2",
		},
		{
			summary: "value(7) cannot return 6, expected 8.",
			evidence: "src/value.ts:2",
		},
		{
			summary: "The branch is not wrong.",
			evidence: "src/value.ts:2 return input === 7 ? input - 1 : input + 1;",
		},
		{
			summary: "The branch isn't wrong.",
			evidence: "src/value.ts:2 return input === 7 ? input - 1 : input + 1;",
		},
		{
			summary: "value(7) returns 6, expected 8.",
			evidence: "src/value.ts:2 value(7) never returns 6.",
		},
		{
			summary: "value(7) might return 6, expected 8.",
			evidence: "src/value.ts:2",
		},
		{
			summary: "The branch could be wrong.",
			evidence: "src/value.ts:2 return input === 7 ? input - 1 : input + 1;",
		},
		{
			summary: "value(7) returns 6, expected 8.",
			evidence: "src/value.ts:2 value(7) returns 8.",
		},
		{
			summary: "value(7) returns 6, expected 8?",
			evidence: "src/value.ts:2",
		},
		{
			summary: "Missing API documentation",
			evidence: "src/value.ts:2 return input === 7 ? input - 1 : input + 1;",
		},
		{
			summary: "Wrong result for input 7.5",
			evidence: "src/value.ts:2 returns 6 instead of 8.",
		},
		{
			summary: "Wrong result for input 7",
			evidence: "src/value.ts:2 returns 6.5 instead of 8.",
		},
		{
			summary: "Wrong result for input 7",
			evidence: "src/value.ts.backup:2 returns 6 instead of 8.",
		},
	])(
		"rejects unrelated or unsupported findings without detection credit %#",
		(finding) => {
			const fixture = REVIEWER_CASES[0];
			if (!fixture) throw new Error("Expected defect reviewer case.");
			expect(
				reviewerOutcome(
					fixture,
					{
						kind: "submitted",
						verdict: "failed",
						findings: [
							{
								...finding,
								severity: "blocking",
								findingId: "review-target.R1-01",
							},
						],
					},
					"quiet",
				),
			).toMatchObject({
				kind: "product",
				passed: false,
				evidence: {
					assessment: {
						matchedDefectIds: [],
						falseFindingIds: [],
						unassessedFindingIds: ["review-target.R1-01"],
						labelSource: "synthetic",
					},
				},
			});
		},
	);

	test("retains complete finding details and counts extra findings separately", () => {
		const fixture = REVIEWER_CASES[0];
		if (!fixture) throw new Error("Expected defect reviewer case.");
		const found = {
			findingId: "review-target.R1-01",
			severity: "blocking" as const,
			summary: "The special branch gives the wrong result.",
			evidence: `${"Retained context. ".repeat(300)}src/value.ts:2 value(7) returns 6, expected 8.`,
			scopeBlocker: false,
		};
		const unrelated = {
			findingId: "review-target.R1-02",
			severity: "advisory" as const,
			summary: "Rename the function.",
			evidence: "src/value.ts:1",
		};
		expect(
			reviewerOutcome(
				fixture,
				{ kind: "submitted", verdict: "failed", findings: [found] },
				"quiet",
			),
		).toMatchObject({
			kind: "product",
			passed: true,
			evidence: {
				findingDetails: [found],
				assessment: {
					matchedDefectIds: ["value-seven-decrements"],
					falseFindingIds: [],
					unassessedFindingIds: [],
				},
			},
		});
		expect(
			reviewerOutcome(
				fixture,
				{ kind: "submitted", verdict: "failed", findings: [found, unrelated] },
				"quiet",
			),
		).toMatchObject({
			kind: "product",
			passed: false,
			evidence: {
				findingDetails: [found, unrelated],
				assessment: {
					matchedDefectIds: ["value-seven-decrements"],
					falseFindingIds: [],
					unassessedFindingIds: [unrelated.findingId],
				},
			},
		});
	});

	test.each([
		{
			summary: "The special case decrements the input.",
			evidence: "src/value.ts:2 return input === 7 ? input - 1 : input + 1;",
		},
		{
			summary: "Wrong result for input 7.",
			evidence: "src/value.ts:2 returns 6 rather than the required 8.",
		},
		{
			summary: "Wrong result for input 7. It does not return 8.",
			evidence: "src/value.ts:2 returns 6 rather than the required 8.",
		},
	])("accepts specific source and numeric defect witnesses %#", (finding) => {
		const fixture = REVIEWER_CASES[0];
		if (!fixture) throw new Error("Expected defect reviewer case.");
		expect(
			reviewerOutcome(
				fixture,
				{
					kind: "submitted",
					verdict: "failed",
					findings: [{ ...finding, severity: "blocking" }],
				},
				"quiet",
			),
		).toMatchObject({
			kind: "product",
			passed: true,
			evidence: {
				assessment: {
					matchedDefectIds: ["value-seven-decrements"],
					falseFindingIds: [],
					unassessedFindingIds: [],
				},
			},
		});
	});

	test("counts clean-case advisory findings even with a passed verdict", () => {
		const fixture = REVIEWER_CASES[1];
		if (!fixture) throw new Error("Expected clean reviewer case.");
		expect(
			reviewerOutcome(
				fixture,
				{
					kind: "submitted",
					verdict: "passed",
					findings: [
						{
							severity: "advisory",
							summary: "Suspicious arithmetic.",
							evidence: "src/value.ts:2",
						},
					],
				},
				"quiet",
			),
		).toMatchObject({
			kind: "product",
			passed: false,
			evidence: {
				assessment: {
					matchedDefectIds: [],
					falseFindingIds: ["unidentified-finding-1"],
					unassessedFindingIds: [],
				},
			},
		});
	});

	test("a failed verdict without a finding does not identify the planted defect", () => {
		const fixture = REVIEWER_CASES[0];
		if (!fixture) throw new Error("Expected defect reviewer case.");
		expect(
			reviewerOutcome(
				fixture,
				{ kind: "submitted", verdict: "failed", findings: [] },
				"quiet",
			),
		).toMatchObject({ kind: "product", passed: false });
	});

	test("retains partial host observation without claiming a complete model identity", () => {
		const model = {
			routeProvider: "openai",
			gateway: null,
			family: "gpt",
			model: "reviewer",
			revision: null,
		};
		expect(
			reportReviewerActor(model, {
				actors: [
					{
						role: "reviewer",
						sessionIds: ["review-1"],
						actualModel: {
							kind: "observed",
							value: { providerID: "openai", modelID: "reviewer" },
						},
						actualVariant: { kind: "observed", value: "high" },
					},
				],
			}),
		).toMatchObject({
			requestedModel: model,
			actualModel: { kind: "unobserved" },
			hostObservation: {
				model: {
					kind: "observed",
					value: { providerID: "openai", modelID: "reviewer" },
				},
				variant: { kind: "observed", value: "high" },
			},
		});
	});

	test("seeds and reads a real durable Flow review assignment", async () => {
		const fixture = REVIEWER_CASES[1];
		if (!fixture) throw new Error("Expected clean reviewer case.");
		const workspace = await gitFixture(fixture.files);
		const flow = createWorkspaceFlowService(workspace);
		try {
			const seed = await seedReviewerAssignment({ workspace, fixture });
			const before = await createFileSessionRepository(workspace).read();
			expect(durableReviewerSubmission({ session: before, seed })).toEqual({
				kind: "unsubmitted",
			});
			if (!before) throw new Error("Expected seeded Flow state.");
			const response = await flow.featureComplete({
				request: {
					operationId: "review-submit-test",
					expectedRevision: before.revision,
					featureId: seed.featureId,
					assignmentId: seed.assignmentId,
					summary: "Requirement verified.",
					result: {
						verdict: "passed",
						findings: [],
						terminalDisposition: "submitted",
					},
				},
			});
			expect(response.status).toBe("ok");
			const completed = await createFileSessionRepository(workspace).read();
			if (!completed) throw new Error("Expected completed Flow state.");
			const closed = await flow.sessionClose({
				request: {
					operationId: "review-close-test",
					expectedRevision: completed.revision,
					sessionId: completed.id,
					kind: "completed",
					summary: "Reviewer pilot fixture completed.",
				},
			});
			expect(closed.status).toBe("ok");
			expect(await createFileSessionRepository(workspace).read()).toBeNull();
			expect(await readDurableReviewerSubmission({ workspace, seed })).toEqual({
				kind: "submitted",
				verdict: "passed",
				findings: [],
			});
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("seeds the planted defect only after its declared test passes", async () => {
		const fixture = REVIEWER_CASES[0];
		if (!fixture) throw new Error("Expected defect reviewer case.");
		const workspace = await gitFixture(fixture.files);
		try {
			const seed = await seedReviewerAssignment({ workspace, fixture });
			expect(await readDurableReviewerSubmission({ workspace, seed })).toEqual({
				kind: "unsubmitted",
			});
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
});
