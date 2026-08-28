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
	ValidationObservation,
	ValidationScope,
} from "./session.js";
import { planEvidence, planGate } from "./session.js";
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
): string[] {
	return [
		...new Set(
			planEvidence(session.plan)
				.filter((entry) => entry.command === command)
				.flatMap((entry) => entry.assertions ?? []),
		),
	];
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
	return {
		session: {
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
		},
		value: observation,
		replayed: false,
	};
}

/** `other` and legacy entries retain the command-only rule. */
function isObservedOnDeclaredPlatform(
	entry: EvidenceEntry,
	observation: ValidationObservation,
): boolean {
	if (entry.platform === undefined || entry.platform === "other") return true;
	return observation.hostPlatform === entry.platform;
}

/** Distinguishes missing, wrong-host, and named-case evidence for recovery. */
export function evidenceRefusal(
	session: Session,
	entry: EvidenceEntry,
	sourceDigest?: SourceDigest,
): string {
	const eligible = session.runs
		.flatMap((run) => run.validations)
		.filter(
			(observation) =>
				observation.command === entry.command &&
				isValidationEligible(observation, sourceDigest),
		);
	const wrongHosts = [
		...new Set(
			eligible
				.filter(
					(observation) => !isObservedOnDeclaredPlatform(entry, observation),
				)
				.map((observation) => observation.hostPlatform ?? "an unrecorded host"),
		),
	];
	// Latest right-host result determines which declared cases remain unmet.
	const unmet = eligible
		.filter((observation) => isObservedOnDeclaredPlatform(entry, observation))
		.toSorted((left, right) => left.recordedRevision - right.recordedRevision)
		.map((observation) =>
			unmetAssertions(entry.assertions ?? [], observation.observedAssertions),
		)
		.filter((names) => names.length > 0)
		.at(-1);
	const needs =
		entry.platform === undefined || entry.platform === "other"
			? entry.environment
			: `${entry.environment} on ${entry.platform}`;
	const detail =
		wrongHosts.length > 0
			? `passed on ${wrongHosts.join(", ")} but this entry declares ${entry.platform}, so that run observed something else — a skipped case exits zero too`
			: unmet
				? `passed on ${entry.platform ?? "the declared host"} but reported no passing result for ${unmet.join(", ")}; arm it again with \`resultsPath\` naming the report the command writes, and make those cases run`
				: `needs ${needs}`;
	return `${JSON.stringify(entry.command)} (${detail}, for ${entry.requirement})`;
}

/** Exact command, host, named-case, eligibility, and optional-source check. */
export function unsatisfiedEvidence(
	session: Session,
	sourceDigest?: SourceDigest,
): EvidenceEntry[] {
	const declared = planEvidence(session.plan);
	if (declared.length === 0) return [];
	const observed = session.runs.flatMap((run) => run.validations);
	return declared.filter(
		(entry) =>
			!observed.some(
				(observation) =>
					observation.command === entry.command &&
					isObservedOnDeclaredPlatform(entry, observation) &&
					assertionsSatisfied(
						entry.assertions ?? [],
						observation.observedAssertions,
					) &&
					isValidationEligible(observation, sourceDigest),
			),
	);
}

export function isValidationFresh(
	session: Session,
	run: FeatureRun,
	observation: ValidationObservation,
): boolean {
	return session.runs
		.filter((candidate) => candidate.featureId === run.featureId)
		.flatMap((candidate) => candidate.validations)
		.every(
			(candidate) =>
				candidate.command !== observation.command ||
				isValidationEligible(candidate) ||
				candidate.recordedRevision < observation.recordedRevision,
		);
}

/**
 * Commands whose latest evidence blocks review until that exact command passes
 * again for the current workspace content.
 *
 * Three sets qualify. A plan-listed command is matched against `feature.validation`
 * by exact string; that field is free-form text and models write prose in it,
 * matching no command, so this half often does not engage although its tests,
 * which pass bare commands, do (`PROSE_VALIDATION` in
 * `tests/domain-transitions.test.ts`). The `scope: "gate"` command is the same
 * rule on a field that is always a command, so the plan half now engages for the
 * one command that matters most, whatever scope its observation was labelled.
 *
 * A command an observation claimed at `broad` scope qualifies whatever the plan
 * says, because `scope` is the one field in a recorded observation that nothing
 * corroborates: capture byte-matches the armed command and takes the exit code
 * from the host, so a caller cannot misreport either, but it can label a narrow
 * command `broad`. Without this, a failing repository gate was discharged by
 * arming something smaller under the same label -- every field of the resulting
 * record true, and the gate never passed. Review only ever needed *a* broad pass,
 * so it accepted that one.
 *
 * Only the reviewed feature's runs are searched, and that is enough: every review
 * consults this, an approved plan is immutable, and `completed` closure needs a
 * passing run for every feature. So a red gate observed under one feature blocks
 * that feature until the same command passes -- it cannot be walked away from by
 * moving to another.
 */
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
					...(gate === undefined ? [] : [gate]),
				]
			: [];
	const failed = session.runs
		.filter((candidate) => candidate.featureId === run.featureId)
		.flatMap((candidate) => candidate.validations)
		.filter((observation) => !isValidationEligible(observation));
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
					isValidationEligible(observation, sourceDigest) &&
					isValidationFresh(session, run, observation),
			),
	);
}
