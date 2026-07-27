/**
 * Whether a durable session document is internally consistent.
 *
 * Flow's second defence, answering a different question from the first. The
 * transitions in `transitions.js` guard the step being taken: they see the current
 * session and the requested change, and refuse the ones that do not follow. This
 * sees a finished document with no idea how it got there, and asks whether any
 * legal sequence of steps could have produced it.
 *
 * That is needed because `.flow/session.json` is a file on disk: it survives
 * crashes mid-write, hand edits, git merges, and older builds of this plugin. So
 * `src/application/schema.ts` runs this on load and refuses a document that fails
 * rather than repairing it -- guessing what a broken document meant is how one
 * inconsistency becomes several.
 *
 * Every issue is returned rather than the first thrown, because a corrupt document
 * usually violates several invariants and the first is rarely the informative one.
 * No rule here may consult anything outside the document; at load time there is
 * nothing else to consult. The cost of the duality is that most rules restate a
 * transition guard from the other side, and the two must not drift: a new
 * transition rule a hand-edited document could violate belongs in both places.
 */
import { artifactIssues } from "./artifact.js";
import { MAX_REVIEW_FINDINGS, MAX_VALIDATIONS_PER_RUN } from "./limits.js";
import { closureOperationIssue } from "./operation.js";
import { planIssue } from "./plan.js";
import type { Session } from "./session.js";
import { reviewResultSemanticIssues } from "./session.js";
import { isFeatureComplete } from "./transitions.js";
import { isValidationEligible } from "./validation.js";

/**
 * Whether the feature already held a passing review before the given revision.
 *
 * Read only to re-derive a review's `kind`. A review is `final` when it is the
 * last feature still outstanding, which is a fact about the whole session at the
 * moment the review was created -- so checking a stored `kind` means reconstructing
 * that moment from revision numbers rather than from the session as it stands now.
 */
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
	// First, because every rule below assumes the v5 shape; a v4 document is not a
	// broken v5 one.
	if (session.version !== 5) issues.push("Session version must be 5.");
	if (!Number.isSafeInteger(session.revision) || session.revision < 0) {
		issues.push("Session revision must be a nonnegative safe integer.");
	}
	// Operation ledger. Ids are the idempotency keys every mutation replays against,
	// so a duplicate would make two different operations indistinguishable, and a
	// revision beyond the session's own means the ledger outran the state it records.
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
	// Without a plan there is nothing further to check, and the two rules that still
	// apply are the ones a plan would have anchored: approval and runs are both
	// approval of, and work on, specific features.
	if (!session.plan) {
		if (session.approval === "approved")
			issues.push("Approval requires a plan.");
		if (session.runs.length > 0) issues.push("Runs require a plan.");
		return issues;
	}
	// The plan's own rules are shared with `savePlan`, which throws the first issue
	// while this collects them, so both read the same primitive rather than one
	// catching what the other threw.
	const planProblem = planIssue(session.plan);
	if (planProblem) issues.push(planProblem);
	// An approved plan is immutable, so it is the fixed frame the rest of the
	// document has to fit. Ids are unique across the whole session rather than per
	// run, so a document cannot reuse one and rely on nesting to disambiguate.
	const featureIds = new Set(
		session.plan.features.map((feature) => feature.id),
	);
	const runIds = new Set<string>();
	const validationIds = new Set<string>();
	const reviewIds = new Set<string>();
	let activeCount = 0;
	let previousRunStartedRevision = 0;
	for (const run of session.runs) {
		if (runIds.has(run.id)) issues.push(`Duplicate run id '${run.id}'.`);
		runIds.add(run.id);
		if (!featureIds.has(run.featureId))
			issues.push(`Run '${run.id}' has unknown feature.`);
		if (run.startedRevision < 1 || run.startedRevision > session.revision) {
			issues.push(`Run '${run.id}' has an invalid start revision.`);
		}
		// Runs are stored in the order they started, so a later run appearing earlier
		// in the array would make the retry lineage unreadable.
		if (run.startedRevision <= previousRunStartedRevision) {
			issues.push("Runs must remain in their durable start order.");
		}
		previousRunStartedRevision = Math.max(
			previousRunStartedRevision,
			run.startedRevision,
		);
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
			// Evidence has to postdate the run it vouches for. A validation recorded
			// before its run started describes a workspace that run had not touched yet.
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
						!isValidationEligible(validation, review.sourceDigest),
				)
			) {
				issues.push(`Review '${review.id}' uses inapplicable validation.`);
			}
			// A final review is what `completed` closure rests on, so it must cite
			// whole-repository evidence rather than only the feature's own tests
			// (`docs/adr/0009-scope-keyed-validation-veto.md`).
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
				// Reported first-issue-only, matching what `completeFeature` would have
				// refused at the time.
				const resultProblem =
					review.result.findings.length > MAX_REVIEW_FINDINGS
						? `A review may contain at most ${MAX_REVIEW_FINDINGS} findings.`
						: reviewResultSemanticIssues(review.result)[0]?.message;
				if (resultProblem) issues.push(resultProblem);
			}
		}
		// Run state must agree with the review that produced it. These four are the
		// only place a state can be checked at all: `state` is a stored field, so a
		// document can claim `completed` with no passing review, and every reader
		// downstream -- closure, retry eligibility, the projection -- trusts it.
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
	// Checkable only once every run has been seen.
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
