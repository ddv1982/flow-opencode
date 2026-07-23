import { MAX_VALIDATION_ID_LENGTH, MAX_VALIDATIONS_PER_RUN } from "./limits.js";
import type {
	FeatureId,
	FeatureRun,
	Session,
	SourceDigest,
	ValidationObservation,
	ValidationScope,
} from "./session.js";
import { FlowTransitionError } from "./transition-error.js";

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

export function unresolvedKnownFailedPlanCommands(
	session: Session,
	run: FeatureRun,
	sourceDigest?: SourceDigest,
): string[] {
	if (session.approval !== "approved") return [];
	const feature = session.plan?.features.find(
		(candidate) => candidate.id === run.featureId,
	);
	if (!feature) return [];
	const validations = session.runs
		.filter((candidate) => candidate.featureId === run.featureId)
		.flatMap((candidate) => candidate.validations);
	const commands = [...new Set(feature.validation)];
	return commands.filter(
		(command) =>
			validations.some(
				(observation) =>
					observation.command === command && !isValidationEligible(observation),
			) &&
			!run.validations.some(
				(observation) =>
					observation.command === command &&
					isValidationEligible(observation, sourceDigest) &&
					isValidationFresh(session, run, observation),
			),
	);
}
