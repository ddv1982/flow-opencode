import { describe, expect, test } from "bun:test";
import { SessionSchema } from "../src/application/schema.js";
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

const FOUNDATION = "foundation";
const DELIVERY = "delivery";
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
		featureId: FeatureId;
		scope: ValidationScope;
		sourceDigest?: SourceDigest;
		exitCode?: number;
		outputComplete?: boolean;
	},
): Session {
	const run = session.runs.find((candidate) => candidate.state === "active");
	if (!run) throw new Error("Expected an active run.");
	return recordValidation(session, {
		captureId: options.id,
		featureId: options.featureId,
		runId: run.id,
		scope: options.scope,
		command: options.scope === "broad" ? "bun test" : "bun test focused",
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
): { session: Session; assignment: ReviewAssignment } {
	const result = startReview(
		session,
		{
			operationId,
			expectedRevision: session.revision,
			featureId,
			sourceDigest: SOURCE_A,
			artifactsChanged: [{ path: `src/${featureId}.ts` }],
			packet: { summary: `Review ${featureId}.`, riskLenses: [] },
		},
		environment,
	);
	return { session: result.session, assignment: result.value };
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

		const reset = resetFeature(session, {
			operationId: "reset-foundation",
			expectedRevision: session.revision,
			featureId: FOUNDATION,
		});
		expect(reset.value).toEqual([FOUNDATION, DELIVERY]);
		expect(reset.session.runs[0]?.state).toBe("superseded");

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
	});

	test("bounds validation observations and assigns every applicable passing observation", () => {
		const environment = deterministicEnvironment();
		let session = begin(
			approve(saveDraft(environment)),
			FOUNDATION,
			environment,
		);
		for (let index = 1; index <= 16; index += 1) {
			session = validate(session, {
				id: `validation-${index}`,
				featureId: FOUNDATION,
				scope: index % 2 === 0 ? "broad" : "focused",
			});
		}
		expect(() =>
			validate(session, {
				id: "validation-over-limit",
				featureId: FOUNDATION,
				scope: "focused",
			}),
		).toThrow("at most 16 validation observations");

		const review = requestReview(session, FOUNDATION, environment);
		expect(review.assignment.validationIds).toEqual(
			Array.from({ length: 16 }, (_, index) => `validation-${index + 1}`),
		);
		expect(
			SessionSchema.safeParse(structuredClone(review.session)).success,
		).toBe(true);
	});
});
