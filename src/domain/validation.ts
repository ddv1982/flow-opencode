import { commandUsesManagedJUnitPath, MANAGED_JUNIT_PATH } from "./artifact.js";
import { MAX_VALIDATION_ID_LENGTH, MAX_VALIDATIONS_PER_RUN } from "./limits.js";
import type {
	EvidenceEntry,
	EvidencePlatform,
	FeatureId,
	FeatureRun,
	ObservedAssertion,
	Session,
	SourceDigest,
	ValidationIneligibleReason,
	ValidationIntent,
	ValidationObservation,
	ValidationScope,
} from "./session.js";
import { planEvidence, planGate } from "./session.js";
import { assertTerminalHeadroom } from "./session-capacity.js";
import { sessionInvariantIssues } from "./session-invariants.js";
import { activeRun } from "./session-queries.js";
import { assertionsSatisfied, unmetAssertions } from "./test-results.js";
import { FlowTransitionError } from "./transition-error.js";

export const VALIDATION_INELIGIBLE_REASONS = [
	"source-drift",
	"exit-code-unavailable",
	"output-completeness-unknown",
] as const satisfies readonly ValidationIneligibleReason[];

/**
 * The longest reason, so a capacity probe built from it stays an upper bound on
 * the serialized size of any real observation.
 */
export const LONGEST_VALIDATION_INELIGIBLE_REASON =
	VALIDATION_INELIGIBLE_REASONS.reduce((longest, reason) =>
		reason.length > longest.length ? reason : longest,
	);

/** Comparable host identities; `other` retains the command-only rule. */
export const EVIDENCE_PLATFORMS = [
	"win32",
	"darwin",
	"linux",
	"other",
] as const satisfies readonly EvidencePlatform[];

/** The longest platform, for the same capacity-probe reason. */
export const LONGEST_EVIDENCE_PLATFORM = EVIDENCE_PLATFORMS.reduce(
	(longest, platform) =>
		platform.length > longest.length ? platform : longest,
);

/** Unknown hosts normalize to `other` and never match a declared OS. */
export function normalizeEvidencePlatform(value: string): EvidencePlatform {
	return (
		EVIDENCE_PLATFORMS.find(
			(platform) => platform !== "other" && platform === value,
		) ?? "other"
	);
}

export function resolveValidationPolicy(
	session: Session,
	featureId: string,
	command: string,
): Readonly<{
	intent: ValidationIntent;
	platform?: EvidencePlatform;
	assertions: string[];
	typed: boolean;
}> {
	const check = session.plan?.features
		.find((feature) => feature.id === featureId)
		?.checks?.find((entry) => entry.command === command);
	const evidence = planEvidence(session.plan).filter(
		(entry) => entry.command === command,
	);
	const canonicalPlatform = evidence.find(
		(entry) => entry.scope !== "extra",
	)?.platform;
	const platform =
		check?.platform ??
		(canonicalPlatform === "other" ? undefined : canonicalPlatform);
	return {
		intent:
			check?.intent ??
			(evidence.some((entry) => entry.scope === "gate-observe")
				? "observe"
				: "pass"),
		...(platform === undefined ? {} : { platform }),
		assertions: [
			...new Set([
				...evidence.flatMap((entry) => entry.assertions ?? []),
				...(check?.assertions ?? []),
			]),
		],
		typed: check !== undefined,
	};
}

export function validationPolicyIssue(
	session: Session,
	observation: Pick<
		ValidationObservation,
		"featureId" | "command" | "intent" | "hostPlatform" | "observedAssertions"
	>,
): string | null {
	const policy = resolveValidationPolicy(
		session,
		observation.featureId,
		observation.command,
	);
	if (
		(policy.typed || observation.intent !== undefined) &&
		observation.intent !== policy.intent
	)
		return "Validation intent must match the frozen approved command policy.";
	if (policy.typed && observation.hostPlatform === undefined)
		return "A typed check must record its actual host platform.";
	if (
		policy.typed &&
		policy.intent === "observe" &&
		(observation.observedAssertions?.length ?? 0) > 0
	)
		return "An observational check cannot claim named passing assertions.";
	return null;
}

export function isValidationEligible(
	observation: ValidationObservation,
	sourceDigest?: SourceDigest,
): boolean {
	return (
		observation.ineligibleReason === undefined &&
		observation.exitCode === 0 &&
		observation.outputComplete &&
		(sourceDigest === undefined || observation.sourceDigest === sourceDigest)
	);
}

