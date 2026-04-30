import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderSessionStatusSummary } from "../src/runtime/application";
import {
	FLOW_PLAN_COMMAND,
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_RUN_COMMAND,
	FLOW_STATUS_COMMAND,
	flowResetFeatureCommand,
} from "../src/runtime/constants";
import { getIndexDocPath } from "../src/runtime/paths";
import { createSession, saveSession } from "../src/runtime/session";
import {
	deriveNextCommand,
	explainSessionState,
	summarizeSession,
} from "../src/runtime/summary";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	samplePlan,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

function toolContext(worktree: string, directory?: string) {
	return (directory ? { worktree, directory } : { worktree }) as Parameters<
		ReturnType<typeof createTestTools>["flow_status"]["execute"]
	>[1];
}

async function activeIndexDocPath(worktree: string): Promise<string> {
	return getIndexDocPath(worktree, await activeSessionId(worktree));
}

function assertOk<T>(
	result: { ok: true; value: T } | { ok: false; message: string },
): T {
	if (!result.ok) {
		throw new Error(result.message);
	}

	return result.value;
}

function buildSummaryFixtureSessions() {
	const planning = assertOk(
		applyPlan(createSession("Build a workflow plugin"), samplePlan()),
	);
	const approved = assertOk(approvePlan(planning));
	const running = assertOk(startRun(approved)).session;
	const blocked = assertOk(
		completeRun(running, {
			contractVersion: "1",
			status: "needs_input",
			summary: "Waiting on an operator decision.",
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "External API credentials are missing." }],
			nextStep: "Ask the operator to provide API credentials.",
			outcome: {
				kind: "needs_operator_input",
				summary: "Credentials are required before work can continue.",
				resolutionHint: "Set the API token and rerun the feature.",
				retryable: true,
				needsHuman: true,
			},
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
				notes: [{ note: "No code changes were made." }],
				followUps: [
					{ summary: "Provide the missing API token.", severity: "high" },
				],
			},
			featureReview: {
				status: "needs_followup",
				summary: "Blocked by missing credentials.",
				blockingFindings: [],
			},
		}),
	);

	const finalPlan = {
		...samplePlan(),
		completionPolicy: {
			minCompletedFeatures: 1,
		},
		features: [samplePlan().features[0]],
	};
	const completed = assertOk(
		completeRun(
			assertOk(
				recordReviewerDecision(
					assertOk(
						startRun(
							assertOk(
								approvePlan(
									assertOk(
										applyPlan(
											createSession("Build a workflow plugin"),
											finalPlan,
										),
									),
								),
							),
						),
					).session,
					{
						scope: "final",
						reviewDepth: "detailed",
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
						],
						evidenceSummary:
							"Checked final cross-feature integration and validation evidence.",
						validationAssessment:
							"Validation coverage and cross-feature interactions were reviewed.",
						evidenceRefs: {
							changedArtifacts: ["src/runtime/session.ts"],
							validationCommands: ["bun test"],
						},
						integrationChecks: [
							"Reviewed integration points across the active feature boundary.",
						],
						regressionChecks: [
							"Checked for regressions in shared surfaces and validation evidence.",
						],
						remainingGaps: [],
						status: "approved",
						summary: "Final review looks good.",
					},
				),
			),
			{
				contractVersion: "1",
				status: "ok",
				summary: "Completed runtime setup.",
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Runtime tests passed.",
					},
				],
				validationScope: "broad",
				reviewIterations: 1,
				decisions: [],
				nextStep: "Session should complete.",
				outcome: { kind: "completed" },
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
				},
				finalReview: {
					reviewDepth: "detailed",
					reviewedSurfaces: [
						"changed_files",
						"shared_surfaces",
						"validation_evidence",
					],
					evidenceSummary:
						"Checked final cross-feature integration and validation evidence.",
					validationAssessment:
						"Validation coverage and cross-feature interactions were reviewed.",
					evidenceRefs: {
						changedArtifacts: ["src/runtime/session.ts"],
						validationCommands: ["bun test"],
					},
					integrationChecks: [
						"Reviewed integration points across the active feature boundary.",
					],
					regressionChecks: [
						"Checked for regressions in shared surfaces and validation evidence.",
					],
					remainingGaps: [],
					status: "passed",
					summary: "Repo-wide validation is clean.",
					blockingFindings: [],
				},
			},
		),
	);

	return {
		planning,
		running,
		blocked,
		completed,
	};
}

