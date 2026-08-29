import { describe, expect, test } from "bun:test";
import {
	deriveConformanceOutcome,
	retainedInstructions,
	retainedReportActors,
} from "../evals/conformance-evidence.js";
import {
	actorsWithSessions,
	deriveRetainedFailure,
	pseudonymizeEvalIds,
	pseudonymousEvalId,
	RetainedScenarioEvidenceSchema,
	retainedFailureEvidence,
	retainedPendingTools,
	ScenarioGradeInputSchema,
} from "../evals/grader-input.js";

describe("retained scenario grader input", () => {
	test("retains a complete attempt envelope when the host produces no outcome", () => {
		const evidence = retainedFailureEvidence({
			attempt: {
				attemptId: "attempt-cell-host-failure",
				cellId: "cell-host-failure",
				caseId: "happy-path",
				repetition: 1,
				model: {
					routeProvider: "xai",
					gateway: null,
					family: "grok-4.6",
					model: "grok-4.6",
					revision: null,
				},
			},
			durationMs: 182_000,
		});
		expect(RetainedScenarioEvidenceSchema.parse(evidence)).toEqual(evidence);
		expect(evidence).toMatchObject({
			actors: [],
			guidanceLoads: [],
			gradeInput: {
				flowCalls: [],
				allCalls: [],
				session: null,
				archives: [],
				finalText: "",
			},
			usage: { durationMs: 182_000, outputTokens: 0, costUsd: null },
		});
	});

	test("retains known usage and grade input after outcome collection", () => {
		const evidence = retainedFailureEvidence({
			attempt: {
				attemptId: "attempt-cell-transform-failure",
				cellId: "cell-transform-failure",
				caseId: "happy-path",
				repetition: 2,
				model: {
					routeProvider: "openai",
					gateway: null,
					family: "gpt-5.6-sol",
					model: "gpt-5.6-sol",
					revision: null,
				},
			},
			durationMs: 45_000,
			outputTokens: 321,
			costUsd: 0.42,
			actors: [],
			guidanceLoads: [],
			gradeInput: {
				schemaVersion: 1,
				flowCalls: [],
				allCalls: [],
				session: { status: "running" },
				archives: [],
				finalText: "partial",
				providerErrors: [],
			},
		});
		expect(evidence.usage).toEqual({
			durationMs: 45_000,
			outputTokens: 321,
			costUsd: 0.42,
		});
		expect(evidence.gradeInput).toMatchObject({
			session: { status: "running" },
			finalText: "partial",
		});
	});

	test("refuses a grafted pre-outcome host label on product evidence", () => {
		const evidence = retainedFailureEvidence({
			attempt: {
				attemptId: "attempt-graft",
				cellId: "cell-graft",
				caseId: "happy-path",
				repetition: 0,
				model: {
					routeProvider: "xai",
					gateway: null,
					family: "grok-4.6",
					model: "grok-4.6",
					revision: null,
				},
			},
			durationMs: 1,
			gradeInput: {
				schemaVersion: 1,
				flowCalls: [],
				allCalls: [],
				session: { status: "completed" },
				archives: [],
				finalText: "done",
				providerErrors: [],
			},
			failure: {
				origin: "host",
				code: "host-start-failed",
				retryable: true,
			},
			failureObservation: {
				kind: "host-phase",
				code: "host-start-failed",
				pendingTools: [],
			},
		});
		expect(deriveRetainedFailure(evidence)).toBeNull();
		for (const code of [
			"host-start-failed" as const,
			"session-create-failed" as const,
		]) {
			const providerContradiction = retainedFailureEvidence({
				attempt: evidence.attempt,
				durationMs: 1,
				gradeInput: {
					schemaVersion: 1,
					flowCalls: [],
					allCalls: [],
					session: null,
					archives: [],
					finalText: "",
					providerErrors: [
						{
							sessionId: "id_0123456789abcdef",
							name: "ProviderError",
							message: "contradictory provider boundary",
						},
					],
				},
				failure: { origin: "host", code, retryable: true },
				failureObservation: {
					kind: "host-phase",
					code,
					pendingTools: [],
				},
			});
			expect(deriveRetainedFailure(providerContradiction)).toBeNull();
		}
	});

	test("derives a provider failure only from a matching observed session error", () => {
		const providerError = {
			sessionId: "ses_provider123",
			name: "ProviderError",
			message: "upstream rejected the turn",
		};
		const evidence = pseudonymizeEvalIds(
			RetainedScenarioEvidenceSchema.parse({
				schemaVersion: 1,
				attempt: {
					attemptId: "attempt-provider-failure",
					cellId: "cell-provider-failure",
					caseId: "happy-path",
					repetition: 0,
					model: {
						routeProvider: "xai",
						gateway: null,
						family: "grok-4.6",
						model: "grok-4.6",
						revision: null,
					},
				},
				actors: [
					{
						role: "manager",
						sessionIds: [providerError.sessionId],
						actualModel: {
							kind: "observed",
							value: { providerID: "xai", modelID: "grok-4.6" },
						},
						requestedModelId: "xai/grok-4.6",
						requestedModel: {
							routeProvider: "xai",
							gateway: null,
							family: "grok-4.6",
							model: "grok-4.6",
							revision: null,
						},
					},
				],
				guidanceLoads: [],
				gradeInput: {
					schemaVersion: 1,
					flowCalls: [],
					allCalls: [],
					session: null,
					archives: [],
					finalText: "",
					providerErrors: [providerError],
				},
				failure: {
					origin: "provider",
					code: "provider-rejected-turn",
					retryable: true,
				},
				failureObservation: { kind: "provider-error", ...providerError },
				usage: { durationMs: 1, outputTokens: 0, costUsd: null },
			}),
		);
		expect(evidence.gradeInput.providerErrors[0]?.sessionId).toMatch(
			/^id_[a-f0-9]{16}$/,
		);
		expect(deriveRetainedFailure(evidence)).toEqual(evidence.failure);
		const pendingCall = {
			tool: "bash",
			status: "running" as const,
			sessionIndex: 0,
			agent: "build",
			input: {},
			output: {},
			rawOutput: "",
			metadata: {},
		};
		const contradictoryAbort = RetainedScenarioEvidenceSchema.parse({
			...evidence,
			gradeInput: {
				...evidence.gradeInput,
				allCalls: [pendingCall],
			},
			failure: {
				origin: "host",
				code: "command-aborted",
				retryable: true,
			},
			failureObservation: {
				kind: "host-phase",
				code: "command-aborted",
				pendingTools: [pendingCall.tool],
			},
		});
		expect(deriveRetainedFailure(contradictoryAbort)).toBeNull();
		expect(
			retainedPendingTools({
				...contradictoryAbort.gradeInput,
				allCalls: [
					{
						...pendingCall,
						status: "error",
						metadata: { interrupted: true },
					},
				],
			}),
		).toEqual([pendingCall.tool]);
		expect(
			deriveRetainedFailure(
				RetainedScenarioEvidenceSchema.parse({
					...contradictoryAbort,
					gradeInput: {
						...contradictoryAbort.gradeInput,
						providerErrors: [],
					},
				}),
			),
		).toEqual(contradictoryAbort.failure);

		for (const forged of [
			{ ...evidence, actors: [] },
			{
				...evidence,
				gradeInput: { ...evidence.gradeInput, providerErrors: [] },
			},
			{
				...evidence,
				failureObservation: {
					...evidence.failureObservation,
					message: "different error",
				},
			},
		]) {
			expect(
				deriveRetainedFailure(RetainedScenarioEvidenceSchema.parse(forged)),
			).toBeNull();
		}
	});

	test("accepts the complete bounded input and pseudonymizes ids deterministically", () => {
		const parsed = ScenarioGradeInputSchema.safeParse({
			schemaVersion: 1,
			flowCalls: [],
			allCalls: [],
			session: null,
			archives: [],
			finalText: "done",
		});
		expect(parsed.success).toBe(true);
		expect(pseudonymousEvalId("ses_parent")).toBe(
			pseudonymousEvalId("ses_parent"),
		);
		expect(pseudonymousEvalId("ses_parent")).not.toBe(
			pseudonymousEvalId("ses_reviewer"),
		);
		expect(pseudonymousEvalId("ses_parent")).toMatch(/^id_[a-f0-9]{16}$/);
	});

	test("rejects partial or expanded grader inputs", () => {
		expect(
			ScenarioGradeInputSchema.safeParse({
				schemaVersion: 1,
				flowCalls: [],
				allCalls: [],
				session: null,
				archives: [],
			}).success,
		).toBe(false);
		expect(
			ScenarioGradeInputSchema.safeParse({
				schemaVersion: 1,
				flowCalls: [],
				allCalls: [],
				session: null,
				archives: [],
				finalText: "done",
				extra: true,
			}).success,
		).toBe(false);
	});

	test("rederives the complete outcome, actors, and instructions", () => {
		const call = {
			tool: "question",
			status: "completed" as const,
			sessionIndex: 0,
			agent: "build",
			input: { questions: ["continue?"] },
			output: {},
			rawOutput: "",
			metadata: {},
		};
		const evidence = RetainedScenarioEvidenceSchema.parse({
			schemaVersion: 1,
			attempt: {
				attemptId: "attempt-1",
				cellId: "cell-1",
				caseId: "scenario",
				repetition: 1,
				model: {
					routeProvider: "openai",
					gateway: null,
					family: "gpt-test",
					model: "gpt-test",
					revision: null,
				},
			},
			actors: [
				{
					role: "manager",
					sessionIds: ["id_0123456789abcdef"],
					actualModel: {
						kind: "observed",
						value: { providerID: "openai", modelID: "gpt-test" },
					},
					requestedModelId: "openai/gpt-test",
					requestedModel: {
						routeProvider: "openai",
						gateway: null,
						family: "gpt-test",
						model: "gpt-test",
						revision: null,
					},
				},
			],
			guidanceLoads: [
				{
					sequence: 0,
					sessionIndex: 0,
					agent: "build",
					id: "flow",
					rawOutput: "guide",
					utf8Bytes: 5,
				},
			],
			gradeInput: {
				schemaVersion: 1,
				flowCalls: [],
				allCalls: [call],
				session: null,
				archives: [
					{
						closure: { kind: "completed" },
						plan: null,
						runs: [{ reviews: [{ result: null }] }],
					},
				],
				finalText: "stopped",
			},
			usage: { durationMs: 12, outputTokens: 34, costUsd: 0.5 },
		});
		const outcome = deriveConformanceOutcome({
			evidence,
			check: () => ["gap"],
			scenarioId: "scenario",
			model: "openai/gpt-test",
			attempt: 2,
		});
		expect(outcome).toMatchObject({
			passed: false,
			endedBy: "user-escalation",
			issues: ["gap"],
			evidence: {
				falseCompletion: true,
				unsubmittedReviews: 1,
				facts: {
					scenario: "scenario",
					model: "openai/gpt-test",
					attempt: 2,
					flowCalls: 0,
					guidanceLoads: 1,
				},
			},
		});
		expect(retainedReportActors(evidence)).toHaveLength(1);
		expect(retainedInstructions(evidence)).toHaveLength(1);
		expect(
			actorsWithSessions([
				{ role: "manager", sessionIds: ["id_manager"] },
				{ role: "reviewer", sessionIds: [] },
			]),
		).toEqual([{ role: "manager", sessionIds: ["id_manager"] }]);
		expect({
			...outcome,
			evidence: { ...outcome.evidence, falseCompletion: false },
		}).not.toEqual(outcome);
	});
});
