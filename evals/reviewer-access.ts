import { z } from "zod";
import { canonicalJson } from "./canonical-json.js";
import {
	pseudonymizeEvalIds,
	type ScenarioGradeInput,
} from "./grader-input.js";
import type { ObservedToolCall } from "./harness.js";
import { type HostTrace, HostTraceSchema } from "./host-trace.js";
import { decodeReviewerPacket } from "./reviewer-packet-bytes.js";

const Id = z.string().min(1).max(256);
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Reference = z.object({ version: z.literal(1), sha256: Digest }).strict();
const Validation = z
	.object({
		id: Id,
		featureId: Id,
		runId: Id,
		scope: z.enum(["focused", "broad"]),
		command: z.string().min(1).max(16384),
		intent: z.enum(["pass", "observe"]).optional(),
		sourceDigest: Digest,
		exitCode: z.number().int().safe().nullable(),
		outputDigest: Digest,
		outputComplete: z.boolean(),
		recordedRevision: z.number().int().safe().nonnegative(),
		hostPlatform: z.enum(["linux", "darwin", "win32", "other"]).optional(),
		ineligibleReason: z.string().optional(),
	})
	.passthrough();
const Assignment = z
	.object({
		id: Id,
		featureId: Id,
		runId: Id,
		kind: z.enum(["feature", "final"]),
		sourceDigest: Digest,
		validationIds: z.array(Id).min(1).max(256),
		createdRevision: z.number().int().safe().nonnegative(),
		packet: z
			.object({ summary: z.string(), riskLenses: z.array(z.string()) })
			.passthrough(),
		result: z
			.object({
				verdict: z.enum(["passed", "failed"]),
				terminalDisposition: z.enum(["submitted", "observed_unsubmitted"]),
				recordedRevision: z.number().int().safe().nonnegative(),
				findings: z.array(z.unknown()),
			})
			.nullable(),
		evidence: Reference.optional(),
	})
	.passthrough();
const Run = z
	.object({
		id: Id,
		featureId: Id,
		state: z.enum(["active", "completed", "blocked", "superseded"]),
		startedRevision: z.number().int().safe().nonnegative(),
		baseline: Reference.optional(),
		artifactsChanged: z.array(z.record(z.string(), z.unknown())),
		validations: z.array(Validation).max(256),
		reviews: z.array(Assignment).max(1),
	})
	.passthrough();
const Feature = z
	.object({
		id: Id,
		kind: z.enum(["inspect", "change"]).optional(),
		validation: z.array(z.string()),
		checks: z
			.array(
				z
					.object({
						command: z.string(),
						intent: z.enum(["pass", "observe"]),
						platform: z.enum(["linux", "darwin", "win32", "other"]).optional(),
					})
					.passthrough(),
			)
			.optional(),
	})
	.passthrough();
const Document = z
	.object({
		version: z.literal(5),
		id: Id,
		revision: z.number().int().safe().nonnegative(),
		goal: z.string().min(1),
		approval: z.literal("approved"),
		plan: z
			.object({
				features: z.array(Feature),
				evidence: z
					.array(
						z
							.object({
								scope: z.enum(["gate", "gate-observe", "extra"]),
								command: z.string(),
								platform: z
									.enum(["linux", "darwin", "win32", "other"])
									.optional(),
								intent: z.enum(["pass", "observe"]).optional(),
							})
							.passthrough(),
					)
					.optional(),
			})
			.passthrough(),
		runs: z.array(Run).max(512),
		amendments: z.array(z.record(z.string(), z.unknown())).optional(),
	})
	.passthrough();
