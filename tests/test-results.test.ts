// Named results, against the failure exit codes could not see.
//
// The measured run ADR 0011's amendment records declared it needed Windows, ran its
// exact declared command on the declared host's *substitute*, and discharged the
// entry with exit zero — green because the case was skipped. `hostPlatform` closed
// the wrong machine. These pin the other half: the same skip on the right machine.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TEST_REPORT_BYTES } from "../src/domain/limits.js";
import {
	assertionsSatisfied,
	observeAssertions,
	unmetAssertions,
} from "../src/domain/test-results.js";
import { readWorkspaceTestReport } from "../src/infrastructure/fs/workspace-validation.js";

/** One bun-shaped report: a pass, a skip, a failure, and a self-closing pass. */
const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test">
  <testsuite name="src/platform.test.ts">
    <testcase name="renames a reserved device name" classname="src/platform.test.ts" time="0.001"/>
    <testcase name="creates the replacement on Windows" classname="src/platform.test.ts" time="0">
      <skipped/>
    </testcase>
    <testcase name="rejects the original on Windows" classname="src/platform.test.ts" time="0.002">
      <failure message="expected false to be true">at src/platform.test.ts:12</failure>
    </testcase>
    <testcase name="escapes &lt;brackets&gt; &amp; quotes" classname="src/platform.test.ts"/>
  </testsuite>
</testsuites>
`;

describe("observing named test results", () => {
	test("reads each declared case as the report described it", () => {
		expect(
			observeAssertions(
				[
					"renames a reserved device name",
					"creates the replacement on Windows",
					"rejects the original on Windows",
					"never written",
				],
				REPORT,
			),
		).toEqual([
			{ name: "renames a reserved device name", status: "passed" },
			{ name: "creates the replacement on Windows", status: "skipped" },
			{ name: "rejects the original on Windows", status: "failed" },
			// The whole point of the fourth status: a name the report never mentions is
			// not a pass, and exit zero says nothing about it either way.
			{ name: "never written", status: "absent" },
		]);
	});

	test("accepts a name qualified by its suite, however the runner joins it", () => {
		for (const name of [
			"renames a reserved device name",
			"src/platform.test.ts renames a reserved device name",
			"src/platform.test.ts.renames a reserved device name",
			"src/platform.test.ts > renames a reserved device name",
		]) {
			expect(observeAssertions([name], REPORT)).toEqual([
				{ name, status: "passed" },
			]);
		}
	});

	test("decodes the entities a report has to escape", () => {
		expect(observeAssertions(["escapes <brackets> & quotes"], REPORT)).toEqual([
			{ name: "escapes <brackets> & quotes", status: "passed" },
		]);
	});

	test("keeps the worse outcome when a name is reported twice", () => {
		// A retried case reported once failing and once passing has still failed, and
		// taking the later record would let a retry loop launder it.
		const retried = `<testsuites>
      <testcase name="flaky" classname="s"><failure/></testcase>
      <testcase name="flaky" classname="s"/>
    </testsuites>`;
		expect(observeAssertions(["flaky"], retried)).toEqual([
			{ name: "flaky", status: "failed" },
		]);
	});

	test("reports nothing for an unparseable or empty report", () => {
		for (const report of ["", "not xml at all", "<testsuites></testsuites>"]) {
			expect(observeAssertions(["anything"], report)).toEqual([
				{ name: "anything", status: "absent" },
			]);
		}
	});

	test("declares nothing satisfied unless every name passed", () => {
		const observed = observeAssertions(
			["renames a reserved device name", "creates the replacement on Windows"],
			REPORT,
		);
		expect(assertionsSatisfied([], undefined)).toBe(true);
		expect(
			assertionsSatisfied(["renames a reserved device name"], observed),
		).toBe(true);
		expect(
			assertionsSatisfied(["creates the replacement on Windows"], observed),
		).toBe(false);
		// No observation at all is the state a run reaches by never naming a report,
		// and it must not pass.
		expect(assertionsSatisfied(["renames a reserved device name"], [])).toBe(
			false,
		);
	});

	test("names the unmet cases with why, so a refusal can quote them", () => {
		const observed = observeAssertions(
			["creates the replacement on Windows", "never written"],
			REPORT,
		);
		expect(
			unmetAssertions(
				["creates the replacement on Windows", "never written"],
				observed,
			),
		).toEqual([
			'"creates the replacement on Windows" skipped',
			'"never written" absent',
		]);
	});
});

describe("reading a report from the workspace", () => {
	async function workspace(): Promise<string> {
		return mkdtemp(join(tmpdir(), "flow-report-"));
	}

	test("reads a report inside the workspace, with when it was written", async () => {
		const root = await workspace();
		try {
			await mkdir(join(root, "reports"), { recursive: true });
			await writeFile(join(root, "reports", "junit.xml"), REPORT, "utf8");
			const read = await readWorkspaceTestReport(root, "reports/junit.xml");
			expect(read?.text).toBe(REPORT);
			expect(read?.modifiedMs).toBeGreaterThan(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses a path that escapes the workspace", async () => {
		const root = await workspace();
		try {
			// The path is the caller's, so this is the one place a caller could reach
			// outside the repository for something to call a result.
			expect(await readWorkspaceTestReport(root, "../outside.xml")).toBeNull();
			expect(await readWorkspaceTestReport(root, "/etc/hosts")).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses a directory, a missing file, and anything over the cap", async () => {
		const root = await workspace();
		try {
			await mkdir(join(root, "reports"), { recursive: true });
			expect(await readWorkspaceTestReport(root, "reports")).toBeNull();
			expect(await readWorkspaceTestReport(root, "absent.xml")).toBeNull();
			await writeFile(
				join(root, "huge.xml"),
				"x".repeat(MAX_TEST_REPORT_BYTES + 1),
				"utf8",
			);
			expect(await readWorkspaceTestReport(root, "huge.xml")).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
