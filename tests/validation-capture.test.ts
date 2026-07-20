import { describe, expect, test } from "bun:test";
import type {
	ObservedValidation,
	PreparedValidation,
} from "../src/application/prepare-validation.js";
import type {
	SourceDigest,
	ValidationObservation,
} from "../src/domain/session.js";
import {
	ValidationCaptureCoordinator,
	ValidationCaptureError,
} from "../src/platform/opencode/validation-capture.js";

const SOURCE = `sha256:${"a".repeat(64)}` as SourceDigest;
const prepared: PreparedValidation = {
	featureId: "runtime-kernel",
	runId: "run-1",
	command: "bun test tests/runtime-gates.test.ts",
	scope: "focused",
	sourceDigest: SOURCE,
};

function persistedObservation(
	input: ObservedValidation,
	recordedRevision = 4,
): ValidationObservation {
	return {
		id: input.captureId,
		featureId: input.featureId,
		runId: input.runId,
		scope: input.scope,
		command: input.command,
		sourceDigest: input.sourceDigest,
		exitCode: input.exitCode,
		outputDigest: input.outputDigest,
		outputComplete: input.outputComplete,
		recordedRevision,
	};
}

describe("OpenCode validation capture", () => {
	test("captures the exact next Bash command and persists its structured observation directly", async () => {
		const calls: Array<{
			workspace: string;
			input: ObservedValidation;
		}> = [];
		const coordinator = new ValidationCaptureCoordinator({
			randomId: () => "capture-1",
			persistObservation: (workspace, input) => {
				calls.push({ workspace, input });
				return Promise.resolve(persistedObservation(input));
			},
		});

		expect(
			coordinator.arm("opencode-session-1", "/workspace", prepared),
		).toEqual({ captureId: "capture-1", expiresInMs: 15 * 60 * 1_000 });
		coordinator.observeToolBefore(
			{ tool: "read", sessionID: "opencode-session-1", callID: "read-1" },
			{ args: { path: "package.json" } },
		);
		expect(coordinator.pendingCount()).toBe(1);

		coordinator.observeToolBefore(
			{ tool: "bash", sessionID: "opencode-session-1", callID: "bash-1" },
			{ args: { command: prepared.command } },
		);
		const output = {
			title: "Focused tests",
			output: "3 pass\n0 fail",
			metadata: { exit: 0, truncated: false },
		};
		const result = await coordinator.observeToolAfter(
			{
				tool: "bash",
				sessionID: "opencode-session-1",
				callID: "bash-1",
				args: { command: prepared.command },
			},
			output,
		);

		expect(result).toEqual(
			expect.objectContaining({
				id: "capture-1",
				exitCode: 0,
				outputComplete: true,
				recordedRevision: 4,
			}),
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			workspace: "/workspace",
			input: {
				captureId: "capture-1",
				featureId: "runtime-kernel",
				runId: "run-1",
				command: prepared.command,
				scope: "focused",
				sourceDigest: SOURCE,
				exitCode: 0,
				outputComplete: true,
			},
		});
		expect(calls[0]?.input.outputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(output.output).toContain(
			'[flow-validation] {"id":"capture-1","scope":"focused","passed":true}',
		);
		expect(output.output).not.toContain("/workspace");
		expect(coordinator.pendingCount()).toBe(0);
	});

	test("cancels when the next Bash command does not exactly match", () => {
		let persisted = false;
		const coordinator = new ValidationCaptureCoordinator({
			randomId: () => "capture-mismatch",
			persistObservation: (_workspace, input) => {
				persisted = true;
				return Promise.resolve(persistedObservation(input));
			},
		});
		coordinator.arm("opencode-session-1", "/workspace", prepared);

		expect(() =>
			coordinator.observeToolBefore(
				{
					tool: "bash",
					sessionID: "opencode-session-1",
					callID: "bash-wrong",
				},
				{ args: { command: `${prepared.command} --watch` } },
			),
		).toThrow(ValidationCaptureError);
		expect(coordinator.pendingCount()).toBe(0);
		expect(persisted).toBe(false);
	});

	test("expires a started capture before processing a late after-hook", async () => {
		let now = 1_000;
		let persisted = false;
		const coordinator = new ValidationCaptureCoordinator({
			now: () => now,
			randomId: () => "capture-started",
			persistObservation: (_workspace, input) => {
				persisted = true;
				return Promise.resolve(persistedObservation(input));
			},
		});
		coordinator.arm("opencode-session-1", "/workspace", prepared);
		coordinator.observeToolBefore(
			{ tool: "bash", sessionID: "opencode-session-1", callID: "bash-1" },
			{ args: { command: prepared.command } },
		);

		now += 15 * 60 * 1_000 + 1;
		expect(
			await coordinator.observeToolAfter(
				{
					tool: "bash",
					sessionID: "opencode-session-1",
					callID: "bash-1",
					args: { command: prepared.command },
				},
				{
					title: "Late validation",
					output: "1 pass",
					metadata: { exit: 0, truncated: false },
				},
			),
		).toBeNull();
		expect(persisted).toBe(false);
		expect(coordinator.pendingCount()).toBe(0);
	});

	test("rearms after an expired started capture loses its after-hook", () => {
		let now = 1_000;
		let nextCapture = 0;
		const coordinator = new ValidationCaptureCoordinator({
			now: () => now,
			randomId: () => `capture-${++nextCapture}`,
			persistObservation: (_workspace, input) =>
				Promise.resolve(persistedObservation(input)),
		});
		expect(
			coordinator.arm("opencode-session-1", "/workspace", prepared),
		).toEqual({ captureId: "capture-1", expiresInMs: 15 * 60 * 1_000 });
		coordinator.observeToolBefore(
			{ tool: "bash", sessionID: "opencode-session-1", callID: "bash-1" },
			{ args: { command: prepared.command } },
		);

		now += 15 * 60 * 1_000 + 1;
		expect(
			coordinator.arm("opencode-session-1", "/workspace", prepared),
		).toEqual({ captureId: "capture-2", expiresInMs: 15 * 60 * 1_000 });
		expect(coordinator.pendingCount()).toBe(1);
	});

	test("requires a structured Bash exit code", async () => {
		let persisted = false;
		const coordinator = new ValidationCaptureCoordinator({
			randomId: () => "capture-no-exit",
			persistObservation: (_workspace, input) => {
				persisted = true;
				return Promise.resolve(persistedObservation(input));
			},
		});
		coordinator.arm("opencode-session-1", "/workspace", prepared);
		coordinator.observeToolBefore(
			{ tool: "bash", sessionID: "opencode-session-1", callID: "bash-1" },
			{ args: { command: prepared.command } },
		);

		await expect(
			coordinator.observeToolAfter(
				{
					tool: "bash",
					sessionID: "opencode-session-1",
					callID: "bash-1",
					args: { command: prepared.command },
				},
				{ title: "Unknown", output: "ok", metadata: {} },
			),
		).rejects.toThrow("structured Bash exit code");
		expect(persisted).toBe(false);
		expect(coordinator.pendingCount()).toBe(0);
	});

	test("persists failed and incomplete observations without presenting either as passed", async () => {
		const cases = [
			{
				name: "failed",
				metadata: { exit: 1, truncated: false },
				exitCode: 1,
				outputComplete: true,
			},
			{
				name: "incomplete",
				metadata: { exit: 0, truncated: true },
				exitCode: 0,
				outputComplete: false,
			},
		] as const;

		for (const item of cases) {
			const observations: ObservedValidation[] = [];
			const coordinator = new ValidationCaptureCoordinator({
				randomId: () => `capture-${item.name}`,
				persistObservation: (_workspace, input) => {
					observations.push(input);
					return Promise.resolve(persistedObservation(input));
				},
			});
			coordinator.arm(`session-${item.name}`, "/workspace", prepared);
			coordinator.observeToolBefore(
				{
					tool: "bash",
					sessionID: `session-${item.name}`,
					callID: `bash-${item.name}`,
				},
				{ args: { command: prepared.command } },
			);
			const output = {
				title: item.name,
				output: `${item.name} output`,
				metadata: item.metadata,
			};
			await coordinator.observeToolAfter(
				{
					tool: "bash",
					sessionID: `session-${item.name}`,
					callID: `bash-${item.name}`,
					args: { command: prepared.command },
				},
				output,
			);

			expect(observations).toEqual([
				expect.objectContaining({
					captureId: `capture-${item.name}`,
					exitCode: item.exitCode,
					outputComplete: item.outputComplete,
				}),
			]);
			expect(output.output).toContain('"passed":false');
		}
	});
});
