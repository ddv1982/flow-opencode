import { describe, expect, test } from "bun:test";
import { SessionSchema } from "../src/application/schema.js";
import { compactProjection } from "../src/application/session-projection.js";
import {
	MAX_PLAN_FEATURES,
	MAX_VALIDATIONS_PER_RUN,
} from "../src/domain/limits.js";
import type {
	FeatureId,
	Plan,
	ReviewAssignment,
	Session,
	SourceDigest,
	ValidationScope,
} from "../src/domain/session.js";
import {
	approvePlan,
	closeSession,
	completeFeature,
	type FeatureCompleteInput,
	recordValidation,
	resetFeature,
	savePlan,
	sessionStatus,
	startReview,
	startRun,
	type TransitionEnvironment,
} from "../src/domain/transitions.js";
import { unresolvedVetoedCommands } from "../src/domain/validation.js";

const FOUNDATION = "foundation";
const DELIVERY = "delivery";
const PLANNED_GATE = "bun run verify:fast";
const PROSE_VALIDATION =
	"Exercise the delivered behavior and its main failure mode.";
const SUBSTITUTE_GATE = "bun run frontend:check && cargo test --workspace";
const SOURCE_A = `sha256:${"a".repeat(64)}` as SourceDigest;
const SOURCE_B = `sha256:${"b".repeat(64)}` as SourceDigest;
const OUTPUT = `sha256:${"f".repeat(64)}` as SourceDigest;

const plan: Plan = {
	summary: "Ship the small Flow runtime.",
	overview: "Build the kernel, then expose it.",
	requirements: ["Keep lifecycle state canonical."],
	decisions: ["Use one full review per run."],
	features: [
		{
			id: FOUNDATION,
			title: "Foundation",
			summary: "Build the lifecycle kernel.",
			targets: ["src/domain"],
			validation: ["bun test tests/domain-transitions.test.ts"],
			dependsOn: [],
		},
		{
			id: DELIVERY,
			title: "Delivery",
			summary: "Expose the lifecycle kernel.",
			targets: ["src/platform"],
			validation: ["bun test"],
			dependsOn: [FOUNDATION],
		},
	],
};

function oneFeaturePlan(validation: string[]): Plan {
	const feature = plan.features.find(({ id }) => id === DELIVERY);
	if (!feature) throw new Error("Expected the delivery plan feature.");
	return { ...plan, features: [{ ...feature, validation, dependsOn: [] }] };
}

const plannedGatePlan = oneFeaturePlan([
	PROSE_VALIDATION,
	PLANNED_GATE,
	PLANNED_GATE,
]);

function deterministicEnvironment(): TransitionEnvironment {
	const sequences = new Map<string, number>();
	return {
		newId(kind) {
			const next = (sequences.get(kind) ?? 0) + 1;
			sequences.set(kind, next);
			return `${kind}-${next}`;
		},
	};
}

function saveDraft(
	environment: TransitionEnvironment,
	overrides: Partial<Parameters<typeof savePlan>[1]> = {},
): Session {
	return savePlan(
		null,
		{
			operationId: "plan-save-1",
			expectedRevision: 0,
			goal: "Ship Flow v6",
			plan,
			...overrides,
		},
		environment,
	).session;
}

function approve(session: Session, operationId = "plan-approve-1"): Session {
	return approvePlan(session, {
		operationId,
		expectedRevision: session.revision,
	}).session;
}

function begin(
	session: Session,
	featureId: FeatureId,
	environment: TransitionEnvironment,
	operationId = `run-start-${featureId}`,
): Session {
	return startRun(
		session,
		{ operationId, expectedRevision: session.revision, featureId },
		environment,
	).session;
}

function validate(
	session: Session,
	options: {
		id: string;
		featureId?: FeatureId;
		scope?: ValidationScope;
		command?: string;
		sourceDigest?: SourceDigest;
		exitCode?: number;
		outputComplete?: boolean;
	},
): Session {
	const run = session.runs.find((candidate) => candidate.state === "active");
	if (!run) throw new Error("Expected an active run.");
	return recordValidation(session, {
		captureId: options.id,
		featureId: options.featureId ?? DELIVERY,
		runId: run.id,
		scope: options.scope ?? "broad",
		command:
			options.command ??
			(options.featureId === undefined
				? PLANNED_GATE
				: options.scope === "focused"
					? "bun test focused"
					: "bun test"),
		sourceDigest: options.sourceDigest ?? SOURCE_A,
		exitCode: options.exitCode ?? 0,
		outputDigest: OUTPUT,
		outputComplete: options.outputComplete ?? true,
	}).session;
}

