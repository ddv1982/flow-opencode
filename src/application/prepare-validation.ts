import { ARTIFACT_PATH_MESSAGE, isArtifactPath } from "../domain/artifact.js";
import { MAX_VALIDATION_ID_LENGTH } from "../domain/limits.js";
import type {
	EvidencePlatform,
	ObservedAssertion,
	Session,
	SourceDigest,
	ValidationIneligibleReason,
	ValidationObservation,
	ValidationScope,
} from "../domain/session.js";
import { activeRun, recordValidation } from "../domain/transitions.js";
import {
	declaredAssertions,
	LONGEST_EVIDENCE_PLATFORM,
	LONGEST_VALIDATION_INELIGIBLE_REASON,
} from "../domain/validation.js";
import type { SessionRepository } from "./ports/session-repository.js";
import { SessionSchema, type ValidationStartRequest } from "./schema.js";

export type PreparedValidation = Readonly<{
	featureId: string;
	runId: string;
	command: string;
	scope: ValidationScope;
	sourceDigest: SourceDigest;
	/**
	 * The host that will run this command, supplied by the caller because reading it
	 * belongs to infrastructure. It is armed here rather than read when the
	 * observation is persisted so the recorded host is the one Flow armed against.
	 */
	hostPlatform: EvidencePlatform;
	/** The test names the approved plan declares for this exact command. */
	assertions: readonly string[];
	/**
	 * Where the caller says this command writes a JUnit report.
	 *
	 * The one half that must come from the caller, since only it knows what its own
	 * command does — which is why the capture adapter reads nothing from a file that
	 * was not written after this arming.
	 */
	resultsPath: string | undefined;
}>;

export type ObservedValidation = PreparedValidation &
	Readonly<{
		captureId: string;
		/** `null` when the host exposed no structured exit code. */
		exitCode: number | null;
		outputDigest: SourceDigest;
		outputComplete: boolean;
		/** What the report said about each declared name; absent when none were declared. */
		observedAssertions?: ObservedAssertion[] | undefined;
		/**
		 * Set by the capture adapter when the host could not supply the evidence a
		 * passing validation requires. Source drift is detected here and overrides it.
		 */
		ineligibleReason?: ValidationIneligibleReason | undefined;
	}>;

function maximumSerializedUnusedCaptureId(session: Session): string {
	// Every code unit is JSON-escaped as six bytes while the binary suffix keeps
	// the probe distinct from any capture id already recorded in this session.
	const used = new Set(
		session.runs.flatMap((run) =>
			run.validations.map((validation) => validation.id),
		),
	);
	for (let index = 0; index <= used.size; index += 1) {
		const discriminator = [...index.toString(2)]
			.map((bit) => (bit === "0" ? "\u0000" : "\u0001"))
			.join("");
		const candidate = `${"\u0000".repeat(
			MAX_VALIDATION_ID_LENGTH - discriminator.length,
		)}${discriminator}`;
		if (!used.has(candidate)) return candidate;
	}
	throw new Error("Flow could not reserve a validation capacity probe id.");
}

function maximumSerializedObservation(
	session: Session,
	prepared: PreparedValidation,
): ObservedValidation &
	Readonly<{ ineligibleReason: ValidationIneligibleReason }> {
	return {
		...prepared,
		captureId: maximumSerializedUnusedCaptureId(session),
		// The widest exit code and the longest reason and platform, so this probe stays
		// an upper bound on the serialized size of any observation that could be
		// recorded.
		exitCode: Number.MIN_SAFE_INTEGER,
		outputDigest: prepared.sourceDigest,
		outputComplete: false,
		hostPlatform: LONGEST_EVIDENCE_PLATFORM,
		// The declared names and the caller's path are fixed by now, so the only free
		// part is each outcome; `skipped` is the longest of the four.
		observedAssertions: prepared.assertions.map((name) => ({
			name,
			status: "skipped" as const,
		})),
		ineligibleReason: LONGEST_VALIDATION_INELIGIBLE_REASON,
	};
}

function assertValidationCanBeRecorded(
	session: Session,
	prepared: PreparedValidation,
): void {
	const prospective = recordValidation(
		session,
		maximumSerializedObservation(session, prepared),
	).session;
	SessionSchema.parse(prospective);
}

export async function prepareValidation(
	repository: SessionRepository,
	input: ValidationStartRequest,
	hostPlatform: EvidencePlatform,
): Promise<PreparedValidation> {
	return repository.transact(async (transaction) => {
		const session = await transaction.load();
		if (!session) throw new Error("No active Flow session exists.");
		if (session.revision !== input.expectedRevision) {
			throw new Error(
				`Stale revision ${input.expectedRevision}; refresh Flow status and use revision ${session.revision}.`,
			);
		}
		const run = activeRun(session);
		if (!run || run.featureId !== input.featureId) {
			throw new Error("Validation must target the active feature run.");
		}
		if (run.reviews.length > 0) {
			throw new Error("Validation cannot start after review has begun.");
		}
		if (input.resultsPath !== undefined && !isArtifactPath(input.resultsPath)) {
			throw new Error(`Validation results path: ${ARTIFACT_PATH_MESSAGE}`);
		}
		const prepared = {
			featureId: run.featureId,
			runId: run.id,
			command: input.command,
			scope: input.scope,
			sourceDigest: await transaction.computeSourceDigest(),
			hostPlatform,
			assertions: declaredAssertions(session, input.command),
			resultsPath: input.resultsPath,
		};
		assertValidationCanBeRecorded(session, prepared);
		return prepared;
	});
}

export async function persistObservedValidation(
	repository: SessionRepository,
	input: ObservedValidation,
): Promise<ValidationObservation> {
	return repository.transact(async (transaction) => {
		const session = await transaction.load();
		if (!session)
			throw new Error("The Flow session ended before validation was recorded.");
		const currentDigest = await transaction.computeSourceDigest();
		const result = recordValidation(session, {
			...input,
			...(currentDigest !== input.sourceDigest
				? { ineligibleReason: "source-drift" as const }
				: {}),
		});
		await transaction.save(result.session);
		return result.value;
	});
}
