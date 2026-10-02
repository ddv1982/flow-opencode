import { describe, expect, test } from "bun:test";
import {
	persistObservedValidation,
	prepareValidation,
} from "../src/application/prepare-validation.js";
import {
	type CompactProjection,
	idleProjection,
	project,
	statusReport,
} from "../src/application/session-projection.js";
import {
	approveSession,
	deterministicEnvironment,
	expectOk,
	FEATURE,
	MemorySessionRepository,
	OUTPUT,
	plan,
	recordObservedValidation,
	revision,
	startFeatureRun,
	submitReview,
} from "./runtime-test-support.js";

function compact(
	nextAction: CompactProjection["nextAction"],
	status: CompactProjection["status"] = "running",
): CompactProjection {
	return {
		view: "compact",
		sessionId: "session-status-report",
		revision: 7,
		goal: "Exercise deterministic status",
		status,
		approval: "approved",
		activeFeatureId: status === "running" ? "feature-one" : null,
		activeRunId: status === "running" ? "run-one" : null,
		blockedFeature:
			status === "blocked"
				? {
						featureId: "feature-one",
						attempt: 2,
						failedReviewCount: 2,
						scopeBlocker: false,
					}
				: null,
		progress: { completed: 0, total: 1, remaining: 1 },
		nextAction,
		archiveRetry: null,
		findingsDigest: [],
		amendments: [],
	};
}

describe("deterministic Flow status report", () => {
	for (const status of ["running", "ready", "blocked"] as const) {
		test(`${status} checkpoint offers closure choices without granting a retry`, () => {
			const report = statusReport(compact("await-user-direction", status));
			expect(report).toContain(
				"Next step: Choose defer or abandon; an exact retry needs aligned user direction or an authorized host recovery request.",
			);
		});
	}

	for (const observation of [
		{ command: "bun test", scope: "broad", exitCode: 1 },
		{ command: "bun test src/other.test.ts", scope: "focused", exitCode: 1 },
		{ command: "bun test", scope: "broad", exitCode: null },
		null,
	] as const) {
		test(`blocked detail reports only declared failed gate facts: ${observation?.command} exit ${observation?.exitCode}`, async () => {
			const repository = new MemorySessionRepository();
			const flow = await approveSession(repository, deterministicEnvironment());
			await startFeatureRun(flow, repository, FEATURE, "checkpoint");
			if (observation !== null) {
				const prepared = await prepareValidation(
					repository,
					{
						expectedRevision: revision(repository),
						featureId: FEATURE,
						command: observation.command,
						scope: observation.scope,
					},
					"linux",
				);
				await persistObservedValidation(repository, {
					...prepared,
					captureId: "failed-before-review",
					exitCode: observation.exitCode,
					outputDigest: OUTPUT,
					outputComplete: true,
					...(observation.exitCode === null
						? { ineligibleReason: "exit-code-unavailable" as const }
						: {}),
				});
			}
			await recordObservedValidation(repository, {
				captureId: "accepted-before-review",
			});
			expectOk(
				await flow.reviewStart({
					request: {
						operationId: "checkpoint-review",
						expectedRevision: revision(repository),
						featureId: FEATURE,
						artifactsChanged: [],
						packet: {
							summary: "Review required gate coverage.",
							riskLenses: [],
						},
					},
				}),
			);
			await submitReview(flow, repository, {
				suffix: "checkpoint",
				summary: "Required coverage needs new scope authority.",
				verdict: "failed",
				findings: [
					{
						severity: "blocking",
						summary: "Gate excluded an existing acceptance case.",
						evidence:
							"The review packet lacks proof that all pre-existing acceptance cases remain covered.",
						scopeBlocker: true,
					},
				],
			});
			const document = repository.session;
			if (!document) throw new Error("Missing checkpoint document");
			const projection = project(document, { view: "detail" });
			expect(projection).toMatchObject({
				status: "blocked",
				nextAction: "await-user-direction",
			});
			const facts = statusReport(projection).filter((line) =>
				/^(?:Environment|Command):/.test(line),
			);
			expect(facts).toEqual(
				observation?.command === "bun test" && observation.exitCode === 1
					? ["Environment: this host", "Command: bun test"]
					: [],
			);
			if (observation?.command === "bun test" && observation.exitCode === 1)
				expect(
					statusReport(projection).find((line) =>
						line.startsWith("Historical failed gate observation:"),
					),
				).toEndWith("not a current gate verdict.");
			expect(statusReport(projection)).toContain(
				"Next step: Choose defer or abandon; an exact retry needs aligned user direction or an authorized host recovery request.",
			);
		});
	}

	test("observed inspection gate failure is not a required-pass checkpoint fact", async () => {
		const repository = new MemorySessionRepository();
		const flow = await approveSession(repository, deterministicEnvironment(), {
			plan: {
				...plan,
				features: plan.features.map((feature) => ({
					...feature,
					kind: "inspect",
				})),
				evidence: [
					{
						scope: "gate-observe",
						command: "bun test",
						environment: "Linux",
						requirement: "Observe suite",
						platform: "linux",
						assertions: [],
					},
					{
						scope: "extra",
						command: "node windows-proof.js",
						environment: "Windows",
						requirement: "Native proof",
						platform: "win32",
						assertions: [],
					},
				],
			},
		});
		await startFeatureRun(flow, repository, FEATURE, "observed-checkpoint");
		await recordObservedValidation(repository, {
			captureId: "observed-audit-failure",
			exitCode: 1,
		});
		const document = repository.session;
		if (!document) throw new Error("Missing observed checkpoint");
		const projection = project(document, { view: "detail" });
		expect(projection).toMatchObject({
			status: "running",
			nextAction: "await-user-direction",
		});
		expect(
			statusReport(projection).filter((line) =>
				/^(?:Environment|Command|Historical failed gate observation):/.test(
					line,
				),
			),
		).toEqual([]);
	});

	test("reports the idle action and exact guidance", () => {
		expect(statusReport(idleProjection("compact"))).toContain(
			"Action guidance: inspect the repository and save one draft plan with flow_plan_save.",
		);
	});

	for (const example of [
		["flow_plan_approve", "approve it only"],
		["flow_feature_reset", "reset the source-stale active feature"],
		["flow_status", "refresh Flow status"],
		["dispatch-flow-reviewer", "existing pending assignment"],
		["flow_validation_start", "exact next validation command"],
		["flow_review_start", "independent review assignment"],
	] as const) {
		test(`owns recovery text for ${example[0]}`, () => {
			const report = statusReport(compact(example[0]));
			expect(report).toContain(`Next action: ${example[0]}`);
			expect(report.some((line) => line.includes(example[1]))).toBe(true);
		});
	}

	test("owns ready feature-start guidance", () => {
		const report = statusReport(compact("flow_run_start", "ready"));
		expect(report).toContain("Next action: flow_run_start");
		expect(
			report.some((line) => line.includes("dependency-ready feature")),
		).toBe(true);
	});

	test("distinguishes blocked and ready user direction", () => {
		const blocked = statusReport(compact("await-user-direction", "blocked"));
		const ready = statusReport(compact("await-user-direction", "ready"));

		expect(blocked.some((line) => line.includes("nextFeatureId"))).toBe(true);
		expect(ready.some((line) => line.includes("flow_run_start"))).toBe(true);
	});

	test("reports completed closure without granting external action", () => {
		const report = statusReport(compact("flow_session_close", "completed"));
		expect(report).toContain("Next action: flow_session_close");
		expect(
			report.some((line) => line.includes("close the completed session")),
		).toBe(true);
	});
});
