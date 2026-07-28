export type SessionStatus =
	| "planning"
	| "ready"
	| "running"
	| "blocked"
	| "completed"
	| "closed";

export type FeatureId = string;
type SessionId = string;
export type SourceDigest = `sha256:${string}`;

export type Artifact = Readonly<{ path: string }>;

export type PlanFeature = Readonly<{
	id: FeatureId;
	title: string;
	summary: string;
	targets: string[];
	validation: string[];
	dependsOn: FeatureId[];
}>;

/**
 * An acceptance observation that needs an environment this host may not be.
 *
 * `plan.gate` moved one claim out of prose and into a declared command. This is the
 * same move for the claim that broke next: a measured run whose goal required
 * observing Windows filesystem behavior wrote "this sandbox has no Windows OS" into
 * `requirements` as a non-goal, implemented what was left, recorded a Wine script it
 * had just written as the acceptance evidence, and closed `completed` — with a
 * passing independent review. Every rule it broke existed, in prose, on the surface
 * that ran it.
 *
 * `command` is what makes this checkable: the entry is satisfied only by a passing
 * observation of that exact command, so the evidence has to be named before there is
 * any pressure to substitute for it, in the plan the user approves. A proxy is still
 * possible — but only by writing the proxy into the approved plan as the proof.
 *
 * `platform` closes the proxy the byte-match alone could not see. A measured run
 * declared `environment: "Windows (win32) host with bun installed"` and discharged it
 * with that exact command's exit zero on Linux — green precisely because the Windows
 * case was skipped there. Every field of that record was true. Naming the OS as a
 * value instead of prose lets the runtime compare it with the host the command
 * actually ran on.
 */
export type ExternalEvidence = Readonly<{
	/** What has to be observed, in the goal's own terms. */
	requirement: string;
	/** The environment that can observe it: an OS, service, credential, or device. */
	environment: string;
	/** The exact command whose passing is that observation. */
	command: string;
	/**
	 * The operating system that can observe it, or `other` when the missing
	 * environment is not an OS: a service, credential, setting, or device. An OS
	 * value is checked against the host each observation was recorded on; `other`
	 * keeps the command-only rule, because Flow cannot see what a credential is, and
	 * is judged where the plan is approved and in the review that is given the entry.
	 *
	 * Optional so Session v5 stays forward-readable; `savePlan` requires it, so no
	 * plan this build writes omits it.
	 */
	platform?: EvidencePlatform | undefined;
	/**
	 * The test cases whose passing *is* this observation, by name.
	 *
	 * `platform` moved the environment out of prose; this moves the result out of the
	 * exit code, the other half of the same measured failure — the declared command
	 * exited zero for a case that never ran, because `test.skip` exits zero. An entry
	 * that names cases is satisfied only by a report saying each one passed.
	 *
	 * An empty list is the honest and common answer, and keeps the exit-code rule: a
	 * credential, a device, or a setting has no case names. Optional so Session v5
	 * stays forward-readable; `savePlan` requires the field, so a new entry was asked.
	 */
	assertions?: string[] | undefined;
}>;

/** One declared assertion, as a report the command wrote described it. */
export type ObservedAssertion = Readonly<{
	name: string;
	/** `absent` means no report mentioned it, which discharges nothing. */
	status: "passed" | "failed" | "skipped" | "absent";
}>;

/** See `EVIDENCE_PLATFORMS` for why the set is these four. */
export type EvidencePlatform = "win32" | "darwin" | "linux" | "other";

export type Plan = Readonly<{
	summary: string;
	overview: string;
	requirements: string[];
	decisions: string[];
	features: PlanFeature[];
	/**
	 * Acceptance evidence this host may be unable to produce, declared at planning
	 * time. Empty when everything the goal asks for is observable here.
	 *
	 * A final review and a `completed` closure are both refused while any entry has
	 * no passing observation of its exact command, so the honest routes out are the
	 * environment, deferred closure, or abandoned closure.
	 *
	 * Optional so Session v5 stays forward-readable; `savePlan` requires it, so no
	 * plan this build writes omits it.
	 */
	externalEvidence?: ExternalEvidence[] | undefined;
	/**
	 * The repository's canonical broad validation command, declared once at planning
	 * time and locked by approval.
	 *
	 * `scope: "broad"` used to be a bare claim about whatever command the model
	 * happened to arm, which is how a run closed `completed` over a red gate by
	 * claiming `git diff --check && git diff --name-status` as broad: nothing in that
	 * record was false, and nothing in it was a test. Naming the gate first moves the
	 * decision to the moment there is no red test to dodge, into the document the
	 * user approves.
	 *
	 * Optional so Session v5 stays forward-readable; `savePlan` requires it, so no
	 * plan this build writes omits it.
	 */
	gate?: string | undefined;
}>;

export type ValidationScope = "focused" | "broad";

/**
 * Why a recorded observation can never satisfy a gate.
 *
 * The two host-capability reasons exist so Flow works against any host, not only
 * one that reports a structured Bash exit code and output-truncation flag. A host
 * that reports neither still produces a durable, visibly-not-passing record
 * instead of an aborted tool call.
 */
export type ValidationIneligibleReason =
	| "source-drift"
	| "exit-code-unavailable"
	| "output-completeness-unknown";

