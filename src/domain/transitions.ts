import { artifactIssues } from "./artifact.js";
import { MAX_REVIEW_FINDINGS, MAX_SESSION_ID_LENGTH } from "./limits.js";
import { operationInputDigest } from "./operation.js";
import { planIssue } from "./plan.js";
import {
	assignFindingIds,
	droppedFindingIds,
	findingIdPrefix,
} from "./review-findings.js";
import type {
	Artifact,
	FeatureId,
	FeatureRun,
	OperationKind,
	OperationRecord,
	Plan,
	ReviewAssignment,
	ReviewResult,
	Session,
	SessionClosure,
	SessionStatus,
	SourceDigest,
} from "./session.js";
import { reviewResultSemanticIssues } from "./session.js";
import { FlowTransitionError } from "./transition-error.js";
import {
	isValidationEligible,
	isValidationFresh,
	unresolvedVetoedCommands,
	unsatisfiedExternalEvidence,
} from "./validation.js";

export { FlowTransitionError } from "./transition-error.js";
export { recordValidation } from "./validation.js";
export type TransitionEnvironment = Readonly<{
	newId: (kind: "session" | "run" | "validation" | "review") => string;
}>;
type MutationResult<T> = Readonly<{
	session: Session;
	value: T;
	replayed: boolean;
}>;
type PlanSaveInput = Readonly<{
	operationId: string;
	expectedRevision: number;
	goal: string;
	plan: Plan;
}>;
type GuardedFeatureInput = Readonly<{
	operationId: string;
	expectedRevision: number;
	featureId: FeatureId;
}>;
type FeatureResetInput = GuardedFeatureInput &
	Readonly<{ nextFeatureId?: FeatureId | undefined }>;
type ReviewStartInput = GuardedFeatureInput &
	Readonly<{
		sourceDigest: SourceDigest;
		artifactsChanged: Artifact[];
		packet: Readonly<{
			summary: string;
			riskLenses: string[];
		}>;
	}>;
export type FeatureCompleteInput = GuardedFeatureInput &
	Readonly<{
		assignmentId: string;
		summary: string;
		result: Omit<ReviewResult, "recordedRevision">;
	}>;
type SessionCloseInput = Readonly<{
	operationId: string;
	expectedRevision: number;
	sessionId: string;
	kind: SessionClosure["kind"];
	summary: string;
}>;

function fail(message: string): never {
	throw new FlowTransitionError(message);
}

function copy<T>(value: T): T {
	return structuredClone(value);
}

function assertOperationId(operationId: string): void {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(operationId)) {
		fail("operationId must be 1-128 stable identifier characters.");
	}
}

function existingOperation(
	session: Session,
	kind: OperationKind,
	operationId: string,
	input: unknown,
): OperationRecord | null {
	assertOperationId(operationId);
	const existing = session.operations.find((item) => item.id === operationId);
	if (!existing) return null;
	if (
		existing.kind !== kind ||
		existing.inputDigest !== operationInputDigest(input)
	) {
		fail("operationId was already used for different work.");
	}
	return existing;
}

function assertRevision(session: Session, expectedRevision: number): void {
	if (expectedRevision !== session.revision) {
		fail(
			`Stale revision ${expectedRevision}; refresh Flow status and use revision ${session.revision}.`,
		);
	}
}

function commit(
	session: Session,
	kind: OperationKind,
	operationId: string,
	input: unknown,
	change: (draft: Session, revision: number) => Session,
	entityId?: string,
): Session {
	const revision = session.revision + 1;
	const draft = copy(session);
	const changed = change(draft, revision);
	return {
		...changed,
		revision,
		operations: [
			...changed.operations,
			{
				id: operationId,
				kind,
				inputDigest: operationInputDigest(input),
				committedRevision: revision,
				...(entityId ? { entityId } : {}),
			},
		],
	};
}

function assertMutable(session: Session): void {
	if (session.closure) fail("This Flow session is closed and archive-only.");
}

function assertPlan(plan: Plan): void {
	const issue = planIssue(plan);
	if (issue) fail(issue);
}

/**
 * A newly saved plan must name the repository's canonical gate.
 *
 * Checked here rather than in `planIssue` because it is a rule about what this
 * build writes, not an invariant every Session v5 document satisfies: a plan saved
 * before the field existed must still hydrate, and it keeps the weaker rule that a
 * `broad` label is the claimant's word.
 */
function assertDeclaredGate(plan: Plan): void {
	if (plan.gate === undefined) {
		fail(
			"A saved plan must declare `gate`: the exact canonical command that validates the whole repository, which every broad observation then has to run.",
		);
	}
}