export function isAcceptedValidation(
	session: Session,
	observation: ValidationObservation,
	sourceDigest?: SourceDigest,
): boolean {
	const policy = resolveValidationPolicy(
		session,
		observation.featureId,
		observation.command,
	);
	if (validationPolicyIssue(session, observation) !== null) return false;
	if (policy.typed && observation.hostPlatform !== policy.platform)
		return false;
	if (policy.intent === "pass")
		return (
			isValidationEligible(observation, sourceDigest) &&
			(!policy.typed ||
				(assertionsSatisfied(
					policy.assertions,
					observation.observedAssertions,
				) &&
					(policy.assertions.length === 0 ||
						!commandUsesManagedJUnitPath(observation.command) ||
						observation.resultsPath === MANAGED_JUNIT_PATH)))
		);
	const gate = planEvidence(session.plan).find(
		(entry) =>
			entry.scope === "gate-observe" && entry.command === observation.command,
	);
	if (gate && isAcceptedExtraProof(session, observation, sourceDigest))
		return true;
	return (
		observation.exitCode !== null &&
		observation.outputComplete &&
		observation.ineligibleReason === undefined &&
		(sourceDigest === undefined || observation.sourceDigest === sourceDigest) &&
		(!gate || isAcceptedObservedGate(session, observation, sourceDigest))
	);
}

export function isAcceptedExtraProof(
	session: Session,
	observation: ValidationObservation,
	sourceDigest?: SourceDigest,
): boolean {
	const policy = resolveValidationPolicy(
		session,
		observation.featureId,
		observation.command,
	);
	return (
		!policy.typed &&
		validationPolicyIssue(session, observation) === null &&
		planEvidence(session.plan).some(
			(entry) =>
				entry.scope === "extra" &&
				entry.command === observation.command &&
				isPassingEvidenceObservation(entry, observation, sourceDigest),
		)
	);
}

export function isAcceptedObservedGate(
	session: Session,
	observation: ValidationObservation,
	sourceDigest?: SourceDigest,
): boolean {
	const gate = planEvidence(session.plan).find(
		(entry) =>
			entry.scope === "gate-observe" && entry.command === observation.command,
	);
	const policy = resolveValidationPolicy(
		session,
		observation.featureId,
		observation.command,
	);
	return (
		gate !== undefined &&
		observation.scope === "broad" &&
		observation.exitCode !== null &&
		observation.outputComplete &&
		observation.ineligibleReason === undefined &&
		(sourceDigest === undefined || observation.sourceDigest === sourceDigest) &&
		isObservedOnDeclaredPlatform(gate, observation) &&
		validationPolicyIssue(session, observation) === null &&
		(!policy.typed ||
			(policy.intent === "observe" &&
				observation.hostPlatform === policy.platform))
	);
}

/** Explicit file/name filters contradict a `broad` claim (ADR 0009). */
const NARROWING_FLAGS = new Set([
	"-t",
	"--test-name-pattern",
	"--testNamePattern",
	"-k",
	"-run",
	"--grep",
	"--filter",
]);

export function narrowingArguments(command: string): string[] {
	return command
		.split(/\s+/)
		.slice(1)
		.filter((token) => {
			if (token.startsWith("-")) {
				return NARROWING_FLAGS.has(token.split("=")[0] ?? token);
			}
			const file = token.split("/").pop() ?? "";
			return (
				/\.(?:test|spec)\./.test(file) ||
				/_test\.[a-z]+$/.test(file) ||
				/^test_.+\.py$/.test(file)
			);
		});
}

/** Case names come only from the approved plan (ADR 0012). */
export function declaredAssertions(
	session: Session,
	command: string,
	featureId = session.runs.find((run) => run.state === "active")?.featureId ??
		"",
): string[] {
	return resolveValidationPolicy(session, featureId, command).assertions;
}

export function declaredResultsPath(
	session: Session,
	command: string,
	featureId = session.runs.find((run) => run.state === "active")?.featureId ??
		"",
): string | undefined {
	const named = declaredAssertions(session, command, featureId).length > 0;
	return named && commandUsesManagedJUnitPath(command)
		? MANAGED_JUNIT_PATH
		: undefined;
}