type ReviewAssignment = z.infer<typeof Assignment>;
type FeatureRun = z.infer<typeof Run>;
type Session = z.infer<typeof Document>;
function validationAccepted(
	document: Session,
	run: FeatureRun,
	assignment: ReviewAssignment,
): boolean {
	const feature = document.plan.features.find(
		(value) => value.id === run.featureId,
	);
	if (
		!feature ||
		new Set(assignment.validationIds).size !==
			assignment.validationIds.length ||
		assignment.result === null ||
		assignment.createdRevision <= run.startedRevision ||
		assignment.result.recordedRevision <= assignment.createdRevision ||
		assignment.result.recordedRevision > document.revision
	)
		return false;
	const assigned = assignment.validationIds.map((id) =>
		run.validations.filter((value) => value.id === id),
	);
	if (assigned.some((values) => values.length !== 1)) return false;
	const observations = assigned.flat();
	const otherFeaturesComplete = document.plan.features.every(
		(candidate) =>
			candidate.id === run.featureId ||
			document.runs.some(
				(previous) =>
					previous.featureId === candidate.id &&
					previous.state === "completed" &&
					previous.reviews.some(
						(review) =>
							review.result?.verdict === "passed" &&
							review.result.terminalDisposition === "submitted" &&
							review.result.recordedRevision < assignment.createdRevision,
					),
			),
	);
	if (assignment.kind !== (otherFeaturesComplete ? "final" : "feature"))
		return false;
	const declaredGates = (document.plan.evidence ?? []).filter(
		(entry) => entry.scope === "gate" || entry.scope === "gate-observe",
	);
	const gates = assignment.kind === "final" ? declaredGates : [];
	type Requirement = {
		command: string;
		intent: "pass" | "observe";
		platform: string | undefined;
		broad: boolean;
		wildcardPlatform: boolean;
		assertions: readonly string[];
	};
	const specs: Requirement[] = (feature.checks ?? []).map((check) => ({
		command: check.command,
		intent: check.intent,
		platform: check.platform,
		broad: false,
		wildcardPlatform: false,
		assertions: Array.isArray(check.assertions)
			? check.assertions.filter(
					(value): value is string => typeof value === "string",
				)
			: [],
	}));
	const requirements: Requirement[] = [
		...specs,
		...gates.map((gate) => ({
			command: gate.command,
			intent:
				gate.scope === "gate-observe"
					? ("observe" as const)
					: ("pass" as const),
			platform: gate.platform,
			broad: true,
			wildcardPlatform: true,
			assertions: Array.isArray(gate.assertions)
				? gate.assertions.filter(
						(value): value is string => typeof value === "string",
					)
				: [],
		})),
	];
	const observedGate = (observation: z.infer<typeof Validation>) =>
		observation.intent === "observe" &&
		observation.scope === "broad" &&
		declaredGates.some(
			(gate) =>
				gate.scope === "gate-observe" &&
				gate.command === observation.command &&
				(gate.platform === undefined ||
					gate.platform === "other" ||
					gate.platform === observation.hostPlatform),
		);
	if (observations.length === 0) return false;
	for (const observation of observations) {
		if (
			observation.featureId !== run.featureId ||
			observation.runId !== run.id ||
			observation.sourceDigest !== assignment.sourceDigest ||
			observation.outputComplete !== true ||
			observation.exitCode === null ||
			observation.ineligibleReason !== undefined ||
			observation.hostPlatform === undefined ||
			observation.recordedRevision <= run.startedRevision ||
			observation.recordedRevision >= assignment.createdRevision
		)
			return false;
		if (
			observation.exitCode !== 0 &&
			!(
				observation.intent === "observe" &&
				(specs.some(
					(required) =>
						required.command === observation.command &&
						required.intent === "observe",
				) ||
					observedGate(observation))
			)
		)
			return false;
	}
	if (
		assignment.kind === "final" &&
		!observations.some(
			(observation) =>
				observation.scope === "broad" &&
				((observation.exitCode === 0 && observation.intent !== "observe") ||
					(observation.intent === "observe" &&
						declaredGates.some(
							(gate) =>
								gate.scope === "gate-observe" &&
								gate.command === observation.command,
						))),
		)
	)
		return false;
	if (assignment.kind === "final") {
		for (const extra of (document.plan.evidence ?? []).filter(
			(entry) => entry.scope === "extra",
		)) {
			const assertions = Array.isArray(extra.assertions)
				? extra.assertions
				: [];
			const found = document.runs
				.flatMap((candidate) => candidate.validations)
				.some(
					(observation) =>
						observation.command === extra.command &&
						observation.sourceDigest === assignment.sourceDigest &&
						observation.outputComplete &&
						observation.exitCode === 0 &&
						observation.ineligibleReason === undefined &&
						observation.hostPlatform !== undefined &&
						(extra.platform === undefined ||
							extra.platform === "other" ||
							extra.platform === observation.hostPlatform) &&
						observation.recordedRevision < assignment.createdRevision &&
						assertions.every(
							(name) =>
								Array.isArray(observation.observedAssertions) &&
								observation.observedAssertions.some(
									(value) =>
										record(value)?.name === name &&
										record(value)?.status === "passed",
								),
						),
				);
			if (!found) return false;
		}
	}
	const assertionsMatch = (
		names: readonly string[],
		observation: z.infer<typeof Validation>,
	) => {
		if (names.length === 0) return true;
		const assertions = observation.observedAssertions;
		return (
			Array.isArray(assertions) &&
			names.every((name) =>
				assertions.some(
					(value: unknown) =>
						record(value)?.name === name && record(value)?.status === "passed",
				),
			) &&
			(!/(?:^|[\s"'=])\.flow\/results\.xml(?=$|[\s"'])/.test(
				observation.command,
			) ||
				observation.resultsPath === ".flow/results.xml")
		);
	};
	const acceptedExtra = (observation: z.infer<typeof Validation>) =>
		!(feature.checks ?? []).some(
			(check) => check.command === observation.command,
		) &&
		observation.exitCode === 0 &&
		(document.plan.evidence ?? []).some(
			(entry) =>
				entry.scope === "extra" &&
				entry.command === observation.command &&
				(entry.platform === undefined ||
					entry.platform === "other" ||
					entry.platform === observation.hostPlatform) &&
				assertionsMatch(
					Array.isArray(entry.assertions)
						? entry.assertions.filter(
								(value): value is string => typeof value === "string",
							)
						: [],
					observation,
				),
		);
	const acceptedPurpose = (observation: z.infer<typeof Validation>) => {
		if (
			!observation.outputComplete ||
			observation.exitCode === null ||
			observation.ineligibleReason !== undefined
		)
			return false;
		const spec = specs.find(
			(required) => required.command === observation.command,
		);
		const gate = declaredGates.find(
			(entry) =>
				entry.scope === "gate-observe" && entry.command === observation.command,
		);
		const intent = spec?.intent ?? (gate ? "observe" : "pass");
		if (
			((spec || observation.intent !== undefined) &&
				observation.intent !== intent) ||
			(spec && observation.hostPlatform !== spec.platform)
		)
			return false;
		if (
			spec &&
			intent === "observe" &&
			Array.isArray(observation.observedAssertions) &&
			observation.observedAssertions.length > 0
		)
			return false;
		if (intent === "observe")
			return !gate || observedGate(observation) || acceptedExtra(observation);
		return (
			observation.exitCode === 0 &&
			(!spec ||
				assertionsMatch(
					[
						...spec.assertions,
						...(document.plan.evidence ?? [])
							.filter((entry) => entry.command === observation.command)
							.flatMap((entry) =>
								Array.isArray(entry.assertions)
									? entry.assertions.filter(
											(value): value is string => typeof value === "string",
										)
									: [],
							),
					],
					observation,
				))
		);
	};
	if (
		!observations.every(acceptedPurpose) ||
		!observations.some(
			(observation) =>
				(observation.exitCode === 0 && observation.intent !== "observe") ||
				(feature.kind === "inspect" &&
					(observedGate(observation) ||
						(assignment.kind === "feature" && acceptedExtra(observation)))),
		)
	)
		return false;
	const vetoCommands = new Set([
		...feature.validation,
		...specs.map((required) => required.command),
		...declaredGates.map((gate) => gate.command),
	]);
	const rejectedBeforeReview = document.runs
		.filter((candidate) => candidate.featureId === run.featureId)
		.flatMap((candidate) => candidate.validations)
		.filter(
			(observation) =>
				observation.recordedRevision < assignment.createdRevision &&
				(observation.scope === "broad" ||
					vetoCommands.has(observation.command)) &&
				!acceptedPurpose(observation),
		);
	if (
		rejectedBeforeReview.some(
			(failed) =>
				!observations.some(
					(observation) =>
						observation.command === failed.command &&
						observation.recordedRevision > failed.recordedRevision,
				),
		)
	)
		return false;
	return requirements.every((required) =>
		observations.some(
			(observation) =>
				observation.command === required.command &&
				assertionsMatch(required.assertions, observation) &&
				(!required.broad || observation.scope === "broad") &&
				(required.platform === undefined ||
					(required.wildcardPlatform && required.platform === "other") ||
					observation.hostPlatform === required.platform) &&
				(required.intent === "observe"
					? observation.intent === "observe"
					: observation.intent !== "observe" && observation.exitCode === 0),
		),
	);
}
type Trace = Extract<HostTrace, { kind: "observed" }>;
type Assistant = Extract<Trace["messages"][number], { role: "assistant" }>;
type Witness = Readonly<{
	message: Assistant;
	tool: Assistant["tools"][number];
}>;
function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
function successful(call: ObservedToolCall): Record<string, unknown> | null {
	const output = record(call.output);
	return call.status === "completed" && output?.status === "ok"
		? record(output.workflowData)
		: null;
}
export function nativeToolWitness(
	call: ObservedToolCall,
	trace: Trace,
): Witness | null {
	if (!call.native) return null;
	const message = trace.messages.find(
		(candidate) =>
			candidate.id === call.native?.messageId &&
			candidate.sessionId === call.native.sessionId,
	);
	if (message?.role !== "assistant" || message.agent !== call.agent)
		return null;
	const tool = message.tools.find(
		(candidate) => candidate.partId === call.native?.partId,
	);
	if (!tool) return null;
	const { tool: name, status, ...native } = tool;
	return name === call.tool &&
		status === call.status &&
		canonicalJson(native) === canonicalJson(call.native)
		? { message, tool }
		: null;
}
function reviewer(call: ObservedToolCall, trace: Trace): Witness | null {
	const observed = nativeToolWitness(call, trace);
	if (!observed || call.agent !== "flow-reviewer") return null;
	const session = trace.sessions.find(
		(candidate) => candidate.id === observed.message.sessionId,
	);
	return session?.agent === "flow-reviewer" &&
		session.parentId !== null &&
		!trace.runnerRootSessionIds.includes(session.id)
		? observed
		: null;
}
function before(read: Witness, submit: Witness): boolean {
	return (
		read.message.sessionId === submit.message.sessionId &&
		read.tool.completedAt !== null &&
		submit.tool.startedAt !== null &&
		read.tool.completedAt <= submit.tool.startedAt &&
		(read.message.order < submit.message.order ||
			(read.message.order === submit.message.order &&
				read.tool.partIndex < submit.tool.partIndex))
	);
}
export function reviewPacketPages(text: string): readonly string[] {
	const pages: string[] = [];
	for (let start = 0; start < text.length; ) {
		let end = Math.min(start + 2048, text.length);
		if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1)))
			end--;
		pages.push(text.slice(start, end));
		start = end;
	}
	return pages.length ? pages : [""];
}
export function checkAutonomousLineage(
	input: Pick<ScenarioGradeInput, "hostTrace">,
): readonly string[] {
	const parsed = HostTraceSchema.safeParse(input.hostTrace);
	if (!parsed.success || parsed.data.kind !== "observed")
		return ["Complete native lineage was not observed."];
	const trace = parsed.data;
	if (trace.runnerRootSessionIds.length !== 1)
		return ["Autonomous execution requires one native root session."];
	const users = trace.messages.filter(
		(message) =>
			message.role === "user" &&
			message.sessionId === trace.runnerRootSessionIds[0],
	);
	let originals = 0;
	let initialToken: string | null = null;
	const issues: string[] = [];
	for (const [index, user] of users.entries()) {
		if (user.role !== "user") continue;
		if (
			user.parts.some(
				(part) => part.type !== "text" || part.compactionContinue === true,
			)
		) {
			issues.push(
				"Native compaction or unknown user-part delivery is unproven.",
			);
			continue;
		}
		const ordinary = user.parts.some(
			(part) => part.synthetic !== true && (part.textBytes ?? 0) > 0,
		);
		if (ordinary) originals++;
		const marked = user.parts.filter(
			(part) => part.synthetic === true && part.flowTokenSha256 !== null,
		);
		if (index === 0) {
			if (!ordinary || marked.length === 0)
				issues.push("The initial original Flow request marker is missing.");
			initialToken = marked[0]?.flowTokenSha256 ?? null;
		}
		for (const part of user.parts)
			if (
				part.synthetic === true &&
				(part.flowTokenSha256 === null || part.flowTokenSha256 !== initialToken)
			)
				issues.push("Unknown or mismatched synthetic Flow continuation.");
		if (index > 0 && !ordinary && marked.length === 0)
			issues.push("Unclassified native root user message.");
	}
	if (originals !== 1)
		issues.push("Expected exactly one original root request.");
	return [...new Set(issues)];
}

