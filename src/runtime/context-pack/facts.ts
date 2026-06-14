import {
	isCatchAllContextTarget,
	normalizeContextPath,
} from "../context-paths";
import type { Feature, Session } from "../schema";

export function uniqueStrings(values: string[]): string[] {
	return Array.from(
		new Set(values.map((value) => value.trim()).filter(Boolean)),
	);
}

export function featureReviewScope(feature: Feature): string[] {
	return uniqueStrings([
		...feature.fileTargets,
		...(feature.reviewScope ?? []).map((target) =>
			target.description
				? `${target.kind}:${target.target} (${target.description})`
				: `${target.kind}:${target.target}`,
		),
	]);
}

function featureReviewScopeTargets(feature: Feature): string[] {
	return uniqueStrings(
		(feature.reviewScope ?? []).map((target) => target.target),
	);
}

export function featureContextTargets(feature: Feature): string[] {
	return uniqueStrings([
		...feature.fileTargets,
		...featureReviewScopeTargets(feature),
	]);
}

export function changedArtifactPaths(session: Session): string[] {
	return uniqueStrings([
		...session.artifacts.map((artifact) => artifact.path),
		...session.execution.history.flatMap((entry) =>
			entry.artifactsChanged.map((artifact) => artifact.path),
		),
	]);
}

export function validationCommands(session: Session): string[] {
	return uniqueStrings([
		...session.execution.lastValidationRun.map((entry) => entry.command),
		...session.execution.history.flatMap((entry) =>
			entry.validationRun.map((validation) => validation.command),
		),
	]);
}

export function plannedContextTargets(features: Feature[]): Set<string> {
	return new Set(features.flatMap((feature) => featureContextTargets(feature)));
}

export function isBroadContextTarget(target: string): boolean {
	const normalizedTarget = normalizeContextPath(target);
	return (
		isCatchAllContextTarget(normalizedTarget) ||
		normalizedTarget.endsWith("/**")
	);
}

export function featureHistoryEntries(session: Session, featureId: string) {
	return session.execution.history.filter(
		(entry) => entry.featureId === featureId,
	);
}

export function lastValue<T>(values: Array<T | null | undefined>): T | null {
	for (let index = values.length - 1; index >= 0; index -= 1) {
		const value = values[index];
		if (value !== null && value !== undefined) {
			return value;
		}
	}
	return null;
}
