import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveReleaseDecision } from "../evals/analysis.js";
import { deriveEnvironmentReserveState } from "../evals/environment-reserves.js";
import {
	deriveRetainedFailure,
	RetainedScenarioEvidenceSchema,
} from "../evals/grader-input.js";
import { releaseCatalog } from "../evals/release-policy.js";
import { EvalReportV2Schema, parseReport } from "../evals/report.js";

const readJson = async (path: string) =>
	JSON.parse(await readFile(path, "utf8"));
function required<T>(value: T | null | undefined): T {
	if (value === undefined || value === null)
		throw new Error("Expected retained fixture evidence is missing.");
	return value;
}

async function runFixture(
	root: string,
	mode: "handoff" | "reserve",
	signal: "SIGINT" | "SIGTERM",
) {
	const child = spawn(
		process.execPath,
		[
			join(import.meta.dir, "fixtures", "eval-reserve-cancellation-child.ts"),
			root,
			mode,
		],
		{
			cwd: root,
			// Never forward provider credentials, reviewer overrides or global auth.
			env: {
				PATH: process.env.PATH,
				HOME: root,
				XDG_CONFIG_HOME: join(root, "config"),
				XDG_DATA_HOME: join(root, "data"),
				XDG_CACHE_HOME: join(root, "cache"),
				FLOW_EVAL_NO_AUTH_COPY: "1",
			},
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	const events: string[] = [];
	let stdout = "";
	let stderr = "";
	let pending = "";
	let expired = false;
	const second = signal === "SIGINT" ? "SIGTERM" : "SIGINT";
	// Only handshakes deliver signals; this timer detects hangs, not readiness.
	const timeout = setTimeout(() => {
		expired = true;
		child.kill("SIGKILL");
	}, 20_000);
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (data: string) => {
		stderr += data;
	});
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (data: string) => {
		stdout += data;
		pending += data;
		let newline = pending.indexOf("\n");
		while (newline !== -1) {
			const line = pending.slice(0, newline);
			pending = pending.slice(newline + 1);
			if (line.startsWith("@@eval-reserve:")) {
				const name = line.slice("@@eval-reserve:".length);
				events.push(name);
				if (name === "ready") child.kill(signal);
				if (name === "cleanup-wait") child.kill(second);
				if (name === `signal:${second}`) child.stdin.end("release\n");
			}
			newline = pending.indexOf("\n");
		}
	});
	try {
		const status = await new Promise<{
			code: number | null;
			signal: NodeJS.Signals | null;
		}>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, exitSignal) =>
				resolve({ code, signal: exitSignal }),
			);
		});
		if (expired) throw new Error(`Reserve fixture hung.\n${stdout}\n${stderr}`);
		return { ...status, events, stderr };
	} finally {
		clearTimeout(timeout);
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	}
}

// The canonical host is exercised unchanged on Linux; Darwin only bypasses its
// platform assertion inside the isolated fake-host child. POSIX signals only.
const signalTest = ["linux", "darwin"].includes(process.platform)
	? test
	: test.skip;