function requestReview(
	session: Session,
	featureId: FeatureId,
	environment: TransitionEnvironment,
	operationId = `review-start-${featureId}`,
	sourceDigest = SOURCE_A,
	expectedRevision = session.revision,
): { session: Session; assignment: ReviewAssignment; replayed: boolean } {
	const result = startReview(
		session,
		{
			operationId,
			expectedRevision,
			featureId,
			sourceDigest,
			artifactsChanged: [{ path: `src/${featureId}.ts` }],
			packet: { summary: `Review ${featureId}.`, riskLenses: [] },
		},
		environment,
	);
	return {
		session: result.session,
		assignment: result.value,
		replayed: result.replayed,
	};
}

function pass(
	session: Session,
	featureId: FeatureId,
	assignment: ReviewAssignment,
	operationId = `feature-complete-${featureId}`,
): Session {
	return completeFeature(session, {
		operationId,
		expectedRevision: session.revision,
		featureId,
		assignmentId: assignment.id,
		summary: `Completed ${featureId}.`,
		result: {
			verdict: "passed",
			findings: [],
			terminalDisposition: "submitted",
		},
	}).session;
}

function rejectReview(
	session: Session,
	featureId: FeatureId,
	assignment: ReviewAssignment,
	operationId = `feature-reject-${featureId}`,
): Session {
	return completeFeature(session, {
		operationId,
		expectedRevision: session.revision,
		featureId,
		assignmentId: assignment.id,
		summary: `Review blocked ${featureId}.`,
		result: {
			verdict: "failed",
			findings: [
				{
					severity: "blocking",
					summary: `${featureId} still has a defect.`,
					evidence: `src/${featureId}.ts:1`,
				},
			],
			terminalDisposition: "submitted",
		},
	}).session;
}

function beginPlannedGateSession(environment: TransitionEnvironment): Session {
	return begin(
		approve(saveDraft(environment, { plan: plannedGatePlan })),
		DELIVERY,
		environment,
	);
}

function retryPlannedGate(
	session: Session,
	environment: TransitionEnvironment,
): Session {
	const reset = resetFeature(session, {
		operationId: "reset-planned-gate",
		expectedRevision: session.revision,
		featureId: DELIVERY,
	}).session;
	return begin(reset, DELIVERY, environment, "run-start-planned-gate-retry");
}

