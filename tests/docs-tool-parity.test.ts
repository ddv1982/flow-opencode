import { describe, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTools } from "../src/tools";

const DEVELOPMENT_DOC_PATH = join(
	import.meta.dir,
	"..",
	"docs",
	"development.md",
);
const RUNTIME_TOOLS_HEADING = "## Current Runtime Tools";

function extractDocumentedToolNames(markdown: string): string[] {
	const headingIndex = markdown.indexOf(RUNTIME_TOOLS_HEADING);
	if (headingIndex === -1) {
		throw new Error(
			`Missing '${RUNTIME_TOOLS_HEADING}' section in docs/development.md`,
		);
	}

	const lineBreakIndex = markdown.indexOf("\n", headingIndex);
	if (lineBreakIndex === -1) {
		throw new Error(
			`Unable to parse '${RUNTIME_TOOLS_HEADING}' section in docs/development.md`,
		);
	}

	const nextHeadingIndex =
		markdown.slice(lineBreakIndex + 1).match(/\n##\s+/)?.index ?? -1;
	const sectionEndIndex =
		nextHeadingIndex >= 0
			? lineBreakIndex + 1 + nextHeadingIndex
			: markdown.length;

	return markdown
		.slice(lineBreakIndex + 1, sectionEndIndex)
		.split("\n")
		.map((line) => line.trim().match(/^- `([^`]+)`$/)?.[1])
		.filter((toolName): toolName is string => Boolean(toolName));
}

function findDuplicates(items: string[]) {
	const counts = new Map<string, number>();
	for (const item of items) {
		counts.set(item, (counts.get(item) ?? 0) + 1);
	}

	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([name]) => name)
		.sort();
}

describe("development docs tool parity", () => {
	test("Current Runtime Tools matches the registered tool surface", async () => {
		const markdown = await readFile(DEVELOPMENT_DOC_PATH, "utf8");
		const documentedToolNames = extractDocumentedToolNames(markdown);
		const registeredToolNames = Object.keys(createTools({}));

		if (documentedToolNames.length === 0) {
			throw new Error(
				"No documented tools found under 'Current Runtime Tools'.",
			);
		}

		const duplicates = findDuplicates(documentedToolNames);
		const missing = registeredToolNames
			.filter((name) => !documentedToolNames.includes(name))
			.sort();
		const extra = documentedToolNames
			.filter((name) => !registeredToolNames.includes(name))
			.sort();

		if (duplicates.length > 0 || missing.length > 0 || extra.length > 0) {
			const issues = [
				duplicates.length > 0
					? `Duplicated in docs: ${duplicates.join(", ")}`
					: null,
				missing.length > 0 ? `Missing from docs: ${missing.join(", ")}` : null,
				extra.length > 0
					? `Documented but not registered: ${extra.join(", ")}`
					: null,
			].filter((issue): issue is string => issue !== null);

			throw new Error(issues.join("\n"));
		}
	});
});