function sameAssertions(
	left: readonly ObservedAssertion[] | undefined,
	right: readonly ObservedAssertion[] | undefined,
): boolean {
	const serialize = (value: readonly ObservedAssertion[] | undefined) =>
		JSON.stringify(
			(value ?? []).map((assertion) => [assertion.name, assertion.status]),
		);
	return serialize(left) === serialize(right);
}

export function recordValidation(
	session: Session,
	input: Readonly<{
		captureId: string;
		featureId: FeatureId;
		runId: string;
		scope: ValidationScope;
		command: string;
		intent?: ValidationIntent | undefined;
		sourceDigest: SourceDigest;
		exitCode: number | null;
		outputDigest: SourceDigest;
		outputComplete: boolean;
		hostPlatform?: EvidencePlatform | undefined;
		resultsPath?: string | undefined;
		observedAssertions?: ObservedAssertion[] | undefined;
		ineligibleReason?: ValidationObservation["ineligibleReason"];
	}>,
): Readonly<{
	session: Session;
	value: ValidationObservation;
	replayed: boolean;
}> {
	if (
		input.captureId.length < 1 ||
		input.captureId.length > MAX_VALIDATION_ID_LENGTH
	) {
		throw new FlowTransitionError(
			`Validation capture id must contain 1-${MAX_VALIDATION_ID_LENGTH} characters.`,
		);
	}
	if (input.exitCode === null && input.ineligibleReason === undefined) {
		throw new FlowTransitionError(
			"An observation without an exit code must record an ineligible reason.",
		);
	}
	const policyIssue = validationPolicyIssue(session, input);
	if (policyIssue) throw new FlowTransitionError(policyIssue);
	const prior = session.runs
		.flatMap((run) => run.validations)
		.find((validation) => validation.id === input.captureId);
	if (prior) {
		if (
			prior.featureId !== input.featureId ||
			prior.runId !== input.runId ||
			prior.scope !== input.scope ||
			prior.command !== input.command ||
			prior.intent !== input.intent ||
			prior.sourceDigest !== input.sourceDigest ||
			prior.exitCode !== input.exitCode ||
			prior.outputDigest !== input.outputDigest ||
			prior.outputComplete !== input.outputComplete ||
			prior.hostPlatform !== input.hostPlatform ||
			prior.resultsPath !== input.resultsPath ||
			!sameAssertions(prior.observedAssertions, input.observedAssertions) ||
			prior.ineligibleReason !== input.ineligibleReason
		) {
			throw new FlowTransitionError(
				"Validation capture id was already used for a different observation.",
			);
		}
		return { session, value: prior, replayed: true };
	}
	if (session.closure) {
		throw new FlowTransitionError(
			"This Flow session is closed and archive-only.",
		);
	}
	const run = session.runs.find((candidate) => candidate.state === "active");
	if (!run || run.id !== input.runId || run.featureId !== input.featureId) {
		throw new FlowTransitionError(
			"Validation no longer belongs to the active feature run.",
		);
	}
	if (run.reviews.length > 0) {
		throw new FlowTransitionError(
			"Validation cannot be recorded after review has begun.",
		);
	}
	if (run.validations.length >= MAX_VALIDATIONS_PER_RUN) {
		throw new FlowTransitionError(
			`A feature run may contain at most ${MAX_VALIDATIONS_PER_RUN} validation observations.`,
		);
	}
	if (input.scope === "broad") {
		const narrowing = narrowingArguments(input.command);
		if (narrowing.length > 0) {
			throw new FlowTransitionError(
				`A broad observation cannot select which tests it runs (${narrowing.join(", ")}). Arm the repository's canonical gate, or record this command as focused.`,
			);
		}
		const gate = planGate(session.plan);
		if (gate !== undefined && input.command !== gate) {
			throw new FlowTransitionError(
				`A broad observation must run the plan-declared canonical gate (${gate}). Arm that exact command, or record this one as focused.`,
			);
		}
	}
	const revision = session.revision + 1;
	const observation: ValidationObservation = {
		id: input.captureId,
		featureId: input.featureId,
		runId: input.runId,
		scope: input.scope,
		command: input.command,
		...(input.intent !== undefined ? { intent: input.intent } : {}),
		sourceDigest: input.sourceDigest,
		exitCode: input.exitCode,
		outputDigest: input.outputDigest,
		outputComplete: input.outputComplete,
		recordedRevision: revision,
		...(input.hostPlatform ? { hostPlatform: input.hostPlatform } : {}),
		...(input.resultsPath ? { resultsPath: input.resultsPath } : {}),
		...(input.observedAssertions && input.observedAssertions.length > 0
			? { observedAssertions: input.observedAssertions }
			: {}),
		...(input.ineligibleReason
			? { ineligibleReason: input.ineligibleReason }
			: {}),
	};
	const draft = structuredClone(session);
	const next: Session = {
		...draft,
		revision,
		runs: draft.runs.map((candidate) =>
			candidate.id === run.id
				? {
						...candidate,
						validations: [...candidate.validations, observation],
					}
				: candidate,
		),
	};
	assertTerminalHeadroom(next);
	const issues = sessionInvariantIssues(next);
	if (issues.length > 0)
		throw new FlowTransitionError(
			`Flow refused an inconsistent session: ${issues.join(" ")}`,
		);
	return {
		session: next,
		value: observation,
		replayed: false,
	};
}

