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

export type FeatureKind = "change" | "inspect";

export type PlanFeature = Readonly<{
	id: FeatureId;
	title: string;
	summary: string;
	targets: string[];
	validation: string[];
	dependsOn: FeatureId[];
	/**
	 * Outcome slice kind. Absent hydrates to `change`.
	 *
	 * `inspect` records findings without a repair loop. A failed review completes
	 * the survey slice so later features can start without reset.
	 */
	kind?: FeatureKind | undefined;
}>;

type EvidenceScope = "gate" | "extra";

/**
 * One acceptance observation declared at planning time.
 *
 * `scope: "gate"` is the canonical whole-repository command. Broad observations
 * must run it byte-for-byte. `scope: "extra"` is everything else the goal needs
 * that this host may not be able to produce. Satisfaction is the same function
 * for both: exact command, declared platform, named cases, eligible observation.
 */
export type EvidenceEntry = Readonly<{
	requirement: string;
	environment: string;
	command: string;
	scope: EvidenceScope;
	platform?: EvidencePlatform | undefined;
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
	evidence?: EvidenceEntry[] | undefined;
}>;

export function planEvidence(
	plan: Plan | null | undefined,
): readonly EvidenceEntry[] {
	return plan?.evidence ?? [];
}

export function planGate(plan: Plan | null | undefined): string | undefined {
	return planEvidence(plan).find((entry) => entry.scope === "gate")?.command;
}

/** Absent `kind` is `change`, so existing Session v5 documents keep the repair loop. */
export function featureKind(
	feature: PlanFeature | undefined | null,
): FeatureKind {
	return feature?.kind === "inspect" ? "inspect" : "change";
}

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
	 * This is what makes `EvidenceEntry.platform` checkable rather than another
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

/** The latest run of a feature that has not been superseded. */
export function currentRun(
	session: Session,
	featureId: string,
): FeatureRun | null {
	return (
		session.runs.findLast(
			(run) => run.featureId === featureId && run.state !== "superseded",
		) ?? null
	);
}

/**
 * The current run of the first feature in plan order whose current run is
 * blocked. `startRun` refuses new runs while one exists and the status
 * projection names it, so both read this one rule.
 */
export function firstBlockedRun(session: Session): FeatureRun | null {
	for (const feature of session.plan?.features ?? []) {
		const run = currentRun(session, feature.id);
		if (run?.state === "blocked") return run;
	}
	return null;
}
