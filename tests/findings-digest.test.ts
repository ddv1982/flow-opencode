import { describe, expect, test } from "bun:test";
import { findingsDigest } from "../src/application/findings-digest.js";
import type {
	FeatureRun,
	PlanFeature,
	ReviewAssignment,
	ReviewFinding,
	Session,
	SourceDigest,
} from "../src/domain/session.js";

const SOURCE = `sha256:${"a".repeat(64)}` as SourceDigest;
const KERNEL = "runtime-kernel";
const FOLLOWUP = "runtime-followup";

function feature(id: string): PlanFeature {
	return {
		id,
		title: id,
		summary: id,
		targets: ["src"],
		validation: ["bun test"],
		dependsOn: [],
	};
}

function review(input: {
	featureId: string;
	runId: string;
	createdRevision: number;
	verdict: "passed" | "failed";
	findings: ReviewFinding[];
}): ReviewAssignment {
	return {
		id: `review-${input.runId}`,
		operationId: `review-start-${input.runId}`,
		featureId: input.featureId,
		runId: input.runId,
		kind: "feature",
		sourceDigest: SOURCE,
		validationIds: [],
		packet: { summary: "Review.", riskLenses: [] },
		createdRevision: input.createdRevision,
		result: {
			verdict: input.verdict,
			findings: input.findings,
			terminalDisposition: "submitted",
			recordedRevision: input.createdRevision + 1,
		},
	};
}

function run(input: {
	id: string;
	featureId: string;
	attempt: number;
	state: FeatureRun["state"];
	reviews: ReviewAssignment[];
}): FeatureRun {
	return {
		id: input.id,
		featureId: input.featureId,
		attempt: input.attempt,
		state: input.state,
		startedRevision: input.attempt,
		summary: input.state === "blocked" ? "Blocked." : "Done.",
		artifactsChanged: [],
		validations: [],
		reviews: input.reviews,
	};
}

function session(
	runs: FeatureRun[],
	extraFeatures: PlanFeature[] = [],
): Session {
	return {
		version: 5,
		id: "session-1",
		revision: 9,
		goal: "Ship the runtime",
		approval: "approved",
		plan: {
			summary: "Ship the runtime.",
			overview: "Exercise findings history.",
			requirements: ["Keep findings readable."],
			decisions: ["Derive the digest from runs."],
			features: [feature(KERNEL), ...extraFeatures],
		},
		runs,
		operations: [],
		closure: null,
	};
}

const BLOCKER_ID = `${KERNEL}.R4-01`;
const BLOCKER: ReviewFinding = {
	findingId: BLOCKER_ID,
	severity: "blocking",
	summary: "Shared contract is still incomplete.",
	evidence: "src/kernel.ts:1",
};

describe("findingsDigest", () => {
	test("keeps a blocker historical after a passing retry that omits it", () => {
		const digest = findingsDigest(
			session([
				run({
					id: "run-1",
					featureId: KERNEL,
					attempt: 1,
					state: "superseded",
					reviews: [
						review({
							featureId: KERNEL,
							runId: "run-1",
							createdRevision: 4,
							verdict: "failed",
							findings: [BLOCKER],
						}),
					],
				}),
				run({
					id: "run-2",
					featureId: KERNEL,
					attempt: 2,
					state: "completed",
					reviews: [
						review({
							featureId: KERNEL,
							runId: "run-2",
							createdRevision: 8,
							verdict: "passed",
							findings: [],
						}),
					],
				}),
			]),
		);

		expect(digest).toEqual([
			{
				featureId: KERNEL,
				findingId: BLOCKER_ID,
				severity: "blocking",
				summary: BLOCKER.summary,
				evidence: BLOCKER.evidence,
				attempt: 1,
				verdict: "failed",
				live: false,
			},
		]);
	});

	test("marks blockers live on a deferred close of a blocked run", () => {
		const digest = findingsDigest(
			session(
				[
					run({
						id: "run-1",
						featureId: KERNEL,
						attempt: 1,
						state: "blocked",
						reviews: [
							review({
								featureId: KERNEL,
								runId: "run-1",
								createdRevision: 4,
								verdict: "failed",
								findings: [BLOCKER],
							}),
						],
					}),
				],
				[feature(FOLLOWUP)],
			),
		);

		expect(digest).toEqual([
			{
				featureId: KERNEL,
				findingId: BLOCKER_ID,
				severity: "blocking",
				summary: BLOCKER.summary,
				evidence: BLOCKER.evidence,
				attempt: 1,
				verdict: "failed",
				live: true,
			},
		]);
	});

	test("omits an untouched feature and findings that never received an id", () => {
		const digest = findingsDigest(
			session(
				[
					run({
						id: "run-1",
						featureId: KERNEL,
						attempt: 1,
						state: "blocked",
						reviews: [
							review({
								featureId: KERNEL,
								runId: "run-1",
								createdRevision: 4,
								verdict: "failed",
								findings: [
									BLOCKER,
									{
										severity: "blocking",
										summary: "Unnumbered gap.",
										evidence: "src/kernel.ts:2",
									},
								],
							}),
						],
					}),
				],
				[feature(FOLLOWUP)],
			),
		);

		expect(digest.map((row) => row.findingId)).toEqual([BLOCKER_ID]);
		expect(digest.some((row) => row.featureId === FOLLOWUP)).toBe(false);
	});

	test("lets a later statement replace text while keeping first-seen order", () => {
		const siblingId = `${KERNEL}.R4-02`;
		const restated: ReviewFinding = {
			findingId: BLOCKER_ID,
			severity: "blocking",
			summary: "Shared contract still drops the retry path.",
			evidence: "src/kernel.ts:14",
		};
		const sibling: ReviewFinding = {
			findingId: siblingId,
			severity: "advisory",
			summary: "Naming is noisy.",
			evidence: "src/kernel.ts:3",
		};
		const digest = findingsDigest(
			session([
				run({
					id: "run-1",
					featureId: KERNEL,
					attempt: 1,
					state: "superseded",
					reviews: [
						review({
							featureId: KERNEL,
							runId: "run-1",
							createdRevision: 4,
							verdict: "failed",
							findings: [BLOCKER, sibling],
						}),
					],
				}),
				run({
					id: "run-2",
					featureId: KERNEL,
					attempt: 2,
					state: "blocked",
					reviews: [
						review({
							featureId: KERNEL,
							runId: "run-2",
							createdRevision: 8,
							verdict: "failed",
							findings: [restated, sibling],
						}),
					],
				}),
			]),
		);

		expect(digest.map((row) => row.findingId)).toEqual([BLOCKER_ID, siblingId]);
		expect(digest[0]).toMatchObject({
			summary: restated.summary,
			evidence: restated.evidence,
			attempt: 2,
			verdict: "failed",
			live: true,
		});
	});
});
