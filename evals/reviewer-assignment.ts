import type { ReviewFinding, Session } from "../src/domain/session.js";
import { observeAssertions } from "../src/domain/test-results.js";
import { normalizeEvidencePlatform } from "../src/domain/validation.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import {
	flowPlanApprove,
	flowPlanSave,
	flowReviewStart,
	flowRunStart,
} from "../src/infrastructure/fs/workspace-flow-service.js";
import {
	persistWorkspaceValidation,
	prepareWorkspaceValidation,
	readWorkspaceTestReport,
} from "../src/infrastructure/fs/workspace-validation.js";
import { canonicalSha256 } from "./canonical-json.js";
import {
	assertReviewerCaseTruth,
	type ReviewerCase,
} from "./reviewer-cases.js";

const FEATURE_ID = "review-target";
const RESULTS_PATH = ".flow/reviewer-results.xml";
const VALIDATION_COMMAND = `bun test --reporter=junit --reporter-outfile=${RESULTS_PATH}`;

export type SeededReviewerAssignment = {
	readonly flowSessionId: string;
	readonly featureId: string;
	readonly runId: string;
	readonly assignmentId: string;
};

export type DurableReviewerSubmission =
	| { readonly kind: "unsubmitted" }
	| {
			readonly kind: "submitted";
			readonly verdict: "passed" | "failed";
			readonly findings: readonly ReviewFinding[];
	  };

function requireFlowSuccess(response: {
	readonly status: "ok" | "error";
	readonly summary: string;
}): void {
	if (response.status === "error") throw new Error(response.summary);
}

async function currentSession(workspace: string): Promise<Session> {
	const session = await createFileSessionRepository(workspace).read();
	if (!session) throw new Error("Reviewer assignment setup lost Flow state.");
	return session;
}

async function verifySeedValidation(workspace: string): Promise<{
	readonly outputDigest: `sha256:${string}`;
	readonly report: string;
}> {
	const process = Bun.spawn(
		["bun", "test", "--reporter=junit", `--reporter-outfile=${RESULTS_PATH}`],
		{
			cwd: workspace,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`Reviewer seed validation failed: ${stderr || stdout}`);
	}
	const report = await readWorkspaceTestReport(workspace, RESULTS_PATH);
	if (!report)
		throw new Error("Reviewer seed validation wrote no JUnit report.");
	return {
		outputDigest: canonicalSha256("flow-reviewer-seed-validation-v1", {
			command: VALIDATION_COMMAND,
			exitCode,
			stdout,
			stderr,
			report: report.text,
		}),
		report: report.text,
	};
}

