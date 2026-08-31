import { describe, expect, test } from "bun:test";
import {
	type CompactProjection,
	idleProjection,
	statusReport,
} from "../src/application/session-projection.js";

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
	};
}

describe("deterministic Flow status report", () => {
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
