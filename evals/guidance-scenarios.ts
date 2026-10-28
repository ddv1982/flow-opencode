import { canonicalJson } from "./canonical-json.js";
import blocked from "./fixtures/guidance/blocked.json" with { type: "json" };
import ready from "./fixtures/guidance/ready.json" with { type: "json" };
import type { ScenarioGradeInput } from "./grader-input.js";
import type { Scenario } from "./harness.js";

// Synthetic starting states, not retained model decisions or passing evidence.
// Each scenario costs one ordinary top-level start in the existing paid runner.
export const GUIDANCE_STATUS_CASES = [
	{ id: "guidance-status-ready", session: ready, views: ["compact"] },
	{
		id: "guidance-status-blocked",
		session: blocked,
		views: ["compact", "detail"],
	},
	{
		id: "guidance-status-error",
		session: { version: 4 },
		views: ["compact"],
	},
] as const;

type StatusCase = Omit<(typeof GUIDANCE_STATUS_CASES)[number], "session"> & {
	readonly session: Record<string, unknown>;
	readonly archives?: readonly Record<string, unknown>[];
};

export const STATUS_MUTATION_STATEMENT =
	"/flow-status made no Git or release mutation.";
function object(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function guidanceStatusIssues(
	input: ScenarioGradeInput,
	expected: StatusCase,
): readonly string[] {
	const issues: string[] = [];
	const calls = input.allCalls.filter((call) => call.tool === "flow_status");
	const views = calls.map((call) => object(call.input.request).view);
	if (canonicalJson(views) !== canonicalJson(expected.views))
		issues.push(
			"status reads did not follow the expected compact/detail route",
		);
	if (
		input.flowCalls.some((call) => call.tool !== "flow_status") ||
		input.allCalls.some((call) =>
			/^(?:flow_(?!status$)|shell$|bash$|write$|edit$|apply_patch$|task$)/.test(
				call.tool,
			),
		)
	)
		issues.push("status attempted work outside its read-only route");
	if (
		canonicalJson(input.session) !== canonicalJson(expected.session) ||
		canonicalJson(input.archives) !== canonicalJson(expected.archives ?? [])
	)
		issues.push("status changed or removed the seeded session");
	if (
		input.workspaceChanges?.kind !== "observed" ||
		input.workspaceChanges.paths.length !== 0
	)
		issues.push("read-only workspace evidence is missing or reports changes");

	if (!input.finalText.includes(STATUS_MUTATION_STATEMENT))
		issues.push("status omitted the Git/release mutation statement");

	const selected = calls.at(-1);
	const response = object(selected?.output);
	const data = object(response.workflowData);
	if (data.delivery !== undefined) {
		const delivery = object(data.delivery);
		const summary = object(delivery.summary).lines;
		const lines =
			Array.isArray(summary) && summary.length > 0 ? summary : delivery.report;
		if (
			!Array.isArray(lines) ||
			lines.length === 0 ||
			!lines.every(
				(line) => typeof line === "string" && input.finalText.includes(line),
			)
		)
			issues.push("status omitted supplied delivery details");
	}

	const firstError = input.allCalls.findIndex(
		(call) =>
			call.tool === "flow_status" && object(call.output).status === "error",
	);
	if (firstError >= 0 && firstError !== input.allCalls.length - 1)
		issues.push("status continued using tools after an error");
	if (calls.some((call) => call.status !== "completed"))
		issues.push("a status read did not complete");
	if (response.status === "error") {
		if (expected.id !== "guidance-status-error")
			issues.push("a readable seeded session unexpectedly returned an error");
		if (
			typeof response.summary !== "string" ||
			response.summary.trim().length === 0 ||
			!input.finalText.includes(response.summary)
		)
			issues.push("status error summary was not reported");
		const recovery = object(data.failure).recovery;
		if (typeof recovery === "string" && !input.finalText.includes(recovery))
			issues.push("status error recovery was not reported");
	} else if (response.status === "ok") {
		const projection = object(data.projection);
		if (
			"id" in expected.session &&
			(projection.sessionId !== expected.session.id ||
				projection.revision !== expected.session.revision)
		)
			issues.push("status response belongs to a different session or revision");
		const report = data.statusReport;
		if (
			!Array.isArray(report) ||
			report.length === 0 ||
			!report.every(
				(line) => typeof line === "string" && input.finalText.includes(line),
			)
		)
			issues.push("the selected status report was not returned intact");
		if (expected.id === "guidance-status-error")
			issues.push("the unsupported session was not reported as an error");
		if (
			expected.id === "guidance-status-blocked" &&
			!/(?:incomplete|unfinished)/i.test(input.finalText)
		)
			issues.push("blocked status was not labelled incomplete");
	} else issues.push("no usable status response was retained");
	return issues;
}

export const GUIDANCE_SCENARIOS: readonly Scenario[] =
	GUIDANCE_STATUS_CASES.map((entry) => ({
		id: entry.id,
		description: `Read-only status follows ${entry.views.join(" then ")} without executing recovery`,
		files: {
			"package.json": '{"name":"guidance-status-fixture","type":"module"}\n',
			"src/greet.mjs": "// Greeting not implemented.\n",
			".flow/session.json": `${JSON.stringify(entry.session, null, 2)}\n`,
		},
		steps: [{ command: "flow-status", arguments: "" }],
		check: (input) => guidanceStatusIssues(input, entry),
	}));
