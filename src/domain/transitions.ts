import { artifactIssues } from "./artifact.js";
import {
	MAX_REVIEW_FINDINGS,
	MAX_SESSION_ID_LENGTH,
	MAX_VALIDATIONS_PER_RUN,
} from "./limits.js";
import { closureOperationIssue, operationInputDigest } from "./operation.js";
import { planIssue } from "./plan.js";
import type {
	Artifact,
	FeatureId,
	FeatureRun,
	OperationKind,
	OperationRecord,
	Plan,
	ReviewAssignment,
	ReviewFinding,
	ReviewResult,
	Session,
	SessionClosure,
	SessionStatus,
	SourceDigest,
	ValidationObservation,
	ValidationScope,
} from "./session.js";

export type TransitionEnvironment = Readonly<{
	newId: (kind: "session" | "run" | "validation" | "review") => string;
}>;

export class FlowTransitionError extends Error {
	readonly code = "FLOW_TRANSITION_REJECTED";
}

export type MutationResult<T> = Readonly<{
	session: Session;
	value: T;
	replayed: boolean;
}>;

export type PlanSaveInput = Readonly<{
	operationId: string;
	expectedRevision: number;
	goal: string;
	plan: Plan;
}>;

export type GuardedFeatureInput = Readonly<{
	operationId: string;
	expectedRevision: number;
	featureId: FeatureId;
}>;

export type ReviewStartInput = GuardedFeatureInput &
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