/**
 * A newly saved plan must answer whether anything the goal asks for is unobservable
 * here.
 *
 * An empty list is a real answer and the common one. What the field removes is the
 * third state: a run that noticed the gap, wrote it into `requirements` as a
 * non-goal, and left nothing for the runtime to check. Requiring the field asks the
 * question while the answer is still cheap, which is the same reason `gate` is
 * required rather than inferred.
 */
function assertDeclaredExternalEvidence(plan: Plan): void {
	if (plan.externalEvidence === undefined) {
		fail(
			"A saved plan must declare `externalEvidence`: every acceptance observation needing an environment this host may not be, each with the exact command whose passing is that observation. Declare an empty list when the goal is fully observable here.",
		);
	}
}

function assertArtifacts(artifacts: readonly Artifact[]): void {
	const issue = artifactIssues(artifacts)[0];
	if (issue) fail(issue);
}

function currentRun(session: Session, featureId: string): FeatureRun | null {
	return (
		[...session.runs]
			.reverse()
			.find(
				(run) => run.featureId === featureId && run.state !== "superseded",
			) ?? null
	);
}

export function activeRun(session: Session): FeatureRun | null {
	return session.runs.find((run) => run.state === "active") ?? null;
}

export function isFeatureComplete(
	session: Session,
	featureId: string,
): boolean {
	return currentRun(session, featureId)?.state === "completed";
}

export function sessionStatus(session: Session): SessionStatus {
	if (session.closure) return "closed";
	if (!session.plan || session.approval === "pending") return "planning";
	if (activeRun(session)) return "running";
	if (
		session.plan.features.some(
			(feature) => currentRun(session, feature.id)?.state === "blocked",
		)
	) {
		return "blocked";
	}
	if (
		session.plan.features.every((feature) =>
			isFeatureComplete(session, feature.id),
		)
	) {
		return "completed";
	}
	return "ready";
}

export function savePlan(
	session: Session | null,
	input: PlanSaveInput,
	environment: TransitionEnvironment,
): MutationResult<null> {
	assertPlan(input.plan);
	assertDeclaredGate(input.plan);
	assertDeclaredExternalEvidence(input.plan);
	if (!session) {
		if (input.expectedRevision !== 0) {
			fail("A new Flow session must start from expectedRevision 0.");
		}
		const sessionId = environment.newId("session");
		if (sessionId.length > MAX_SESSION_ID_LENGTH)
			fail("Generated session id is too long.");
		const initial: Session = {
			version: 5,
			id: sessionId,
			revision: 0,
			goal: input.goal,
			approval: "pending",
			plan: null,
			runs: [],
			operations: [],
			closure: null,
		};
		return {
			session: commit(
				initial,
				"plan-save",
				input.operationId,
				input,
				(draft) => ({
					...draft,
					plan: copy(input.plan),
				}),
			),
			value: null,
			replayed: false,
		};
	}
	const replay = existingOperation(
		session,
		"plan-save",
		input.operationId,
		input,
	);
	if (replay) return { session, value: null, replayed: true };
	assertRevision(session, input.expectedRevision);
	assertMutable(session);
	if (session.approval === "approved") fail("An approved plan is immutable.");
	if (session.goal !== input.goal) {
		fail("Close the active session before starting a different goal.");
	}
	return {
		session: commit(
			session,
			"plan-save",
			input.operationId,
			input,
			(draft) => ({
				...draft,
				plan: copy(input.plan),
			}),
		),
		value: null,
		replayed: false,
	};
}

export function approvePlan(
	session: Session,
	input: Readonly<{ operationId: string; expectedRevision: number }>,
): MutationResult<null> {
	const replay = existingOperation(
		session,
		"plan-approve",
		input.operationId,
		input,
	);
	if (replay) return { session, value: null, replayed: true };
	assertRevision(session, input.expectedRevision);
	assertMutable(session);
	if (!session.plan) fail("Save a plan before approving it.");
	if (session.approval === "approved") fail("The plan is already approved.");
	return {
		session: commit(
			session,
			"plan-approve",
			input.operationId,
			input,
			(draft) => ({
				...draft,
				approval: "approved",
			}),
		),
		value: null,
		replayed: false,
	};
}

function requiresExplicitRetry(
	session: Session,
	featureId: FeatureId,
): boolean {
	const reviewed = session.runs.findLast(
		(run) => run.featureId === featureId && run.reviews.at(-1)?.result,
	);
	return reviewed?.reviews.at(-1)?.result?.verdict === "failed";
}

