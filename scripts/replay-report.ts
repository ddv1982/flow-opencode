import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
	parseReplayFixture,
	type ReplayFixture,
	type ReplayFixtureResult,
	type ReplayScenarioResult,
	type ReplayVariant,
	type ReviewLifecycleAggregateMetric,
	type ReviewLifecycleBaseline,
	ReviewLifecycleBaselineSchema,
	replayFixture,
	type TerminalComparisonStatus,
} from "../src/application/replay/index.js";
import { parseStrictJsonObject } from "../src/infrastructure/fs/strict-json-object.js";

const FIXTURE_ROOT = resolve(import.meta.dir, "../tests/fixtures/replay");
const REVIEW_LIFECYCLE_BASELINE_PATH = resolve(
	import.meta.dir,
	"../tests/fixtures/review-lifecycle/qa-scribe-5-1-high.json",
);
const SAFE_FIXTURE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const VARIANTS = ["A", "B", "C", "D"] as const;
const RECONCILIATION_TOLERANCE_PERCENT = 1;

type AggregateFact = ReplayFixture["hostFacts"][number];

export type ReplayReportOptions = {
	fixture: string;
	variant: ReplayVariant;
	json: boolean;
};

type ReconciliationStatus = "matched" | "mismatched" | "unavailable";

type Reconciliation = {
	metric: AggregateFact["metric"];
	expected: number;
	observed: number | null;
	delta: number | null;
	deltaPercent: number | null;
	status: ReconciliationStatus;
	withinTolerance: boolean | null;
};

type AggregateReconciliationStatus =
	| "matched"
	| "mismatched"
	| "unavailable"
	| "empty";

type ExpectationStatus = "matched" | "mismatched" | "unavailable" | "empty";

type TerminalExpectationSummary = {
	scenarios: number;
	status: ExpectationStatus;
	scenariosMatched: number;
	scenariosMismatched: number;
	scenariosUnavailable: number;
	fieldStatus: {
		decision: TerminalComparisonStatus;
		reason: TerminalComparisonStatus;
		revision: TerminalComparisonStatus;
		stateDigest: TerminalComparisonStatus;
	};
};

export type ReplayReport = {
	fixture: string;
	variant: ReplayVariant;
	status: "supported" | "unsupported";
	variantReason: "control" | "not_implemented_in_phase_0";
	factOrigins: {
		hostFacts: ReplayFixture["hostFacts"];
		flowLedgerClaims: ReplayFixture["flowLedgerClaims"];
		suppliedObservations: ReplayFixture["suppliedObservations"];
		replayDerivedFacts: ReplayFixture["replayDerivedFacts"];
	};
	reviewLifecycleBaseline: ReviewLifecycleBaseline;
	replay: ReplayFixtureResult;
	// Oracle reconciliation is reported separately from variant support: a
	// `supported` variant never implies its terminal expectations matched.
	terminalExpectations: TerminalExpectationSummary;
	reviewWorkers: {
		declared: number | null;
		observed: number | null;
		observedSource: "host_metadata";
		reconciliationStatus: "unreconciled";
	};
	reconciliation: {
		tolerancePercent: number;
		metrics: Reconciliation[];
		status: AggregateReconciliationStatus;
		withinTolerance: boolean | null;
	};
};

function fail(message: string): never {
	throw new Error(message);
}

function factValue(fact: AggregateFact | undefined): number | null {
	return fact?.availability.status === "available"
		? fact.availability.value
		: null;
}

function findFact(
	facts: readonly AggregateFact[],
	metric: AggregateFact["metric"],
): AggregateFact | undefined {
	return facts.find((fact) => fact.metric === metric);
}

