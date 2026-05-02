import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FLOW_REVIEW_COMMAND_TEMPLATE } from "../src/audit/prompts/commands";

const PROMPT_SNAPSHOT_DIR = join(
	import.meta.dir,
	"__fixtures__",
	"prompt-snapshots",
);

describe("prompt snapshots", () => {
	test("flow-review command prompt matches the committed review-quality snapshot", async () => {
		const snapshot = await readFile(
			join(PROMPT_SNAPSHOT_DIR, "flow-review-command-template.md"),
			"utf8",
		);

		expect(`${FLOW_REVIEW_COMMAND_TEMPLATE}\n`).toBe(snapshot);
		expect(snapshot).toContain(
			"Run a read-only Flow review and present calibrated findings",
		);
		expect(snapshot).toContain(
			"Trace concrete invariants and failure paths before writing findings",
		);
		expect(snapshot).toContain(
			"achievedDepth can be full_audit only when every major surface",
		);
		expect(snapshot).toContain(
			"Use hardening_opportunity for useful architectural, test, or resilience improvements",
		);
		expect(snapshot).toContain(
			"Pass the ledger to flow_review_render exactly as { reviewJson: JSON.stringify(ledger), view }",
		);
		expect(snapshot).toContain(
			"reviewJson must contain the actual serialized JSON string for the ledger",
		);
	});
});