export function nextRunnableFeature(session: Session): FeatureId | null {
	if (!session.plan) return null;
	for (const feature of session.plan.features) {
		const state = currentRun(session, feature.id)?.state;
		if (state === "completed") continue;
		if (state === "blocked") continue;
		if (requiresExplicitRetry(session, feature.id)) continue;
		if (feature.dependsOn.every((id) => isFeatureComplete(session, id))) {
			return feature.id;
		}
	}
	return null;
}

function assertFeatureRunnable(session: Session, featureId: FeatureId): void {
	const feature = session.plan?.features.find((item) => item.id === featureId);
	if (!feature) fail(`Unknown feature '${featureId}'.`);
	const existing = currentRun(session, featureId);
	if (existing?.state === "completed")
		fail(`Feature '${featureId}' is complete.`);
	if (existing?.state === "blocked") {
		fail(`Reset blocked feature '${featureId}' before retrying it.`);
	}
	if (!feature.dependsOn.every((id) => isFeatureComplete(session, id))) {
		fail(`Feature '${featureId}' has incomplete dependencies.`);
	}
}

function createRun(
	session: Session,
	featureId: FeatureId,
	environment: TransitionEnvironment,
): FeatureRun {
	return {
		id: environment.newId("run"),
		featureId,
		attempt:
			session.runs.filter((run) => run.featureId === featureId).length + 1,
		state: "active",
		startedRevision: session.revision + 1,
		summary: null,
		artifactsChanged: [],
		validations: [],
		reviews: [],
	};
}

export function startRun(
	session: Session,
	input: Readonly<{
		operationId: string;
		expectedRevision: number;
		featureId?: FeatureId | undefined;
	}>,
	environment: TransitionEnvironment,
): MutationResult<FeatureRun> {
	const replay = existingOperation(
		session,
		"run-start",
		input.operationId,
		input,
	);
	if (replay) {
		const run = session.runs.find((item) => item.id === replay.entityId);
		if (!run) fail("The replayed run no longer exists.");
		return { session, value: run, replayed: true };
	}
	assertRevision(session, input.expectedRevision);
	assertMutable(session);
	if (!session.plan || session.approval !== "approved") {
		fail("Approve a plan before starting execution.");
	}
	if (activeRun(session)) fail("Only one feature run may be active.");
	const blocked = session.plan.features.find(
		(feature) => currentRun(session, feature.id)?.state === "blocked",
	);
	if (blocked) {
		fail(`Reset blocked feature '${blocked.id}' before starting another run.`);
	}
	const featureId = input.featureId ?? nextRunnableFeature(session);
	if (!featureId) fail("No runnable feature is available.");
	assertFeatureRunnable(session, featureId);
	const created = createRun(session, featureId, environment);
	const next = commit(
		session,
		"run-start",
		input.operationId,
		input,
		(draft) => ({ ...draft, runs: [...draft.runs, created] }),
		created.id,
	);
	return { session: next, value: created, replayed: false };
}

function isFinalFeatureRun(session: Session, run: FeatureRun): boolean {
	if (!session.plan) return false;
	return session.plan.features.every(
		(feature) =>
			feature.id === run.featureId || isFeatureComplete(session, feature.id),
	);
}

