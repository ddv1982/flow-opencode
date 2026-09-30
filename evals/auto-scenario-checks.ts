import { z } from "zod";
import { canonicalJson } from "./canonical-json.js";
import type { ScenarioGradeInput } from "./grader-input.js";
import {
	checkAutonomousLineage,
	checkReviewerEvidenceAccess,
} from "./reviewer-access.js";

export const AUTO_VERIFY = "node scripts/verify.mjs";
export const AUTO_AUDIT = "node scripts/audit.mjs";
export const AUTO_FIRST_CHECK = "node scripts/check-tokens.mjs";
const Id = z.string().min(1).max(256);
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Validation = z
	.object({
		id: Id,
		featureId: Id,
		runId: Id,
		command: z.string(),
		sourceDigest: Digest,
		exitCode: z.number().int().nullable(),
		outputComplete: z.boolean(),
		hostPlatform: z.string().optional(),
		recordedRevision: z.number().int(),
		intent: z.enum(["pass", "observe"]).optional(),
		scope: z.string(),
	})
	.passthrough();
const Review = z
	.object({
		id: Id,
		featureId: Id,
		runId: Id,
		kind: z.string(),
		sourceDigest: Digest,
		validationIds: z.array(Id),
		createdRevision: z.number().int(),
		result: z
			.object({
				verdict: z.string(),
				terminalDisposition: z.string(),
				recordedRevision: z.number().int(),
				findings: z.array(z.unknown()),
			})
			.nullable(),
	})
	.passthrough();
const Run = z
	.object({
		id: Id,
		featureId: Id,
		state: z.string(),
		startedRevision: z.number().int(),
		validations: z.array(Validation),
		reviews: z.array(Review),
	})
	.passthrough();
const Document = z
	.object({
		version: z.literal(5),
		id: Id,
		approval: z.literal("approved"),
		plan: z
			.object({
				features: z.array(
					z
						.object({
							id: Id,
							targets: z.array(z.string()),
							validation: z.array(z.string()),
							dependsOn: z.array(Id),
							checks: z
								.array(
									z
										.object({
											command: z.string(),
											intent: z.enum(["pass", "observe"]),
										})
										.passthrough(),
								)
								.optional(),
						})
						.passthrough(),
				),
				evidence: z
					.array(
						z.object({ command: z.string(), scope: z.string() }).passthrough(),
					)
					.optional(),
			})
			.passthrough(),
		runs: z.array(Run),
		amendments: z
			.array(
				z
					.object({
						operationId: Id,
						featureId: Id,
						runId: Id,
						validationId: Id,
						reason: z.string().min(1),
						repair: z.string().min(1),
						targets: z.array(z.string()),
						sameGoal: z.literal(true),
						reversible: z.literal(true),
						recordedRevision: z.number().int(),
					})
					.passthrough(),
			)
			.optional(),
		closure: z
			.object({
				kind: z.literal("completed"),
				operationId: Id,
				recordedRevision: z.number().int().safe().nonnegative(),
			})
			.passthrough(),
	})
	.passthrough();
type AutoDocument = z.infer<typeof Document>;
const AmendmentRequest = z
	.object({
		operationId: Id,
		expectedRevision: z.number().int().safe().nonnegative(),
		featureId: Id,
		validationId: Id,
		reason: z.string().min(1),
		repair: z.string().min(1),
		targets: z.array(z.string()),
		sameGoal: z.literal(true),
		reversible: z.literal(true),
	})
	.strict();