export function reconcile(
	hostFacts: readonly AggregateFact[],
	derivedFacts: readonly AggregateFact[],
): ReplayReport["reconciliation"] {
	const metrics: Reconciliation[] = [];
	for (const hostFact of hostFacts) {
		const expected = factValue(hostFact);
		if (expected === null) continue;
		const observed = factValue(findFact(derivedFacts, hostFact.metric));
		if (observed === null) {
			// An expected host-backed metric that replay did not derive stays
			// unavailable. It is never discarded and reported as reconciled.
			metrics.push({
				metric: hostFact.metric,
				expected,
				observed: null,
				delta: null,
				deltaPercent: null,
				status: "unavailable",
				withinTolerance: null,
			});
			continue;
		}
		const delta = observed - expected;
		const deltaPercent =
			expected === 0
				? delta === 0
					? 0
					: Number.POSITIVE_INFINITY
				: (Math.abs(delta) / expected) * 100;
		const withinTolerance = deltaPercent <= RECONCILIATION_TOLERANCE_PERCENT;
		metrics.push({
			metric: hostFact.metric,
			expected,
			observed,
			delta,
			deltaPercent,
			status: withinTolerance ? "matched" : "mismatched",
			withinTolerance,
		});
	}
	const status = aggregateReconciliationStatus(metrics);
	return {
		tolerancePercent: RECONCILIATION_TOLERANCE_PERCENT,
		metrics,
		status,
		// `true` only when every expected metric matched within tolerance; an
		// absent or mismatched expected metric can never read as within tolerance.
		withinTolerance:
			status === "matched" ? true : status === "mismatched" ? false : null,
	};
}

function rollupExpectationField(
	statuses: readonly TerminalComparisonStatus[],
): TerminalComparisonStatus {
	if (statuses.some((status) => status === "mismatched")) return "mismatched";
	if (statuses.some((status) => status === "unavailable")) return "unavailable";
	return "matched";
}

/**
 * Aggregates per-scenario terminal expectation comparisons so a mismatched or
 * unavailable expected fact can never render as a fully matched (green) oracle.
 */
export function aggregateTerminalExpectations(
	scenarios: readonly ReplayScenarioResult[],
): TerminalExpectationSummary {
	let scenariosMatched = 0;
	let scenariosMismatched = 0;
	let scenariosUnavailable = 0;
	for (const scenario of scenarios) {
		const status = scenario.terminalComparison.status;
		if (status === "matched") scenariosMatched += 1;
		else if (status === "mismatched") scenariosMismatched += 1;
		else scenariosUnavailable += 1;
	}
	const fieldStatus = {
		decision: rollupExpectationField(
			scenarios.map((s) => s.terminalComparison.decision),
		),
		reason: rollupExpectationField(
			scenarios.map((s) => s.terminalComparison.reason),
		),
		revision: rollupExpectationField(
			scenarios.map((s) => s.terminalComparison.revision),
		),
		stateDigest: rollupExpectationField(
			scenarios.map((s) => s.terminalComparison.stateDigest),
		),
	};
	const status: ExpectationStatus =
		scenarios.length === 0
			? "empty"
			: scenariosMismatched > 0
				? "mismatched"
				: scenariosUnavailable > 0
					? "unavailable"
					: "matched";
	return {
		scenarios: scenarios.length,
		status,
		scenariosMatched,
		scenariosMismatched,
		scenariosUnavailable,
		fieldStatus,
	};
}

function aggregateReconciliationStatus(
	metrics: readonly Reconciliation[],
): AggregateReconciliationStatus {
	if (metrics.length === 0) return "empty";
	if (metrics.some((metric) => metric.status === "mismatched")) {
		return "mismatched";
	}
	if (metrics.some((metric) => metric.status === "unavailable")) {
		return "unavailable";
	}
	return "matched";
}