/** Creates a real pending Flow assignment without involving a manager model. */
export async function seedReviewerAssignment(input: {
	readonly workspace: string;
	readonly fixture: ReviewerCase;
}): Promise<SeededReviewerAssignment> {
	assertReviewerCaseTruth(input.fixture);
	const operationSuffix = `${input.fixture.caseId}-v${input.fixture.caseVersion}`;
	requireFlowSuccess(
		await flowPlanSave(input.workspace, {
			request: {
				operationId: `reviewer-plan-save-${operationSuffix}`,
				expectedRevision: 0,
				goal: "Verify the current value implementation.",
				plan: {
					summary: "Verify the value implementation.",
					overview:
						"Inspect the implementation independently before completion.",
					requirements: [
						"For every safe-integer input below Number.MAX_SAFE_INTEGER, value returns input plus one.",
					],
					decisions: [
						"Use the exported value function as the public boundary.",
					],
					evidence: [
						{
							scope: "gate",
							requirement: "Behavioral correctness",
							environment: "isolated evaluator workspace",
							command: VALIDATION_COMMAND,
							platform: normalizeEvidencePlatform(process.platform),
							assertions: ["value returns the next safe integer"],
						},
					],
					features: [
						{
							id: FEATURE_ID,
							kind: "inspect",
							title: "Review the value implementation",
							summary:
								"Verify the value function against the approved requirement.",
							targets: Object.keys(input.fixture.files).sort(),
							validation: [VALIDATION_COMMAND],
							dependsOn: [],
						},
					],
				},
			},
		}),
	);
	requireFlowSuccess(
		await flowPlanApprove(input.workspace, {
			request: {
				operationId: `reviewer-plan-approve-${operationSuffix}`,
				expectedRevision: (await currentSession(input.workspace)).revision,
			},
		}),
	);
	requireFlowSuccess(
		await flowRunStart(input.workspace, {
			request: {
				operationId: `reviewer-run-start-${operationSuffix}`,
				expectedRevision: (await currentSession(input.workspace)).revision,
				featureId: FEATURE_ID,
			},
		}),
	);
	const prepared = await prepareWorkspaceValidation(input.workspace, {
		expectedRevision: (await currentSession(input.workspace)).revision,
		featureId: FEATURE_ID,
		command: VALIDATION_COMMAND,
		scope: "broad",
		resultsPath: RESULTS_PATH,
	});
	const validation = await verifySeedValidation(input.workspace);
	await persistWorkspaceValidation(input.workspace, {
		...prepared,
		captureId: `reviewer-validation-${operationSuffix}`,
		exitCode: 0,
		outputDigest: validation.outputDigest,
		outputComplete: true,
		hostPlatform: normalizeEvidencePlatform(process.platform),
		observedAssertions: observeAssertions(
			prepared.assertions,
			validation.report,
		),
	});
	requireFlowSuccess(
		await flowReviewStart(input.workspace, {
			request: {
				operationId: `reviewer-review-start-${operationSuffix}`,
				expectedRevision: (await currentSession(input.workspace)).revision,
				featureId: FEATURE_ID,
				artifactsChanged: Object.keys(input.fixture.files)
					.sort()
					.map((path) => ({ path })),
				packet: {
					summary:
						"Verify the value function against the approved requirement. Baseline inventory: src/value.ts and src/value.test.ts are tracked regular non-executable files; there are no source deletions, renames, generated artifacts, symlinks, or file-mode changes. Host-owned .flow and .opencode files are outside the source change.",
					riskLenses: ["functional correctness", "boundary behavior"],
				},
			},
		}),
	);
	const session = await currentSession(input.workspace);
	const run = session.runs.find(
		(candidate) =>
			candidate.featureId === FEATURE_ID && candidate.state === "active",
	);
	const assignment = run?.reviews.find((review) => review.result === null);
	if (!run || !assignment) {
		throw new Error(
			"Reviewer assignment setup did not persist a pending review.",
		);
	}
	return {
		flowSessionId: session.id,
		featureId: FEATURE_ID,
		runId: run.id,
		assignmentId: assignment.id,
	};
}

export function durableReviewerSubmission(input: {
	readonly session: Session | null;
	readonly seed: SeededReviewerAssignment;
}): DurableReviewerSubmission {
	const run = input.session?.runs.find(
		(candidate) => candidate.id === input.seed.runId,
	);
	const assignment = run?.reviews.find(
		(candidate) => candidate.id === input.seed.assignmentId,
	);
	if (!assignment) {
		throw new Error(
			"The seeded reviewer assignment disappeared from Flow state.",
		);
	}
	if (
		assignment.result === null ||
		assignment.result.terminalDisposition !== "submitted"
	) {
		return { kind: "unsubmitted" };
	}
	return {
		kind: "submitted",
		verdict: assignment.result.verdict,
		findings: assignment.result.findings,
	};
}

export async function readDurableReviewerSubmission(input: {
	readonly workspace: string;
	readonly seed: SeededReviewerAssignment;
}): Promise<DurableReviewerSubmission> {
	const repository = createFileSessionRepository(input.workspace);
	const active = await repository.read();
	if (active?.runs.some((run) => run.id === input.seed.runId)) {
		return durableReviewerSubmission({ session: active, seed: input.seed });
	}
	const archived = await repository.transact((transaction) =>
		transaction.loadArchive(input.seed.flowSessionId),
	);
	return durableReviewerSubmission({
		session: archived,
		seed: input.seed,
	});
}
