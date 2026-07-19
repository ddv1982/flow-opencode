import { describe, expect, test } from "bun:test";
import type {
	ValidationReceiptRef,
	ValidationReceiptV1,
} from "../src/domain/validation-receipt.js";
import {
	ValidationCaptureCoordinator,
	ValidationCaptureError,
} from "../src/platform/opencode/validation-capture.js";

const sourceDigest = `sha256:${"a".repeat(64)}` as const;
const receiptRef: ValidationReceiptRef = {
	kind: "validation_receipt_ref_v1",
	digest: `sha256:${"b".repeat(64)}`,
	byteLength: 321,
};

function arm(
	coordinator: ValidationCaptureCoordinator,
	overrides: Partial<Parameters<typeof coordinator.arm>[0]> = {},
) {
	return coordinator.arm({
		sessionID: "session-1",
		worktree: "/worktree",
		featureRunId: "feature-run:1",
		featureId: "feature-1",
		sourceDigest,
		command: "bun test tests/unit.test.ts",
		coverageScope: "focused",
		environmentKeys: ["CI"],
		...overrides,
	});
}

describe("validation capture coordinator", () => {
	test("attests exact next Bash execution with runtime timing and no raw output artifact", async () => {
		let now = Date.parse("2026-07-19T20:00:00.000Z");
		const receipts: ValidationReceiptV1[] = [];
		const coordinator = new ValidationCaptureCoordinator({
			now: () => now,
			randomId: () => "capture-1",
			publishReceipt: (_worktree, receipt) => {
				receipts.push(receipt);
				return Promise.resolve(receiptRef);
			},
		});
		const armed = arm(coordinator);
		expect(armed.captureId).toBe("capture-1");

		now += 10;
		coordinator.observeToolBefore(
			{ tool: "bash", sessionID: "session-1", callID: "call-1" },
			{ args: { command: "bun test tests/unit.test.ts" } },
		);
		now += 20;
		const output = {
			title: "test",
			output: "1 pass\n0 fail",
			metadata: { exit: 0, truncated: false },
		};
		expect(
			await coordinator.observeToolAfter(
				{
					tool: "bash",
					sessionID: "session-1",
					callID: "call-1",
					args: { command: "bun test tests/unit.test.ts" },
				},
				output,
			),
		).toEqual(receiptRef);
		expect(receipts).toHaveLength(1);
		expect(receipts[0]).toMatchObject({
			startedAt: "2026-07-19T20:00:00.010Z",
			completedAt: "2026-07-19T20:00:00.030Z",
			exitCode: 0,
			outputCompleteness: "complete",
		});
		expect(receipts[0]).not.toHaveProperty("exactOutputArtifactRef");
		expect(output.output).toContain("[flow-validation-receipt]");
		expect(output.output).not.toContain("/worktree");
		expect(coordinator.pendingCount()).toBe(0);
	});

	test("cancels rather than capturing a different Bash command", () => {
		const coordinator = new ValidationCaptureCoordinator({
			publishReceipt: () => Promise.resolve(receiptRef),
		});
		arm(coordinator);
		expect(() =>
			coordinator.observeToolBefore(
				{ tool: "bash", sessionID: "session-1", callID: "call-1" },
				{ args: { command: "rm -rf unrelated" } },
			),
		).toThrow(ValidationCaptureError);
		expect(coordinator.pendingCount()).toBe(0);
	});

	test("refuses a command mutated by a later before-hook", async () => {
		let published = false;
		const coordinator = new ValidationCaptureCoordinator({
			publishReceipt: () => {
				published = true;
				return Promise.resolve(receiptRef);
			},
		});
		arm(coordinator);
		coordinator.observeToolBefore(
			{ tool: "bash", sessionID: "session-1", callID: "call-1" },
			{ args: { command: "bun test tests/unit.test.ts" } },
		);
		await expect(
			coordinator.observeToolAfter(
				{
					tool: "bash",
					sessionID: "session-1",
					callID: "call-1",
					args: { command: "printf mutated" },
				},
				{
					title: "test",
					output: "mutated",
					metadata: { exit: 0, truncated: false },
				},
			),
		).rejects.toThrow("no longer matched");
		expect(published).toBe(false);
		expect(coordinator.pendingCount()).toBe(0);
	});

	test("refuses unstructured exit status instead of guessing success", async () => {
		const coordinator = new ValidationCaptureCoordinator({
			publishReceipt: () => Promise.resolve(receiptRef),
		});
		arm(coordinator);
		coordinator.observeToolBefore(
			{ tool: "bash", sessionID: "session-1", callID: "call-1" },
			{ args: { command: "bun test tests/unit.test.ts" } },
		);
		await expect(
			coordinator.observeToolAfter(
				{
					tool: "bash",
					sessionID: "session-1",
					callID: "call-1",
					args: { command: "bun test tests/unit.test.ts" },
				},
				{ title: "test", output: "ok", metadata: {} },
			),
		).rejects.toThrow("structured Bash exit code");
	});

	test("records truncation explicitly and leaves it unusable for review", async () => {
		let captured: ValidationReceiptV1 | undefined;
		const coordinator = new ValidationCaptureCoordinator({
			publishReceipt: (_worktree, receipt) => {
				captured = receipt;
				return Promise.resolve(receiptRef);
			},
		});
		arm(coordinator);
		coordinator.observeToolBefore(
			{ tool: "bash", sessionID: "session-1", callID: "call-1" },
			{ args: { command: "bun test tests/unit.test.ts" } },
		);
		await coordinator.observeToolAfter(
			{
				tool: "bash",
				sessionID: "session-1",
				callID: "call-1",
				args: { command: "bun test tests/unit.test.ts" },
			},
			{
				title: "test",
				output: "partial",
				metadata: { exit: 0, truncated: true },
			},
		);
		expect(captured?.outputCompleteness).toBe("truncated");
	});

	test("bounds concurrent captures and expires orphaned arms", () => {
		let now = 0;
		const coordinator = new ValidationCaptureCoordinator({
			now: () => now,
			maxCaptures: 1,
			captureTtlMs: 10,
			publishReceipt: () => Promise.resolve(receiptRef),
		});
		arm(coordinator);
		expect(() => arm(coordinator, { sessionID: "session-2" })).toThrow(
			"bounded pending",
		);
		now = 11;
		expect(() => arm(coordinator, { sessionID: "session-2" })).not.toThrow();
		expect(coordinator.pendingCount()).toBe(1);
	});

	test("does not expire a Bash call after execution has started", async () => {
		let now = 0;
		const coordinator = new ValidationCaptureCoordinator({
			now: () => now,
			captureTtlMs: 10,
			publishReceipt: () => Promise.resolve(receiptRef),
		});
		arm(coordinator);
		coordinator.observeToolBefore(
			{ tool: "bash", sessionID: "session-1", callID: "call-1" },
			{ args: { command: "bun test tests/unit.test.ts" } },
		);
		now = 60_000;
		expect(
			await coordinator.observeToolAfter(
				{
					tool: "bash",
					sessionID: "session-1",
					callID: "call-1",
					args: { command: "bun test tests/unit.test.ts" },
				},
				{
					title: "test",
					output: "ok",
					metadata: { exit: 0, truncated: false },
				},
			),
		).toEqual(receiptRef);
	});

	test("requires explicit cancellation identity when supplied", () => {
		const coordinator = new ValidationCaptureCoordinator({
			randomId: () => "capture-1",
			publishReceipt: () => Promise.resolve(receiptRef),
		});
		arm(coordinator);
		expect(coordinator.cancel("session-1", "wrong")).toBe(false);
		expect(coordinator.cancel("session-1", "capture-1")).toBe(true);
	});
});
