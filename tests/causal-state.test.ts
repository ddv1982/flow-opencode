import { describe, expect, test } from "bun:test";
import { SessionSchema } from "../src/application/schema.js";
import {
	type ReviewAssignment,
	type Session,
	toFeatureId,
	toSessionId,
} from "../src/domain/session.js";
import { validateSessionInvariants } from "../src/domain/session-invariants.js";
import {
	applyPlan,
	approvePlan,
	canonicalReviewAssignmentResultDigest,
	canonicalSessionSnapshotId,
	causalDeltaProjection,
	closeSession,
	compactSessionProjection,
	createSession,
	detailSessionProjection,
	executionSessionProjection,
	MAX_EXECUTION_PROJECTION_BYTES,
	mutationReceiptProjection,
	resetFeature,
	reviewerSessionProjection,
	serializedUtf8JsonBytes,
	startRun,
	type TransitionEnvironment,
	validateCausalChain,
} from "../src/domain/transitions.js";
import { validationCommandClass } from "../src/domain/validation-command.js";

const environment: TransitionEnvironment = {
	now: () => "2026-07-18T12:00:00.000Z",
	newSessionId: () => toSessionId("causal-session"),
	newOperationId: (revision) => `operation-${revision}`,
};

const featureId = toFeatureId("causal-state");
const SOURCE_DIGEST = `sha256:${"1".repeat(64)}`;
const FEATURE_PACKET_DIGEST = `sha256:${"4".repeat(64)}`;
const FINAL_PACKET_DIGEST = `sha256:${"5".repeat(64)}`;

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("Expected a successful transition.");
	return result.value;
}

function runningSession(featureCount = 1) {
	const created = createSession("Build causal Flow state", environment);
	const features = Array.from({ length: featureCount }, (_, index) => ({
		id: index === 0 ? featureId : toFeatureId(`feature-${index + 1}`),
		title: `Feature ${index + 1}`,
		summary: "A bounded feature summary. ".repeat(10),
		reviewDepth: "standard" as const,
		targets: Array.from(
			{ length: 30 },
			(_, targetIndex) =>
				`src/feature-${index + 1}/very-long-assigned-target-${targetIndex}.ts`,
		),
		dependsOn: [],
	}));
	const planned = unwrap(
		applyPlan(
			created,
			{
				summary: "Causal state",
				overview: "Use immutable identities and bounded projections.",
				finalReviewPolicy: "detailed",
				features,
			},
			environment,
		),
	);
	const approved = unwrap(approvePlan(planned, environment));
	return unwrap(startRun(approved, environment, featureId)).session;
}

function withReviewAssignment(
	session: Session,
	reviewKind: "feature" | "final" = "feature",
	requiredDepth: ReviewAssignment["requiredDepth"] = "standard",
	id = `review-assignment:${reviewKind}`,
): { session: Session; assignment: ReviewAssignment } {
	if (!session.activeFeatureRunId || !session.activeFeatureId) {
		throw new Error("Expected an active native feature run.");
	}
	const prerequisiteAssignment =
		reviewKind === "final"
			? session.reviewAssignments.find(
					(assignment) => assignment.reviewKind === "feature",
				)
			: undefined;
	const prerequisiteResult = prerequisiteAssignment
		? {
				assignmentId: prerequisiteAssignment.id,
				verdict: "passed" as const,
				findings: [],
				completedAt: prerequisiteAssignment.startedAt,
				terminalDisposition: "submitted" as const,
			}
		: null;
	const assignment: ReviewAssignment = {
		id,
		operationId: `start-${id}`,
		featureRunId: session.activeFeatureRunId,
		featureId: session.activeFeatureId,
		reviewKind,
		validationScope: reviewKind === "final" ? "broad" : "targeted",
		validationEvidenceRefs: [],
		sourceDigest: SOURCE_DIGEST,
		packetDigest:
			reviewKind === "final" ? FINAL_PACKET_DIGEST : FEATURE_PACKET_DIGEST,
		packetSummary: `Review the ${reviewKind} assignment.`,
		riskLenses: [],
		prerequisite: prerequisiteResult
			? {
					assignmentId: prerequisiteResult.assignmentId,
					result: prerequisiteResult,
					resultDigest:
						canonicalReviewAssignmentResultDigest(prerequisiteResult),
				}
			: null,
		attemptId: `review-attempt:${reviewKind}`,
		logicalPassId: `review-pass:${reviewKind}`,
		startedAt: environment.now(),
		requiredDepth,
		status: "pending",
		completedAt: null,
		invalidatedAt: null,
		invalidationReason: null,
	};
	return {
		session: {
			...session,
			reviewAssignments: [...session.reviewAssignments, assignment],
		},
		assignment,
	};
}

