import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OPENCODE_TOOL_REGISTRY } from "../src/adapters/opencode/tool-surface/tool-registry";
import { createTools } from "../src/adapters/opencode/tools";

const DEVELOPMENT_DOC_PATH = join(
	import.meta.dir,
	"..",
	"docs",
	"development.md",
);
const RUNTIME_TOOLS_HEADING = "## Current Runtime Tools";

type DocumentedToolRow = {
	toolName: string;
	description: string;
};

function extractDocumentedToolRows(markdown: string): DocumentedToolRow[] {
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
		.map((line) => line.trim().match(/^- `([^`]+)` — (.+)$/))
		.filter((match): match is RegExpMatchArray => match !== null)
		.map((match) => {
			const [, toolName, description] = match;
			if (!toolName || !description) {
				throw new Error(`Invalid documented tool row: ${match[0]}`);
			}
			return { toolName, description };
		});
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
	test("Current Runtime Tools matches registry-derived docs rows", async () => {
		const markdown = await readFile(DEVELOPMENT_DOC_PATH, "utf8");
		const documentedToolRows = extractDocumentedToolRows(markdown);
		const documentedToolNames = documentedToolRows.map((row) => row.toolName);
		const registeredToolNames = Object.keys(createTools({}));
		const registryDocsRows = OPENCODE_TOOL_REGISTRY.flatMap((entry) =>
			entry.docsRowMetadata?.section ===
			"docs/development.md#current-runtime-tools"
				? [
						{
							toolName: entry.toolName,
							section: entry.docsRowMetadata.section,
							label: entry.docsRowMetadata.label,
							description: entry.hostDescription,
						},
					]
				: [],
		);
		const expectedToolNames: string[] = registryDocsRows.map(
			(row) => row.toolName,
		);
		const registryLabels = [
			...new Set(registryDocsRows.map((row) => row.label)),
		];

		expect(registryLabels).toEqual(["Default OpenCode tool surface"]);
		expect(markdown).toContain(
			`${registryLabels[0]}, in registry docs-row order:`,
		);

		if (documentedToolRows.length === 0) {
			throw new Error(
				"No documented tool rows found under 'Current Runtime Tools'.",
			);
		}

		const duplicates = findDuplicates(documentedToolNames);
		const orderMismatch =
			documentedToolNames.length === expectedToolNames.length &&
			documentedToolNames.some(
				(toolName, index) => toolName !== expectedToolNames[index],
			);
		const missing = expectedToolNames
			.filter((name) => !documentedToolNames.includes(name))
			.sort();
		const extra = documentedToolNames
			.filter((name) => !expectedToolNames.includes(name))
			.sort();
		const descriptionMismatches = registryDocsRows
			.filter((expectedRow) => {
				const documentedRow = documentedToolRows.find(
					(row) => row.toolName === expectedRow.toolName,
				);
				return documentedRow?.description !== expectedRow.description;
			})
			.map((row) => row.toolName)
			.sort();

		expect(expectedToolNames).toEqual(registeredToolNames);

		if (
			duplicates.length > 0 ||
			missing.length > 0 ||
			extra.length > 0 ||
			orderMismatch ||
			descriptionMismatches.length > 0
		) {
			const issues = [
				duplicates.length > 0
					? `Duplicated in docs: ${duplicates.join(", ")}`
					: null,
				missing.length > 0 ? `Missing from docs: ${missing.join(", ")}` : null,
				extra.length > 0
					? `Documented but not registry-backed: ${extra.join(", ")}`
					: null,
				orderMismatch
					? "Documented tools do not match registry docs row order."
					: null,
				descriptionMismatches.length > 0
					? `Description mismatch: ${descriptionMismatches.join(", ")}`
					: null,
			].filter((issue): issue is string => issue !== null);

			throw new Error(issues.join("\n"));
		}
	});
});