describe("Session v5 domain state machine", () => {
	test("binds a planless abandoned close to its exact operation", () => {
		const planless: Session = {
			version: 5,
			id: "planless-session",
			revision: 0,
			goal: "Record an abandoned attempt.",
			approval: "pending",
			plan: null,
			runs: [],
			operations: [],
			closure: null,
		};
		const closed = closeSession(planless, {
			operationId: "close-planless",
			expectedRevision: 0,
			sessionId: planless.id,
			kind: "abandoned",
			summary: "Nothing was started.",
		}).session;
		expect(SessionSchema.safeParse(closed).success).toBe(true);
		if (!closed.closure) throw new Error("Expected a recorded closure.");

		expect(SessionSchema.safeParse({ ...closed, operations: [] }).success).toBe(
			false,
		);
		expect(
			SessionSchema.safeParse({
				...closed,
				operations: closed.operations.map((operation) => ({
					...operation,
					kind: "plan-save",
				})),
			}).success,
		).toBe(false);
		expect(
			SessionSchema.safeParse({
				...closed,
				closure: { ...closed.closure, recordedRevision: 0 },
			}).success,
		).toBe(false);
		expect(
			SessionSchema.safeParse({
				...closed,
				closure: { ...closed.closure, summary: "Changed later." },
			}).success,
		).toBe(false);
	});

	test("validates the plan DAG and requires approval before one run can become active", () => {
		const environment = deterministicEnvironment();
		const draft = saveDraft(environment);

		expect(draft).toMatchObject({
			version: 5,
			id: "session-1",
			revision: 1,
			approval: "pending",
		});
		expect(sessionStatus(draft)).toBe("planning");
		expect(() => begin(draft, FOUNDATION, environment)).toThrow(
			"Approve a plan",
		);

		const approved = approve(draft);
		expect(sessionStatus(approved)).toBe("ready");
		expect(() => begin(approved, DELIVERY, environment)).toThrow(
			"incomplete dependencies",
		);

		const running = begin(approved, FOUNDATION, environment);
		expect(sessionStatus(running)).toBe("running");
		expect(running.runs).toEqual([
			expect.objectContaining({
				id: "run-1",
				featureId: FOUNDATION,
				attempt: 1,
				state: "active",
			}),
		]);
		expect(() =>
			begin(running, DELIVERY, environment, "run-start-while-active"),
		).toThrow("Only one feature run may be active");

		const cyclic: Plan = {
			...plan,
			features: plan.features.map((feature) => ({
				...feature,
				dependsOn: feature.id === FOUNDATION ? [DELIVERY] : [FOUNDATION],
			})),
		};
		expect(() =>
			savePlan(
				null,
				{
					operationId: "cyclic-plan",
					expectedRevision: 0,
					goal: "Reject a cycle",
					plan: cyclic,
				},
				environment,
			),
		).toThrow("dependency graph is cyclic");
	});

	test("replays only the exact operation and rejects stale or conflicting mutations", () => {
		const environment = deterministicEnvironment();
		const input = {
			operationId: "plan-save-idempotent",
			expectedRevision: 0,
			goal: "Ship Flow v6",
			plan,
		} as const;
		const first = savePlan(null, input, environment);
		const replay = savePlan(first.session, input, environment);

		expect(replay.replayed).toBe(true);
		expect(replay.session).toBe(first.session);
		expect(replay.session.revision).toBe(1);
		expect(() =>
			savePlan(
				first.session,
				{ ...input, goal: "Different work" },
				environment,
			),
		).toThrow("operationId was already used for different work");
		expect(() =>
			approvePlan(first.session, {
				operationId: "stale-approval",
				expectedRevision: 0,
			}),
		).toThrow("Stale revision 0");
	});

	test("stores validation on the run and derives one feature review followed by one broad final review", () => {
		const environment = deterministicEnvironment();
		const states: Array<[string, number, ReturnType<typeof sessionStatus>]> =
			[];
		let session = saveDraft(environment);
		states.push(["draft", session.revision, sessionStatus(session)]);
		session = approve(session);
		states.push(["approved", session.revision, sessionStatus(session)]);

		session = begin(session, FOUNDATION, environment);
		session = validate(session, {
			id: "validation-foundation",
			featureId: FOUNDATION,
			scope: "focused",
		});
		const firstReview = requestReview(session, FOUNDATION, environment);
		session = firstReview.session;
		expect(firstReview.assignment).toMatchObject({
			id: "review-1",
			kind: "feature",
			validationIds: ["validation-foundation"],
			result: null,
		});
		expect(firstReview.assignment.packet).not.toHaveProperty(
			"artifactsChanged",
		);
		expect(
			session.runs.find((run) => run.featureId === FOUNDATION)
				?.artifactsChanged,
		).toEqual([{ path: "src/foundation.ts" }]);
		expect(() =>
			requestReview(session, FOUNDATION, environment, "duplicate-review"),
		).toThrow("pending review assignment");
		session = pass(session, FOUNDATION, firstReview.assignment);

		session = begin(session, DELIVERY, environment);
		session = validate(session, {
			id: "validation-delivery-focused",
			featureId: DELIVERY,
			scope: "focused",
		});
		expect(() => requestReview(session, DELIVERY, environment)).toThrow(
			"Final review requires passing broad validation",
		);

		session = validate(session, {
			id: "validation-delivery-broad",
			featureId: DELIVERY,
			scope: "broad",
		});
		const finalReview = requestReview(session, DELIVERY, environment);
		session = finalReview.session;
		expect(finalReview.assignment).toMatchObject({
			id: "review-2",
			kind: "final",
			validationIds: [
				"validation-delivery-focused",
				"validation-delivery-broad",
			],
		});
		expect(
			session.runs.find((run) => run.featureId === DELIVERY)?.reviews,
		).toHaveLength(1);
		expect(() =>
			validate(session, {
				id: "validation-after-review",
				featureId: DELIVERY,
				scope: "broad",
			}),
		).toThrow("after review has begun");
		expect(() =>
			closeSession(session, {
				operationId: "close-too-soon",
				expectedRevision: session.revision,
				sessionId: session.id,
				kind: "completed",
				summary: "Not finished.",
			}),
		).toThrow("requires every planned feature");

		session = pass(session, DELIVERY, finalReview.assignment);
		expect(() =>
			resetFeature(session, {
				operationId: "reset-completed-delivery",
				expectedRevision: session.revision,
				featureId: DELIVERY,
			}),
		).toThrow("active or blocked feature run");
		states.push(["completed", session.revision, sessionStatus(session)]);
		const closed = closeSession(session, {
			operationId: "close-completed",
			expectedRevision: session.revision,
			sessionId: session.id,
			kind: "completed",
			summary: "All planned work passed review.",
		}).session;
		states.push(["closed", closed.revision, sessionStatus(closed)]);

		expect(states).toEqual([
			["draft", 1, "planning"],
			["approved", 2, "ready"],
			["completed", 11, "completed"],
			["closed", 12, "closed"],
		]);
		expect(closed.closure).toMatchObject({
			kind: "completed",
			operationId: "close-completed",
			recordedRevision: 12,
		});
		expect(SessionSchema.parse(structuredClone(closed))).toEqual(closed);
		if (!closed.closure) throw new Error("Expected a recorded closure.");
		const wrongClosureOperation: Session = {
			...closed,
			closure: {
				...closed.closure,
				operationId: closed.operations[0]?.id ?? "missing-operation",
			},
		};
		expect(SessionSchema.safeParse(wrongClosureOperation).success).toBe(false);
		const wrongClosureRevision: Session = {
			...closed,
			closure: { ...closed.closure, recordedRevision: 0 },
		};
		expect(SessionSchema.safeParse(wrongClosureRevision).success).toBe(false);
		const changedClosurePayload: Session = {
			...closed,
			closure: { ...closed.closure, summary: "Changed after close." },
		};
		expect(SessionSchema.safeParse(changedClosurePayload).success).toBe(false);
		const crossRunEvidence: Session = {
			...closed,
			runs: closed.runs.map((run) =>
				run.featureId === DELIVERY
					? {
							...run,
							reviews: run.reviews.map((review) => ({
								...review,
								validationIds: ["validation-foundation"],
							})),
						}
					: run,
			),
		};
		expect(SessionSchema.safeParse(crossRunEvidence).success).toBe(false);
		const mismatchedSource: Session = {
			...closed,
			runs: closed.runs.map((run) => ({
				...run,
				reviews: run.reviews.map((review) => ({
					...review,
					sourceDigest: SOURCE_B,
				})),
			})),
		};
		expect(SessionSchema.safeParse(mismatchedSource).success).toBe(false);
		const ineligibleReviewEvidence: Session = {
			...closed,
			runs: closed.runs.map((run) => ({
				...run,
				validations: run.validations.map((validation) => ({
					...validation,
					ineligibleReason: "source-drift",
				})),
			})),
		};
		expect(SessionSchema.safeParse(ineligibleReviewEvidence).success).toBe(
			false,
		);
		const downgradedFinal: Session = {
			...closed,
			runs: closed.runs.map((run) =>
				run.featureId === DELIVERY
					? {
							...run,
							validations: run.validations.map((validation) => ({
								...validation,
								scope: "focused",
							})),
							reviews: run.reviews.map((review) => ({
								...review,
								kind: "feature",
							})),
						}
					: run,
			),
		};
		expect(SessionSchema.safeParse(downgradedFinal).success).toBe(false);
		const laterValidation: Session = {
			...closed,
			runs: closed.runs.map((run) => ({
				...run,
				validations: run.validations.map((validation) => ({
					...validation,
					recordedRevision:
						run.reviews[0]?.createdRevision ?? validation.recordedRevision,
				})),
			})),
		};
		expect(SessionSchema.safeParse(laterValidation).success).toBe(false);
	});

	test("a failed review blocks execution and reset creates a fresh full run", () => {
		const environment = deterministicEnvironment();
		let session = begin(
			approve(saveDraft(environment)),
			FOUNDATION,
			environment,
		);
		session = validate(session, {
			id: "validation-before-failure",
			featureId: FOUNDATION,
			scope: "focused",
		});
		const review = requestReview(session, FOUNDATION, environment);
		session = review.session;
		const invalidResults: Array<{
			result: FeatureCompleteInput["result"];
			message: string;
		}> = [
			{
				result: {
					verdict: "failed",
					findings: [],
					terminalDisposition: "submitted",
				},
				message: "requires a blocking finding",
			},
			{
				result: {
					verdict: "passed",
					findings: [
						{
							severity: "blocking",
							summary: "Supported blocker.",
							evidence: "src/domain/transitions.ts: completion gate",
						},
					],
					terminalDisposition: "submitted",
				},
				message: "cannot contain blocking findings",
			},
			{
				result: {
					verdict: "passed",
					findings: [],
					terminalDisposition: "observed_unsubmitted",
				},
				message: "must fail closed",
			},
		];
		for (const [index, { result, message }] of invalidResults.entries()) {
			expect(() =>
				completeFeature(session, {
					operationId: `invalid-review-${index}`,
					expectedRevision: session.revision,
					featureId: FOUNDATION,
					assignmentId: review.assignment.id,
					summary: "The review result is inconsistent.",
					result,
				}),
			).toThrow(message);
		}
		expect(() =>
			completeFeature(session, {
				operationId: "feature-failed-without-evidence",
				expectedRevision: session.revision,
				featureId: FOUNDATION,
				assignmentId: review.assignment.id,
				summary: "The review claimed a correctness issue.",
				result: {
					verdict: "failed",
					findings: [{ severity: "blocking", summary: "Unsupported blocker." }],
					terminalDisposition: "submitted",
				},
			}),
		).toThrow("requires concrete evidence");
		session = completeFeature(session, {
			operationId: "feature-failed",
			expectedRevision: session.revision,
			featureId: FOUNDATION,
			assignmentId: review.assignment.id,
			summary: "The review found a correctness issue.",
			result: {
				verdict: "failed",
				findings: [
					{
						severity: "blocking",
						summary: "Completion can bypass review.",
						evidence: "src/domain/transitions.ts: completion gate",
					},
				],
				terminalDisposition: "submitted",
			},
		}).session;

		expect(sessionStatus(session)).toBe("blocked");
		expect(() =>
			begin(session, FOUNDATION, environment, "retry-without-reset"),
		).toThrow("Reset blocked feature");
		expect(() =>
			begin(session, DELIVERY, environment, "start-other-while-blocked"),
		).toThrow("Reset blocked feature 'foundation'");
		const blockedRevision = session.revision;
		expect(() =>
			resetFeature(
				session,
				{
					operationId: "reset-foundation-start-dependent",
					expectedRevision: session.revision,
					featureId: FOUNDATION,
					nextFeatureId: DELIVERY,
				},
				environment,
			),
		).toThrow("incomplete dependencies");
		expect(session.revision).toBe(blockedRevision);

		const resetInput = {
			operationId: "reset-foundation",
			expectedRevision: session.revision,
			featureId: FOUNDATION,
		} as const;
		const reset = resetFeature(session, resetInput);
		expect(reset.value).toEqual([FOUNDATION, DELIVERY]);
		expect(reset.session.runs[0]?.state).toBe("superseded");
		expect(resetFeature(reset.session, resetInput)).toMatchObject({
			replayed: true,
			value: [FOUNDATION, DELIVERY],
		});

		const retry = begin(
			reset.session,
			FOUNDATION,
			environment,
			"retry-full-run",
		);
		expect(retry.runs.at(-1)).toMatchObject({
			id: "run-2",
			featureId: FOUNDATION,
			attempt: 2,
			state: "active",
			validations: [],
			reviews: [],
			artifactsChanged: [],
		});
		expect(SessionSchema.safeParse(structuredClone(retry)).success).toBe(true);
		expect(
			SessionSchema.safeParse({
				...structuredClone(retry),
				runs: [...structuredClone(retry.runs)].reverse(),
			}).success,
		).toBe(false);
	});

	test("requires explicit retries while independent untouched work continues", () => {
		const environment = deterministicEnvironment();
		const templateFeature = plan.features[0];
		if (!templateFeature) throw new Error("Expected a template feature.");
		const independentPlan: Plan = {
			...plan,
			features: ["feature-a", "feature-b", "feature-c"].map((id) => ({
				...templateFeature,
				id,
				title: id,
				dependsOn: [],
			})),
		};
		let session = begin(
			approve(saveDraft(environment, { plan: independentPlan })),
			"feature-a",
			environment,
		);
		session = validate(session, {
			id: "validation-a",
			featureId: "feature-a",
			scope: "focused",
		});
		const reviewA = requestReview(session, "feature-a", environment);
		session = rejectReview(reviewA.session, "feature-a", reviewA.assignment);

		const resetInput = {
			operationId: "reset-a-start-b",
			expectedRevision: session.revision,
			featureId: "feature-a",
			nextFeatureId: "feature-b",
		} as const;
		const atomic = resetFeature(session, resetInput, environment);
		expect(atomic.value).toMatchObject({
			featureId: "feature-b",
			state: "active",
		});
		expect(atomic.session.revision).toBe(session.revision + 1);
		expect(atomic.session.operations.at(-1)).toMatchObject({
			kind: "feature-reset",
			entityId: "run-2",
		});
		expect(SessionSchema.safeParse(atomic.session).success).toBe(true);
		expect(() =>
			resetFeature(
				atomic.session,
				{ ...resetInput, nextFeatureId: "feature-c" },
				environment,
			),
		).toThrow("operationId was already used for different work");

		session = validate(atomic.session, {
			id: "validation-b",
			featureId: "feature-b",
			scope: "focused",
		});
		const reviewB = requestReview(session, "feature-b", environment);
		session = pass(reviewB.session, "feature-b", reviewB.assignment);
		const replay = resetFeature(session, resetInput, environment);
		expect(replay).toMatchObject({
			replayed: true,
			value: { id: "run-2", featureId: "feature-b", state: "completed" },
		});
		expect(compactProjection(replay.session).status).toBe("ready");

		const defaultC = startRun(
			session,
			{
				operationId: "run-start-default-c",
				expectedRevision: session.revision,
			},
			environment,
		);
		expect(defaultC.value.featureId).toBe("feature-c");
		session = validate(defaultC.session, {
			id: "validation-c",
			featureId: "feature-c",
			scope: "focused",
		});
		const reviewC = requestReview(session, "feature-c", environment);
		session = pass(reviewC.session, "feature-c", reviewC.assignment);
		expect(compactProjection(session).nextAction).toBe("await-user-direction");
		expect(() =>
			startRun(
				session,
				{
					operationId: "implicit-retry-a",
					expectedRevision: session.revision,
				},
				environment,
			),
		).toThrow("No runnable feature");

		session = begin(session, "feature-a", environment, "explicit-retry-a");
		expect(session.runs.at(-1)).toMatchObject({
			featureId: "feature-a",
			attempt: 2,
		});
		const activeRetryRevision = session.revision;
		expect(() =>
			resetFeature(
				session,
				{
					operationId: "reset-a-start-completed-b",
					expectedRevision: session.revision,
					featureId: "feature-a",
					nextFeatureId: "feature-b",
				},
				environment,
			),
		).toThrow("Feature 'feature-b' is complete");
		expect(session.revision).toBe(activeRetryRevision);
		session = resetFeature(session, {
			operationId: "reset-unreviewed-retry-a",
			expectedRevision: session.revision,
			featureId: "feature-a",
		}).session;
		expect(compactProjection(session).nextAction).toBe("await-user-direction");
	});

	test("enforces exact planned gates across observations and retries", () => {
		const rejecting: Array<
			[
				name: string,
				observations: Array<Parameters<typeof validate>[1]>,
				source?: SourceDigest,
			]
		> = [
			["immediate", [{ id: "immediate-failure", exitCode: 1 }]],
			[
				"latest-incomplete",
				[
					{ id: "first-pass" },
					{ id: "latest-incomplete", outputComplete: false },
				],
			],
			[
				"current-source",
				[
					{ id: "source-a-failure", exitCode: 1 },
					{ id: "source-b-pass", sourceDigest: SOURCE_B },
					{ id: "source-a-substitute", command: SUBSTITUTE_GATE },
				],
				SOURCE_A,
			],
		];
		for (const [name, observations, source] of rejecting) {
			const environment = deterministicEnvironment();
			let session = beginPlannedGateSession(environment);
			for (const observation of observations) {
				session = validate(session, observation);
			}
			expect(() =>
				requestReview(
					session,
					DELIVERY,
					environment,
					`review-${name}`,
					source ?? SOURCE_A,
				),
			).toThrow(PLANNED_GATE);
		}

		const retryEnvironment = deterministicEnvironment();
		let retry = validate(beginPlannedGateSession(retryEnvironment), {
			id: "prior-attempt-failure",
			exitCode: 1,
		});
		const failedRun = retry.runs.at(-1);
		if (!failedRun) throw new Error("Expected the failed planned-gate run.");
		expect(unresolvedVetoedCommands(retry, failedRun, SOURCE_A)).toEqual([
			PLANNED_GATE,
		]);
		retry = validate(retry, { id: "prior-attempt-pass" });
		const passedRun = retry.runs.at(-1);
		if (!passedRun) throw new Error("Expected the passing planned-gate run.");
		expect(unresolvedVetoedCommands(retry, passedRun, SOURCE_A)).toEqual([]);
		retry = retryPlannedGate(retry, retryEnvironment);
		retry = validate(retry, {
			id: "retry-substitute",
			command: SUBSTITUTE_GATE,
		});
		expect(() =>
			requestReview(retry, DELIVERY, retryEnvironment, "review-substitute"),
		).toThrow(PLANNED_GATE);
		retry = validate(retry, { id: "retry-exact-pass" });
		expect(
			requestReview(retry, DELIVERY, retryEnvironment, "review-retry")
				.assignment.validationIds,
		).toEqual(["retry-substitute", "retry-exact-pass"]);
		expect(retry.plan?.features[0]?.validation).toEqual([
			PROSE_VALIDATION,
			PLANNED_GATE,
			PLANNED_GATE,
		]);
	});

	test("does not reuse broad evidence observed before a later failure", () => {
		const environment = deterministicEnvironment();
		let session = begin(
			approve(saveDraft(environment, { plan: oneFeaturePlan(["bun test"]) })),
			DELIVERY,
			environment,
		);
		session = validate(session, {
			id: "old-broad-pass",
			featureId: DELIVERY,
			command: "bun test",
			scope: "broad",
		});
		session = validate(session, {
			id: "later-failure",
			featureId: DELIVERY,
			command: "bun test",
			scope: "broad",
			exitCode: 1,
		});
		session = validate(session, {
			id: "fresh-focused-pass",
			featureId: DELIVERY,
			command: "bun test",
			scope: "focused",
		});
		expect(() =>
			requestReview(
				session,
				DELIVERY,
				environment,
				"review-with-stale-broad-pass",
			),
		).toThrow("Final review requires passing broad validation");
	});

	test("blocks a narrower command relabelled broad after the gate failed", () => {
		const environment = deterministicEnvironment();
		// Prose-only plan validation, so nothing but the `broad` claim can engage the
		// veto. This is the recorded failure mode: the gate is observed red, then a
		// smaller command is armed under the same label and review accepts it.
		let session = begin(
			approve(
				saveDraft(environment, { plan: oneFeaturePlan([PROSE_VALIDATION]) }),
			),
			DELIVERY,
			environment,
		);
		session = validate(session, {
			id: "gate-failure",
			featureId: DELIVERY,
			command: "bun test",
			scope: "broad",
			exitCode: 1,
		});
		session = validate(session, {
			id: "narrower-relabelled",
			featureId: DELIVERY,
			command: "bun test src/greet.test.ts",
			scope: "broad",
		});
		const run = session.runs.at(-1);
		if (!run) throw new Error("Expected the active run.");
		expect(unresolvedVetoedCommands(session, run, SOURCE_A)).toEqual([
			"bun test",
		]);
		expect(compactProjection(session).nextAction).toBe("flow_validation_start");
		expect(() =>
			requestReview(session, DELIVERY, environment, "review-relabelled"),
		).toThrow('"bun test"');
		// The same command passing for current source is the only discharge.
		session = validate(session, {
			id: "gate-pass",
			featureId: DELIVERY,
			command: "bun test",
			scope: "broad",
		});
		expect(
			requestReview(session, DELIVERY, environment, "review-gate-pass")
				.assignment.validationIds,
		).toEqual(["narrower-relabelled", "gate-pass"]);
	});

	test("blocks the review of the feature the gate failed under", () => {
		const environment = deterministicEnvironment();
		// What makes the veto's per-feature scope safe. A red broad gate cannot be
		// walked away from by moving to a feature whose runs do not carry it: this
		// feature's own review is blocked too, and `completed` closure needs every
		// feature to pass. Prose-only validation again, so only the claim engages.
		let session = begin(
			approve(
				saveDraft(environment, {
					plan: {
						...plan,
						features: plan.features.map((feature) => ({
							...feature,
							validation: [PROSE_VALIDATION],
						})),
					},
				}),
			),
			FOUNDATION,
			environment,
		);
		session = validate(session, {
			id: "foundation-gate-failure",
			featureId: FOUNDATION,
			command: "bun test",
			scope: "broad",
			exitCode: 1,
		});
		session = validate(session, {
			id: "foundation-relabelled",
			featureId: FOUNDATION,
			command: "bun test src/greet.test.ts",
			scope: "broad",
		});
		expect(() =>
			requestReview(session, FOUNDATION, environment, "review-foundation"),
		).toThrow('"bun test"');
	});

	test("admits the maximum planned gates plus separate broad evidence", () => {
		expect(MAX_VALIDATIONS_PER_RUN).toBe(MAX_PLAN_FEATURES + 1);
		const commands = Array.from(
			{ length: MAX_PLAN_FEATURES },
			(_, index) => `bun run planned:${index + 1}`,
		);
		const environment = deterministicEnvironment();
		let session = begin(
			approve(saveDraft(environment, { plan: oneFeaturePlan(commands) })),
			DELIVERY,
			environment,
		);
		for (const [index, command] of commands.entries()) {
			session = validate(session, {
				id: `prior-failure-${index + 1}`,
				command,
				exitCode: 1,
				scope: "focused",
			});
		}
		session = retryPlannedGate(session, environment);
		const passingIds: string[] = [];
		for (const [index, command] of commands.entries()) {
			const id = `current-pass-${index + 1}`;
			passingIds.push(id);
			session = validate(session, { id, command, scope: "focused" });
		}
		passingIds.push("current-broad");
		session = validate(session, {
			id: "current-broad",
			command: SUBSTITUTE_GATE,
		});
		expect(() =>
			validate(session, { id: "over-limit", command: "bun run extra" }),
		).toThrow(`at most ${MAX_VALIDATIONS_PER_RUN} validation observations`);
		const review = requestReview(
			session,
			DELIVERY,
			environment,
			"review-maximum-plan",
		);
		expect(review.assignment).toMatchObject({
			kind: "final",
			validationIds: passingIds,
		});
		SessionSchema.parse(structuredClone(review.session));
	});

	test("grandfathers review assignments admitted before exact-gate policy", () => {
		const environment = deterministicEnvironment();
		// Focused, so only the plan listing vetoes it: the legacy admission below
		// swaps in a prose-only plan to reconstruct state accepted before that veto
		// existed, and a `broad` failure would be vetoed on its own evidence.
		let prospective = validate(beginPlannedGateSession(environment), {
			id: "legacy-exact-failure",
			scope: "focused",
			exitCode: 1,
		});
		prospective = validate(prospective, {
			id: "legacy-substitute-pass",
			command: SUBSTITUTE_GATE,
		});
		expect(() =>
			requestReview(prospective, DELIVERY, environment, "new-admission"),
		).toThrow(PLANNED_GATE);

		const accepted = requestReview(
			{ ...prospective, plan: oneFeaturePlan([PROSE_VALIDATION]) },
			DELIVERY,
			environment,
			"legacy-admission",
		);
		const legacySession = accepted.session;
		const grandfathered: Session = { ...legacySession, plan: prospective.plan };
		expect(accepted.assignment.validationIds).toHaveLength(1);
		expect(accepted.assignment.validationIds[0]).toBe("legacy-substitute-pass");
		SessionSchema.parse(structuredClone(grandfathered));
		expect(
			requestReview(
				grandfathered,
				DELIVERY,
				environment,
				"legacy-admission",
				SOURCE_A,
				prospective.revision,
			).replayed,
		).toBe(true);
		const completed = pass(grandfathered, DELIVERY, accepted.assignment);
		expect(sessionStatus(completed)).toBe("completed");
		const closed = closeSession(completed, {
			operationId: "close-grandfathered",
			expectedRevision: completed.revision,
			sessionId: completed.id,
			kind: "completed",
			summary: "Previously accepted review completed.",
		}).session;
		expect(sessionStatus(closed)).toBe("closed");
	});
});