function utf8Bytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe("causal session state", () => {
	test("starts at a canonical revision-zero snapshot", () => {
		const session = createSession("Canonical creation", environment);

		expect(session.version).toBe(4);
		expect(session.causal.revision).toBe(0);
		expect(session.causal.mutations).toEqual([]);
		expect(session.causal.evidence).toEqual([]);
		expect(session.causal.snapshotId).toBe(canonicalSessionSnapshotId(session));
	});

	test("advances exactly once per committed transition and preserves the chain", () => {
		const created = createSession("Chain mutations", environment);
		const planned = unwrap(
			applyPlan(
				created,
				{
					summary: "One feature",
					overview: "Verify revision chaining.",
					features: [
						{
							id: featureId,
							title: "Causal feature",
							summary: "Track mutations.",
						},
					],
				},
				environment,
			),
		);
		const approved = unwrap(approvePlan(planned, environment));
		const running = unwrap(startRun(approved, environment, featureId)).session;

		expect(created.causal.revision).toBe(0);
		expect(planned.causal.revision).toBe(1);
		expect(approved.causal.revision).toBe(2);
		expect(running.causal.revision).toBe(3);
		expect(running.causal.mutations).toHaveLength(3);
		expect(
			running.causal.mutations.map((mutation) => [
				mutation.priorRevision,
				mutation.revision,
			]),
		).toEqual([
			[0, 1],
			[1, 2],
			[2, 3],
		]);
		for (const [index, mutation] of running.causal.mutations.entries()) {
			const priorSnapshot =
				index === 0
					? created.causal.snapshotId
					: running.causal.mutations[index - 1]?.currentSnapshotId;
			if (!priorSnapshot) throw new Error("Expected a prior snapshot.");
			expect(mutation.priorSnapshotId).toBe(priorSnapshot);
		}
		expect(created.plan).toBeNull();
	});

	test("copies receipt changed entities instead of aliasing causal history", () => {
		const session = runningSession();
		const mutation = session.causal.mutations.at(-1);
		const receipt = mutationReceiptProjection(session);
		if (!mutation || !receipt.changedEntity) {
			throw new Error("Expected a mutation receipt entity.");
		}

		receipt.changedEntity.id = "mutated-receipt";

		expect(mutation.changedEntity.id).not.toBe("mutated-receipt");
	});

	test("returns complete execution context with derived finality and copied arrays", () => {
		const nonFinalSession = runningSession(2);
		const nonFinalPlan = nonFinalSession.plan;
		const activeFeature = nonFinalPlan?.features[0];
		if (!nonFinalPlan || !activeFeature) {
			throw new Error("Expected an approved active plan.");
		}
		const before = structuredClone(nonFinalSession);
		const nonFinal = unwrap(executionSessionProjection(nonFinalSession));

		expect(nonFinal).toEqual({
			view: "execution",
			featureRunId: nonFinalSession.activeFeatureRunId ?? undefined,
			goal: nonFinalSession.goal,
			plan: {
				summary: nonFinalPlan.summary,
				overview: nonFinalPlan.overview,
				requirements: nonFinalPlan.requirements,
				decisions: nonFinalPlan.decisions,
				finalReviewPolicy: nonFinalPlan.finalReviewPolicy,
			},
			feature: {
				id: featureId,
				title: "Feature 1",
				summary: "A bounded feature summary. ".repeat(10),
				targets: activeFeature.targets,
				validation: [],
				dependsOn: [],
				reviewDepth: "standard",
			},
			isFinalFeature: false,
			requiredValidationScope: "targeted",
			expectedRevision: nonFinalSession.causal.revision,
			expectedSnapshotId: nonFinalSession.causal.snapshotId,
		});
		nonFinal.plan.requirements.push("projection-owned");
		nonFinal.plan.decisions.push("projection-owned");
		nonFinal.feature.targets.push("projection-owned.ts");
		nonFinal.feature.validation.push("projection-owned validation");
		nonFinal.feature.dependsOn.push(featureId);
		expect(nonFinalSession).toEqual(before);
		expect(nonFinal).not.toHaveProperty("truncated");
		expect(nonFinal).not.toHaveProperty("hasMore");
		expect(nonFinal).not.toHaveProperty("nextCursor");

		const finalSession = runningSession();
		const final = unwrap(executionSessionProjection(finalSession));
		expect(final.isFinalFeature).toBe(true);
		expect(final.requiredValidationScope).toBe("broad");
	});

	test("rejects oversized hand-edited execution state without truncating it", () => {
		const session = runningSession();
		if (!session.plan) throw new Error("Expected an approved plan.");
		const oversized = {
			...session,
			plan: {
				...session.plan,
				overview: "🔥".repeat(4_000),
			},
		};

		const result = executionSessionProjection(oversized);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected runtime oversize rejection.");
		expect(result.message).toContain(`${MAX_EXECUTION_PROJECTION_BYTES}`);
		expect(result.recovery).toContain("never truncated");
	});

	test("rejects execution context without an approved active feature", () => {
		const created = createSession(
			"Execution requires active work",
			environment,
		);
		expect(executionSessionProjection(created).ok).toBe(false);
		const planned = unwrap(
			applyPlan(
				created,
				{
					summary: "Execution context",
					overview: "Start before execution.",
					features: [
						{
							id: featureId,
							title: "Inactive",
							summary: "Not started.",
						},
					],
				},
				environment,
			),
		);
		const approved = unwrap(approvePlan(planned, environment));
		const inactive = executionSessionProjection(approved);
		expect(inactive.ok).toBe(false);
		if (inactive.ok) throw new Error("Expected inactive execution rejection.");
		expect(inactive.message).toContain("active in-progress");
	});

	test("admits multibyte plans by serialized bytes and rejects oversized context", () => {
		const created = createSession(
			"Measure multibyte execution context",
			environment,
		);
		const accepted = applyPlan(
			created,
			{
				summary: "Within budget",
				overview: "🔥".repeat(1_000),
				features: [
					{
						id: featureId,
						title: "Multibyte",
						summary: "Admitted by UTF-8 JSON size.",
					},
				],
			},
			environment,
		);
		expect(accepted.ok).toBe(true);
		if (!accepted.ok) throw new Error("Expected within-budget plan.");
		const running = unwrap(
			startRun(unwrap(approvePlan(accepted.value, environment)), environment),
		).session;
		expect(
			serializedUtf8JsonBytes(unwrap(executionSessionProjection(running))),
		).toBeLessThanOrEqual(MAX_EXECUTION_PROJECTION_BYTES);

		const multibyte = "🔥".repeat(4_000);
		expect(multibyte.length).toBeLessThan(MAX_EXECUTION_PROJECTION_BYTES);
		const rejected = applyPlan(
			created,
			{
				summary: "Over budget",
				overview: multibyte,
				features: [
					{
						id: featureId,
						title: "Too large",
						summary: "Reject the entire plan.",
					},
				],
			},
			environment,
		);
		expect(rejected.ok).toBe(false);
		if (rejected.ok) throw new Error("Expected oversized plan rejection.");
		expect(rejected.message).toContain(`${MAX_EXECUTION_PROJECTION_BYTES}`);
		expect(created.causal.revision).toBe(0);
	});

	test("classifies scope references lexically before bounded projection", () => {
		const session = runningSession();
		const unsafeTargets = [
			"/Users/private/secret.ts",
			"\\root\\private.ts",
			"C:\\private\\secret.ts",
			"C:relative\\secret.ts",
			"\\\\server\\share\\secret.ts",
			"\\\\?\\C:\\private\\device.ts",
			"https://example.com/secret.ts",
			"file:private/secret.ts",
			"~",
			"~/private.ts",
			"~someone/private.ts",
			"src/../private.ts",
			"src\\..\\private.ts",
		];
		const safeTargets = [
			"  src\\feature.ts  ",
			"foo..bar",
			"...",
			".well-known",
		];
		const targets = [...unsafeTargets, ...safeTargets];
		const scoped = {
			...session,
			plan: session.plan
				? {
						...session.plan,
						features: session.plan.features.map((feature, index) =>
							index === 0 ? { ...feature, targets } : feature,
						),
					}
				: null,
		};
		const execution = unwrap(executionSessionProjection(scoped));
		const repeated = unwrap(executionSessionProjection(scoped));
		const detail = detailSessionProjection(scoped);
		const assigned = withReviewAssignment(scoped);
		const reviewer = unwrap(
			reviewerSessionProjection(assigned.session, {
				assignmentId: assigned.assignment.id,
			}),
		);
		const detailTargets = detail.plan?.features[0]?.targets ?? [];
		for (const index of unsafeTargets.keys()) {
			const transformed = execution.feature.targets[index];
			expect(transformed).toMatch(/^sha256:[a-f0-9]{64}$/);
			expect(transformed).toBe(repeated.feature.targets[index]);
			expect(detailTargets[index]).toBe(transformed);
			if (index < reviewer.assignedScope.length) {
				expect(reviewer.assignedScope[index]).toBe(transformed);
			}
		}
		expect(execution.feature.targets.slice(unsafeTargets.length)).toEqual([
			"src\\feature.ts",
			"foo..bar",
			"...",
			".well-known",
		]);
		for (const unsafe of unsafeTargets) {
			expect(execution.feature.targets).not.toContain(unsafe.trim());
		}
		const serialized = JSON.stringify({ execution, detail, reviewer });
		expect(serialized).not.toContain("/Users/private");
		expect(serialized).not.toContain("example.com/secret");
		expect(serialized).not.toContain("C:relative");
		expect(serialized).not.toContain("device.ts");
	});

	test("keeps compact, reviewer, and mutation receipt projections bounded", () => {
		const session = runningSession(6);
		const before = JSON.stringify(session);
		const compact = compactSessionProjection(session);
		const privateScopeSession = {
			...session,
			plan: session.plan
				? {
						...session.plan,
						features: session.plan.features.map((feature, index) =>
							index === 0
								? {
										...feature,
										targets: [`/Users/private/${"🔥".repeat(500)}.ts`],
									}
								: feature,
						),
					}
				: null,
		};
		const assigned = withReviewAssignment(privateScopeSession);
		const reviewer = unwrap(
			reviewerSessionProjection(assigned.session, {
				assignmentId: assigned.assignment.id,
			}),
		);
		const receipt = mutationReceiptProjection(session, ["🔥".repeat(1000)]);
		const detail = detailSessionProjection(session);

		expect(utf8Bytes(compact)).toBeLessThanOrEqual(3000);
		expect(utf8Bytes(reviewer)).toBeLessThanOrEqual(3000);
		expect(utf8Bytes(receipt)).toBeLessThanOrEqual(2000);
		expect(JSON.stringify(reviewer)).not.toContain("/Users/private");
		expect(reviewer.reviewKind).toBe("feature");
		expect(reviewer.requiredDepth).toBe("standard");
		expect(detail.view).toBe("detail");
		expect(JSON.stringify(session)).toBe(before);
		expect(compact.feature?.id).toBe(featureId);
		expect(compact.feature).not.toHaveProperty("reviewDepth");
		expect(compact).not.toHaveProperty("evidenceRefs");
		expect(compact.closure).toBeNull();
		expect("nextFeature" in compact).toBe(false);
		const closed = unwrap(
			closeSession(
				session,
				"deferred",
				environment,
				"Pause with compact routing context.",
				{
					operationId: "close-for-compact-projection",
					expectedRevision: session.causal.revision,
					expectedSnapshotId: session.causal.snapshotId,
				},
			),
		);
		expect(compactSessionProjection(closed).closure).toEqual({
			kind: "deferred",
			retryOperationId: "close-for-compact-projection",
		});
	});

	test("returns unchanged metadata, bounded ordered deltas, and rejects future polls", () => {
		const session = runningSession();
		const unchanged = unwrap(
			causalDeltaProjection(session, session.causal.revision),
		);
		const delta = unwrap(causalDeltaProjection(session, 0));
		const future = causalDeltaProjection(session, session.causal.revision + 1);

		expect(unchanged).toMatchObject({ changed: false, mutations: [] });
		expect(delta.changed).toBe(true);
		expect(delta.mutations.map((mutation) => mutation.revision)).toEqual([
			1, 2, 3,
		]);
		expect(delta.hasMore).toBe(false);
		expect(future.ok).toBe(false);
	});

	test("rejects relational corruption across active pointers, runs, assignments, and history", () => {
		const running = runningSession();
		const run = running.featureRuns.find(
			(candidate) => candidate.id === running.activeFeatureRunId,
		);
		const runningFeature = running.plan?.features[0];
		if (!run || !running.plan || !runningFeature) {
			throw new Error("Expected active run state.");
		}
		const assigned = withReviewAssignment(running);
		const brokenAssignment = {
			...assigned.session,
			reviewAssignments: assigned.session.reviewAssignments.map((candidate) =>
				candidate.id === assigned.assignment.id
					? { ...candidate, featureRunId: "feature-run:missing" }
					: candidate,
			),
		};
		const terminal = {
			...running,
			status: "ready" as const,
			activeFeatureId: null,
			activeFeatureRunId: null,
			featureRuns: [
				{ ...run, status: "completed" as const, endedAt: environment.now() },
			],
			plan: {
				...running.plan,
				features: [
					...running.plan.features.map((feature) => ({
						...feature,
						status: "completed" as const,
					})),
					{
						...runningFeature,
						id: toFeatureId("causal-state-pending"),
						dependsOn: [],
						status: "pending" as const,
					},
				],
			},
			history: [
				{
					featureRunId: run.id,
					featureId: run.featureId,
					status: "completed" as const,
					summary: "Corrupt unresolved history references.",
					recordedAt: environment.now(),
					artifactsChanged: [],
					validationScope: "targeted" as const,
					validationEvidenceRefs: [SOURCE_DIGEST],
					reviewAssignmentIds: ["review-assignment:missing"],
					outcome: {
						kind: "completed" as const,
						summary: "Corrupt unresolved history references.",
					},
					orchestrationPasses: [],
				},
			],
		};
		const cases = [
			{
				name: "active pointer pair",
				state: { ...running, activeFeatureId: null },
				error: "present or absent together",
			},
			{
				name: "active run status",
				state: {
					...running,
					featureRuns: [
						{ ...run, status: "reset" as const, endedAt: environment.now() },
					],
				},
				error: "exactly one active feature run",
			},
			{
				name: "plan feature status",
				state: {
					...running,
					plan: {
						...running.plan,
						features: running.plan.features.map((feature) => ({
							...feature,
							status: "pending" as const,
						})),
					},
				},
				error: "running session requires exactly one in-progress feature",
			},
			{
				name: "assignment run reference",
				state: brokenAssignment,
				error: "does not match its feature run",
			},
			{
				name: "terminal ownership",
				state: terminal,
				error: "runtime-owned terminal mutation",
			},
		];

		for (const corruption of cases) {
			expect(
				validateSessionInvariants(corruption.state),
				corruption.name,
			).toContain(corruption.error);
			expect(
				SessionSchema.safeParse(corruption.state).success,
				corruption.name,
			).toBe(false);
		}
	});

	test("paginates deltas without advertising records it did not return", () => {
		let session = runningSession();
		for (let index = 0; index < 13; index += 1) {
			session = unwrap(
				resetFeature(session, featureId, environment, {
					operationId: `delta-reset-${index}`,
					expectedRevision: session.causal.revision,
					expectedSnapshotId: session.causal.snapshotId,
				}),
			);
			session = unwrap(startRun(session, environment, featureId)).session;
		}

		const first = unwrap(causalDeltaProjection(session, 0));
		expect(first.hasMore).toBe(true);
		const lastFirstRevision = first.mutations.at(-1)?.revision;
		if (lastFirstRevision === undefined) {
			throw new Error("Expected a bounded first delta page.");
		}
		expect(first.throughRevision).toBe(lastFirstRevision);
		expect(first.currentRevision).toBe(session.causal.revision);
		expect(first.nextSinceRevision).toBe(first.throughRevision);
		expect(utf8Bytes(first)).toBeLessThanOrEqual(3_000);
		const second = unwrap(
			causalDeltaProjection(session, first.nextSinceRevision ?? 0),
		);
		expect(second.mutations[0]?.revision).toBe(first.throughRevision + 1);
	});

	test("authenticates the causal chain and replays an operation idempotently", () => {
		const running = runningSession();
		const guard = {
			operationId: "causal-reset-replay",
			expectedRevision: running.causal.revision,
			expectedSnapshotId: running.causal.snapshotId,
		};
		const reset = unwrap(resetFeature(running, featureId, environment, guard));
		const replayed = unwrap(resetFeature(reset, featureId, environment, guard));

		expect(replayed).toEqual(reset);
		expect(validateCausalChain(reset)).toBeNull();
		const latest = reset.causal.mutations.at(-1);
		if (!latest) throw new Error("Expected a causal mutation.");
		const tampered = {
			...reset,
			causal: {
				...reset.causal,
				mutations: [
					...reset.causal.mutations.slice(0, -1),
					{ ...latest, operationId: "forged-operation" },
				],
			},
		};
		expect(validateCausalChain(tampered)).toContain("invalid digest");
	});

	test("rejects operation-id reuse across operation kinds and request payloads", () => {
		const running = runningSession();
		const firstOperationId = running.causal.mutations[0]?.operationId;
		const thirdOperationId = running.causal.mutations[2]?.operationId;
		if (!firstOperationId || !thirdOperationId) {
			throw new Error("Expected three setup mutations.");
		}

		const resetCollision = resetFeature(running, featureId, environment, {
			operationId: firstOperationId,
			expectedRevision: running.causal.revision,
			expectedSnapshotId: running.causal.snapshotId,
		});

		expect(resetCollision.ok).toBe(false);
		if (resetCollision.ok)
			throw new Error("Expected reset operation collision.");
		expect(resetCollision.message).toContain("different request");

		const closeCollision = closeSession(
			running,
			"deferred",
			environment,
			"Pause safely.",
			{
				operationId: thirdOperationId,
				expectedRevision: running.causal.revision,
				expectedSnapshotId: running.causal.snapshotId,
			},
		);
		expect(closeCollision.ok).toBe(false);
		if (closeCollision.ok)
			throw new Error("Expected close operation collision.");
		expect(closeCollision.message).toContain("different request");
		expect(running.causal.revision).toBe(3);
	});

	test("classifies validation commands through one domain-owned precedence", () => {
		const cases = [
			["bun test && tsc --noEmit", "typecheck"],
			["swiftc -typecheck Sources/App.swift", "typecheck"],
			["swift test", "test"],
			["bun run typecheck", "typecheck"],
			["biome check src", "lint"],
			["xcodebuild -scheme App", "build"],
			["biome format src", "format"],
			["smoke check", "smoke"],
			["healthcheck", "other"],
			["custom verifier", "other"],
		] as const;

		for (const [command, expected] of cases) {
			expect(validationCommandClass(command)).toBe(expected);
		}
	});

	test("projects feature and final policy from durable assignments", () => {
		const session = runningSession();
		if (!session.plan) throw new Error("Expected an approved plan.");
		const plan = {
			...session.plan,
			finalReviewPolicy: "broad" as const,
			requirements: ["Preserve causal truth."],
			decisions: ["Use one immutable review packet."],
			features: session.plan.features.map((feature) => ({
				...feature,
				reviewDepth: "quick" as const,
				targets: ["src/domain", "tests"],
			})),
		};
		const approved = { ...session, plan };
		const featureAssigned = withReviewAssignment(
			approved,
			"feature",
			"quick",
			"review-assignment:feature-policy",
		);
		const finalAssigned = withReviewAssignment(
			featureAssigned.session,
			"final",
			"broad",
			"review-assignment:final-policy",
		);

		const feature = unwrap(
			reviewerSessionProjection(finalAssigned.session, {
				assignmentId: featureAssigned.assignment.id,
			}),
		);
		const final = unwrap(
			reviewerSessionProjection(finalAssigned.session, {
				assignmentId: finalAssigned.assignment.id,
			}),
		);

		expect(feature).toMatchObject({
			reviewKind: "feature",
			requiredDepth: "quick",
			assignedScope: ["src/domain", "tests"],
		});
		expect(final).toMatchObject({
			reviewKind: "final",
			requiredDepth: "broad",
			assignedScope: ["src/domain", "tests"],
		});
	});

	test("rejects reviewer recovery without a durable assignment", () => {
		const created = createSession("Reject premature review", environment);
		const planned = unwrap(
			applyPlan(
				created,
				{
					summary: "Review later",
					overview: "Review only approved active work.",
					features: [
						{
							id: featureId,
							title: "Pending",
							summary: "Not active yet.",
						},
					],
				},
				environment,
			),
		);
		const missing = reviewerSessionProjection(planned, {
			assignmentId: "review-assignment:missing",
		});
		expect(missing.ok).toBe(false);
		if (missing.ok) throw new Error("Expected missing assignment rejection.");
		expect(missing.message).toContain("was not found");
		expect(missing.recovery).toContain("flow_review_start");
	});

	test("replays an exact guarded reset but rejects a changed reset request", () => {
		const running = runningSession(2);
		const guard = {
			operationId: "reset-causal-feature",
			expectedRevision: running.causal.revision,
			expectedSnapshotId: running.causal.snapshotId,
		};
		const reset = unwrap(resetFeature(running, featureId, environment, guard));
		const replayed = unwrap(resetFeature(reset, featureId, environment, guard));
		expect(replayed).toEqual(reset);
		const rerun = unwrap(startRun(reset, environment, featureId)).session;
		const changedAssignment = resetFeature(rerun, featureId, environment, {
			operationId: guard.operationId,
			expectedRevision: rerun.causal.revision,
			expectedSnapshotId: rerun.causal.snapshotId,
		});
		expect(changedAssignment.ok).toBe(false);
		if (changedAssignment.ok) {
			throw new Error("Expected changed causal assignment rejection.");
		}
		expect(changedAssignment.message).toContain("different request");

		const changedRequest = resetFeature(
			reset,
			toFeatureId("feature-2"),
			environment,
			guard,
		);
		expect(changedRequest.ok).toBe(false);
		if (changedRequest.ok) throw new Error("Expected changed reset rejection.");
		expect(changedRequest.message).toContain("different request");
	});

	test("fails preflight for a forged genesis and avoids duplicate generated ids", () => {
		const created = createSession("Protect the chain root", environment);
		const forgedGenesis = {
			...created,
			causal: {
				...created.causal,
				genesisSnapshotId: `sha256:${"9".repeat(64)}`,
			},
		};
		const rejected = applyPlan(
			forgedGenesis,
			{
				summary: "Must reject",
				overview: "Do not launder a forged causal root.",
				features: [
					{
						id: featureId,
						title: "Forged",
						summary: "Should never be applied.",
					},
				],
			},
			environment,
		);
		expect(rejected.ok).toBe(false);
		if (rejected.ok) throw new Error("Expected forged genesis rejection.");
		expect(rejected.message).toContain("invalid");

		const duplicateEnvironment: TransitionEnvironment = {
			...environment,
			newSessionId: () => toSessionId("s"),
			newOperationId: () => "s:operation:2",
		};
		const planned = unwrap(
			applyPlan(
				createSession("Avoid generated collisions", duplicateEnvironment),
				{
					summary: "Unique operations",
					overview: "Fall back deterministically when generated ids collide.",
					features: [
						{
							id: featureId,
							title: "Unique",
							summary: "Keep operation ids unique.",
						},
					],
				},
				duplicateEnvironment,
			),
		);
		const approved = unwrap(approvePlan(planned, duplicateEnvironment));
		const running = unwrap(
			startRun(approved, duplicateEnvironment, featureId),
		).session;
		expect(
			new Set(running.causal.mutations.map((item) => item.operationId)).size,
		).toBe(running.causal.mutations.length);
		expect(validateCausalChain(running)).toBeNull();
	});
});
