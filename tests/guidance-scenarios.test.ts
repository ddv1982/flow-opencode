import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScenarioGradeInput } from "../evals/grader-input.js";
import {
	GUIDANCE_SCENARIOS,
	GUIDANCE_STATUS_CASES,
} from "../evals/guidance-scenarios.js";
import type { ObservedToolCall } from "../evals/harness.js";
import { caseCatalogFor, releaseScenarios } from "../evals/run.js";
import FlowPlugin from "../src/index.js";
import { createNativeFlowHost } from "./fixtures/native-flow-host.js";

for (const [index, entry] of GUIDANCE_STATUS_CASES.entries()) {
	test(`${entry.id}: real plugin responses satisfy the grader; wrong routes and mutations fail`, async () => {
		const scenario = GUIDANCE_SCENARIOS[index];
		if (!scenario) throw new Error("Missing guidance scenario.");
		const workspace = await mkdtemp(join(tmpdir(), "flow-guidance-eval-"));
		const host = await createNativeFlowHost(workspace);
		try {
			await host.load(FlowPlugin);
			await mkdir(join(workspace, ".flow"), { recursive: true });
			const bytes = scenario.files[".flow/session.json"];
			if (!bytes) throw new Error("Missing seeded session.");
			await writeFile(join(workspace, ".flow/session.json"), bytes);
			const calls: ObservedToolCall[] = [];
			let finalText = "";
			for (const view of entry.views) {
				const output = await host.response("flow_status", {
					request: { view },
				});
				calls.push({
					tool: "flow_status",
					status: "completed",
					sessionIndex: 0,
					agent: "build",
					input: { request: { view } },
					output,
					rawOutput: JSON.stringify(output),
					metadata: {},
				});
				if (output.status === "error") {
					const failure = output.workflowData.failure as { recovery: string };
					finalText = `${output.summary}\n${failure.recovery}`;
				} else {
					const report = output.workflowData.statusReport;
					if (!Array.isArray(report)) throw new Error("Missing status report.");
					finalText = `${report.join("\n")}\nOverall incomplete.`;
				}
			}
			const input: ScenarioGradeInput = {
				flowCalls: calls,
				allCalls: calls,
				session: entry.session,
				archives: [],
				workspaceChanges: { kind: "observed", paths: [] },
				finalText,
			};
			expect(scenario.check(input)).toEqual([]);
			expect(
				await readFile(join(workspace, ".flow/session.json"), "utf8"),
			).toBe(bytes);
			// An omitted report or an empty trace cannot become a pass.
			expect(
				scenario.check({ ...input, finalText: "Flow looks good." }),
			).not.toEqual([]);
			expect(
				scenario.check({ ...input, flowCalls: [], allCalls: [] }),
			).not.toEqual([]);
			// Duplicate reads also catch continuing after an error.
			expect(
				scenario.check({ ...input, allCalls: [...calls, ...calls] }),
			).not.toEqual([]);
			if (entry.id === "guidance-status-error") {
				const first = calls[0];
				if (!first) throw new Error("Missing status error.");
				const trailingRead = {
					...first,
					tool: "read",
					input: { filePath: "src/greet.mjs" },
				};
				expect(
					scenario.check({ ...input, allCalls: [...calls, trailingRead] }),
				).not.toEqual([]);
			}
			// Retained text alone does not excuse a response for the wrong source state.
			if (entry.id !== "guidance-status-error") {
				const stale = structuredClone(calls);
				const last = stale.at(-1);
				if (!last) throw new Error("Missing status call.");
				const output = last.output as {
					workflowData: { projection: { revision: number } };
				};
				output.workflowData.projection.revision = 99;
				expect(
					scenario.check({ ...input, allCalls: stale, flowCalls: stale }),
				).not.toEqual([]);
				const error = calls.map((call, callIndex) =>
					callIndex === calls.length - 1
						? {
								...call,
								output: { status: "error", summary: "Unexpected failure" },
							}
						: call,
				);
				expect(
					scenario.check({
						...input,
						allCalls: error,
						finalText: "Unexpected failure",
					}),
				).not.toEqual([]);
			}
			if (entry.views.length > 1)
				expect(
					scenario.check({ ...input, allCalls: calls.slice(0, 1) }),
				).not.toEqual([]);
			for (const tool of [
				"flow_run_start",
				"flow_feature_reset",
				"flow_session_close",
				"shell",
				"write",
				"task",
			]) {
				const first = calls[0];
				if (!first) throw new Error("Missing status call.");
				const mutation = { ...first, tool };
				expect(
					scenario.check({
						...input,
						allCalls: [...calls, mutation],
						flowCalls: [...calls, mutation],
					}),
				).not.toEqual([]);
			}
			expect(scenario.check({ ...input, session: null })).not.toEqual([]);
			expect(
				scenario.check({
					...input,
					session: { ...entry.session, revision: 99 },
				}),
			).not.toEqual([]);
			expect(
				scenario.check({
					...input,
					workspaceChanges: { kind: "observed", paths: ["src/greet.mjs"] },
				}),
			).not.toEqual([]);
			expect(
				scenario.check({
					...input,
					workspaceChanges: { kind: "unavailable", reason: "not retained" },
				}),
			).not.toEqual([]);
		} finally {
			await host.dispose();
			await rm(workspace, { recursive: true, force: true });
		}
	});
}

test("guidance cases reuse ordinary catalog/reporting without altering the release matrix", () => {
	const catalog = caseCatalogFor(GUIDANCE_SCENARIOS, {
		kind: "ordinary",
		repeat: 1,
	});
	expect(catalog.map((row) => row.caseId)).toEqual(
		GUIDANCE_STATUS_CASES.map((row) => row.id),
	);
	expect(catalog.every((row) => row.release === "report-only")).toBe(true);
	const release = releaseScenarios("10.0.1");
	expect(release).toHaveLength(17);
	expect(release.some((row) => row.id.startsWith("guidance-status-"))).toBe(
		false,
	);
});
