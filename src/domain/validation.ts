import type { FeatureRun, Session, SourceDigest } from "./session.js";

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
	const commands = [...new Set(feature.validation)];
	const knownFailed = new Set(
		session.runs
			.filter((candidate) => candidate.featureId === run.featureId)
			.flatMap((candidate) => candidate.validations)
			.filter(
				(observation) =>
					commands.includes(observation.command) &&
					(observation.exitCode !== 0 || !observation.outputComplete),
			)
			.map((observation) => observation.command),
	);
	return commands.filter((command) => {
		const latest = run.validations
			.filter(
				(observation) =>
					observation.command === command &&
					(sourceDigest === undefined ||
						observation.sourceDigest === sourceDigest),
			)
			.sort((left, right) => right.recordedRevision - left.recordedRevision)[0];
		return (
			knownFailed.has(command) &&
			(latest?.exitCode !== 0 || !latest.outputComplete)
		);
	});
}
