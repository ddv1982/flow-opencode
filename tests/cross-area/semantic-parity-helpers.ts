import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	SEMANTIC_INVARIANT_IDS,
	type SemanticInvariantId,
} from "../../src/runtime/domain";

const repoRoot = join(import.meta.dir, "..", "..");
const DOC_INVARIANT_MARKER_PATTERN =
	/^\s*-\s+\[semantic-invariant\]\s+([a-z_]+\.[a-z_]+\.[a-z_]+)\s*$/;

export type DocumentedSemanticInvariant = {
	id: string;
	line: number;
};

export function knownSemanticInvariantIds(): SemanticInvariantId[] {
	return [...SEMANTIC_INVARIANT_IDS];
}

export function expectKnownInvariantIds(ids: readonly string[]): void {
	const knownIds = new Set<string>(knownSemanticInvariantIds());
	for (const id of ids) {
		if (!knownIds.has(id)) {
			throw new Error(`Unknown semantic invariant id: ${id}`);
		}
	}
}

export function expectDistinctIds(ids: readonly string[]): void {
	const seen = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) {
			throw new Error(`Duplicate semantic invariant id: ${id}`);
		}
		seen.add(id);
	}
}

export function readRepoFile(relativePath: string): string {
	return readFileSync(join(repoRoot, relativePath), "utf8");
}

export function extractDocumentedSemanticInvariants(
	text: string,
): DocumentedSemanticInvariant[] {
	const markers: DocumentedSemanticInvariant[] = [];
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (!line.includes("[semantic-invariant]")) {
			continue;
		}
		const match = line.match(DOC_INVARIANT_MARKER_PATTERN);
		if (!match) {
			throw new Error(
				`Malformed semantic invariant marker at line ${index + 1}: ${line.trim()}`,
			);
		}
		const id = match[1];
		if (!id) {
			throw new Error(
				`Semantic invariant marker missing id at line ${index + 1}: ${line.trim()}`,
			);
		}
		markers.push({ id, line: index + 1 });
	}
	return markers;
}

export function extractDocumentedSemanticInvariantIds(text: string): string[] {
	return extractDocumentedSemanticInvariants(text).map((marker) => marker.id);
}