export function startReview(
	session: Session,
	input: ReviewStartInput,
	environment: TransitionEnvironment,
): MutationResult<ReviewAssignment> {
	assertArtifacts(input.artifactsChanged);
	const replay = existingOperation(
		session,
		"review-start",
		input.operationId,
		input,
	);
	if (replay) {
		const assignment = session.runs
			.flatMap((run) => run.reviews)
			.find((review) => review.id === replay.entityId);
		if (!assignment) fail("The replayed review assignment no longer exists.");
		return { session, value: assignment, replayed: true };
	}
	assertRevision(session, input.expectedRevision);
	assertMutable(session);
	const run = activeRun(session);
	if (!run || run.featureId !== input.featureId) {
		fail("Review must target the active feature run.");
	}
	if (run.reviews.some((review) => review.result === null)) {
		fail("The active run already has a pending review assignment.");
	}
	if (run.reviews.length > 0) {
		fail("Reset the feature before starting another full review.");
	}
	const unresolved = unresolvedVetoedCommands(session, run, input.sourceDigest);
	if (unresolved.length > 0) {
		fail(
			`Review requires passing these exact commands for the current workspace content: ${unresolved.map((command) => JSON.stringify(command)).join(", ")}. A different command cannot discharge one that failed.`,
		);
	}
	const kind = isFinalFeatureRun(session, run) ? "final" : "feature";
	// Only the final review, and deliberately: a run that split the goal into a
	// feature this host can prove and one it cannot, then passed the first and
	// blocked the second, produced the best outcome the eval matrix has recorded.
	// Vetoing every feature review over a plan-level gap would refuse that work.
	// The final review is where the whole plan is claimed verified, which is the
	// claim declared external evidence exists to hold.
	if (kind === "final") {
		const unsatisfied = unsatisfiedExternalEvidence(
			session,
			input.sourceDigest,
		);
		if (unsatisfied.length > 0) {
			fail(
				`Final review requires the plan's declared external evidence to pass for the current workspace content: ${unsatisfied
					.map(
						(entry) =>
							`${JSON.stringify(entry.command)} (${entry.environment}, for ${entry.requirement})`,
					)
					.join(
						", ",
					)}. A substitute observation cannot discharge it. If the environment is unavailable, ask the user to choose deferred or abandoned closure.`,
			);
		}
	}
	const applicable = run.validations.filter(
		(validation) =>
			isValidationEligible(validation, input.sourceDigest) &&
			isValidationFresh(session, run, validation),
	);
	const hasRequiredValidation =
		kind === "feature"
			? applicable.length > 0
			: applicable.some((validation) => validation.scope === "broad");
	if (!hasRequiredValidation) {
		fail(
			kind === "final"
				? "Final review requires passing broad validation for the current workspace content."
				: "Review requires passing validation for the current workspace content.",
		);
	}
	const assignmentId = environment.newId("review");
	let created: ReviewAssignment | null = null;
	const next = commit(
		session,
		"review-start",
		input.operationId,
		input,
		(draft, revision) => {
			created = {
				id: assignmentId,
				operationId: input.operationId,
				featureId: input.featureId,
				runId: run.id,
				kind,
				sourceDigest: input.sourceDigest,
				validationIds: applicable.map((validation) => validation.id),
				packet: {
					summary: input.packet.summary,
					riskLenses: [...input.packet.riskLenses],
				},
				createdRevision: revision,
				result: null,
			};
			return {
				...draft,
				runs: draft.runs.map((item) =>
					item.id === run.id
						? {
								...item,
								artifactsChanged: input.artifactsChanged.map((artifact) => ({
									...artifact,
								})),
								reviews: [...item.reviews, created as ReviewAssignment],
							}
						: item,
				),
			};
		},
		assignmentId,
	);
	if (!created) fail("Flow could not create the review assignment.");
	return { session: next, value: created, replayed: false };
}

function assertReviewResult(
	result: Omit<ReviewResult, "recordedRevision">,
): void {
	if (result.findings.length > MAX_REVIEW_FINDINGS) {
		fail(`A review may contain at most ${MAX_REVIEW_FINDINGS} findings.`);
	}
	const issue = reviewResultSemanticIssues(result)[0];
	if (issue) fail(issue.message);
}

export function completeFeature(
	session: Session,
	input: FeatureCompleteInput,
): MutationResult<FeatureRun> {
	assertReviewResult(input.result);
	const replay = existingOperation(
		session,
		"feature-complete",
		input.operationId,
		input,
	);
	if (replay) {
		const run = session.runs.find((item) => item.id === replay.entityId);
		if (!run) fail("The replayed feature run no longer exists.");
		return { session, value: run, replayed: true };
	}
	assertRevision(session, input.expectedRevision);
	assertMutable(session);
	const run = activeRun(session);
	if (!run || run.featureId !== input.featureId) {
		fail("Completion must target the active feature run.");
	}
	const assignment = run.reviews.find(
		(review) => review.id === input.assignmentId,
	);
	if (!assignment || assignment.result) {
		fail("Completion requires the active pending review assignment.");
	}
	// A failed verdict must carry every still-live prior id, so recurrence history
	// survives a retry without the manager restating it in packet prose.
	if (input.result.verdict === "failed") {
		const dropped = droppedFindingIds(
			session,
			run.featureId,
			input.result.findings,
		);
		if (dropped.length > 0) {
			fail(
				`A failed result must carry every live prior finding id forward; missing ${dropped.join(", ")}.`,
			);
		}
	}
	const findings = assignFindingIds(
		input.result.findings,
		findingIdPrefix(run.featureId, assignment.createdRevision),
	);
	const next = commit(
		session,
		"feature-complete",
		input.operationId,
		input,
		(draft, revision) => ({
			...draft,
			runs: draft.runs.map((item) => {
				if (item.id !== run.id) return item;
				return {
					...item,
					state: input.result.verdict === "passed" ? "completed" : "blocked",
					summary: input.summary,
					reviews: item.reviews.map((review) =>
						review.id === assignment.id
							? {
									...review,
									result: {
										...input.result,
										findings,
										recordedRevision: revision,
									},
								}
							: review,
					),
				};
			}),
		}),
		run.id,
	);
	const completed = next.runs.find((item) => item.id === run.id);
	if (!completed) fail("Flow could not update the feature run.");
	return { session: next, value: completed, replayed: false };
}

