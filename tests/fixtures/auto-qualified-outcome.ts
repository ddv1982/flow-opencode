import { createHash } from "node:crypto";
import type { ScenarioGradeInput } from "../../evals/grader-input.js";
import { collectHostTrace } from "../../evals/host-trace.js";
import { collectReviewerPacketBytes } from "../../evals/reviewer-packet-bytes.js";

const digest = `sha256:${"a".repeat(64)}`;
export function autoQualifiedOutcome(
	kind: "two" | "prerequisite" | "audit",
): ScenarioGradeInput {
	const features =
		kind === "two"
			? [
					{
						id: "tokens",
						title: "Tokens",
						summary: "Tokenize",
						targets: ["src/tokens.mjs"],
						validation: ["node scripts/check-tokens.mjs"],
						dependsOn: [],
					},
					{
						id: "report",
						title: "Report",
						summary: "Summarize",
						targets: ["src/report.mjs"],
						validation: ["node scripts/verify.mjs"],
						dependsOn: ["tokens"],
					},
				]
			: [
					{
						id: "parser",
						title: "Parser",
						summary: "Guard null",
						targets:
							kind === "prerequisite"
								? ["src/parser.mjs", "runtime.json"]
								: ["src/parser.mjs"],
						validation: ["node scripts/verify.mjs"],
						dependsOn: [],
						...(kind === "audit"
							? {
									checks: [
										{
											command: "node scripts/audit.mjs",
											intent: "observe",
											platform: "linux",
										},
										{
											command: "node scripts/verify.mjs",
											intent: "pass",
											platform: "linux",
										},
									],
								}
							: {}),
					},
				];
	const plan = {
		summary: "Implement text behavior",
		overview: "Complete approved changes",
		requirements: ["Text behavior is correct"],
		decisions: [],
		features,
		evidence: [
			{
				scope: "gate",
				command: "node scripts/verify.mjs",
				platform: "linux",
				requirement: "Required behavior",
				environment: "Local",
				assertions: [],
			},
		],
	};
	const calls: Array<{
		tool: string;
		status: "completed";
		sessionIndex: number;
		agent: string;
		input: Record<string, unknown>;
		output: unknown;
		rawOutput: string;
		metadata: Record<string, unknown>;
		native: {
			sessionId: string;
			messageId: string;
			partId: string;
			partIndex: number;
			callId: string;
			startedAt: number;
			completedAt: number;
		};
	}> = [];
	const runs = features.map((feature, index) => {
		const runId = `run-${index}`,
			created = 5 + index * 4,
			recorded = created + 1;
		const validations = [
			...(kind === "audit"
				? [
						{
							id: "audit-observation",
							featureId: feature.id,
							runId,
							command: "node scripts/audit.mjs",
							scope: "broad",
							intent: "observe",
							sourceDigest: digest,
							exitCode: 12,
							outputComplete: true,
							outputDigest: digest,
							recordedRevision: created - 2,
							hostPlatform: "linux",
						},
					]
				: []),
			{
				id: `validation-${index}`,
				featureId: feature.id,
				runId,
				command: feature.validation[0],
				scope: index === 0 && kind === "two" ? "focused" : "broad",
				intent: "pass",
				sourceDigest: digest,
				exitCode: 0,
				outputComplete: true,
				outputDigest: digest,
				recordedRevision: created - 1,
				hostPlatform: "linux",
			},
		];
		const packet = {
			version: 1,
			sessionId: "session:qualification",
			featureId: feature.id,
			runId,
			baseline: { version: 1, sha256: digest },
			sourceDigest: digest,
			provenance: "captured-before-run",
			complete: true,
			preservedPreexisting: { count: 0, digest, entries: [] },
			changes: feature.targets.map((path) => ({
				path,
				before: { kind: "file", mode: 420, digest: `sha256:${"b".repeat(64)}` },
				after: { kind: "file", mode: 420, digest },
				binary: false,
				preexistingDirty: false,
				diff: "--- old\n+++ new\n@@ -1 +1 @@\n-incomplete\n+implemented\n",
			})),
		};
		const envelope = JSON.stringify({
			owner: "flow-review-evidence",
			version: 1,
			kind: "packet",
			packet,
		});
		const assignment = {
			id: `review:qualification${index}`,
			featureId: feature.id,
			runId,
			kind: index === features.length - 1 ? "final" : "feature",
			sourceDigest: digest,
			validationIds: validations.map((value) => value.id),
			createdRevision: created,
			packet: { summary: "Review implementation", riskLenses: ["Null input"] },
			evidence: {
				version: 1,
				sha256: `sha256:${createHash("sha256").update(envelope).digest("hex")}`,
			},
			result: {
				verdict: "passed",
				terminalDisposition: "submitted",
				findings: [],
				recordedRevision: recorded,
			},
		};
		const run = {
			id: runId,
			featureId: feature.id,
			attempt: 1,
			state: "completed",
			startedRevision: created - 3,
			baseline: packet.baseline,
			artifactsChanged: feature.targets.map((path) => ({ path })),
			validations,
			reviews: [assignment],
		};
		const context = {
			view: "reviewer",
			sessionId: "session:qualification",
			revision: created,
			goal: "Implement text behavior",
			planContext: plan,
			feature,
			assignment: { ...assignment, result: null },
			artifactsChanged: run.artifactsChanged,
			validations,
			completedFeatureIds: features.slice(0, index).map((value) => value.id),
			priorFindings: [],
			amendments: [],
			amendmentEvidence: [],
			nextFindingIdPrefix: `${feature.id}.R${created}`,
		};
		const append = (
			tool: string,
			input: Record<string, unknown>,
			output: unknown,
		) => {
			const number = calls.length;
			calls.push({
				tool,
				status: "completed",
				agent: "flow-reviewer",
				sessionIndex: 1,
				input,
				output,
				rawOutput: JSON.stringify(output),
				metadata: {},
				native: {
					sessionId: `ses_reviewer${index}`,
					messageId: `msg_call_${number}`,
					partId: `prt_call_${number}`,
					partIndex: 0,
					callId: `call_${number}`,
					startedAt: 20 + index * 30 + (number % 3) * 2,
					completedAt: 21 + index * 30 + (number % 3) * 2,
				},
			});
		};
		append(
			"flow_status",
			{ request: { view: "reviewer", assignmentId: assignment.id } },
			{
				status: "ok",
				workflowData: {
					reviewerPager: {
						assignmentId: assignment.id,
						contextPages: 1,
						diffPages: 1,
						chunkBytes: 8192,
						assurance: "host-evidence",
					},
					projection: context,
				},
			},
		);
		append(
			"flow_status",
			{
				request: {
					view: "reviewer-evidence",
					assignmentId: assignment.id,
					part: "diff",
					page: 0,
				},
			},
			{
				status: "ok",
				workflowData: {
					projection: {
						view: "reviewer-evidence",
						sessionId: packet.sessionId,
						assignmentId: assignment.id,
						sourceDigest: digest,
						part: "diff",
						page: 0,
						totalPages: 1,
						complete: true,
						assurance: "host-evidence",
						text: JSON.stringify(packet),
					},
				},
			},
		);
		append(
			"flow_feature_complete",
			{
				request: {
					featureId: feature.id,
					assignmentId: assignment.id,
					result: {
						verdict: "passed",
						terminalDisposition: "submitted",
						findings: [],
					},
				},
			},
			{
				status: "ok",
				workflowData: {
					operation: { replayed: false, revision: recorded, entity: run },
				},
			},
		);
		return run;
	});
	const document = {
		version: 5,
		id: "session:qualification",
		revision: 12,
		goal: "Implement text behavior",
		approval: "approved",
		plan,
		runs,
		amendments: [],
		closure: {
			kind: "completed",
			operationId: "close-task",
			recordedRevision: 12,
			summary: "Completed approved task",
		},
	};
	const managerCalls = [
		{
			tool: "flow_plan_save",
			input: {
				request: { operationId: "save-plan", goal: document.goal, plan },
			},
			output: {
				status: "ok",
				workflowData: {
					operation: { operationId: "save-plan", revision: 1, replayed: false },
				},
			},
		},
		{
			tool: "flow_plan_approve",
			input: { request: { operationId: "approve-plan", expectedRevision: 1 } },
			output: {
				status: "ok",
				workflowData: {
					operation: {
						operationId: "approve-plan",
						revision: 2,
						replayed: false,
					},
				},
			},
		},
		...runs.flatMap((run, index) => [
			{
				tool: "flow_run_start",
				input: {
					request: { featureId: run.featureId, operationId: `start-${index}` },
				},
				output: {
					status: "ok",
					workflowData: {
						operation: {
							operationId: `start-${index}`,
							revision: run.startedRevision,
							replayed: false,
							entity: run,
						},
					},
				},
			},
			{
				tool: "flow_review_start",
				input: {
					request: { featureId: run.featureId, operationId: `review-${index}` },
				},
				output: {
					status: "ok",
					workflowData: {
						operation: {
							operationId: `review-${index}`,
							revision: run.reviews[0]?.createdRevision,
							replayed: false,
							entity: run.reviews[0],
						},
					},
				},
			},
		]),
		{
			tool: "flow_session_close",
			input: {
				request: {
					operationId: "close-task",
					expectedRevision: 11,
					sessionId: document.id,
					kind: "completed",
					summary: document.closure.summary,
				},
			},
			output: {
				status: "ok",
				workflowData: {
					operation: {
						operationId: "close-task",
						revision: 12,
						replayed: false,
						entity: document.closure,
					},
				},
			},
		},
	].map((call, index) => ({
		...call,
		status: "completed" as const,
		agent: "build",
		sessionIndex: 0,
		rawOutput: JSON.stringify(call.output),
		metadata: {},
		native: {
			sessionId: "ses_root",
			messageId: `msg_manager${index}`,
			partId: `prt_manager${index}`,
			partIndex: 0,
			callId: `call_manager${index}`,
			startedAt:
				call.tool === "flow_session_close"
					? 100
					: index < 2
						? index * 2 + 3
						: 7 + Math.floor((index - 2) / 2) * 30 + (index % 2) * 2,
			completedAt:
				call.tool === "flow_session_close"
					? 101
					: index < 2
						? index * 2 + 4
						: 8 + Math.floor((index - 2) / 2) * 30 + (index % 2) * 2,
		},
	}));
	calls.push(...managerCalls);
	const hostTrace = collectHostTrace({
		runnerRootSessionIds: ["ses_root"],
		directory: "/workspace",
		childrenComplete: true,
		sessionMetadata: [
			{ id: "ses_root", directory: "/workspace" },
			...features.map((_, index) => ({
				id: `ses_reviewer${index}`,
				directory: "/workspace",
				parentID: "ses_root",
				agent: "flow-reviewer",
			})),
		],
		sessionMessages: [
			{
				sessionId: "ses_root",
				messages: [
					{
						info: {
							id: "msg_root",
							sessionID: "ses_root",
							role: "user",
							time: { created: 1 },
						},
						parts: [
							{
								id: "prt_root",
								messageID: "msg_root",
								sessionID: "ses_root",
								type: "text",
								text: "Complete the task",
							},
							{
								id: "prt_token",
								messageID: "msg_root",
								sessionID: "ses_root",
								type: "text",
								text: "Flow",
								synthetic: true,
								metadata: { "opencode-plugin-flow/auto": "fixture-token" },
							},
						],
					},
					...managerCalls.map((call) => ({
						info: {
							id: call.native.messageId,
							sessionID: "ses_root",
							role: "assistant",
							parentID: "msg_root",
							agent: "build",
							time: { created: call.native.startedAt },
						},
						parts: [
							{
								id: call.native.partId,
								sessionID: "ses_root",
								messageID: call.native.messageId,
								callID: call.native.callId,
								type: "tool",
								tool: call.tool,
								state: {
									status: "completed",
									time: {
										start: call.native.startedAt,
										end: call.native.completedAt,
									},
								},
							},
						],
					})),
				],
			},
			...features.map((_, index) => ({
				sessionId: `ses_reviewer${index}`,
				messages: [
					{
						info: {
							id: `msg_child${index}`,
							sessionID: `ses_reviewer${index}`,
							role: "user",
							time: { created: 11 + index * 30 },
						},
						parts: [
							{
								id: `prt_child${index}`,
								messageID: `msg_child${index}`,
								sessionID: `ses_reviewer${index}`,
								type: "text",
								text: "Review assignment",
							},
						],
					},
					...calls
						.filter((call) => call.native.sessionId === `ses_reviewer${index}`)
						.map((call) => ({
							info: {
								id: call.native.messageId,
								sessionID: call.native.sessionId,
								role: "assistant",
								parentID: `msg_child${index}`,
								agent: "flow-reviewer",
								time: { created: call.native.startedAt },
							},
							parts: [
								{
									id: call.native.partId,
									sessionID: call.native.sessionId,
									messageID: call.native.messageId,
									callID: call.native.callId,
									type: "tool",
									tool: call.tool,
									state: {
										status: "completed",
										time: {
											start: call.native.startedAt,
											end: call.native.completedAt,
										},
									},
								},
							],
						})),
				],
			})),
		],
	});
	return {
		session: null,
		archives: [document],
		allCalls: calls,
		flowCalls: calls,
		hostTrace,
		packetBytes: collectReviewerPacketBytes(calls, [document]),
		workspaceChanges: {
			kind: "observed",
			paths:
				kind === "two"
					? ["src/report.mjs", "src/tokens.mjs"]
					: kind === "prerequisite"
						? ["runtime.json", "src/parser.mjs"]
						: ["src/parser.mjs"],
		},
		finalText:
			kind === "audit"
				? "Audit found 12 outstanding advisory items and exited 12; required parser gate passed."
				: "Implementation passed the required gate and independent review.",
	};
}
