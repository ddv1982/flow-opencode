import type { ScenarioGradeInput } from "../../evals/grader-input.js";
import { collectHostTrace } from "../../evals/host-trace.js";
import { autoQualifiedOutcome } from "./auto-qualified-outcome.js";

export const localCommand = "node scripts/verify.mjs";
export const externalCommand = "node scripts/platform-check.mjs";
export const deferredGoal =
	"Make parse(input) safely handle null and preserve trimmed strings, changing only src/parser.mjs with Linux validation and required macOS proof.";
export const deferredAnswer = `**Deferred and archived the current Flow session.** The parser change is retained, and required macOS evidence remains **unfulfilled**.

- **Linux validation:** \`${localCommand}\` passed with exit code 0.
- **Outstanding proof:** \`${externalCommand}\` on macOS; unavailable on this Linux host.
- **Progress:** 0 of 1 features complete; unfinished feature: \`parser-null\`.
- **Assurance:** Completion is not claimed. Independent review was not performed.
- **Findings:** No live advisory or historical findings.
- **External action authority:** Not granted.

Goal: ${deferredGoal}

Flow’s archived handoff retains these assurance limitations:
- Artifact paths and the canonical gate are caller declarations; Flow validates binding, not completeness or fitness.
- Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.
- Freshness holds when review is accepted; an archive does not attest the current workspace.

Flow recorded no artifact declarations; that is not an exhaustive Git-change inventory.`;