describe("graceful-eval-stop.R10-05: real release runner reserve cancellation", () => {
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		for (const mode of ["handoff", "reserve"] as const) {
			const label =
				mode === "handoff"
					? "durable final-primary cleanup prevents reserve handoff"
					: "second reserve preserves first and skips third";
			signalTest(
				`${signal}: ${label}`,
				async () => {
					const root = await mkdtemp(join(tmpdir(), "flow-eval-reserve-stop-"));
					try {
						const result = await runFixture(root, mode, signal);
						expect(result.stderr).toBe("");
						expect(result.code).toBe(signal === "SIGINT" ? 130 : 143);
						expect(result.signal).toBeNull();
						expect(result.events).not.toContain("unexpected-network");
						expect(result.events).toContain("returned");
						const retained = mode === "handoff" ? 76 : 77;
						const started = mode === "handoff" ? 76 : 78;
						expect(result.events).toContain(`durable:${retained}`);
						expect(
							result.events.filter((event) => event.startsWith("signal:")),
						).toEqual([
							`signal:${signal}`,
							`signal:${signal === "SIGINT" ? "SIGTERM" : "SIGINT"}`,
						]);
						for (const phase of ["start", "stop", "cleaned"])
							expect(
								result.events.filter((event) => event.startsWith(`${phase}:`)),
							).toEqual(
								Array.from(
									{ length: started + 1 },
									(_, index) => `${phase}:${index}`,
								),
							);
						expect(
							result.events.filter((event) => event.startsWith("outcome:")),
						).toEqual(
							Array.from(
								{ length: retained },
								(_, index) => `outcome:${index + 1}`,
							),
						);
						const results = join(root, "evals", "results");
						const names = await readdir(results);
						const reports = names.filter((name) => name.endsWith(".v2"));
						expect(reports).toHaveLength(1);
						const directory = join(results, required(reports[0]));
						expect(await readJson(join(directory, "catalog.json"))).toEqual(
							releaseCatalog(),
						);
						const parsed = parseReport(
							await readJson(join(directory, "report.json")),
							releaseCatalog(),
						);
						if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
						const report = parsed.value;
						const primary = report.plan.cells.filter(
							(cell) => cell.schedule === "primary",
						);
						const reserves = report.plan.cells.filter(
							(cell) => cell.schedule === "environment-reserve",
						);
						expect(primary).toHaveLength(76);
						expect(reserves).toHaveLength(16);
						expect(report.attempts.map((attempt) => attempt.cellId)).toEqual([
							...primary.map((cell) => cell.cellId),
							...(mode === "reserve" ? [required(reserves[0]).cellId] : []),
						]);
						expect(report.completion).toMatchObject({
							status: "stopped",
							cause: "operator",
							observed: { attempts: retained, outputTokens: 0, costUsd: 0 },
						});
						const mutable = EvalReportV2Schema.parse(report);
						const state = deriveEnvironmentReserveState(
							mutable.plan,
							mutable.attempts,
						);
						expect(state).toMatchObject({
							activatedReserveCellIds: reserves
								.slice(0, 3)
								.map((cell) => cell.cellId),
							nextReserveCellIds: reserves
								.slice(mode === "handoff" ? 0 : 1, 3)
								.map((cell) => cell.cellId),
							targetsSatisfied: false,
							fatal: false,
							exhaustedStrata: [],
						});
						expect(report.completion.activatedReserveCellIds).toEqual(
							state.activatedReserveCellIds,
						);
						for (const folder of ["attempts", "transcripts"])
							expect(await readdir(join(directory, folder))).toHaveLength(
								retained,
							);
						const gaps = report.attempts.filter(
							(attempt) => attempt.outcome.kind === "failure",
						);
						expect(gaps.map((attempt) => attempt.cellId)).toEqual(
							[0, 3, 6].map((index) => required(primary[index]).cellId),
						);
						for (const attempt of report.attempts) {
							const evidence = RetainedScenarioEvidenceSchema.parse(
								await readJson(
									join(directory, required(attempt.transcript).artifact),
								),
							);
							if (attempt.outcome.kind === "failure") {
								expect(attempt.outcome).toEqual({
									kind: "failure",
									origin: "provider",
									code: "provider-rejected-turn",
									retryable: true,
								});
								expect(deriveRetainedFailure(evidence)).toEqual(
									evidence.failure,
								);
								expect(evidence.failureObservation?.kind).toBe(
									"provider-error",
								);
							} else {
								expect(evidence.failure).toBeNull();
								expect(attempt.outcome).toMatchObject({
									kind: "product",
									passed: true,
									issues: [],
								});
							}
						}
						const legacyFiles = names.filter((name) => name.endsWith(".json"));
						expect(legacyFiles).toHaveLength(1);
						const legacy = await readJson(
							join(results, required(legacyFiles[0])),
						);
						expect(legacy.summary).toMatchObject({
							total: retained,
							scored: retained - 3,
							passed: retained - 3,
							environmentBlocked: 3,
							aborted: 0,
						});
						expect(legacy.results).toHaveLength(retained);
						const first = required(report.attempts[0]);
						if ("kind" in first.artifact)
							throw new Error("Expected packed artifact identity.");
						const decision = deriveReleaseDecision({
							report,
							catalog: releaseCatalog(),
							expected: {
								kind: "release",
								artifact: first.artifact,
								evaluator: first.evaluator,
								attempts: report.attempts.map((attempt) => ({
									cellId: attempt.cellId,
									hostConfigSha256: attempt.hostConfigSha256,
									instructions: attempt.instructions,
									actors: attempt.actors.map((actor) => ({
										role: actor.role,
										requestedModel: actor.requestedModel,
										actualModel: {
											kind: "allow-unobserved" as const,
											value: actor.requestedModel,
											reason: "Explicitly fake host; cancellation test only.",
										},
									})),
								})),
							},
							promotionArtifact: first.artifact,
						});
						expect(decision.verdict).not.toBe("VERIFIED");
						expect(
							decision.reasons.some(
								(reason) => reason.code === "campaign-stopped",
							),
						).toBe(true);
					} finally {
						await rm(root, { recursive: true, force: true });
					}
				},
				25_000,
			);
		}
	}
});
