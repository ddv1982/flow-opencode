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
import { reviewerOutcome } from "../evals/reviewer-run.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import {
	flowFeatureComplete,
	flowSessionClose,
} from "../src/infrastructure/fs/workspace-flow-service.js";

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
							summary: "Wrong result",
							evidence: "src/value.ts",
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

	test("seeds and reads a real durable Flow review assignment", async () => {
		const fixture = REVIEWER_CASES[1];
		if (!fixture) throw new Error("Expected clean reviewer case.");
		const workspace = await gitFixture(fixture.files);
		try {
			const seed = await seedReviewerAssignment({ workspace, fixture });
			const before = await createFileSessionRepository(workspace).read();
			expect(durableReviewerSubmission({ session: before, seed })).toEqual({
				kind: "unsubmitted",
			});
			if (!before) throw new Error("Expected seeded Flow state.");
			const response = await flowFeatureComplete(workspace, {
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
			const closed = await flowSessionClose(workspace, {
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
