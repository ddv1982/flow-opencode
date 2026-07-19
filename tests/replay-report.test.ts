import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
	buildReplayReport,
	formatReplayReport,
	parseReplayFixtureText,
	parseReplayReportArgs,
	reconcile,
	resolveReplayFixturePath,
} from "../scripts/replay-report.js";
import {
	parseReplayFixture,
	REPLAY_SCENARIO_IDS,
	replayFixture,
	validateReplayFixturePrivacy,
} from "../src/application/replay/index.js";

const FIXTURE_PATH = "tests/fixtures/replay/long-running-v5/fixture.json";

async function loadFixture() {
	return JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as unknown;
}

function runReport(...args: string[]) {
	return Bun.spawnSync({
		cmd: ["bun", "run", "scripts/replay-report.ts", ...args],
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
	});
}

describe("sanitized replay report", () => {
	test("rejects duplicate JSON keys before privacy and schema validation", () => {
		expect(() =>
			parseReplayFixtureText('{"version":1,"nested":{"value":1,"value":2}}'),
		).toThrow("replay fixture has duplicate key 'value'");
	});

	test("validates the closed fixture and replays all nine control scenarios", async () => {
		const raw = await loadFixture();
		expect(validateReplayFixturePrivacy(raw)).toEqual({
			safe: true,
			violations: [],
		});
		const fixture = parseReplayFixture(raw);
		expect(fixture.scenarios.map(({ id }) => id).sort()).toEqual(
			[...REPLAY_SCENARIO_IDS].sort(),
		);
		const first = replayFixture(fixture, "A");
		const second = replayFixture(fixture, "A");
		expect(first).toEqual(second);
		expect(first.supported).toBe(true);
		expect(first.scenarios).toHaveLength(9);
		expect(first.scenarios.every(({ decision }) => decision !== null)).toBe(
			true,
		);
	});

	test("marks reconciliation unavailable when an expected derived fact is absent", () => {
		const hostFacts = [
			{
				metric: "session_count" as const,
				availability: { status: "available" as const, value: 46 },
			},
			{
				metric: "tool_part_count" as const,
				availability: { status: "available" as const, value: 3314 },
			},
		];
		// session_count matches, but the expected tool_part_count is not derived.
		const derivedFacts = [
			{
				metric: "session_count" as const,
				availability: { status: "available" as const, value: 46 },
			},
		];
		const reconciliation = reconcile(hostFacts, derivedFacts);
		expect(reconciliation.status).toBe("unavailable");
		expect(reconciliation.withinTolerance).not.toBe(true);
		expect(reconciliation.withinTolerance).toBeNull();
		const toolParts = reconciliation.metrics.find(
			(metric) => metric.metric === "tool_part_count",
		);
		expect(toolParts).toMatchObject({
			status: "unavailable",
			observed: null,
			withinTolerance: null,
		});
	});

	test("marks reconciliation mismatched when a derived fact is outside tolerance", () => {
		const hostFacts = [
			{
				metric: "session_count" as const,
				availability: { status: "available" as const, value: 46 },
			},
		];
		const derivedFacts = [
			{
				metric: "session_count" as const,
				availability: { status: "available" as const, value: 90 },
			},
		];
		const reconciliation = reconcile(hostFacts, derivedFacts);
		expect(reconciliation.status).toBe("mismatched");
		expect(reconciliation.withinTolerance).toBe(false);
	});

	test("preserves exact host aggregates and reconciles available facts within 1%", async () => {
		const report = await buildReplayReport({
			fixture: "long-running-v5",
			variant: "A",
			json: true,
		});
		expect(report.reconciliation.status).toBe("matched");
		const host = Object.fromEntries(
			report.factOrigins.hostFacts.map((fact) => [
				fact.metric,
				fact.availability.status === "available"
					? fact.availability.value
					: null,
			]),
		);
		expect(host).toMatchObject({
			session_count: 46,
			child_session_count: 45,
			tool_part_count: 3314,
			input_token_count: 6673027,
			cache_read_token_count: 98713088,
			compaction_count: 4,
			root_flow_tool_call_count: 92,
			root_flow_tool_result_character_count: 1007950,
			child_flow_status_call_count: 28,
			child_flow_status_result_character_count: 455038,
			reviewer_dispatch_count: 30,
			reviewer_child_session_count: 26,
			reviewer_execution_count: 7,
			prompt_character_count: 103813,
			result_character_count: 255269,
			tool_error_count: 17,
			message_error_count: 2,
			tool_latency_p50_ms: 9,
			tool_latency_p95_ms: 185,
			tool_latency_total_ms: 11661273,
			output_token_count: null,
		});
		expect(report.reconciliation.tolerancePercent).toBe(1);
		expect(report.reconciliation.withinTolerance).toBe(true);
		expect(
			report.reconciliation.metrics.every(
				(metric) =>
					metric.withinTolerance === null || metric.deltaPercent === 0,
			),
		).toBe(true);
		expect(report.reviewLifecycleBaseline).toMatchObject({
			baselineId: "qa_scribe_5_1_high",
			inferenceEffort: "high",
		});
		expect(report.reviewLifecycleBaseline.facts).toContainEqual({
			metric: "invalid_reviewer_payload_count",
			availability: { status: "available", value: 47 },
		});
		expect(report.reviewLifecycleBaseline.facts).toContainEqual({
			metric: "evidence_only_rerun_count",
			availability: { status: "unavailable", reason: "not_recorded" },
		});
		const formatted = formatReplayReport(report);
		expect(formatted).toContain("Flow 5.1 pre-v4 lifecycle baseline");
		expect(formatted).not.toContain("Session v4 lifecycle baseline");
	});

	test("keeps fact origins, zero, unavailability, and supplied observations distinct", async () => {
		const report = await buildReplayReport({
			fixture: "long-running-v5",
			variant: "A",
			json: false,
		});
		expect(report.factOrigins.flowLedgerClaims).toContainEqual({
			metric: "declared_worker_count",
			availability: { status: "available", value: 0 },
		});
		expect(report.factOrigins.hostFacts).toContainEqual({
			metric: "output_token_count",
			availability: {
				status: "unavailable",
				reason: "provider_unavailable",
			},
		});
		expect(report.factOrigins.suppliedObservations).toContainEqual({
			metric: "result_character_count",
			availability: { status: "available", value: 108102 },
		});
		expect(report.factOrigins.suppliedObservations).toContainEqual({
			metric: "reviewer_input_share_basis_points",
			availability: { status: "available", value: 7820 },
		});
		expect(report.factOrigins.replayDerivedFacts).toContainEqual({
			metric: "reviewer_execution_count",
			availability: { status: "available", value: 7 },
		});
		expect(report.factOrigins.replayDerivedFacts).toContainEqual({
			metric: "live_prompt_character_count",
			availability: { status: "available", value: 26947 },
		});
		expect(report.reviewWorkers).toEqual({
			declared: 0,
			observed: 7,
			observedSource: "host_metadata",
			reconciliationStatus: "unreconciled",
		});
		expect(formatReplayReport(report)).toContain("Unavailable");
		expect(formatReplayReport(report)).toContain(
			"7 observed reviewer executions",
		);
		expect(formatReplayReport(report)).toContain(
			"47 invalid reviewer payloads",
		);
	});

	test("emits concise human and structured JSON CLI output", () => {
		const human = runReport("--fixture", "long-running-v5", "--variant", "A");
		expect(human.exitCode).toBe(0);
		expect(human.stdout.toString()).toContain(
			"Replay long-running-v5 / variant A: supported",
		);
		expect(human.stdout.toString()).toContain("Scenarios: 9");

		const json = runReport("--variant", "A", "--json");
		expect(json.exitCode).toBe(0);
		const parsed = JSON.parse(json.stdout.toString()) as {
			status: string;
			replay: { scenarios: unknown[] };
		};
		expect(parsed.status).toBe("supported");
		expect(parsed.replay.scenarios).toHaveLength(9);
	});

	test("rejects traversal and unsafe fixture names before filesystem access", () => {
		for (const unsafe of ["../long-running-v5", "/tmp/corpus", "a/b", "a\\b"]) {
			expect(() => resolveReplayFixturePath(unsafe)).toThrow(
				"unsafe fixture name",
			);
		}
		expect(() =>
			parseReplayReportArgs(["--fixture", "../long-running-v5"]),
		).toThrow("unsafe fixture name");
		const result = runReport("--fixture", "../long-running-v5", "--json");
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("unsafe fixture name");
	});

	test("reports variants B through D as unsupported without invented outcomes", async () => {
		for (const variant of ["B", "C", "D"] as const) {
			const report = await buildReplayReport({
				fixture: "long-running-v5",
				variant,
				json: true,
			});
			expect(report.status).toBe("unsupported");
			expect(report.variantReason).toBe("not_implemented_in_phase_0");
			expect(report.replay.scenarios).toHaveLength(9);
			expect(
				report.replay.scenarios.every(
					(result) =>
						!result.supported &&
						result.decision === null &&
						result.reason === "unsupported_variant",
				),
			).toBe(true);
		}
	});

	test("contains no private canary strings, paths, or case identifiers", async () => {
		const fixtureText = await readFile(FIXTURE_PATH, "utf8");
		for (const forbidden of [
			"/Users/",
			"/home/",
			"sk-",
			"BEGIN PRIVATE KEY",
			"qa-scribe",
			"sourceSessionId",
			"transcript",
			"promptText",
			"toolOutput",
		]) {
			expect(fixtureText).not.toContain(forbidden);
		}
	});
});
