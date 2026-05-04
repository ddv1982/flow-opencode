export const FLOW_GITIGNORE_ENTRIES = [
	"active/",
	"stored/",
	"completed/",
	"events/",
	"checkpoints/",
	"projections/",
	"locks/",
	"standards-profile.json",
] as const;

export function parseGitignoreEntries(contents: string): string[] {
	return contents.split(/\r?\n/).filter((line) => line.length > 0);
}

export function mergeGitignoreEntries(
	existingEntries: string[],
	requiredEntries: readonly string[] = FLOW_GITIGNORE_ENTRIES,
): string[] {
	const nextEntries = [...existingEntries];
	for (const entry of requiredEntries) {
		if (!nextEntries.includes(entry)) {
			nextEntries.push(entry);
		}
	}
	return nextEntries;
}

export function renderGitignoreEntries(entries: string[]): string {
	return entries.map((entry) => `${entry}\n`).join("");
}
