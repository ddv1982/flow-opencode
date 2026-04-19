import { describe, expect, test } from "bun:test";
import { SEMANTIC_INVARIANT_IDS } from "../src/runtime/domain";
import {
	expectDistinctIds,
	expectKnownInvariantIds,
	extractDocumentedSemanticInvariantIds,
	readRepoFile,
} from "./cross-area/semantic-parity-helpers";

const CANONICAL_DOCS = [
	"docs/architecture/invariant-matrix.md",
	"docs/architecture/strictness-contract.md",
	"docs/architecture/v2-boundaries.md",
] as const;

describe("docs semantic parity", () => {
	test("canonical docs declare semantic invariants with explicit markers", () => {
		for (const relativePath of CANONICAL_DOCS) {
			const ids = extractDocumentedSemanticInvariantIds(
				readRepoFile(relativePath),
			);
			expect(ids.length).toBeGreaterThan(0);
			expectKnownInvariantIds(ids);
			expectDistinctIds(ids);
		}
	});

	test("canonical docs cover the full runtime-owned semantic catalog", () => {
		const ids = [
			...new Set(
				CANONICAL_DOCS.flatMap((relativePath) =>
					extractDocumentedSemanticInvariantIds(readRepoFile(relativePath)),
				),
			),
		].sort();

		expect(ids).toEqual([...SEMANTIC_INVARIANT_IDS].sort());
	});
});