function acceptedSubmission(
	call: ObservedToolCall,
	assignment: ReviewAssignment,
	run: FeatureRun,
): boolean {
	const data = successful(call),
		request = record(call.input.request),
		operation = record(data?.operation);
	const entity = record(operation?.entity),
		result = record(request?.result);
	return (
		call.tool === "flow_feature_complete" &&
		request?.assignmentId === assignment.id &&
		request.featureId === run.featureId &&
		result?.verdict === "passed" &&
		result.terminalDisposition === "submitted" &&
		operation?.replayed === false &&
		entity?.id === run.id &&
		entity.state === "completed" &&
		canonicalJson(entity) === canonicalJson(run) &&
		operation.revision === assignment.result?.recordedRevision
	);
}
function priorFindings(
	document: Session,
	featureId: string,
	beforeRevision: number,
): readonly Record<string, unknown>[] {
	let live: Record<string, unknown>[] = [];
	const reviews = document.runs
		.filter((run) => run.featureId === featureId)
		.flatMap((run) => run.reviews)
		.filter(
			(review) =>
				review.result !== null &&
				review.result.recordedRevision < beforeRevision,
		)
		.sort(
			(a, b) =>
				(a.result?.recordedRevision ?? 0) - (b.result?.recordedRevision ?? 0),
		);
	for (const review of reviews) {
		if (!review.result) continue;
		const reported = review.result.findings.flatMap((value) => {
			const finding = record(value);
			return typeof finding?.findingId === "string"
				? [
						{
							findingId: finding.findingId,
							severity: finding.severity,
							summary: finding.summary,
							...(finding.evidence === undefined
								? {}
								: { evidence: finding.evidence }),
						},
					]
				: [];
		});
		if (review.result.verdict === "passed") {
			live = reported;
			continue;
		}
		live = [
			...live.map(
				(finding) =>
					reported.find((value) => value.findingId === finding.findingId) ??
					finding,
			),
			...reported.filter(
				(finding) =>
					!live.some((value) => value.findingId === finding.findingId),
			),
		];
	}
	return live;
}
function contextMatches(
	context: Record<string, unknown>,
	document: Session,
	run: FeatureRun,
	assignment: ReviewAssignment,
): boolean {
	const observedAssignment = record(context.assignment),
		feature = record(context.feature);
	if (
		!feature ||
		!observedAssignment ||
		observedAssignment.validationIds === undefined ||
		observedAssignment.evidence === undefined ||
		context.planContext === undefined ||
		context.validations === undefined ||
		context.artifactsChanged === undefined
	)
		return false;
	try {
		return (
			context.view === "reviewer" &&
			context.sessionId === document.id &&
			context.goal === document.goal &&
			canonicalJson(feature) ===
				canonicalJson(
					document.plan.features.find((value) => value.id === run.featureId),
				) &&
			observedAssignment?.id === assignment.id &&
			observedAssignment.runId === run.id &&
			observedAssignment.featureId === run.featureId &&
			observedAssignment.sourceDigest === assignment.sourceDigest &&
			observedAssignment.kind === assignment.kind &&
			observedAssignment.result === null &&
			canonicalJson(observedAssignment.packet) ===
				canonicalJson(assignment.packet) &&
			canonicalJson(observedAssignment.validationIds) ===
				canonicalJson(assignment.validationIds) &&
			canonicalJson(observedAssignment.evidence) ===
				canonicalJson(assignment.evidence) &&
			canonicalJson(context.planContext) ===
				canonicalJson({
					...document.plan,
					features: document.plan.features.map(
						({ kind: _kind, ...value }) => value,
					),
				}) &&
			canonicalJson(context.validations) ===
				canonicalJson(
					run.validations.filter((validation) =>
						assignment.validationIds.includes(validation.id),
					),
				) &&
			canonicalJson(context.artifactsChanged) ===
				canonicalJson(run.artifactsChanged) &&
			canonicalJson(context.completedFeatureIds ?? null) ===
				canonicalJson(
					document.plan.features
						.filter(
							(feature) =>
								feature.id !== run.featureId &&
								document.runs.some(
									(previous) =>
										previous.featureId === feature.id &&
										previous.state === "completed" &&
										previous.reviews.some(
											(review) =>
												review.result !== null &&
												review.result.recordedRevision <
													assignment.createdRevision,
										),
								),
						)
						.map((feature) => feature.id),
				) &&
			canonicalJson(context.amendments ?? null) ===
				canonicalJson(
					(document.amendments ?? []).filter(
						(amendment) =>
							amendment.featureId === run.featureId &&
							typeof amendment.recordedRevision === "number" &&
							amendment.recordedRevision <= assignment.createdRevision,
					),
				) &&
			canonicalJson(context.amendmentEvidence ?? null) ===
				canonicalJson(
					document.runs
						.filter((previous) => previous.featureId === run.featureId)
						.flatMap((previous) => previous.validations)
						.filter((validation) =>
							(document.amendments ?? []).some(
								(amendment) =>
									amendment.featureId === run.featureId &&
									amendment.validationId === validation.id &&
									typeof amendment.recordedRevision === "number" &&
									amendment.recordedRevision <= assignment.createdRevision,
							),
						),
				) &&
			canonicalJson(context.priorFindings ?? null) ===
				canonicalJson(
					priorFindings(document, run.featureId, assignment.createdRevision),
				) &&
			Array.isArray(context.completedFeatureIds) &&
			Array.isArray(context.amendments) &&
			Array.isArray(context.amendmentEvidence) &&
			typeof context.nextFindingIdPrefix === "string"
		);
	} catch {
		return false;
	}
}
function pageSet(
	calls: readonly ObservedToolCall[],
	assignment: ReviewAssignment,
	documentId: string,
	part: "context" | "diff",
	total: number,
): ReadonlyMap<number, string> | null {
	const pages = new Map<number, string>();
	for (const call of calls) {
		const projection = record(successful(call)?.projection);
		if (
			projection?.view !== "reviewer-evidence" ||
			projection.assignmentId !== assignment.id ||
			projection.part !== part
		)
			continue;
		if (
			projection.sessionId !== documentId ||
			projection.sourceDigest !== assignment.sourceDigest ||
			projection.complete !== true ||
			projection.assurance !== "host-evidence" ||
			projection.totalPages !== total ||
			typeof projection.page !== "number" ||
			!Number.isSafeInteger(projection.page) ||
			projection.page < 0 ||
			projection.page >= total ||
			typeof projection.text !== "string"
		)
			return null;
		const previous = pages.get(projection.page);
		if (previous !== undefined && previous !== projection.text) return null;
		pages.set(projection.page, projection.text);
	}
	return pages.size === total ? pages : null;
}
export function checkReviewerEvidenceAccess(
	input: ScenarioGradeInput,
	documentInput: unknown,
): readonly string[] {
	const parsedTrace = HostTraceSchema.safeParse(input.hostTrace),
		parsedDocument = Document.safeParse(documentInput);
	if (
		!parsedTrace.success ||
		parsedTrace.data.kind !== "observed" ||
		!parsedDocument.success
	)
		return [
			"Complete native lineage and durable session are required for reviewer access.",
		];
	const trace = parsedTrace.data,
		document = parsedDocument.data,
		issues: string[] = [];
	const runs = document.runs.filter((run) => run.state === "completed");
	if (runs.length === 0)
		return ["No completed feature has independent reviewer evidence."];
	for (const run of runs) {
		const assignment = run.reviews.at(-1);
		const fail = (detail: string) => issues.push(`${run.featureId}: ${detail}`);
		if (
			!assignment?.evidence ||
			assignment.result?.verdict !== "passed" ||
			assignment.result.terminalDisposition !== "submitted" ||
			!run.baseline ||
			!validationAccepted(document, run, assignment)
		) {
			fail(
				"Accepted current-source validation and submitted review are missing.",
			);
			continue;
		}
		const submissions = input.allCalls.filter(
			(call) =>
				acceptedSubmission(call, assignment, run) && reviewer(call, trace),
		);
		if (submissions.length !== 1) {
			fail("One accepted native reviewer-child submission is required.");
			continue;
		}
		const submission = submissions[0];
		if (!submission) continue;
		const submit = reviewer(submission, trace);
		if (!submit) continue;
		const reads = input.allCalls.filter(
			(call) =>
				call.tool === "flow_status" &&
				successful(call) &&
				(() => {
					const observed = reviewer(call, trace);
					return observed !== null && before(observed, submit);
				})(),
		);
		const headers = reads.filter(
			(call) =>
				record(successful(call)?.projection)?.view === "reviewer" &&
				record(record(successful(call)?.projection)?.assignment)?.id ===
					assignment.id,
		);
		if (headers.length === 0) {
			fail("Reviewer context was not read before submission.");
			continue;
		}
		const header = headers.at(-1);
		if (!header) continue;
		const data = successful(header),
			pager = record(data?.reviewerPager),
			inline = record(data?.projection);
		if (
			!pager ||
			!inline ||
			pager.assignmentId !== assignment.id ||
			pager.assurance !== "host-evidence" ||
			pager.chunkBytes !== 8192 ||
			typeof pager.diffPages !== "number" ||
			!Number.isSafeInteger(pager.diffPages) ||
			pager.diffPages < 1 ||
			pager.diffPages > 4096 ||
			typeof pager.contextPages !== "number" ||
			!Number.isSafeInteger(pager.contextPages) ||
			pager.contextPages < 1 ||
			pager.contextPages > 4096
		) {
			fail("Bound host evidence pager is missing.");
			continue;
		}
		let context = inline;
		if (inline.inlineContext === "paged") {
			const pages = pageSet(
				reads,
				assignment,
				document.id,
				"context",
				pager.contextPages,
			);
			if (!pages) {
				fail("Complete bound context pages were not read.");
				continue;
			}
			try {
				context =
					record(
						JSON.parse(
							[...pages.entries()]
								.sort(([a], [b]) => a - b)
								.map(([, text]) => text)
								.join(""),
						),
					) ?? {};
			} catch {
				fail("Context pages are malformed.");
				continue;
			}
		}
		if (!contextMatches(context, document, run, assignment)) {
			fail("Reviewer context does not match the accepted assignment and run.");
			continue;
		}
		const observation = input.packetBytes?.filter(
			(value) => value.assignmentId === assignment.id,
		);
		if (observation?.length !== 1 || observation[0]?.kind !== "observed") {
			fail("Original bound packet bytes are unavailable.");
			continue;
		}
		try {
			const decoded = decodeReviewerPacket(observation[0].envelopeBase64);
			const sameId = (original: string, retained: string) =>
				original === retained || pseudonymizeEvalIds(original) === retained;
			if (
				decoded.sha256 !== assignment.evidence.sha256 ||
				!sameId(decoded.packet.sessionId, document.id) ||
				!sameId(decoded.packet.runId, run.id) ||
				!sameId(decoded.packet.featureId, run.featureId) ||
				decoded.packet.sourceDigest !== assignment.sourceDigest ||
				canonicalJson(decoded.packet.baseline) !== canonicalJson(run.baseline)
			) {
				fail("Original packet byte digest or binding differs.");
				continue;
			}
			const originalPages = reviewPacketPages(decoded.packetText),
				pages = pageSet(
					reads,
					assignment,
					document.id,
					"diff",
					pager.diffPages,
				);
			if (
				!pages ||
				originalPages.length !== pager.diffPages ||
				originalPages.some(
					(page, index) =>
						pages.get(index) !== page &&
						pages.get(index) !== pseudonymizeEvalIds(page),
				)
			)
				fail("Complete original diff pages were not read before submission.");
		} catch {
			fail("Original packet bytes are unsafe or malformed.");
		}
	}
	return issues;
}