function buildSummaryFixtures() {
	const sessions = buildSummaryFixtureSessions();

	return {
		planning: summarizeSession(sessions.planning),
		running: summarizeSession(sessions.running),
		blocked: summarizeSession(sessions.blocked),
		completed: summarizeSession(sessions.completed),
	};
}

function normalizeSummaryFixture(summary: ReturnType<typeof summarizeSession>) {
	if (!summary.session) {
		return summary;
	}

	const planning =
		summary.session.planning.implementationApproach === undefined
			? {
					repoProfile: summary.session.planning.repoProfile,
					research: summary.session.planning.research,
				}
			: summary.session.planning;

	const normalizedSession = {
		...summary.session,
		id: "<session-id>",
		closure: summary.session.closure
			? { ...summary.session.closure, recordedAt: "<closure-recorded-at>" }
			: null,
		planning,
	} as Record<string, unknown>;

	if (!summary.session.decisionGate) {
		delete normalizedSession.decisionGate;
	}
	delete normalizedSession.operator;

	return {
		...summary,
		session: normalizedSession,
	};
}

function normalizeFlowStatusFixture(summary: Record<string, unknown>) {
	const {
		workspace,
		workspaceRoot,
		phase,
		lane,
		laneReason,
		blocker,
		reason,
		finalReviewPolicy,
		...rest
	} = summary;
	void finalReviewPolicy;
	void workspace;
	void workspaceRoot;
	void phase;
	void lane;
	void blocker;
	void laneReason;
	void reason;
	return normalizeSummaryFixture(rest as ReturnType<typeof summarizeSession>);
}