/** `other` and legacy entries retain the command-only rule. */
export function isObservedOnDeclaredPlatform(
	entry: EvidenceEntry,
	observation: ValidationObservation,
): boolean {
	if (entry.platform === undefined || entry.platform === "other") return true;
	return observation.hostPlatform === entry.platform;
}

function isObservedAtDeclaredPath(
	entry: EvidenceEntry,
	observation: ValidationObservation,
): boolean {
	return (
		(entry.assertions?.length ?? 0) === 0 ||
		!commandUsesManagedJUnitPath(entry.command) ||
		observation.resultsPath === MANAGED_JUNIT_PATH
	);
}

function isPassingEvidenceObservation(
	entry: EvidenceEntry,
	observation: ValidationObservation,
	sourceDigest?: SourceDigest,
): boolean {
	return (
		isValidationEligible(observation, sourceDigest) &&
		isObservedOnDeclaredPlatform(entry, observation) &&
		isObservedAtDeclaredPath(entry, observation) &&
		assertionsSatisfied(entry.assertions ?? [], observation.observedAssertions)
	);
}

function isPassingEvidenceFresh(
	session: Session,
	entry: EvidenceEntry,
	observation: ValidationObservation,
): boolean {
	return session.runs
		.filter((run) => run.featureId === observation.featureId)
		.flatMap((run) => run.validations)
		.every(
			(candidate) =>
				candidate.command !== entry.command ||
				!isObservedOnDeclaredPlatform(entry, candidate) ||
				isPassingEvidenceObservation(entry, candidate) ||
				candidate.recordedRevision < observation.recordedRevision,
		);
}

export type EvidenceStatus =
	| Readonly<{ kind: "satisfied" }>
	| Readonly<{ kind: "wrong-host"; hosts: string[] }>
	| Readonly<{ kind: "unmet-cases"; cases: string[] }>
	| Readonly<{ kind: "missing" }>;

/**
 * How one declared evidence entry stands against the recorded observations.
 * The boolean (`unsatisfiedEvidence`) and the message (`evidenceRefusal`) both
 * derive from this, so they cannot disagree about why an entry is unmet.
 */