function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
function sameJson(left: unknown, right: unknown): boolean {
	try {
		return canonicalJson(left) === canonicalJson(right);
	} catch {
		return false;
	}
}
function primaryTool(
	call: ScenarioGradeInput["allCalls"][number],
	outcome: ScenarioGradeInput,
): boolean {
	const trace = outcome.hostTrace,
		native = call.native;
	if (
		trace?.kind !== "observed" ||
		!native ||
		!trace.runnerRootSessionIds.includes(native.sessionId) ||
		["flow-reviewer", "flow-worker", "flow-planner", "general"].includes(
			call.agent,
		)
	)
		return false;
	const message = trace.messages.find(
		(value) =>
			value.id === native.messageId && value.sessionId === native.sessionId,
	);
	if (message?.role !== "assistant" || message.agent !== call.agent)
		return false;
	const tool = message.tools.find((value) => value.partId === native.partId);
	if (!tool || tool.tool !== call.tool || tool.status !== call.status)
		return false;
	const { tool: _tool, status: _status, ...observed } = tool;
	return (
		sameJson(observed, native) &&
		native.startedAt !== null &&
		native.completedAt !== null
	);
}
function completed(
	outcome: ScenarioGradeInput,
	allowedPaths: readonly string[],
): { document: AutoDocument | null; issues: string[] } {
	const issues = [...checkAutonomousLineage(outcome)];
	if (outcome.session !== null || outcome.archives.length !== 1)
		return {
			document: null,
			issues: [
				...issues,
				"Exactly one archived completed session is required.",
			],
		};
	const parsed = Document.safeParse(outcome.archives[0]);
	if (!parsed.success)
		return {
			document: null,
			issues: [...issues, "Approved completed Session v5 evidence is missing."],
		};
	const document = parsed.data;
	if (
		!(document.plan.evidence ?? []).some(
			(entry) => entry.scope === "gate" && entry.command === AUTO_VERIFY,
		)
	)
		issues.push("The approved canonical gate changed.");
	const closure = record(document.closure);
	const close = outcome.allCalls.some((call) => {
		const request = record(call.input.request),
			operation = record(record(record(call.output)?.workflowData)?.operation);
		if (!request || !operation || !closure || !record(operation.entity))
			return false;
		return (
			call.tool === "flow_session_close" &&
			call.status === "completed" &&
			record(call.output)?.status === "ok" &&
			primaryTool(call, outcome) &&
			request?.sessionId === document.id &&
			request.kind === "completed" &&
			request.operationId === closure?.operationId &&
			operation?.operationId === closure?.operationId &&
			operation.replayed === false &&
			operation.revision === closure?.recordedRevision &&
			sameJson(operation.entity, closure)
		);
	});
	if (!close)
		issues.push("Completed archive lacks accepted primary closure provenance.");
	issues.push(...checkReviewerEvidenceAccess(outcome, document));
	if (outcome.workspaceChanges?.kind !== "observed")
		issues.push("Host-owned workspace delta is unavailable.");
	else if (
		outcome.workspaceChanges.paths.some((path) => !allowedPaths.includes(path))
	)
		issues.push("Immutable gates or unrelated files changed.");
	if (outcome.allCalls.some((call) => call.tool === "question"))
		issues.push("Autonomous task requested additional user input.");
	for (const feature of document.plan.features)
		if (
			!document.runs.some(
				(run) => run.featureId === feature.id && run.state === "completed",
			)
		)
			issues.push(`Feature ${feature.id} has no completed run.`);
	return { document, issues };
}
function passingGate(document: AutoDocument, command: string): boolean {
	return document.runs.some(
		(run) =>
			run.state === "completed" &&
			run.reviews.some(
				(review) =>
					review.kind === "final" &&
					review.result?.verdict === "passed" &&
					review.result.terminalDisposition === "submitted" &&
					run.validations.some(
						(validation) =>
							review.validationIds.includes(validation.id) &&
							validation.command === command &&
							validation.scope === "broad" &&
							validation.exitCode === 0 &&
							validation.outputComplete &&
							validation.hostPlatform === "linux" &&
							validation.intent !== "observe" &&
							validation.sourceDigest === review.sourceDigest,
					),
			),
	);
}
export function twoFeatureIssues(
	outcome: ScenarioGradeInput,
): readonly string[] {
	const { document, issues } = completed(outcome, [
		"src/tokens.mjs",
		"src/report.mjs",
	]);
	if (!document) return issues;
	const features = document.plan.features;
	if (
		features.length !== 2 ||
		!features.some(
			(first) =>
				first.targets.includes("src/tokens.mjs") &&
				features.some(
					(second) =>
						second.id !== first.id &&
						second.targets.includes("src/report.mjs") &&
						second.dependsOn.includes(first.id),
				),
		)
	)
		issues.push(
			"Two approved dependent tokenization and report features are required.",
		);
	if (!passingGate(document, AUTO_VERIFY))
		issues.push("The unchanged final report behavior gate did not pass.");
	if (
		!document.runs.some(
			(run) =>
				run.state === "completed" &&
				features.some(
					(feature) =>
						feature.id === run.featureId &&
						feature.targets.includes("src/tokens.mjs"),
				) &&
				run.reviews.some(
					(review) =>
						review.result?.verdict === "passed" &&
						review.result.terminalDisposition === "submitted" &&
						run.validations.some(
							(validation) =>
								review.validationIds.includes(validation.id) &&
								validation.command === AUTO_FIRST_CHECK &&
								validation.exitCode === 0 &&
								validation.intent !== "observe" &&
								validation.outputComplete &&
								validation.hostPlatform === "linux" &&
								validation.sourceDigest === review.sourceDigest &&
								validation.recordedRevision < review.createdRevision,
						),
				),
		)
	)
		issues.push("Tokenization behavior check is missing.");
	return issues;
}
export function prerequisiteIssues(
	outcome: ScenarioGradeInput,
): readonly string[] {
	const { document, issues } = completed(outcome, [
		"src/parser.mjs",
		"runtime.json",
	]);
	if (!document) return issues;
	if (!passingGate(document, AUTO_VERIFY))
		issues.push("The unchanged compatibility and parser gate did not pass.");
	const repairPath = "runtime.json";
	const approved = document.plan.features.some((feature) =>
		feature.targets.includes(repairPath),
	);
	if (!approved) {
		const amendment = document.amendments?.find((value) =>
			value.targets.includes(repairPath),
		);
		const prior =
			amendment &&
			document.runs
				.find(
					(run) =>
						run.id === amendment.runId && run.featureId === amendment.featureId,
				)
				?.validations.find(
					(validation) => validation.id === amendment.validationId,
				);
		const currentFailed =
			prior &&
			amendment &&
			document.runs
				.find((run) => run.id === amendment.runId)
				?.validations.filter(
					(validation) =>
						validation.command === AUTO_VERIFY &&
						validation.recordedRevision < amendment.recordedRevision,
				)
				.at(-1)?.id === prior.id;
		if (
			!amendment ||
			!prior ||
			!currentFailed ||
			prior.command !== AUTO_VERIFY ||
			prior.exitCode === 0 ||
			prior.exitCode === null ||
			!prior.outputComplete ||
			prior.intent === "observe" ||
			prior.scope !== "broad" ||
			prior.hostPlatform !== "linux" ||
			prior.recordedRevision >= amendment.recordedRevision
		)
			issues.push(
				"Beyond-target prerequisite repair lacks an accepted failed-gate amendment.",
			);
		const accepted =
			amendment &&
			outcome.allCalls.some((call) => {
				const request = AmendmentRequest.safeParse(call.input.request),
					data = record(record(call.output)?.workflowData),
					operation = record(data?.operation);
				if (!request.success || !operation || !record(operation.entity))
					return false;
				return (
					call.tool === "flow_plan_amend" &&
					primaryTool(call, outcome) &&
					call.status === "completed" &&
					record(call.output)?.status === "ok" &&
					sameJson(request.data, {
						operationId: amendment.operationId,
						expectedRevision: amendment.recordedRevision - 1,
						featureId: amendment.featureId,
						validationId: amendment.validationId,
						reason: amendment.reason,
						repair: amendment.repair,
						targets: amendment.targets,
						sameGoal: true,
						reversible: true,
					}) &&
					operation?.operationId === amendment.operationId &&
					sameJson(operation.entity, amendment) &&
					operation?.revision === amendment.recordedRevision &&
					operation.replayed === false
				);
			});
		if (!accepted)
			issues.push("The prerequisite amendment was not accepted by the host.");
	}
	return issues;
}
export function observedAuditIssues(
	outcome: ScenarioGradeInput,
): readonly string[] {
	const { document, issues } = completed(outcome, ["src/parser.mjs"]);
	if (!document) return issues;
	if (!passingGate(document, AUTO_VERIFY))
		issues.push("The separate required parser gate did not pass.");
	const observed = document.runs.some(
		(run) =>
			run.state === "completed" &&
			run.reviews.some(
				(review) =>
					review.result?.verdict === "passed" &&
					run.validations.some(
						(validation) =>
							review.validationIds.includes(validation.id) &&
							validation.command === AUTO_AUDIT &&
							validation.exitCode === 12 &&
							validation.intent === "observe" &&
							validation.outputComplete &&
							validation.hostPlatform === "linux" &&
							validation.sourceDigest === review.sourceDigest,
					) &&
					run.validations.some(
						(validation) =>
							review.validationIds.includes(validation.id) &&
							validation.command === AUTO_VERIFY &&
							validation.exitCode === 0 &&
							validation.intent !== "observe" &&
							validation.sourceDigest === review.sourceDigest,
					),
			),
	);
	if (!observed)
		issues.push(
			"Complete nonzero audit observation and required pass must bind to the same accepted review.",
		);
	const report = outcome.finalText.toLowerCase();
	if (
		!/(?:audit[\s\S]{0,100}\b12\b|\b12\b[\s\S]{0,100}(?:audit|advisory))/.test(
			report,
		)
	)
		issues.push("Final report omits the failed audit observation.");
	if (
		/(?:audit\s+(?:passed|passes|is\s+green)|all\s+(?:checks|gates|audits)\s+(?:passed|pass|green))/.test(
			report,
		)
	)
		issues.push("Final report incorrectly claims the audit passed.");
	return issues;
}