describe("runtime summary", () => {
	test("summarizeSession reports missing state when no session exists", () => {
		expect(summarizeSession(null)).toEqual({
			status: "missing",
			summary: "No active Flow session found.",
		});
	});

	test("explainSessionState reports how to start when no session exists", () => {
		expect(explainSessionState(null)).toEqual({
			category: "no_session",
			status: "missing",
			summary: "No active Flow session exists for this workspace.",
			phase: "idle",
			lane: "lite",
			laneReason:
				"Flow can stay in the lite lane until a non-trivial plan or risk signal appears.",
			blocker: "No active Flow session exists for this workspace.",
			reason: "Flow has not started a tracked session for this workspace yet.",
			nextStep: "Start a new Flow session with /flow-plan <goal>.",
			nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
		});
	});

	test("explainSessionState surfaces a decision gate recommendation", () => {
		const session = createSession("Choose a path");
		session.plan = samplePlan();
		session.planning.decisionLog.push({
			question: "Should Flow pause for approval?",
			decisionMode: "recommend_confirm",
			decisionDomain: "architecture",
			options: [{ label: "Pause and ask", tradeoffs: ["safer"] }],
			recommendation: "Pause and ask before changing the architecture.",
			rationale: ["The architecture choice affects multiple files."],
		});

		expect(explainSessionState(session)).toEqual({
			category: "decision_gate",
			status: "recommend_confirm",
			summary: "Should Flow pause for approval?",
			phase: "decision",
			lane: "strict",
			laneReason:
				"Flow detected elevated coordination or recovery risk, so the strict lane is the safest fit.",
			blocker: "Should Flow pause for approval?",
			reason:
				"A meaningful planning decision is still open, so Flow should pause before continuing execution.",
			nextStep: "Pause and ask before changing the architecture.",
			nextCommand: FLOW_PLAN_COMMAND,
		});
	});

	test("renderSessionStatusSummary creates a canonical human-readable status string", () => {
		const running = buildSummaryFixtureSessions().running;

		expect(renderSessionStatusSummary(running)).toBe(
			[
				"Flow: Flow is focused on feature 'setup-runtime'.",
				"Next: Continue the active feature through validation and review.",
				"Command: /flow-run",
				"Working on: setup-runtime — Create runtime helpers (in_progress)",
				"Progress: 0/2 completed",
				"Final review policy: detailed",
				"Goal: Build a workflow plugin",
			].join("\n"),
		);
	});

	test("runtime summary exposes the runtime-owned final review policy and final-path guidance", () => {
		const thresholdPlan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
		};
		const running = assertOk(
			startRun(
				assertOk(
					approvePlan(
						assertOk(
							applyPlan(
								createSession("Build a workflow plugin"),
								thresholdPlan,
							),
						),
					),
				),
			),
		).session;
		const summary = summarizeSession(running);

		expect(summary.session?.finalReviewPolicy).toBe("detailed");
		expect(explainSessionState(running).nextStep).toBe(
			"Continue the active feature through broad validation and the detailed final cross-feature review.",
		);
	});

	test("applyPlan preserves explicit final review policy overrides", () => {
		const applied = assertOk(
			applyPlan(createSession("Build a workflow plugin"), {
				...samplePlan(),
				deliveryPolicy: {
					finalReviewPolicy: "broad",
				},
			}),
		);

		expect(summarizeSession(applied).session?.finalReviewPolicy).toBe("broad");
	});

	test("renderSessionStatusSummary can override the rendered command for history views", () => {
		const planning = buildSummaryFixtureSessions().planning;

		expect(
			renderSessionStatusSummary(planning, {
				nextCommand: "/flow-session activate test-session",
			}),
		).toBe(
			[
				"Flow: Flow has a draft plan that still needs the next planning step.",
				"Blocker: The draft plan is not approved yet.",
				"Next: Review or refine the draft plan, then approve it when ready.",
				"Command: /flow-session activate test-session",
				"Progress: 0/2 completed",
				"Final review policy: detailed",
				"Goal: Build a workflow plugin",
			].join("\n"),
		);
	});

	test("summarizeSession exposes a runtime-owned operator model", () => {
		const running = buildSummaryFixtureSessions().running;
		const summary = summarizeSession(running);

		expect(summary.session?.operator).toEqual({
			phase: "executing",
			lane: "standard",
			laneReason:
				"This session has multi-step work but no elevated risk signals, so the standard lane fits best.",
			blocker: null,
			reason:
				"An approved feature is active, so Flow should stay in execution.",
			nextStep: "Continue the active feature through validation and review.",
			nextCommand: FLOW_RUN_COMMAND,
		});
	});

	test("lane selection uses lite for tiny work and strict for elevated coordination risk", () => {
		const firstFeature = samplePlan().features[0];
		if (!firstFeature) {
			throw new Error("Missing first feature in sample plan.");
		}
		const liteSession = createSession("Ship a tiny fix");
		liteSession.plan = {
			...samplePlan(),
			features: [firstFeature],
		};
		const liteGuidance = explainSessionState(liteSession);
		expect(liteGuidance.lane).toBe("lite");

		const blocked = buildSummaryFixtureSessions().blocked;
		const strictGuidance = explainSessionState(blocked);
		expect(strictGuidance.lane).toBe("strict");
	});

	test("summarizeSession preserves the default planning/running/blocked/completed payloads", () => {
		expect(
			Object.fromEntries(
				Object.entries(buildSummaryFixtures()).map(([name, summary]) => [
					name,
					normalizeSummaryFixture(summary),
				]),
			),
		).toMatchInlineSnapshot(`
	      {
	        "blocked": {
	          "session": {
	            "activeFeature": null,
	            "approval": "approved",
	            "artifacts": [
	              {
	                "path": "src/runtime/session.ts",
	              },
	            ],
	            "closure": null,
	            "completion": {
	              "activeFeatureTriggersSessionCompletion": false,
	              "canCompleteWithPendingFeatures": false,
	              "completedFeatures": 0,
	              "remainingBeyondTarget": 0,
	              "targetCompletedFeatures": 2,
	              "totalFeatures": 2,
	            },
	            "featureLines": [
	              "setup-runtime (blocked): Create runtime helpers",
	              "execute-feature (pending): Implement execution flow",
	            ],
	            "featureProgress": {
	              "completed": 0,
	              "total": 2,
	            },
	            "features": [
	              {
	                "id": "setup-runtime",
	                "status": "blocked",
	                "summary": "Add runtime helper files and state persistence.",
	                "title": "Create runtime helpers",
	              },
	              {
	                "id": "execute-feature",
	                "status": "pending",
	                "summary": "Wire runtime tools to feature execution.",
	                "title": "Implement execution flow",
	              },
	            ],
	            "finalReviewPolicy": "detailed",
	            "goal": "Build a workflow plugin",
	            "id": "<session-id>",
	            "lastFeatureResult": {
	              "featureId": "setup-runtime",
	              "followUps": [
	                {
	                  "severity": "high",
	                  "summary": "Provide the missing API token.",
	                },
	              ],
	              "notes": [
	                {
	                  "note": "No code changes were made.",
	                },
	              ],
	              "verificationStatus": "not_recorded",
	            },
	            "lastNextStep": "Ask the operator to provide API credentials.",
	            "lastOutcome": {
	              "kind": "needs_operator_input",
	              "needsHuman": true,
	              "resolutionHint": "Set the API token and rerun the feature.",
	              "retryable": true,
	              "summary": "Credentials are required before work can continue.",
	            },
	            "lastOutcomeKind": "needs_operator_input",
	            "lastReviewerDecision": null,
	            "lastValidationRun": [],
	            "nextCommand": "/flow-status",
	            "notes": [
	              "External API credentials are missing.",
	            ],
	            "planOverview": "Create one setup feature and one execution feature.",
	            "planSummary": "Implement a small workflow feature set.",
	            "planning": {
	              "repoProfile": [],
	              "research": [],
	            },
	            "status": "blocked",
	          },
	          "status": "blocked",
	          "summary": "Waiting on an operator decision.",
	        },
	        "completed": {
	          "session": {
	            "activeFeature": null,
	            "approval": "approved",
	            "artifacts": [
	              {
	                "path": "src/runtime/session.ts",
	              },
	            ],
	            "closure": {
	              "kind": "completed",
	              "recordedAt": "<closure-recorded-at>",
	              "summary": "Completed runtime setup.",
	            },
	            "completion": {
	              "activeFeatureTriggersSessionCompletion": false,
	              "canCompleteWithPendingFeatures": false,
	              "completedFeatures": 1,
	              "remainingBeyondTarget": 0,
	              "targetCompletedFeatures": 1,
	              "totalFeatures": 1,
	            },
	            "featureLines": [
	              "setup-runtime (completed): Create runtime helpers",
	            ],
	            "featureProgress": {
	              "completed": 1,
	              "total": 1,
	            },
	            "features": [
	              {
	                "id": "setup-runtime",
	                "status": "completed",
	                "summary": "Add runtime helper files and state persistence.",
	                "title": "Create runtime helpers",
	              },
	            ],
	            "finalReviewPolicy": "detailed",
	            "goal": "Build a workflow plugin",
	            "id": "<session-id>",
	            "lastFeatureResult": {
	              "featureId": "setup-runtime",
	              "verificationStatus": "passed",
	            },
	            "lastNextStep": "Session should complete.",
	            "lastOutcome": {
	              "kind": "completed",
	            },
	            "lastOutcomeKind": "completed",
	            "lastReviewerDecision": {
	              "blockingFindings": [],
	              "evidenceRefs": {
	                "changedArtifacts": [
	                  "src/runtime/session.ts",
	                ],
	                "validationCommands": [
	                  "bun test",
	                ],
	              },
	              "evidenceSummary": "Checked final cross-feature integration and validation evidence.",
	              "followUps": [],
	              "integrationChecks": [
	                "Reviewed integration points across the active feature boundary.",
	              ],
	              "regressionChecks": [
	                "Checked for regressions in shared surfaces and validation evidence.",
	              ],
	              "remainingGaps": [],
	              "reviewDepth": "detailed",
	              "reviewPurpose": "completion_gate",
	              "reviewedSurfaces": [
	                "changed_files",
	                "shared_surfaces",
	                "validation_evidence",
	              ],
	              "scope": "final",
	              "status": "approved",
	              "suggestedValidation": [],
	              "summary": "Final review looks good.",
	              "validationAssessment": "Validation coverage and cross-feature interactions were reviewed.",
	            },
	            "lastValidationRun": [
	              {
	                "command": "bun test",
	                "status": "passed",
	                "summary": "Runtime tests passed.",
	              },
	            ],
	            "nextCommand": "/flow-plan <goal>",
	            "notes": [],
	            "planOverview": "Create one setup feature and one execution feature.",
	            "planSummary": "Implement a small workflow feature set.",
	            "planning": {
	              "repoProfile": [],
	              "research": [],
	            },
	            "status": "completed",
	          },
	          "status": "completed",
	          "summary": "Completed runtime setup.",
	        },
	        "planning": {
	          "session": {
	            "activeFeature": null,
	            "approval": "pending",
	            "artifacts": [],
	            "closure": null,
	            "completion": {
	              "activeFeatureTriggersSessionCompletion": false,
	              "canCompleteWithPendingFeatures": false,
	              "completedFeatures": 0,
	              "remainingBeyondTarget": 0,
	              "targetCompletedFeatures": 2,
	              "totalFeatures": 2,
	            },
	            "featureLines": [
	              "setup-runtime (pending): Create runtime helpers",
	              "execute-feature (pending): Implement execution flow",
	            ],
	            "featureProgress": {
	              "completed": 0,
	              "total": 2,
	            },
	            "features": [
	              {
	                "id": "setup-runtime",
	                "status": "pending",
	                "summary": "Add runtime helper files and state persistence.",
	                "title": "Create runtime helpers",
	              },
	              {
	                "id": "execute-feature",
	                "status": "pending",
	                "summary": "Wire runtime tools to feature execution.",
	                "title": "Implement execution flow",
	              },
	            ],
	            "finalReviewPolicy": "detailed",
	            "goal": "Build a workflow plugin",
	            "id": "<session-id>",
	            "lastFeatureResult": null,
	            "lastNextStep": null,
	            "lastOutcome": null,
	            "lastOutcomeKind": null,
	            "lastReviewerDecision": null,
	            "lastValidationRun": [],
	            "nextCommand": "/flow-plan",
	            "notes": [],
	            "planOverview": "Create one setup feature and one execution feature.",
	            "planSummary": "Implement a small workflow feature set.",
	            "planning": {
	              "repoProfile": [],
	              "research": [],
	            },
	            "status": "planning",
	          },
	          "status": "planning",
	          "summary": "Implement a small workflow feature set.",
	        },
	        "running": {
	          "session": {
	            "activeFeature": {
	              "id": "setup-runtime",
	              "status": "in_progress",
	              "summary": "Add runtime helper files and state persistence.",
	              "title": "Create runtime helpers",
	            },
	            "approval": "approved",
	            "artifacts": [],
	            "closure": null,
	            "completion": {
	              "activeFeatureTriggersSessionCompletion": false,
	              "canCompleteWithPendingFeatures": false,
	              "completedFeatures": 0,
	              "remainingBeyondTarget": 0,
	              "targetCompletedFeatures": 2,
	              "totalFeatures": 2,
	            },
	            "featureLines": [
	              "setup-runtime (in_progress): Create runtime helpers",
	              "execute-feature (pending): Implement execution flow",
	            ],
	            "featureProgress": {
	              "completed": 0,
	              "total": 2,
	            },
	            "features": [
	              {
	                "id": "setup-runtime",
	                "status": "in_progress",
	                "summary": "Add runtime helper files and state persistence.",
	                "title": "Create runtime helpers",
	              },
	              {
	                "id": "execute-feature",
	                "status": "pending",
	                "summary": "Wire runtime tools to feature execution.",
	                "title": "Implement execution flow",
	              },
	            ],
	            "finalReviewPolicy": "detailed",
	            "goal": "Build a workflow plugin",
	            "id": "<session-id>",
	            "lastFeatureResult": null,
	            "lastNextStep": null,
	            "lastOutcome": null,
	            "lastOutcomeKind": null,
	            "lastReviewerDecision": null,
	            "lastValidationRun": [],
	            "nextCommand": "/flow-run",
	            "notes": [],
	            "planOverview": "Create one setup feature and one execution feature.",
	            "planSummary": "Implement a small workflow feature set.",
	            "planning": {
	              "repoProfile": [],
	              "research": [],
	            },
	            "status": "running",
	          },
	          "status": "running",
	          "summary": "Running feature 'setup-runtime'.",
	        },
	      }
	      `);
	});

	test("flow_status returns the unchanged default summary shape for planning/running/blocked/completed fixtures", async () => {
		const tools = createTestTools();

		for (const session of Object.values(buildSummaryFixtureSessions())) {
			const worktree = makeTempDir();
			await saveSession(worktree, session);

			const response = await tools.flow_status.execute(
				{},
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);

			const expectedSessionSummary =
				session.status === "completed"
					? summarizeSession(null)
					: summarizeSession(session);
			const expectedGuidance =
				session.status === "completed"
					? explainSessionState(null)
					: explainSessionState(session);
			const {
				guidance: parsedGuidance,
				operatorSummary: parsedOperatorSummary,
				...parsedBase
			} = parsed;
			expect(normalizeFlowStatusFixture(parsedBase)).toEqual(
				normalizeSummaryFixture(expectedSessionSummary),
			);
			expect(parsedGuidance).toEqual(expectedGuidance);
			expect(typeof parsedOperatorSummary).toBe("string");
		}
	});

	test("summarizeSession exposes threshold-based final completion context while other features remain pending", async () => {
		const worktree = makeTempDir();
		const thresholdPlan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
		};

		const running = assertOk(
			startRun(
				assertOk(
					approvePlan(
						assertOk(
							applyPlan(
								createSession("Build a workflow plugin"),
								thresholdPlan,
							),
						),
					),
				),
			),
		).session;
		const summary = summarizeSession(running);

		expect(summary.session?.completion).toEqual({
			activeFeatureTriggersSessionCompletion: true,
			canCompleteWithPendingFeatures: true,
			completedFeatures: 0,
			remainingBeyondTarget: 1,
			targetCompletedFeatures: 1,
			totalFeatures: 2,
		});

		await saveSession(worktree, running);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(indexDoc).toContain("completion target: 1/2 features");
		expect(indexDoc).toContain("pending allowed at completion: yes");
		expect(indexDoc).toContain(
			"active feature triggers session completion: yes",
		);
		expect(indexDoc).not.toContain("final review required");
	});

	test("summarizeSession exposes a runtime decisionGate for blocking planning decisions", () => {
		const session = createSession("Build a workflow plugin");
		session.planning.decisionLog = [
			{
				question: "Should Flow ship a minimal cut or wait for full parity?",
				decisionMode: "autonomous_choice",
				decisionDomain: "delivery",
				options: [{ label: "Ship minimal", tradeoffs: ["faster"] }],
				recommendation: "Ship minimal",
				rationale: ["A safe default exists."],
			},
			{
				question: "Should Flow rewrite the API surface now?",
				decisionMode: "recommend_confirm",
				decisionDomain: "architecture",
				options: [
					{ label: "Rewrite now", tradeoffs: ["cleaner"] },
					{ label: "Defer", tradeoffs: ["safer"] },
				],
				recommendation: "Defer",
				rationale: ["A breaking rewrite needs confirmation."],
			},
		];

		const summary = summarizeSession(session);

		expect(summary.session?.decisionGate).toEqual({
			status: "recommend_confirm",
			domain: "architecture",
			question: "Should Flow rewrite the API surface now?",
			recommendation: "Defer",
			rationale: ["A breaking rewrite needs confirmation."],
		});
	});

	test("deriveNextCommand covers planning, runnable, blocked-human, and completed branches", () => {
		const planning = createSession("Build a workflow plugin");
		expect(deriveNextCommand(planning)).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);

		const applied = applyPlan(planning, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		expect(deriveNextCommand(applied.value)).toBe(FLOW_PLAN_COMMAND);

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		expect(deriveNextCommand(approved.value)).toBe(FLOW_RUN_COMMAND);

		const running = startRun(approved.value);
		expect(running.ok).toBe(true);
		if (!running.ok) return;

		expect(deriveNextCommand(running.value.session)).toBe(FLOW_RUN_COMMAND);

		const blocked = {
			...approved.value,
			status: "blocked" as const,
			execution: {
				...approved.value.execution,
				lastFeatureId: "setup-runtime",
				lastOutcome: {
					kind: "blocked_external" as const,
					summary: "Waiting on human decision.",
					needsHuman: true,
				},
			},
		};

		expect(deriveNextCommand(blocked)).toBe(FLOW_STATUS_COMMAND);

		const completed = { ...approved.value, status: "completed" as const };
		expect(deriveNextCommand(completed)).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
	});

	test("suggests resetting blocked features when the outcome is retryable", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const blocked = completeRun(started.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "Validation exposed a recoverable repo issue.",
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
			validationRun: [
				{
					command: "bun test",
					status: "failed",
					summary: "A repo test failed.",
				},
			],
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [{ summary: "Investigate and repair the failing path." }],
			nextStep: "Research the failure, fix it, and rerun the feature.",
			outcome: {
				kind: "contract_error",
				summary: "The runtime completion path needs another iteration.",
				resolutionHint:
					"Reset the feature and rerun it after fixing the issue.",
				retryable: true,
				autoResolvable: true,
				needsHuman: false,
			},
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "failed",
			},
			featureReview: {
				status: "needs_followup",
				summary: "More work is required.",
				blockingFindings: [],
			},
		});
		expect(blocked.ok).toBe(true);
		if (!blocked.ok) return;

		expect(summarizeSession(blocked.value).session?.nextCommand).toBe(
			flowResetFeatureCommand("setup-runtime"),
		);
	});
});