export function evidenceStatus(
	session: Session,
	entry: EvidenceEntry,
	sourceDigest?: SourceDigest,
): EvidenceStatus {
	const matching = session.runs
		.flatMap((run) => run.validations)
		.filter(
			(observation) =>
				observation.command === entry.command &&
				(entry.scope !== "gate-observe" || observation.scope === "broad") &&
				isObservedAtDeclaredPath(entry, observation),
		);
	const candidates =
		entry.scope === "gate-observe" ? matching.slice(-1) : matching;
	const eligible = candidates.filter((observation) => {
		if (entry.scope === "gate-observe")
			return isAcceptedObservedGate(session, observation, sourceDigest);
		const policy = resolveValidationPolicy(
			session,
			observation.featureId,
			observation.command,
		);
		return policy.typed
			? policy.intent === "pass" &&
					isAcceptedValidation(session, observation, sourceDigest)
			: isValidationEligible(observation, sourceDigest) &&
					(!session.plan?.evidence?.some(
						(candidate) =>
							candidate.scope === "gate-observe" &&
							candidate.command === entry.command,
					) ||
						isPassingEvidenceFresh(session, entry, observation));
	});
	const onHost = eligible.filter((observation) =>
		isObservedOnDeclaredPlatform(entry, observation),
	);
	if (
		onHost.some((observation) =>
			assertionsSatisfied(
				entry.assertions ?? [],
				observation.observedAssertions,
			),
		)
	)
		return { kind: "satisfied" };
	// Latest right-host result determines which declared cases remain unmet.
	const unmet = onHost
		.toSorted((left, right) => left.recordedRevision - right.recordedRevision)
		.map((observation) =>
			unmetAssertions(entry.assertions ?? [], observation.observedAssertions),
		)
		.filter((names) => names.length > 0)
		.at(-1);
	const wrongHostCandidates =
		entry.scope === "gate-observe"
			? candidates.filter(
					(observation) =>
						observation.exitCode !== null &&
						observation.outputComplete &&
						observation.ineligibleReason === undefined &&
						(sourceDigest === undefined ||
							observation.sourceDigest === sourceDigest),
				)
			: eligible;
	const wrongHosts = [
		...new Set(
			wrongHostCandidates
				.filter(
					(observation) => !isObservedOnDeclaredPlatform(entry, observation),
				)
				.map((observation) => observation.hostPlatform ?? "an unrecorded host"),
		),
	];
	if (wrongHosts.length > 0) return { kind: "wrong-host", hosts: wrongHosts };
	if (unmet) return { kind: "unmet-cases", cases: unmet };
	return { kind: "missing" };
}

/**
 * Explains why one declared evidence entry is unmet.
 *
 * Meant for entries `unsatisfiedEvidence` returned with the same
 * `sourceDigest`; for an entry that is already satisfied, this falls back to
 * the generic `needs …` wording.
 */
export function evidenceRefusal(
	session: Session,
	entry: EvidenceEntry,
	sourceDigest?: SourceDigest,
): string {
	const status = evidenceStatus(session, entry, sourceDigest);
	const needs =
		entry.platform === undefined || entry.platform === "other"
			? entry.environment
			: `${entry.environment} on ${entry.platform}`;
	const detail =
		status.kind === "wrong-host"
			? entry.scope === "gate-observe"
				? `observed on ${status.hosts.join(", ")} but this entry declares ${entry.platform}`
				: `passed on ${status.hosts.join(", ")} but this entry declares ${entry.platform}, so that run observed something else — a skipped case exits zero too`
			: status.kind === "unmet-cases"
				? `passed on ${entry.platform ?? "the declared host"} but reported no passing result for ${status.cases.join(", ")}; rerun the exact approved command so ${commandUsesManagedJUnitPath(entry.command) ? MANAGED_JUNIT_PATH : "a fresh resultsPath"} reports those cases passing`
				: `needs ${needs}`;
	return `${JSON.stringify(entry.command)} (${detail}, for ${entry.requirement})`;
}

export function unsatisfiedEvidence(
	session: Session,
	sourceDigest?: SourceDigest,
): EvidenceEntry[] {
	return planEvidence(session.plan).filter(
		(entry) =>
			evidenceStatus(session, entry, sourceDigest).kind !== "satisfied",
	);
}

export function isValidationFresh(
	session: Session,
	run: FeatureRun,
	observation: ValidationObservation,
): boolean {
	const gate = planEvidence(session.plan).find(
		(entry) => entry.scope === "gate-observe",
	);
	const policy = resolveValidationPolicy(
		session,
		run.featureId,
		observation.command,
	);
	if (
		gate?.command === observation.command &&
		!policy.typed &&
		(observation.scope !== "broad" ||
			!isObservedOnDeclaredPlatform(gate, observation))
	)
		return planEvidence(session.plan).some(
			(entry) =>
				entry.scope === "extra" &&
				entry.command === observation.command &&
				isPassingEvidenceObservation(entry, observation) &&
				isPassingEvidenceFresh(session, entry, observation),
		);
	if (
		resolveValidationPolicy(session, run.featureId, observation.command)
			.intent === "observe"
	)
		return (
			session.runs
				.filter((candidate) => candidate.featureId === run.featureId)
				.flatMap((candidate) => candidate.validations)
				.filter(
					(candidate) =>
						candidate.command === observation.command &&
						(gate?.command !== observation.command ||
							candidate.scope === "broad"),
				)
				.at(-1)?.id === observation.id
		);
	return session.runs
		.filter((candidate) => candidate.featureId === run.featureId)
		.flatMap((candidate) => candidate.validations)
		.every(
			(candidate) =>
				candidate.command !== observation.command ||
				isAcceptedValidation(session, candidate) ||
				candidate.recordedRevision < observation.recordedRevision,
		);
}