export function parseReplayReportArgs(
	args: readonly string[],
): ReplayReportOptions {
	let fixture = "long-running-v5";
	let variant: ReplayVariant = "A";
	let json = false;
	const seen = new Set<string>();
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--json") {
			if (seen.has(argument)) fail("--json may not be repeated");
			seen.add(argument);
			json = true;
			continue;
		}
		if (argument === "--fixture" || argument === "--variant") {
			if (seen.has(argument)) fail(`${argument} may not be repeated`);
			seen.add(argument);
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				fail(`${argument} requires a value`);
			}
			index += 1;
			if (argument === "--fixture") fixture = value;
			else if (VARIANTS.includes(value as ReplayVariant)) {
				variant = value as ReplayVariant;
			} else fail("variant must be one of A, B, C, or D");
			continue;
		}
		fail(`unknown argument: ${argument ?? ""}`);
	}
	if (!SAFE_FIXTURE_NAME.test(fixture)) fail("unsafe fixture name");
	return { fixture, variant, json };
}

export function resolveReplayFixturePath(fixture: string): string {
	if (!SAFE_FIXTURE_NAME.test(fixture)) fail("unsafe fixture name");
	const directory = resolve(FIXTURE_ROOT, fixture);
	if (!directory.startsWith(`${FIXTURE_ROOT}${sep}`)) {
		fail("unsafe fixture path");
	}
	return resolve(directory, "fixture.json");
}

export function parseReplayFixtureText(raw: string): ReplayFixture {
	const parsed = parseStrictJsonObject(raw, "replay fixture");
	if (!parsed.ok) fail(parsed.error);
	return parseReplayFixture(parsed.value);
}

export async function buildReplayReport(
	options: ReplayReportOptions,
): Promise<ReplayReport> {
	const fixturePath = resolveReplayFixturePath(options.fixture);
	const fixture = parseReplayFixtureText(await readFile(fixturePath, "utf8"));
	const lifecycleBaselineRaw = parseStrictJsonObject(
		await readFile(REVIEW_LIFECYCLE_BASELINE_PATH, "utf8"),
		"review lifecycle baseline",
	);
	if (!lifecycleBaselineRaw.ok) fail(lifecycleBaselineRaw.error);
	const reviewLifecycleBaseline = ReviewLifecycleBaselineSchema.parse(
		lifecycleBaselineRaw.value,
	);
	const replay = replayFixture(fixture, options.variant);
	return {
		fixture: options.fixture,
		variant: options.variant,
		status: replay.supported ? "supported" : "unsupported",
		variantReason: replay.supported ? "control" : "not_implemented_in_phase_0",
		factOrigins: {
			hostFacts: fixture.hostFacts,
			flowLedgerClaims: fixture.flowLedgerClaims,
			suppliedObservations: fixture.suppliedObservations,
			replayDerivedFacts: fixture.replayDerivedFacts,
		},
		reviewLifecycleBaseline,
		replay,
		terminalExpectations: aggregateTerminalExpectations(replay.scenarios),
		reviewWorkers: {
			declared: factValue(
				findFact(fixture.flowLedgerClaims, "declared_worker_count"),
			),
			observed: factValue(
				findFact(fixture.hostFacts, "reviewer_execution_count"),
			),
			observedSource: "host_metadata",
			reconciliationStatus: "unreconciled",
		},
		reconciliation: reconcile(fixture.hostFacts, fixture.replayDerivedFacts),
	};
}

function renderFact(
	facts: readonly AggregateFact[],
	metric: AggregateFact["metric"],
): string {
	const fact = findFact(facts, metric);
	if (!fact || fact.availability.status === "unavailable") return "unavailable";
	return String(fact.availability.value);
}

function renderBasisPoints(
	facts: readonly AggregateFact[],
	metric: AggregateFact["metric"],
): string {
	const value = factValue(findFact(facts, metric));
	return value === null ? "unavailable" : `${value / 100}%`;
}

function renderLifecycleCounter(
	baseline: ReviewLifecycleBaseline,
	metric: ReviewLifecycleAggregateMetric,
): string {
	return renderFact(baseline.facts, metric);
}