export type ValidationObservation = Readonly<{
	id: string;
	featureId: FeatureId;
	runId: string;
	scope: ValidationScope;
	command: string;
	sourceDigest: SourceDigest;
	/**
	 * `null` when the host exposed no structured exit code. Never eligible, and
	 * always paired with an `ineligibleReason`, so a host that cannot report exit
	 * status can never produce a passing validation.
	 */
	exitCode: number | null;
	outputDigest: SourceDigest;
	outputComplete: boolean;
	recordedRevision: number;
	/**
	 * The host this command actually ran on, supplied by the capture adapter.
	 *
	 * This is what makes `ExternalEvidence.platform` checkable rather than another
	 * claim. Optional so existing Session v5 documents remain readable; an
	 * observation without it cannot satisfy an entry that names an OS, because a
	 * record that never said where it ran is not evidence about where it ran.
	 */
	hostPlatform?: EvidencePlatform | undefined;
	/**
	 * The report the command wrote, and what it said about each name the plan declared
	 * for this command.
	 *
	 * The names come from the approved plan and never from the caller, which is what
	 * makes this an observation rather than another claim. The path is the caller's,
	 * because only it knows where its own command reports — so the file must have been
	 * written after arming to count. Both optional for forward-readability.
	 */
	resultsPath?: string | undefined;
	observedAssertions?: ObservedAssertion[] | undefined;
	/**
	 * Optional so existing Session v5 documents remain readable. Once recorded,
	 * an ineligible observation is diagnostic history and can never satisfy a
	 * validation or review gate.
	 */
	ineligibleReason?: ValidationIneligibleReason | undefined;
}>;

export type ReviewFinding = Readonly<{
	severity: "blocking" | "advisory";
	summary: string;
	evidence?: string | undefined;
	/**
	 * Stable identity across attempts, as `<feature-id>.R<revision>-<NN>`.
	 *
	 * A reviewer sets it to a prior id to report recurrence and omits it for a new
	 * issue; the runtime then issues one. Optional so existing Session v5
	 * documents remain readable, and so a submission never fails on bookkeeping.
	 */
	findingId?: string | undefined;
	/**
	 * Set when repairing this finding needs material work outside the approved
	 * plan, which makes the feature ineligible for automatic retry.
	 *
	 * Optional so existing Session v5 documents remain readable; absent means
	 * false. This was previously a `[scope-blocker]` marker the manager had to
	 * spot inside `summary` prose, which no code path parsed.
	 */
	scopeBlocker?: boolean | undefined;
}>;

export type ReviewResult = Readonly<{
	verdict: "passed" | "failed";
	findings: ReviewFinding[];
	terminalDisposition: "submitted" | "observed_unsubmitted";
	recordedRevision: number;
}>;

export function reviewResultSemanticIssues(
	result: Pick<ReviewResult, "verdict" | "findings" | "terminalDisposition">,
) {
	const issues: Array<{
		path: Array<string | number>;
		message: string;
	}> = [];
	const blocking = result.findings.some(
		(finding) => finding.severity === "blocking",
	);
	for (const [index, finding] of result.findings.entries()) {
		if (finding.severity === "blocking" && !finding.evidence?.trim()) {
			issues.push({
				path: ["findings", index, "evidence"],
				message: "A blocking finding requires concrete evidence.",
			});
		}
		if (finding.scopeBlocker && finding.severity !== "blocking") {
			issues.push({
				path: ["findings", index, "scopeBlocker"],
				message: "Only a blocking finding can be a scope blocker.",
			});
		}
	}
	if (result.verdict === "failed" && !blocking) {
		issues.push({
			path: ["findings"],
			message: "A failed review requires a blocking finding.",
		});
	}
	if (result.verdict === "passed" && blocking) {
		issues.push({
			path: ["findings"],
			message: "A passed review cannot contain blocking findings.",
		});
	}
	if (
		result.terminalDisposition === "observed_unsubmitted" &&
		result.verdict !== "failed"
	) {
		issues.push({
			path: ["terminalDisposition"],
			message: "Observed-but-unsubmitted review work must fail closed.",
		});
	}
	return issues;
}

export type ReviewAssignment = Readonly<{
	id: string;
	operationId: string;
	featureId: FeatureId;
	runId: string;
	kind: "feature" | "final";
	sourceDigest: SourceDigest;
	validationIds: string[];
	packet: Readonly<{
		summary: string;
		riskLenses: string[];
	}>;
	createdRevision: number;
	result: ReviewResult | null;
}>;

/**
 * The run is the canonical execution aggregate. Feature status, active work,
 * validation, review, and completion are derived from this one record instead
 * of being copied into parallel histories and counters.
 */
export type FeatureRun = Readonly<{
	id: string;
	featureId: FeatureId;
	attempt: number;
	state: "active" | "completed" | "blocked" | "superseded";
	startedRevision: number;
	summary: string | null;
	artifactsChanged: Artifact[];
	validations: ValidationObservation[];
	reviews: ReviewAssignment[];
}>;

export type OperationKind =
	| "plan-save"
	| "plan-approve"
	| "run-start"
	| "review-start"
	| "feature-complete"
	| "feature-reset"
	| "session-close";

export type OperationRecord = Readonly<{
	id: string;
	kind: OperationKind;
	inputDigest: SourceDigest;
	committedRevision: number;
	entityId?: string | undefined;
}>;

export type SessionClosure = Readonly<{
	kind: "completed" | "deferred" | "abandoned";
	summary: string;
	operationId: string;
	recordedRevision: number;
}>;

/**
 * Session v5 is a deliberate hard cutover. Older active sessions must be
 * closed before upgrading; archived documents are inert history.
 *
 * Revision/order carries lifecycle truth. There are deliberately no clocks in
 * the correctness model.
 */
export type Session = Readonly<{
	version: 5;
	id: SessionId;
	revision: number;
	goal: string;
	approval: "pending" | "approved";
	plan: Plan | null;
	runs: FeatureRun[];
	operations: OperationRecord[];
	closure: SessionClosure | null;
}>;
