// Named results, against the failure exit codes could not see.
//
// The measured run ADR 0011's amendment records declared it needed Windows, ran its
// exact declared command on the declared host's *substitute*, and discharged the
// entry with exit zero — green because the case was skipped. `hostPlatform` closed
// the wrong machine. These pin the other half: the same skip on the right machine.

import { describe, expect, test } from "bun:test";
import {
	appendFile,
	mkdir,
	mkdtemp,
	rename,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TEST_REPORT_BYTES } from "../src/domain/limits.js";
import {
	assertionsSatisfied,
	unmetAssertions,
} from "../src/domain/test-results.js";
import { readWorkspaceTestReport } from "../src/infrastructure/fs/workspace-validation.js";
import { observeAssertions } from "../src/infrastructure/junit-results.js";

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

	test("reads Bun's own shape, where the path is in `file` and classname is empty", () => {
		// Verbatim from `bun test --reporter=junit`, which is the runner Flow is built
		// on. It emits `classname=""`, so treating only `classname` as the suite made
		// the most natural qualified name the one form that did not match — a refusal
		// of a case that passed.
		const bun = `<testsuites>
      <testcase name="renames a reserved device name" classname="" time="0" file="src/platform.test.ts" line="4" assertions="1" />
      <testcase name="creates the replacement on Windows" classname="" time="0" file="src/platform.test.ts" line="9" assertions="0">
        <skipped />
      </testcase>
    </testsuites>`;
		for (const name of [
			"creates the replacement on Windows",
			"src/platform.test.ts creates the replacement on Windows",
			"src/platform.test.ts > creates the replacement on Windows",
		]) {
			expect(observeAssertions([name], bun)).toEqual([
				{ name, status: "skipped" },
			]);
		}
		expect(
			observeAssertions(
				["src/platform.test.ts > renames a reserved device name"],
				bun,
			),
		).toEqual([
			{
				name: "src/platform.test.ts > renames a reserved device name",
				status: "passed",
			},
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

	test("reports nothing for an unparseable, empty, or suiteless report", () => {
		// The last one is the fail-closed case: a bare `<testcase>` in text that is not a
		// report -- a truncated write, a log quoting a case name -- must not name a
		// declared case passed just because the element appears.
		for (const report of [
			"",
			"not xml at all",
			"<testsuites></testsuites>",
			'<testcase name="anything"/>',
			'garbage <testcase name="anything" classname="s"/> more garbage',
		]) {
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

	test.each([
		'<testsuites><testcase name="never-ran"/>',
		'<testsuites><!-- <testcase name="never-ran"/> --></testsuites>',
		'<testsuites><system-out><![CDATA[<testcase name="never-ran"/>]]></system-out></testsuites>',
		'<testsuites><system-out><testcase name="never-ran"/></system-out></testsuites>',
		'<testsuites><testcase name="real"><system-out><testcase name="never-ran"/></system-out></testcase></testsuites>',
		'<testsuites><testcase name="never-ran"/></wrong>',
		'<testsuites><testcase name="never-ran"/></testsuites><testsuites/>',
		'<testsuites><testcase name="never-ran" name="other"/></testsuites>',
		'<testsuites><testcase name="never-ran" broken/></testsuites>',
		'<!DOCTYPE testsuites><testsuites><testcase name="never-ran"/></testsuites>',
		'<!DOCTYPE testsuites [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuites><testcase name="never-ran"/></testsuites>',
		'<log><testsuites><testcase name="never-ran"/></testsuites></log>',
	])("does not invent passing evidence from %s", (report) => {
		expect(observeAssertions(["never-ran"], report)).toEqual([
			{ name: "never-ran", status: "absent" },
		]);
	});

	test("accepts XML quoting and character references without reading log markup", () => {
		const report = `<testsuite><testcase name='a > b &amp; &#34;c&#x22;'>
			<system-out><![CDATA[<failure/>]]></system-out><!-- <skipped/> -->
		</testcase></testsuite>`;
		expect(observeAssertions(['a > b & "c"'], report)).toEqual([
			{ name: 'a > b & "c"', status: "passed" },
		]);
	});

	test("handles deep suites with many cases within the report limit", () => {
		const report =
			"<testsuite>".repeat(100_000) +
			'<testcase name="x"/>'.repeat(80_000) +
			"</testsuite>".repeat(100_000);
		expect(Buffer.byteLength(report)).toBeLessThan(MAX_TEST_REPORT_BYTES);
		expect(observeAssertions(["x"], report)).toEqual([
			{ name: "x", status: "passed" },
		]);
	});

	test("restores suite eligibility after leaving nested log elements", () => {
		const report = `<testsuites><testsuite><system-out><testsuite>
			<testcase name="fake"/>
		</testsuite></system-out><testcase name="real"><skipped/></testcase>
		<testcase name="next"/></testsuite></testsuites>`;
		expect(observeAssertions(["fake", "real", "next"], report)).toEqual([
			{ name: "fake", status: "absent" },
			{ name: "real", status: "skipped" },
			{ name: "next", status: "passed" },
		]);
	});

	test.each([
		["<failure/>", "<skipped/>", ""],
		["", "<skipped/>", "<error/>"],
		["<skipped/>", "<failure/>", ""],
	])("keeps failed duplicates regardless of ordering: %j", (...bodies) => {
		const report = `<testsuites>${bodies.map((body) => `<testcase name="flaky">${body}</testcase>`).join("")}</testsuites>`;
		expect(observeAssertions(["flaky"], report)).toEqual([
			{ name: "flaky", status: "failed" },
		]);
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
			// outside the repository for something to call a result. Both cases write a
			// real file first: `/etc/hosts` used to stand in for the absolute case and
			// proved nothing, because `join(root, "/etc/hosts")` lands *inside* the
			// workspace and the assertion passed only because nothing was there.
			const outside = join(root, "..", "outside.xml");
			await writeFile(outside, '<testsuite><testcase name="x"/></testsuite>');
			expect(await readWorkspaceTestReport(root, "../outside.xml")).toBeNull();
			expect(await readWorkspaceTestReport(root, outside)).toBeNull();
			// And the containment check must still admit what it is for. This is the
			// assertion that fails when a POSIX prefix test is used on Windows.
			await mkdir(join(root, "nested"), { recursive: true });
			await writeFile(
				join(root, "nested", "report.xml"),
				'<testsuite><testcase name="ok"/></testsuite>',
			);
			expect(
				await readWorkspaceTestReport(root, "nested/report.xml"),
			).not.toBeNull();
		} finally {
			await rm(join(root, "..", "outside.xml"), { force: true });
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses an absolute path even when it names a workspace file", async () => {
		const root = await workspace();
		try {
			const report = join(root, "junit.xml");
			await writeFile(report, REPORT, "utf8");
			expect(await readWorkspaceTestReport(root, report)).toBeNull();
			expect(
				await readWorkspaceTestReport(root, "C:\\workspace\\junit.xml"),
			).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses a final symlink that escapes the workspace", async () => {
		const root = await workspace();
		const outside = await mkdtemp(join(tmpdir(), "flow-report-outside-"));
		try {
			const outsideReport = join(outside, "junit.xml");
			await writeFile(outsideReport, REPORT, "utf8");
			await symlink(outsideReport, join(root, "junit.xml"), "file");

			expect(await readWorkspaceTestReport(root, "junit.xml")).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("refuses a symlinked parent directory that escapes the workspace", async () => {
		const root = await workspace();
		const outside = await mkdtemp(join(tmpdir(), "flow-report-outside-"));
		try {
			await writeFile(join(outside, "junit.xml"), REPORT, "utf8");
			await symlink(
				outside,
				join(root, "reports"),
				process.platform === "win32" ? "junction" : "dir",
			);

			expect(
				await readWorkspaceTestReport(root, "reports/junit.xml"),
			).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
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
				Buffer.alloc(MAX_TEST_REPORT_BYTES),
			);
			expect(await readWorkspaceTestReport(root, "huge.xml")).not.toBeNull();
			await writeFile(
				join(root, "huge.xml"),
				Buffer.alloc(MAX_TEST_REPORT_BYTES + 1),
			);
			expect(await readWorkspaceTestReport(root, "huge.xml")).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses malformed UTF-8", async () => {
		const root = await workspace();
		try {
			await writeFile(join(root, "junit.xml"), Buffer.from([0xc3, 0x28]));
			expect(await readWorkspaceTestReport(root, "junit.xml")).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses path replacement after inspection or open", async () => {
		for (const stage of ["inspected", "opened"] as const) {
			const root = await workspace();
			try {
				const report = join(root, "junit.xml");
				await writeFile(report, REPORT, "utf8");
				expect(
					await readWorkspaceTestReport(root, "junit.xml", async (at) => {
						if (at !== stage) return;
						await rename(report, join(root, `${stage}.xml`));
						await writeFile(report, "replacement", "utf8");
					}),
				).toBeNull();
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
	});

	test("refuses parent replacement after inspection", async () => {
		const root = await workspace();
		try {
			const reports = join(root, "reports");
			await mkdir(reports);
			await writeFile(join(reports, "junit.xml"), REPORT, "utf8");
			expect(
				await readWorkspaceTestReport(
					root,
					"reports/junit.xml",
					async (stage) => {
						if (stage !== "inspected") return;
						await rename(reports, join(root, "original-reports"));
						await mkdir(reports);
						await writeFile(join(reports, "junit.xml"), "replacement", "utf8");
					},
				),
			).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refuses growth or truncation after reading", async () => {
		for (const mutation of ["grow", "truncate"] as const) {
			const root = await workspace();
			try {
				const report = join(root, "junit.xml");
				await writeFile(report, REPORT, "utf8");
				expect(
					await readWorkspaceTestReport(root, "junit.xml", async (stage) => {
						if (stage !== "read") return;
						if (mutation === "grow") await appendFile(report, "x");
						else await truncate(report, 1);
					}),
				).toBeNull();
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
	});
});