export function formatReplayReport(report: ReplayReport): string {
	const host = report.factOrigins.hostFacts;
	const ledger = report.factOrigins.flowLedgerClaims;
	const supplied = report.factOrigins.suppliedObservations;
	const unavailable = host
		.filter((fact) => fact.availability.status === "unavailable")
		.map((fact) => fact.metric);
	const reconciliation =
		report.reconciliation.withinTolerance === null
			? "unavailable"
			: report.reconciliation.withinTolerance
				? "within tolerance"
				: "outside tolerance";
	return `${[
		`Replay ${report.fixture} / variant ${report.variant}: ${report.status}`,
		`Scenarios: ${report.replay.scenarios.length}`,
		`Host facts: ${renderFact(host, "session_count")} sessions; ${renderFact(host, "child_session_count")} children; ${renderFact(host, "tool_part_count")} tool parts; ${renderFact(host, "input_token_count")} input tokens; ${renderFact(host, "cache_read_token_count")} cache-read tokens; ${renderFact(host, "compaction_count")} compactions; ${renderFact(host, "reviewer_execution_count")} observed reviewer executions`,
		`Flow ledger: ${renderFact(ledger, "declared_worker_count")} declared workers`,
		`Supplied/unreconciled: ${renderFact(supplied, "result_character_count")} four-invocation characters; ${renderBasisPoints(supplied, "reviewer_input_share_basis_points")} reviewer input share`,
		`Replay-derived: ${report.replay.scenarios.filter((scenario) => scenario.supported).length} supported terminal decisions`,
		`Flow 5.1 pre-v4 lifecycle baseline (${report.reviewLifecycleBaseline.baselineId}; ${report.reviewLifecycleBaseline.inferenceEffort} inference): ${renderLifecycleCounter(report.reviewLifecycleBaseline, "review_assignment_attempt_count")} assignment attempts; ${renderLifecycleCounter(report.reviewLifecycleBaseline, "invalid_reviewer_payload_count")} invalid reviewer payloads; ${renderLifecycleCounter(report.reviewLifecycleBaseline, "completion_submission_count")} completion submissions; ${renderLifecycleCounter(report.reviewLifecycleBaseline, "accepted_blocker_count")} accepted blockers; ${renderLifecycleCounter(report.reviewLifecycleBaseline, "schema_rejection_count")} schema rejections; ${renderLifecycleCounter(report.reviewLifecycleBaseline, "evidence_only_rerun_count")} evidence-only reruns; ${renderLifecycleCounter(report.reviewLifecycleBaseline, "feature_reset_count")} feature resets; ${renderLifecycleCounter(report.reviewLifecycleBaseline, "abandoned_session_count")} abandoned sessions`,
		`Terminal expectations: ${report.terminalExpectations.status} (decision ${report.terminalExpectations.fieldStatus.decision}; reason ${report.terminalExpectations.fieldStatus.reason}; revision ${report.terminalExpectations.fieldStatus.revision}; digest ${report.terminalExpectations.fieldStatus.stateDigest}; ${report.terminalExpectations.scenariosMatched} matched / ${report.terminalExpectations.scenariosMismatched} mismatched / ${report.terminalExpectations.scenariosUnavailable} unavailable)`,
		`Review worker reconciliation: ${report.reviewWorkers.reconciliationStatus} (${report.reviewWorkers.declared ?? "unavailable"} declared; ${report.reviewWorkers.observed ?? "unavailable"} observed)`,
		`Reconciliation (${report.reconciliation.tolerancePercent}%): ${reconciliation}`,
		`Unavailable: ${unavailable.length > 0 ? unavailable.join(", ") : "none"}`,
	].join("\n")}\n`;
}

async function main(): Promise<void> {
	const options = parseReplayReportArgs(process.argv.slice(2));
	const report = await buildReplayReport(options);
	process.stdout.write(
		options.json
			? `${JSON.stringify(report, null, 2)}\n`
			: formatReplayReport(report),
	);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		const message =
			error instanceof Error ? error.message : "replay report failed";
		process.stderr.write(`replay-report: ${message}\n`);
		process.exitCode = 1;
	});
}
