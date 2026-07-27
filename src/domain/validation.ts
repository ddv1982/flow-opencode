import { MAX_VALIDATION_ID_LENGTH, MAX_VALIDATIONS_PER_RUN } from "./limits.js";
import type {
	FeatureId,
	FeatureRun,
	Session,
	SourceDigest,
	ValidationIneligibleReason,
	ValidationObservation,
	ValidationScope,
} from "./session.js";
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

/**
 * Arguments that contradict a `broad` claim, named so the refusal can quote them.
 *
 * `scope` is the one recorded field nothing corroborates, and the escape ADR 0009
 * left open is arming something narrow under the broad label: every field of the
 * resulting record true, exit zero, and the repository gate never run. A command
 * that has already told the runtime it is narrow is refused rather than trusted.
 *
 * Two kinds say so unambiguously. Naming test files to run is one. Filtering by
 * test name is the other, and it was measured being used to exclude the one red
 * test by name (`bun test --test-name-pattern '^(?!pre-existing invariant$)...'`),
 * which is a whole-suite gate in form and a hand-picked subset in effect. A gate
 * that filters by test name is not a whole-suite gate, so the flags are refused
 * even though a false positive costs a real repository its broad claim.
 *
 * Everything else stays broad on purpose. The first token is the program, so a
 * gate invoked as `bun run scripts/check.ts` keeps its claim, and a bare directory
 * stays broad because `pytest tests/` is a whole suite in many repositories.
 *
 * What this cannot see is a command that is not a gate at all: `git diff --check
 * && git diff --name-status` contradicts nothing about breadth and simply cannot
 * fail. Deciding which commands count as tests is an open-ended whitelist, so that
 * shape is not guessed at here. `plan.gate` closes it from the other end instead —
 * the gate is named before implementation and a broad claim must match it
 * (`docs/adr/0010-declared-canonical-gate.md`).
 */
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
		// A plan that named its gate has already answered which command breadth
		// means, so the label is no longer the claimant's to define. A plan saved
		// before this rule existed declares nothing and keeps the older behavior;
		// `savePlan` refuses a new one without a gate, so that set only shrinks.
		const gate = session.plan?.gate;
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
 * `tests/domain-transitions.test.ts`). `plan.gate` is the same rule on a field that
 * is always a command, so the plan half now engages for the one command that
 * matters most, whatever scope its observation was labelled.
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
	const gate = session.plan?.gate;
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