export function unresolvedVetoedCommands(
	session: Session,
	run: FeatureRun,
	sourceDigest?: SourceDigest,
): string[] {
	const gate = planGate(session.plan);
	const planned =
		session.approval === "approved"
			? [
					...(session.plan?.features.find(
						(candidate) => candidate.id === run.featureId,
					)?.validation ?? []),
					...(session.plan?.features
						.find((candidate) => candidate.id === run.featureId)
						?.checks?.map((check) => check.command) ?? []),
					...(gate === undefined ? [] : [gate]),
				]
			: [];
	const failed = session.runs
		.filter((candidate) => candidate.featureId === run.featureId)
		.flatMap((candidate) => candidate.validations)
		.filter((observation) => !isAcceptedValidation(session, observation));
	const commands = [
		...new Set(
			failed
				.filter(
					(observation) =>
						observation.scope === "broad" ||
						planned.includes(observation.command),
				)
				.map((observation) => observation.command),
		),
	];
	return commands.filter(
		(command) =>
			!run.validations.some(
				(observation) =>
					observation.command === command &&
					isAcceptedValidation(session, observation, sourceDigest) &&
					isValidationFresh(session, run, observation),
			),
	);
}

export type PrerequisiteAmendmentEligibility =
	| Readonly<{
			eligible: true;
			run: FeatureRun;
			observation: ValidationObservation;
	  }>
	| Readonly<{ eligible: false; reason: string }>;

export function prerequisiteAmendmentEligibility(
	session: Session,
	featureId: string,
	validationId: string,
	currentSourceDigest: SourceDigest,
): PrerequisiteAmendmentEligibility {
	if (session.closure)
		return {
			eligible: false,
			reason: "This Flow session is closed and archive-only.",
		};
	if (session.plan?.evidence?.some((entry) => entry.scope === "gate-observe"))
		return {
			eligible: false,
			reason:
				"An observed inspection gate cannot authorize a prerequisite repair amendment.",
		};
	if (session.approval !== "approved" || !session.plan)
		return {
			eligible: false,
			reason: "A prerequisite amendment requires an approved plan.",
		};
	const run = activeRun(session);
	if (!run || run.featureId !== featureId)
		return {
			eligible: false,
			reason: "An amendment must target the active feature run.",
		};
	if (run.reviews.length > 0)
		return {
			eligible: false,
			reason: "An amendment cannot bypass an existing independent review.",
		};
	if (
		session.runs.some(
			(candidate) =>
				candidate.featureId === run.featureId &&
				candidate.reviews.some((review) =>
					review.result?.findings.some((finding) => finding.scopeBlocker),
				),
		)
	)
		return {
			eligible: false,
			reason: "An independent review scope blocker requires user direction.",
		};
	const observation = run.validations.find((item) => item.id === validationId);
	const latest = run.validations
		.filter(
			(item) =>
				item.scope === "broad" && item.command === planGate(session.plan),
		)
		.at(-1);
	if (!observation)
		return {
			eligible: false,
			reason:
				"An amendment requires a failed canonical-gate observation on the active run.",
		};
	if (
		latest?.id !== observation.id ||
		observation.scope !== "broad" ||
		observation.command !== planGate(session.plan) ||
		observation.exitCode === null ||
		observation.exitCode === 0 ||
		!observation.outputComplete ||
		observation.ineligibleReason !== undefined ||
		observation.sourceDigest !== currentSourceDigest
	)
		return {
			eligible: false,
			reason:
				"An amendment requires a complete failed canonical-gate observation for the current source.",
		};
	const policy = resolveValidationPolicy(
		session,
		featureId,
		observation.command,
	);
	if (
		policy.platform !== undefined &&
		observation.hostPlatform !== policy.platform
	)
		return {
			eligible: false,
			reason:
				"A canonical observation on an unavailable declared host requires user direction.",
		};
	return { eligible: true, run, observation };
}
