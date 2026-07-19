import type { FeatureId, FeatureRunId } from "../domain/session.js";
import type { SessionRepository } from "./ports/session-repository.js";
import type { SourceDigest } from "./ports/source-identity.js";

export type PrepareValidationInput = {
	expectedRevision: number;
	expectedSnapshotId: string;
	featureId: string;
};

export type PreparedValidation = {
	featureRunId: FeatureRunId;
	featureId: FeatureId;
	sourceDigest: SourceDigest;
};

export class ValidationPreparationError extends Error {
	readonly code = "FLOW_VALIDATION_PREPARATION";
}

/**
 * Bind an ephemeral validation capture to the current causal guard and source.
 * This does not mutate Session v4; review start rechecks both the receipt and
 * current source before materializing assignment-owned evidence.
 */
export async function prepareValidation(
	repository: SessionRepository,
	input: PrepareValidationInput,
): Promise<PreparedValidation> {
	return repository.transact(async (transaction) => {
		const session = await transaction.load();
		if (!session) {
			throw new ValidationPreparationError(
				"No active Flow session exists for validation capture.",
			);
		}
		if (
			input.expectedRevision !== session.causal.revision ||
			input.expectedSnapshotId !== session.causal.snapshotId
		) {
			throw new ValidationPreparationError(
				"Validation capture used stale causal guards; reload compact status.",
			);
		}
		if (
			input.featureId !== session.activeFeatureId ||
			!session.activeFeatureRunId
		) {
			throw new ValidationPreparationError(
				"Validation capture must target the active native feature run.",
			);
		}
		const run = session.featureRuns.find(
			(candidate) => candidate.id === session.activeFeatureRunId,
		);
		if (run?.status !== "active" || run.featureId !== input.featureId) {
			throw new ValidationPreparationError(
				"The active validation feature run is internally inconsistent.",
			);
		}
		const source = await transaction.computeSourceIdentity();
		return {
			featureRunId: run.id,
			featureId: run.featureId,
			sourceDigest: source.digest,
		};
	});
}