export type SessionCloseInput = Readonly<{
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

function nextRunnableFeature(session: Session): FeatureId | null {
	if (!session.plan) return null;
	for (const feature of session.plan.features) {
		const state = currentRun(session, feature.id)?.state;
		if (state === "completed") continue;
		if (state === "blocked") continue;
		if (feature.dependsOn.every((id) => isFeatureComplete(session, id))) {
			return feature.id;
		}
	}
	return null;
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
	const feature = session.plan.features.find((item) => item.id === featureId);
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
	const runId = environment.newId("run");
	const attempt =
		session.runs.filter((run) => run.featureId === featureId).length + 1;
	let created: FeatureRun | null = null;
	const next = commit(
		session,
		"run-start",
		input.operationId,
		input,
		(draft, revision) => {
			created = {
				id: runId,
				featureId,
				attempt,
				state: "active",
				startedRevision: revision,
				summary: null,
				artifactsChanged: [],
				validations: [],
				reviews: [],
			};
			return { ...draft, runs: [...draft.runs, created] };
		},
		runId,
	);
	if (!created) fail("Flow could not create the feature run.");
	return { session: next, value: created, replayed: false };
}

export function recordValidation(
	session: Session,
	input: Readonly<{
		captureId: string;
		featureId: FeatureId;
		runId: string;
		scope: ValidationScope;
		command: string;
		sourceDigest: SourceDigest;
		exitCode: number;
		outputDigest: SourceDigest;
		outputComplete: boolean;
	}>,
): MutationResult<ValidationObservation> {
	if (input.captureId.length < 1 || input.captureId.length > 256) {
		fail("Validation capture id must contain 1-256 characters.");
	}
	const prior = session.runs
		.flatMap((run) => run.validations)
		.find((validation) => validation.id === input.captureId);
	if (prior) {
		if (
			prior.featureId !== input.featureId ||
			prior.runId !== input.runId ||
			prior.scope !== input.scope ||
			prior.command !== input.command ||
			prior.sourceDigest !== input.sourceDigest ||
			prior.exitCode !== input.exitCode ||
			prior.outputDigest !== input.outputDigest ||
			prior.outputComplete !== input.outputComplete
		) {
			fail(
				"Validation capture id was already used for a different observation.",
			);
		}
		return { session, value: prior, replayed: true };
	}
	assertMutable(session);
	const run = activeRun(session);
	if (!run || run.id !== input.runId || run.featureId !== input.featureId) {
		fail("Validation no longer belongs to the active feature run.");
	}
	if (run.reviews.length > 0) {
		fail("Validation cannot be recorded after review has begun.");
	}
	if (run.validations.length >= MAX_VALIDATIONS_PER_RUN) {
		fail(
			`A feature run may contain at most ${MAX_VALIDATIONS_PER_RUN} validation observations.`,
		);
	}
	const revision = session.revision + 1;
	const observation: ValidationObservation = {
		id: input.captureId,
		featureId: input.featureId,
		runId: input.runId,
		scope: input.scope,
		command: input.command,
		sourceDigest: input.sourceDigest,
		exitCode: input.exitCode,
		outputDigest: input.outputDigest,
		outputComplete: input.outputComplete,
		recordedRevision: revision,
	};
	const draft = copy(session);
	const runs = draft.runs.map((item) =>
		item.id === run.id
			? { ...item, validations: [...item.validations, observation] }
			: item,
	);
	return {
		session: { ...draft, revision, runs },
		value: observation,
		replayed: false,
	};
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
	const kind = isFinalFeatureRun(session, run) ? "final" : "feature";
	const applicable = run.validations.filter(
		(validation) =>
			validation.exitCode === 0 &&
			validation.outputComplete &&
			validation.sourceDigest === input.sourceDigest &&
			(kind === "feature" || validation.scope === "broad"),
	);
	if (applicable.length === 0) {
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
	const blocking = result.findings.some(
		(finding) => finding.severity === "blocking",
	);
	const unsupported = result.findings.some(
		(finding) => finding.severity === "blocking" && !finding.evidence?.trim(),
	);
	if (unsupported) fail("A blocking finding requires concrete evidence.");
	if (result.verdict === "failed" && !blocking) {
		fail("A failed review requires a blocking finding.");
	}
	if (result.verdict === "passed" && blocking) {
		fail("A passed review cannot contain a blocking finding.");
	}
	if (
		result.terminalDisposition === "observed_unsubmitted" &&
		result.verdict !== "failed"
	) {
		fail("Observed-but-unsubmitted review work must fail closed.");
	}
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
										findings: input.result.findings.map(
											(finding: ReviewFinding) => ({ ...finding }),
										),
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
	input: GuardedFeatureInput,
): MutationResult<string[]> {
	const replay = existingOperation(
		session,
		"feature-reset",
		input.operationId,
		input,
	);
	if (replay) {
		if (!session.plan) fail("The replayed reset has no approved plan.");
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
	const ids = [...affected];
	return {
		session: commit(
			session,
			"feature-reset",
			input.operationId,
			input,
			(draft) => ({
				...draft,
				runs: draft.runs.map((run) =>
					affected.has(run.featureId) && run.state !== "superseded"
						? { ...run, state: "superseded" }
						: run,
				),
			}),
		),
		value: ids,
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

function featurePassedBefore(
	session: Session,
	featureId: string,
	revision: number,
): boolean {
	return session.runs.some(
		(run) =>
			run.featureId === featureId &&
			run.reviews.some(
				(review) =>
					review.result?.verdict === "passed" &&
					review.result.recordedRevision < revision,
			),
	);
}

export function sessionInvariantIssues(session: Session): string[] {
	const issues: string[] = [];
	if (session.version !== 5) issues.push("Session version must be 5.");
	if (!Number.isSafeInteger(session.revision) || session.revision < 0) {
		issues.push("Session revision must be a nonnegative safe integer.");
	}
	const operationIds = new Set<string>();
	for (const operation of session.operations) {
		if (operationIds.has(operation.id)) {
			issues.push(`Duplicate operation id '${operation.id}'.`);
		}
		operationIds.add(operation.id);
		if (
			operation.committedRevision < 1 ||
			operation.committedRevision > session.revision
		) {
			issues.push(`Operation '${operation.id}' has an invalid revision.`);
		}
	}
	if (session.closure) {
		const closureIssue = closureOperationIssue(session);
		if (closureIssue) issues.push(closureIssue);
		if (session.closure.kind === "completed" && !session.plan) {
			issues.push("A completed closure requires a plan.");
		}
	}
	if (!session.plan) {
		if (session.approval === "approved")
			issues.push("Approval requires a plan.");
		if (session.runs.length > 0) issues.push("Runs require a plan.");
		return issues;
	}
	try {
		assertPlan(session.plan);
	} catch (error) {
		issues.push(error instanceof Error ? error.message : String(error));
	}
	const featureIds = new Set(
		session.plan.features.map((feature) => feature.id),
	);
	const runIds = new Set<string>();
	const validationIds = new Set<string>();
	const reviewIds = new Set<string>();
	let activeCount = 0;
	for (const run of session.runs) {
		if (runIds.has(run.id)) issues.push(`Duplicate run id '${run.id}'.`);
		runIds.add(run.id);
		if (!featureIds.has(run.featureId))
			issues.push(`Run '${run.id}' has unknown feature.`);
		if (run.startedRevision < 1 || run.startedRevision > session.revision) {
			issues.push(`Run '${run.id}' has an invalid start revision.`);
		}
		if (run.reviews.length > 1) {
			issues.push(`Run '${run.id}' has more than one review.`);
		}
		if (run.validations.length > MAX_VALIDATIONS_PER_RUN) {
			issues.push(
				`Run '${run.id}' has more than ${MAX_VALIDATIONS_PER_RUN} validations.`,
			);
		}
		for (const issue of artifactIssues(run.artifactsChanged)) {
			issues.push(`Run '${run.id}': ${issue}`);
		}
		if (run.state === "active") activeCount += 1;
		const runValidationIds = new Set<string>();
		for (const validation of run.validations) {
			if (validationIds.has(validation.id)) {
				issues.push(`Duplicate validation id '${validation.id}'.`);
			}
			validationIds.add(validation.id);
			runValidationIds.add(validation.id);
			if (
				validation.runId !== run.id ||
				validation.featureId !== run.featureId
			) {
				issues.push(
					`Validation '${validation.id}' is attached to the wrong run.`,
				);
			}
			if (validation.recordedRevision > session.revision) {
				issues.push(`Validation '${validation.id}' is from a future revision.`);
			}
			if (validation.recordedRevision <= run.startedRevision) {
				issues.push(`Validation '${validation.id}' predates its run.`);
			}
		}
		for (const review of run.reviews) {
			if (reviewIds.has(review.id))
				issues.push(`Duplicate review id '${review.id}'.`);
			reviewIds.add(review.id);
			if (review.runId !== run.id || review.featureId !== run.featureId) {
				issues.push(`Review '${review.id}' is attached to the wrong run.`);
			}
			const uniqueReferences = new Set(review.validationIds);
			if (review.validationIds.length > MAX_VALIDATIONS_PER_RUN) {
				issues.push(
					`Review '${review.id}' has more than ${MAX_VALIDATIONS_PER_RUN} validation references.`,
				);
			}
			if (uniqueReferences.size !== review.validationIds.length) {
				issues.push(`Review '${review.id}' repeats validation references.`);
			}
			if (review.validationIds.some((id) => !runValidationIds.has(id))) {
				issues.push(`Review '${review.id}' references unknown validation.`);
			}
			const referenced = run.validations.filter((validation) =>
				uniqueReferences.has(validation.id),
			);
			if (
				referenced.some(
					(validation) =>
						validation.exitCode !== 0 ||
						!validation.outputComplete ||
						validation.sourceDigest !== review.sourceDigest,
				)
			) {
				issues.push(`Review '${review.id}' uses inapplicable validation.`);
			}
			if (
				review.kind === "final" &&
				!referenced.some((validation) => validation.scope === "broad")
			) {
				issues.push(`Final review '${review.id}' lacks broad validation.`);
			}
			if (
				review.createdRevision < 1 ||
				review.createdRevision > session.revision
			) {
				issues.push(`Review '${review.id}' has an invalid creation revision.`);
			}
			if (review.createdRevision <= run.startedRevision) {
				issues.push(`Review '${review.id}' predates its run.`);
			}
			if (
				referenced.some(
					(validation) => validation.recordedRevision >= review.createdRevision,
				)
			) {
				issues.push(`Review '${review.id}' references later validation.`);
			}
			const expectedKind = session.plan.features.every(
				(feature) =>
					feature.id === run.featureId ||
					featurePassedBefore(session, feature.id, review.createdRevision),
			)
				? "final"
				: "feature";
			if (review.kind !== expectedKind) {
				issues.push(`Review '${review.id}' has the wrong derived kind.`);
			}
			if (review.result) {
				if (
					review.result.recordedRevision <= review.createdRevision ||
					review.result.recordedRevision > session.revision
				) {
					issues.push(`Review '${review.id}' has an invalid result revision.`);
				}
				try {
					assertReviewResult(review.result);
				} catch (error) {
					issues.push(error instanceof Error ? error.message : String(error));
				}
			}
		}
		const last = run.reviews.at(-1);
		if (run.state === "active" && (run.summary !== null || last?.result)) {
			issues.push(`Active run '${run.id}' contains a recorded outcome.`);
		}
		if (run.state === "completed" && last?.result?.verdict !== "passed") {
			issues.push(`Completed run '${run.id}' lacks a passing review.`);
		}
		if (run.state === "blocked" && last?.result?.verdict !== "failed") {
			issues.push(`Blocked run '${run.id}' lacks a failed review.`);
		}
		if (run.state === "superseded" && last?.result?.verdict === "passed") {
			issues.push(`Superseded run '${run.id}' cannot retain a passing review.`);
		}
	}
	if (activeCount > 1) issues.push("Only one run may be active.");
	if (session.closure) {
		if (activeCount > 0)
			issues.push("A closed session cannot retain active work.");
		if (
			session.closure.kind === "completed" &&
			session.plan.features.some(
				(feature) => !isFeatureComplete(session, feature.id),
			)
		) {
			issues.push("A completed closure requires every feature to be complete.");
		}
	}
	return issues;
}