function dependentClosure(plan: Plan, featureId: string): Set<string> {
	const affected = new Set([featureId]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const feature of plan.features) {
			if (
				!affected.has(feature.id) &&
				feature.dependsOn.some((dependency) => affected.has(dependency))
			) {
				affected.add(feature.id);
				changed = true;
			}
		}
	}
	return affected;
}

export function resetFeature(
	session: Session,
	input: FeatureResetInput,
	environment?: TransitionEnvironment,
): MutationResult<string[] | FeatureRun> {
	const replay = existingOperation(
		session,
		"feature-reset",
		input.operationId,
		input,
	);
	if (replay) {
		if (!session.plan) fail("The replayed reset has no approved plan.");
		if (replay.entityId) {
			const run = session.runs.find((item) => item.id === replay.entityId);
			if (!run) fail("The replayed reset run no longer exists.");
			return { session, value: run, replayed: true };
		}
		return {
			session,
			value: [...dependentClosure(session.plan, input.featureId)],
			replayed: true,
		};
	}
	assertRevision(session, input.expectedRevision);
	assertMutable(session);
	if (!session.plan || session.approval !== "approved") {
		fail("Reset requires an approved plan.");
	}
	if (
		!session.plan.features.some((feature) => feature.id === input.featureId)
	) {
		fail(`Unknown feature '${input.featureId}'.`);
	}
	const selected = currentRun(session, input.featureId);
	if (
		!selected ||
		(selected.state !== "active" && selected.state !== "blocked")
	) {
		fail("Reset requires an active or blocked feature run.");
	}
	const affected = dependentClosure(session.plan, input.featureId);
	const runs = copy(session.runs).map((run) =>
		affected.has(run.featureId) && run.state !== "superseded"
			? { ...run, state: "superseded" as const }
			: run,
	);
	let created: FeatureRun | null = null;
	if (input.nextFeatureId !== undefined) {
		if (!environment)
			fail("Atomic reset and run start requires an environment.");
		const reset = { ...session, runs };
		if (
			session.plan.features.some(
				(feature) => currentRun(reset, feature.id)?.state === "blocked",
			)
		) {
			fail("Reset remaining blocked features before starting another run.");
		}
		assertFeatureRunnable(reset, input.nextFeatureId);
		created = createRun(reset, input.nextFeatureId, environment);
	}
	return {
		session: commit(
			session,
			"feature-reset",
			input.operationId,
			input,
			(draft) => ({
				...draft,
				runs: created ? [...runs, created] : runs,
			}),
			created?.id,
		),
		value: created ?? [...affected],
		replayed: false,
	};
}

export function closeSession(
	session: Session,
	input: SessionCloseInput,
): MutationResult<SessionClosure> {
	const replay = existingOperation(
		session,
		"session-close",
		input.operationId,
		input,
	);
	if (replay) {
		if (!session.closure) fail("The replayed closure is missing.");
		return { session, value: session.closure, replayed: true };
	}
	assertRevision(session, input.expectedRevision);
	if (session.id !== input.sessionId)
		fail("sessionId does not match active state.");
	assertMutable(session);
	if (input.kind === "completed" && sessionStatus(session) !== "completed") {
		fail("A completed close requires every planned feature to pass review.");
	}
	// Reachable only through a plan whose external evidence was satisfied and then
	// invalidated, since the final review already checked it. Stated here anyway
	// because this is the claim the field exists to hold, and it should not depend on
	// which path reached the closure.
	if (input.kind === "completed") {
		const unsatisfied = unsatisfiedExternalEvidence(session);
		if (unsatisfied.length > 0) {
			fail(
				`A completed close requires the plan's declared external evidence to have passed: ${unsatisfied
					.map((entry) => JSON.stringify(entry.command))
					.join(", ")}. Close deferred or abandoned instead.`,
			);
		}
	}
	let closure: SessionClosure | null = null;
	const next = commit(
		session,
		"session-close",
		input.operationId,
		input,
		(draft, revision) => {
			closure = {
				kind: input.kind,
				summary: input.summary,
				operationId: input.operationId,
				recordedRevision: revision,
			};
			return {
				...draft,
				runs: draft.runs.map((run) =>
					run.state === "active" ? { ...run, state: "superseded" } : run,
				),
				closure,
			};
		},
	);
	if (!closure) fail("Flow could not record the closure.");
	return { session: next, value: closure, replayed: false };
}
