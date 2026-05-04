import { relative } from "node:path";
import type { StackProfile, StandardsProfile } from "../schema";
import { STACK_RESEARCH_QUERIES } from "./stack-standards-research-queries";

type StackBucket = keyof StackProfile;
type StandardsPriority = "user" | "local" | "official" | "external";

export function objectRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function addSignal(
	profile: StackProfile,
	bucket: StackBucket,
	name: string,
	evidenceRef: string,
	confidence: "low" | "medium" | "high",
) {
	profile[bucket].push({
		name,
		evidenceRefs: [evidenceRef],
		confidence,
	});
}

export function addRule(
	profile: StandardsProfile,
	summary: string,
	sourceRefs: string[],
	priority: StandardsPriority,
) {
	profile.rules.push({ summary, sourceRefs, priority });
}

export function addGap(
	profile: StandardsProfile,
	stackItem: string,
	reason: string,
	suggestedResearch: string[],
) {
	profile.gaps.push({ stackItem, reason, suggestedResearch });
}

export function dedupeStackProfile(profile: StackProfile): StackProfile {
	return Object.fromEntries(
		Object.entries(profile).map(([bucket, items]) => [
			bucket,
			dedupeEntries(items),
		]),
	) as StackProfile;
}

function dedupeEntries<T extends { name: string; evidenceRefs: string[] }>(
	items: T[],
): T[] {
	const byName = new Map<string, T>();
	for (const item of items) {
		const existing = byName.get(item.name);
		if (!existing) {
			byName.set(item.name, {
				...item,
				evidenceRefs: [...new Set(item.evidenceRefs)],
			});
			continue;
		}
		existing.evidenceRefs = [
			...new Set([...existing.evidenceRefs, ...item.evidenceRefs]),
		];
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function dedupeStandardsProfile(
	profile: StandardsProfile,
): StandardsProfile {
	return {
		localGuidelines: dedupeByReference(profile.localGuidelines),
		externalGuidance: dedupeByReference(profile.externalGuidance),
		rules: dedupeRules(profile.rules),
		gaps: dedupeGaps(profile.gaps),
		precedence: [...new Set(profile.precedence)],
	};
}

export function addResearchGaps(
	profile: StandardsProfile,
	stackProfile: StackProfile,
): StandardsProfile {
	if (!hasStackSignals(stackProfile)) {
		return profile;
	}
	const knownLocalRefs = new Set([
		...profile.localGuidelines.map((item) => item.reference),
		...profile.rules.flatMap((item) => item.sourceRefs),
	]);
	const nextProfile = { ...profile, gaps: [...profile.gaps] };
	for (const item of [
		...stackProfile.languages,
		...stackProfile.frameworks,
		...stackProfile.tools,
	]) {
		if (hasSpecificLocalRule(profile, item.name, knownLocalRefs)) {
			continue;
		}
		addGap(
			nextProfile,
			item.name,
			"No local standards were found for this detected stack item.",
			researchQueriesFor(item.name),
		);
	}
	return nextProfile;
}

function hasSpecificLocalRule(
	profile: StandardsProfile,
	stackItem: string,
	knownLocalRefs: Set<string>,
): boolean {
	const normalizedStackItem = stackItem.toLocaleLowerCase();
	return profile.rules.some(
		(rule) =>
			rule.priority === "local" &&
			rule.summary.toLocaleLowerCase().includes(normalizedStackItem) &&
			rule.sourceRefs.some((ref) => knownLocalRefs.has(ref)),
	);
}

export function hasStackSignals(profile: StackProfile): boolean {
	return Object.values(profile).some((items) => items.length > 0);
}

export function hasStandardsSignals(profile: StandardsProfile): boolean {
	return (
		profile.localGuidelines.length > 0 ||
		profile.externalGuidance.length > 0 ||
		profile.rules.length > 0 ||
		profile.gaps.length > 0
	);
}

export function withStandardsPrecedence(
	profile: StandardsProfile,
): StandardsProfile {
	return {
		...profile,
		rules: [
			{
				summary:
					"Apply direct user instructions first, then repo-local guideline files and configs, then official docs, then broader external standards.",
				sourceRefs: [],
				priority: "user",
			},
			...profile.rules,
		],
		precedence: [
			"direct user instructions",
			"repo-local guideline files and tool configs",
			"official documentation via Ref/MCP or webfetch",
			"broader Exa/websearch guidance",
			...profile.precedence,
		],
	};
}

function dedupeByReference<T extends { reference: string }>(items: T[]): T[] {
	return [
		...new Map(items.map((item) => [item.reference, item])).values(),
	].sort((a, b) => a.reference.localeCompare(b.reference));
}

function dedupeRules<T extends { summary: string; sourceRefs: string[] }>(
	items: T[],
): T[] {
	const bySummary = new Map<string, T>();
	for (const item of items) {
		const existing = bySummary.get(item.summary);
		if (!existing) {
			bySummary.set(item.summary, {
				...item,
				sourceRefs: [...new Set(item.sourceRefs)],
			});
			continue;
		}
		existing.sourceRefs = [
			...new Set([...existing.sourceRefs, ...item.sourceRefs]),
		];
	}
	return [...bySummary.values()];
}

function dedupeGaps<
	T extends { stackItem: string; suggestedResearch: string[] },
>(items: T[]): T[] {
	const byItem = new Map<string, T>();
	for (const item of items) {
		const existing = byItem.get(item.stackItem);
		if (!existing) {
			byItem.set(item.stackItem, {
				...item,
				suggestedResearch: [...new Set(item.suggestedResearch)],
			});
			continue;
		}
		existing.suggestedResearch = [
			...new Set([...existing.suggestedResearch, ...item.suggestedResearch]),
		];
	}
	return [...byItem.values()].sort((a, b) =>
		a.stackItem.localeCompare(b.stackItem),
	);
}

function researchQueriesFor(stackItem: string): string[] {
	return (
		STACK_RESEARCH_QUERIES[stackItem] ?? [
			`Ref MCP: official ${stackItem} coding standards and configuration documentation`,
			`Exa: current ${stackItem} best practices for production code quality`,
			`Websearch fallback: official ${stackItem} testing and maintenance documentation`,
		]
	);
}

export function relativeRef(
	workspaceRoot: string,
	absolutePath: string,
): string {
	const pathFromRoot = relative(workspaceRoot, absolutePath);
	return pathFromRoot === "" || pathFromRoot.startsWith("..")
		? absolutePath
		: pathFromRoot;
}
