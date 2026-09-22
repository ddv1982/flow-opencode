import { JevConfiguration } from "../evals/recovery-decisions/campaign.js";
import { readEpisodeQuestion } from "../evals/recovery-decisions/episode-operator.js";
import type { EpisodeDriver } from "../evals/recovery-decisions/episode-runner.js";
import { registerEpisodes } from "../evals/recovery-decisions/episodes.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
export async function operatorRegistration(
	driver: EpisodeDriver,
	identity: {
		task: unknown;
		initialState: unknown;
		completionCriteria: string;
	},
	timeoutMs = 3000,
	model = "fixture",
) {
	const manager = {
		model,
		prompt: "Frozen task",
		harnessDigest: driver.harnessDigest,
	};
	return registerEpisodes({
		schemaVersion: 1,
		split: "calibration",
		calibrationEvidenceDigest: null,
		episodes: [
			{
				id: "one",
				taskDigest: datasetDigest(identity.task),
				initialStateDigest: datasetDigest(identity.initialState),
				completionCriteria: identity.completionCriteria,
				sourceReference: "operator-fixture",
				independenceGroupId: "one",
			},
		],
		arms: {
			managerOnly: manager,
			managerPlusJev: { ...manager, jev: JevConfiguration },
		},
		execution: { timeoutMs, resetProtocol: "Fresh fixture" },
		inference: {
			method: "paired-bootstrap-percentile-v1",
			seed: 42,
			resamples: 2000,
			confidence: 0.95,
		},
	});
}
export async function awaitQuestion(directory: string, signal: AbortSignal) {
	for (;;) {
		signal.throwIfAborted();
		try {
			return await readEpisodeQuestion(directory);
		} catch {
			await Bun.sleep(10);
		}
	}
}