export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Missing fixture record.");
	return value as Record<string, unknown>;
}
export function nativeTrace(calls: ScenarioGradeInput["allCalls"]) {
	return collectHostTrace({
		runnerRootSessionIds: ["ses_root"],
		directory: "/workspace",
		childrenComplete: true,
		sessionMetadata: [{ id: "ses_root", directory: "/workspace" }],
		sessionMessages: [
			{
				sessionId: "ses_root",
				messages: [
					{
						info: {
							id: "msg_user",
							sessionID: "ses_root",
							role: "user",
							time: { created: 1 },
						},
						parts: [
							{
								id: "prt_user",
								sessionID: "ses_root",
								messageID: "msg_user",
								type: "text",
								text: "Complete the approved task",
							},
						],
					},
					...calls.map((call) => ({
						info: {
							id: call.native?.messageId,
							sessionID: "ses_root",
							role: "assistant",
							parentID: "msg_user",
							agent: call.agent,
							time: { created: call.native?.startedAt },
						},
						parts: [
							{
								id: call.native?.partId,
								sessionID: "ses_root",
								messageID: call.native?.messageId,
								callID: call.native?.callId,
								type: "tool",
								tool: call.tool,
								state: {
									status: call.status,
									time: {
										start: call.native?.startedAt,
										end: call.native?.completedAt,
									},
								},
							},
						],
					})),
				],
			},
		],
	});
}
export function validation(input: ScenarioGradeInput) {
	const run = record((record(input.archives[0]).runs as unknown[])[0]);
	return record((run.validations as unknown[])[0]);
}
export function deferredCaptureOutcome(
	finalText = deferredAnswer,
): ScenarioGradeInput {
	const base = autoQualifiedOutcome("single", {
		goal: deferredGoal,
		featureId: "parser-null",
	});
	const archive = record(base.archives[0]);
	const run = record((archive.runs as unknown[])[0]);
	const capture = validation(base);
	Object.assign(capture, { recordedRevision: 4 });
	Object.assign(run, {
		startedRevision: 3,
		state: "superseded",
		reviews: [],
		artifactsChanged: [],
	});
	Object.assign(archive, {
		revision: 5,
		closure: {
			kind: "deferred",
			operationId: "close-task",
			recordedRevision: 5,
			summary: "Required macOS proof remains unavailable.",
		},
	});
	const plan = record(archive.plan);
	plan.evidence = [
		{ scope: "gate", command: localCommand, platform: "linux", assertions: [] },
		{
			scope: "extra",
			command: externalCommand,
			platform: "darwin",
			assertions: [],
		},
	];
	const close = base.allCalls.find(
		(call) => call.tool === "flow_session_close",
	);
	if (!close) throw new Error("Missing fixture close.");
	Object.assign(record(close.input.request), {
		kind: "deferred",
		expectedRevision: 4,
	});
	const closeData = record(record(close.output).workflowData);
	Object.assign(record(closeData.operation), {
		revision: 5,
		entity: archive.closure,
	});
	closeData.delivery = {
		findingsDigest: [],
		assurance: {
			conclusion: "completion-not-claimed",
			checks: Array.from({ length: 4 }, () => ({ status: "not-applicable" })),
		},
		report: [
			"Handoff format: 1",
			"External action authority: not-granted",
			`Goal: ${deferredGoal}`,
			"Closure: deferred",
			"Progress: 0 of 1 features complete",
			"Unfinished features: parser-null",
			"Findings digest: none",
			"Reported artifacts: 0 latest, 0 superseded",
			"Assurance: completion not claimed",
			"Features:",
			"- parser-null: Safely parse null and trim strings",
			"  attempts: 1; latest state: superseded",
			"  outcome: none recorded",
			"  terminal findings: none",
			"Assurance checks:",
			"- not-applicable [TS-enforced] Recorded completion: deferred closure makes no completion claim.",
			"- not-applicable [host-attested] Accepted validation: deferred closure makes no completion claim.",
			"- not-applicable [host-attested] Canonical gate: deferred closure makes no completion claim.",
			"- not-applicable [host-attested] Declared evidence: deferred closure makes no completion claim.",
			"Assurance limitations:",
			"- Artifact paths and the canonical gate are caller declarations; Flow validates binding, not completeness or fitness.",
			"- Goal alignment, scope discipline, evidence completeness, requirement coverage, test adequacy, and review substance remain model judgments.",
			"- Freshness holds when review is accepted; an archive does not attest the current workspace.",
			"Artifacts as reported by Flow from caller declarations, not an exact or exhaustive Git delta:",
			"- latest attempts: none reported",
			"- superseded attempts only: none reported",
			`Recorded local validation: ${JSON.stringify(capture)}`,
			`Required external evidence: ${JSON.stringify(plan.evidence)}`,
		],
	};
	const manager = base.allCalls.filter(
		(call) => call.agent === "build" && call.tool !== "flow_review_start",
	);
	const append = (
		tool: string,
		input: Record<string, unknown>,
		output: unknown,
		startedAt: number,
		metadata: Record<string, unknown> = {},
	) => ({
		tool,
		status: "completed" as const,
		agent: "build",
		sessionIndex: 0,
		input,
		output,
		rawOutput: typeof output === "string" ? output : JSON.stringify(output),
		metadata,
		native: {
			sessionId: "ses_root",
			messageId: `msg_capture${startedAt}`,
			partId: `prt_capture${startedAt}`,
			partIndex: 0,
			callId: `call_capture${startedAt}`,
			startedAt,
			completedAt: startedAt + 1,
		},
	});
	const marker = `[flow-validation] ${JSON.stringify({ id: capture.id, scope: "broad", intent: "pass", passed: true, observed: false, recordedRevision: 4 })}`;
	const arm = append(
		"flow_validation_start",
		{
			request: {
				featureId: "parser-null",
				scope: "broad",
				command: localCommand,
				expectedRevision: 3,
			},
		},
		{
			status: "ok",
			workflowData: {
				capture: { captureId: capture.id, expiresInMs: 900000 },
				command: localCommand,
				scope: "broad",
				intent: "pass",
			},
		},
		20,
	);
	const bash = append(
		"bash",
		{ command: localCommand },
		`(no output)\n\n${marker}`,
		22,
		{ exit: 0, truncated: false, output: "(no output)" },
	);
	const status = append(
		"flow_status",
		{ request: { view: "detail" } },
		{
			status: "ok",
			workflowData: {
				projection: {
					sessionId: archive.id,
					view: "detail",
					revision: 4,
					status: "running",
					plan: structuredClone(plan),
					runs: [{ ...structuredClone(run), state: "active" }],
					progress: { completed: 0, total: 1, remaining: 1 },
					nextAction: "await-user-direction",
				},
			},
		},
		24,
	);
	const calls = [
		...manager.filter((call) => call !== close),
		arm,
		bash,
		status,
		close,
	];
	return {
		...base,
		allCalls: calls,
		flowCalls: calls.filter((call) => call.tool.startsWith("flow_")),
		packetBytes: [],
		hostTrace: nativeTrace(calls),
		finalText,
	};
}
