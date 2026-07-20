import type {
	SourceDigest,
	ValidationObservation,
	ValidationScope,
} from "../domain/session.js";
import { activeRun, recordValidation } from "../domain/transitions.js";
import type { SessionRepository } from "./ports/session-repository.js";
import type { ValidationStartRequest } from "./schema.js";

export type PreparedValidation = Readonly<{
	featureId: string;
	runId: string;
	command: string;
	scope: ValidationScope;
	sourceDigest: SourceDigest;
}>;

export type ObservedValidation = PreparedValidation &
	Readonly<{
		captureId: string;
		exitCode: number;
		outputDigest: SourceDigest;
		outputComplete: boolean;
	}>;

export async function prepareValidation(
	repository: SessionRepository,
	input: ValidationStartRequest,
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
		return {
			featureId: run.featureId,
			runId: run.id,
			command: input.command,
			scope: input.scope,
			sourceDigest: await transaction.computeSourceDigest(),
		};
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
		if (currentDigest !== input.sourceDigest) {
			throw new Error(
				"Workspace content changed during validation; rerun the command against the final content.",
			);
		}
		const result = recordValidation(session, input);
		await transaction.save(result.session);
		return result.value;
	});
}
