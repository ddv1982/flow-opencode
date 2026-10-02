import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { deriveConformanceOutcome } from "../evals/conformance-evidence.js";
import {
	pseudonymizeEvalIds,
	RetainedScenarioEvidenceSchema,
	ScenarioGradeInputSchema,
} from "../evals/grader-input.js";
import { collectHostTrace } from "../evals/host-trace.js";
import {
	normalizeRequestedModel,
	redactTranscript,
} from "../evals/provenance.js";
import {
	checkAutonomousLineage,
	checkReviewerEvidenceAccess,
	reviewPacketPages,
} from "../evals/reviewer-access.js";
import {
	collectReviewerPacketBytes,
	decodeReviewerPacket,
	ReviewerPacketSchema,
} from "../evals/reviewer-packet-bytes.js";
import { reviewerProjection } from "../src/application/session-projection.js";
import { reviewReadiness } from "../src/domain/review-readiness.js";
import type { Plan } from "../src/domain/session.js";
import {
	approveSession,
	deterministicEnvironment,
	MemorySessionRepository,
	plan,
	startReviewedRun,
	submitReview,
} from "./runtime-test-support.js";

const digest: `sha256:${string}` = `sha256:${"a".repeat(64)}`;
function packetFixture() {
	const packet = {
		version: 1,
		sessionId: "session:fixture",
		featureId: "feature",
		runId: "run",
		baseline: { version: 1, sha256: digest },
		sourceDigest: digest,
		provenance: "captured-before-run",
		complete: true,
		preservedPreexisting: { count: 0, digest, entries: [] },
		changes: [],
	};
	const envelope = JSON.stringify({
		owner: "flow-review-evidence",
		version: 1,
		kind: "packet",
		packet,
	});
	const sha256 = `sha256:${createHash("sha256").update(envelope).digest("hex")}`;
	const document = {
		id: "session:fixture",
		runs: [
			{
				id: "run",
				baseline: packet.baseline,
				reviews: [
					{
						id: "review:fixture",
						featureId: "feature",
						runId: "run",
						sourceDigest: digest,
						evidence: { version: 1, sha256 },
					},
				],
			},
		],
	};
	const call = {
		tool: "flow_status",
		status: "completed",
		output: {
			status: "ok",
			workflowData: {
				projection: {
					view: "reviewer-evidence",
					sessionId: "session:fixture",
					assignmentId: "review:fixture",
					sourceDigest: digest,
					part: "diff",
					page: 0,
					totalPages: 1,
					complete: true,
					assurance: "host-evidence",
					text: JSON.stringify(packet),
				},
			},
		},
	};
	return { packet, envelope, sha256, document, call };
}

test("captures canonical original packet bytes from complete host pages", () => {
	const fixture = packetFixture();
	const observations = collectReviewerPacketBytes(
		[fixture.call],
		[fixture.document],
	);
	expect(observations).toHaveLength(1);
	const observed = observations[0];
	if (observed?.kind !== "observed")
		throw new Error("Expected original packet bytes");
	const decoded = decodeReviewerPacket(observed.envelopeBase64);
	expect(decoded.sha256).toBe(fixture.sha256);
	expect(decoded.packetText).toBe(JSON.stringify(fixture.packet));
	expect(JSON.stringify(decoded.packet)).toBe(JSON.stringify(fixture.packet));
});

test("missing diff page records explicit unavailable packet", () => {
	const fixture = packetFixture();
	expect(collectReviewerPacketBytes([], [fixture.document])).toEqual([
		{
			kind: "unavailable",
			assignmentId: "review:fixture",
			sourceDigest: digest,
			reason: "missing-pages",
		},
	]);
});

async function accessFixture(
	approvedPlan: Plan = plan,
	command = "bun test",
	scope: "focused" | "broad" = "broad",
) {
	const repository = new MemorySessionRepository();
	const flow = await approveSession(repository, deterministicEnvironment(), {
		plan: approvedPlan,
	});
	await startReviewedRun(flow, repository, {
		suffix: "reviewer-access",
		command,
		scope,
	});
	const pending = repository.session;
	if (!pending?.runs[0]?.reviews[0])
		throw new Error("Missing genuine pending assignment");
	const run = pending.runs[0],
		review = run.reviews[0];
	if (!review) throw new Error("Missing review");
	const packet = {
		...packetFixture().packet,
		sessionId: pending.id,
		featureId: run.featureId,
		runId: run.id,
		sourceDigest: review.sourceDigest,
	};
	const envelope = JSON.stringify({
		owner: "flow-review-evidence",
		version: 1,
		kind: "packet",
		packet,
	});
	const evidence = {
		version: 1 as const,
		sha256:
			`sha256:${createHash("sha256").update(envelope).digest("hex")}` as `sha256:${string}`,
	};
	const context = reviewerProjection(
		{
			...pending,
			runs: [
				{
					...run,
					baseline: { version: 1, sha256: digest },
					reviews: [{ ...review, evidence }],
				},
			],
		},
		review.id,
	);
	await submitReview(flow, repository, {
		suffix: "reviewer-access",
		summary: "Approved implementation",
		verdict: "passed",
	});
	const submitted = repository.session;
	if (!submitted?.runs[0]) throw new Error("Missing submitted run");
	repository.session = {
		...submitted,
		runs: submitted.runs.map((value) => ({
			...value,
			baseline: { version: 1, sha256: digest },
			reviews: value.reviews.map((value) => ({ ...value, evidence })),
		})),
	};
	const document = repository.session;
	if (!document) throw new Error("Missing submitted state");
	const completedRun = document.runs[0],
		accepted = completedRun?.reviews[0];
	if (!completedRun || !accepted?.result)
		throw new Error("Missing accepted review");
	const output = (projection: unknown, reviewerPager?: unknown) => ({
		status: "ok",
		workflowData: { projection, ...(reviewerPager ? { reviewerPager } : {}) },
	});
	const pager = {
		assignmentId: review.id,
		contextPages: 1,
		diffPages: 1,
		chunkBytes: 8192,
		assurance: "host-evidence",
	};
	const call = (
		tool: string,
		index: number,
		input: Record<string, unknown>,
		value: unknown,
	) => ({
		tool,
		status: "completed" as const,
		sessionIndex: 1,
		agent: "flow-reviewer",
		input,
		output: value,
		rawOutput: JSON.stringify(value),
		metadata: {},
		native: {
			sessionId: "ses_child",
			messageId: `msg_child_${index}`,
			partId: `prt_child_${index}`,
			partIndex: 0,
			callId: `call_${index}`,
			startedAt: 10 + index * 2,
			completedAt: 11 + index * 2,
		},
	});
	const calls = [
		call(
			"flow_status",
			0,
			{ request: { view: "reviewer", assignmentId: review.id } },
			output(context, pager),
		),
		call(
			"flow_status",
			1,
			{
				request: {
					view: "reviewer-evidence",
					assignmentId: review.id,
					part: "diff",
					page: 0,
				},
			},
			output({
				view: "reviewer-evidence",
				sessionId: pending.id,
				revision: review.createdRevision,
				assignmentId: review.id,
				sourceDigest: review.sourceDigest,
				part: "diff",
				page: 0,
				totalPages: 1,
				complete: true,
				assurance: "host-evidence",
				text: JSON.stringify(packet),
			}),
		),
		call(
			"flow_feature_complete",
			2,
			{
				request: {
					assignmentId: review.id,
					featureId: run.featureId,
					result: {
						verdict: "passed",
						terminalDisposition: "submitted",
						findings: [],
					},
				},
			},
			{
				status: "ok",
				workflowData: {
					operation: {
						replayed: false,
						revision: accepted.result.recordedRevision,
						entity: completedRun,
					},
				},
			},
		),
	];
	const rootUser = {
		info: {
			id: "msg_root",
			sessionID: "ses_root",
			role: "user",
			time: { created: 1 },
		},
		parts: [
			{
				id: "prt_root",
				sessionID: "ses_root",
				messageID: "msg_root",
				type: "text",
				text: "Complete the approved task",
			},
			{
				id: "prt_mark",
				sessionID: "ses_root",
				messageID: "msg_root",
				type: "text",
				text: "Flow",
				synthetic: true,
				metadata: { "opencode-plugin-flow/auto": "one-task-token" },
			},
		],
	};
	const childUser = {
		info: {
			id: "msg_child_user",
			sessionID: "ses_child",
			role: "user",
			time: { created: 2 },
		},
		parts: [
			{
				id: "prt_child_user",
				sessionID: "ses_child",
				messageID: "msg_child_user",
				type: "text",
				text: "Review the assignment",
			},
		],
	};
	const childMessages = calls.map((item, index) => ({
		info: {
			id: item.native.messageId,
			sessionID: "ses_child",
			role: "assistant",
			parentID: "msg_child_user",
			agent: "flow-reviewer",
			time: { created: 3 + index },
		},
		parts: [
			{
				id: item.native.partId,
				sessionID: "ses_child",
				messageID: item.native.messageId,
				callID: item.native.callId,
				type: "tool",
				tool: item.tool,
				state: {
					status: "completed",
					time: { start: item.native.startedAt, end: item.native.completedAt },
				},
			},
		],
	}));
	const hostTrace = collectHostTrace({
		directory: "/workspace",
		childrenComplete: true,
		runnerRootSessionIds: ["ses_root"],
		sessionMetadata: [
			{ id: "ses_root", directory: "/workspace" },
			{
				id: "ses_child",
				directory: "/workspace",
				parentID: "ses_root",
				agent: "flow-reviewer",
			},
		],
		sessionMessages: [
			{ sessionId: "ses_root", messages: [rootUser] },
			{ sessionId: "ses_child", messages: [childUser, ...childMessages] },
		],
	});
	const packetBytes = collectReviewerPacketBytes(calls, [document]);
	return {
		input: {
			hostTrace,
			packetBytes,
			allCalls: calls,
			flowCalls: calls,
			session: document,
			archives: [],
			finalText: "Complete",
		},
		document,
	};
}

test("complete inline context and bound diff read before child submission pass", async () => {
	const fixture = await accessFixture();
	expect(checkAutonomousLineage(fixture.input)).toEqual([]);
	expect(checkReviewerEvidenceAccess(fixture.input, fixture.document)).toEqual(
		[],
	);
});

async function narrativeReviewFixture(kind: "final" | "feature") {
	const command = "node scripts/verify.mjs";
	const first = plan.features[0];
	if (!first) throw new Error("Missing runtime feature");
	const approvedPlan: Plan = {
		...plan,
		features: [
			{
				...first,
				validation: [
					"node scripts/verify.mjs passes for token and report behavior, including duplicate tokens and null; inspect source and diff before independent review.",
				],
			},
			...(kind === "feature"
				? [{ ...first, id: "later-feature", dependsOn: [first.id] }]
				: []),
		],
		evidence: plan.evidence?.map((entry) => ({ ...entry, command })),
	};
	return accessFixture(
		approvedPlan,
		command,
		kind === "final" ? "broad" : "focused",
	);
}

for (const kind of ["final", "feature"] as const) {
	test(`runtime-accepted ${kind} review treats legacy validation narrative as prose`, async () => {
		const fixture = await narrativeReviewFixture(kind);
		const run = fixture.document.runs[0],
			assignment = run?.reviews[0];
		if (!run || !assignment) throw new Error("Missing runtime review");
		expect(
			reviewReadiness(fixture.document, run, assignment.sourceDigest),
		).toMatchObject({ kind: "ready", reviewKind: kind });
		expect(assignment).toMatchObject({
			kind,
			result: { verdict: "passed", terminalDisposition: "submitted" },
		});
		expect(
			checkReviewerEvidenceAccess(fixture.input, fixture.document),
		).toEqual([]);
	});
	for (const invalid of ["no-evidence", "observe-only"] as const) {
		test(`legacy ${kind} narrative cannot admit ${invalid}`, async () => {
			const fixture = await narrativeReviewFixture(kind);
			const input = structuredClone(fixture.input),
				document = structuredClone(fixture.document);
			const run = document.runs[0],
				assignment = run?.reviews[0];
			if (!run || !assignment) throw new Error("Missing evidence control");
			if (invalid === "no-evidence") {
				run.validations = [];
				assignment.validationIds = [];
			} else
				for (const observation of run.validations)
					observation.intent = "observe";
			expect(
				reviewReadiness(document, run, assignment.sourceDigest).kind,
			).not.toBe("ready");
			synchronizeContext(input, document);
			expect(checkReviewerEvidenceAccess(input, document)).not.toEqual([]);
		});
	}
}

function retainedAccessEvidence(
	input: Awaited<ReturnType<typeof accessFixture>>["input"],
) {
	const value = {
		schemaVersion: 1,
		attempt: {
			attemptId: "attempt-cell-native-access",
			cellId: "cell-native-access",
			caseId: "native-access",
			repetition: 0,
			model: normalizeRequestedModel({
				modelId: "openai/gpt-6-sol",
				gateway: null,
				family: "gpt-6-sol",
				revision: null,
			}),
		},
		actors: [],
		guidanceLoads: [],
		gradeInput: { schemaVersion: 1, ...input },
		usage: { durationMs: 100, outputTokens: 200, costUsd: null },
		failure: null,
	};
	const transcript = redactTranscript({ value, projectPath: "/workspace" });
	return RetainedScenarioEvidenceSchema.parse(JSON.parse(transcript.text));
}

test("redacted retained native evidence preserves nulls, token digests and reviewer grading", async () => {
	const { input } = await accessFixture();
	const firstCall = input.allCalls[0];
	if (!firstCall) throw new Error("Missing reviewer call");
	firstCall.metadata = { accessToken: "raw-access", api_key: "raw-key" };
	const evidence = retainedAccessEvidence(input);
	const trace = evidence.gradeInput.hostTrace;
	const root = trace?.kind === "observed" ? trace.messages[0] : null;
	if (root?.role !== "user") throw new Error("Missing retained root request");
	expect(root.parts.map((part) => part.flowTokenSha256)).toEqual([
		null,
		"sha256:cf5adbc869d30049269d2bec7d9633d0896c3316c48ccb953d7aa319cb854ec4",
	]);
	expect(evidence.gradeInput.allCalls[0]?.metadata).toEqual({
		accessToken: "[redacted]",
		api_key: "[redacted]",
	});
	const outcome = deriveConformanceOutcome({
		evidence,
		check: (gradeInput) => [
			...checkAutonomousLineage(gradeInput),
			...checkReviewerEvidenceAccess(gradeInput, gradeInput.session),
		],
		scenarioId: "native-access",
		model: "openai/gpt-6-sol",
		attempt: 0,
	});
	expect(outcome.passed).toBe(true);
	expect(outcome.issues).toEqual([]);
});

test("redacted retained native evidence distinguishes matching, mismatched and missing continuations", async () => {
	for (const continuation of ["matching", "mismatched", "missing"] as const) {
		const { input } = await accessFixture();
		if (input.hostTrace.kind !== "observed")
			throw new Error("Missing observed trace");
		const root = input.hostTrace.messages[0];
		if (root?.role !== "user" || !root.parts[1])
			throw new Error("Missing root request marker");
		input.hostTrace.messages.push({
			id: "msg_continuation",
			sessionId: root.sessionId,
			order: 1,
			created: 20,
			role: "user",
			parts: [
				{
					...root.parts[1],
					id: "prt_continuation",
					partIndex: 0,
					flowTokenSha256:
						continuation === "matching"
							? root.parts[1].flowTokenSha256
							: continuation === "missing"
								? null
								: `sha256:${"b".repeat(64)}`,
				},
			],
		});
		const evidence = retainedAccessEvidence(input);
		expect(checkAutonomousLineage(evidence.gradeInput)).toEqual(
			continuation === "matching"
				? []
				: continuation === "mismatched"
					? ["Unknown or mismatched synthetic Flow continuation."]
					: [
							"Unknown or mismatched synthetic Flow continuation.",
							"Unclassified native root user message.",
						],
		);
	}
});

test("source-file read without diff pages cannot pass reviewer access", async () => {
	const fixture = await accessFixture();
	const calls = fixture.input.allCalls.filter(
		(call) => !("part" in (call.input.request as Record<string, unknown>)),
	);
	expect(
		checkReviewerEvidenceAccess(
			{ ...fixture.input, allCalls: calls, flowCalls: calls },
			fixture.document,
		),
	).not.toEqual([]);
});

function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected fixture object");
	return value as Record<string, unknown>;
}

test.each([
	"missing-native",
	"manager-agent",
	"late-read",
	"missing-context",
	"page-error",
	"wrong-source",
	"wrong-assignment",
	"wrong-count",
	"false-complete",
	"forged-completion",
	"stale-validation",
	"wrong-byte-ref",
])("reviewer access rejects %s", async (mutant) => {
	const fixture = await accessFixture();
	const input = structuredClone(fixture.input),
		document = structuredClone(fixture.document);
	const header = input.allCalls[0],
		page = input.allCalls[1],
		submit = input.allCalls[2];
	if (!header || !page || !submit || !document.runs[0])
		throw new Error("Missing access fixture calls");
	const projection = object(object(page.output).workflowData).projection;
	switch (mutant) {
		case "missing-native":
			delete object(submit).native;
			break;
		case "manager-agent":
			submit.agent = "build";
			break;
		case "late-read":
			page.native.completedAt = submit.native.startedAt + 1;
			break;
		case "missing-context":
			object(object(header.output).workflowData).projection = {};
			break;
		case "page-error":
			object(page.output).status = "error";
			break;
		case "wrong-source":
			object(projection).sourceDigest = `sha256:${"b".repeat(64)}`;
			break;
		case "wrong-assignment":
			object(projection).assignmentId = "review:wrong";
			break;
		case "wrong-count":
			object(projection).totalPages = 2;
			break;
		case "false-complete":
			object(projection).complete = false;
			break;
		case "forged-completion":
			object(object(submit.output).workflowData).operation = {
				replayed: true,
				revision: document.revision,
				entity: document.runs[0],
			};
			break;
		case "stale-validation":
			object(document.runs[0].validations[0]).sourceDigest =
				`sha256:${"b".repeat(64)}`;
			break;
		case "wrong-byte-ref":
			object(document.runs[0].reviews[0]?.evidence).sha256 =
				`sha256:${"b".repeat(64)}`;
			break;
	}
	expect(checkReviewerEvidenceAccess(input, document)).not.toEqual([]);
});

test("retained privacy transform keeps original SHA while proving each diff page", async () => {
	const fixture = await accessFixture();
	const input = ScenarioGradeInputSchema.parse(
		pseudonymizeEvalIds({ schemaVersion: 1, ...fixture.input }),
	);
	const document = pseudonymizeEvalIds(fixture.document);
	expect(checkAutonomousLineage(input)).toEqual([]);
	expect(checkReviewerEvidenceAccess(input, document)).toEqual([]);
	expect(input.packetBytes?.[0]).toEqual(
		fixture.input.packetBytes[0]?.kind === "observed"
			? {
					...fixture.input.packetBytes[0],
					assignmentId: pseudonymizeEvalIds(
						fixture.input.packetBytes[0].assignmentId,
					),
				}
			: fixture.input.packetBytes[0],
	);
});

test("complete inspect-kind inline projection omits kind only from planContext", async () => {
	const fixture = await accessFixture();
	const document = structuredClone(fixture.document),
		input = structuredClone(fixture.input);
	const feature = document.plan?.features[0],
		header = input.allCalls[0];
	if (!feature || !header) throw new Error("Missing feature");
	object(feature).kind = "inspect";
	const context = object(object(header.output).workflowData).projection;
	object(object(context).feature).kind = "inspect";
	expect(checkReviewerEvidenceAccess(input, document)).toEqual([]);
});

test("gate pass cannot be split across focused pass and broad failed observation", async () => {
	const fixture = await accessFixture(),
		document = structuredClone(fixture.document);
	const run = document.runs[0],
		assignment = run?.reviews[0],
		validation = run?.validations[0];
	if (!run || !assignment || !validation) throw new Error("Missing validation");
	object(validation).scope = "focused";
	run.validations.push({
		...validation,
		id: "broad-observe",
		scope: "broad",
		intent: "observe",
		exitCode: 12,
	});
	assignment.validationIds.push("broad-observe");
	expect(checkReviewerEvidenceAccess(fixture.input, document)).not.toEqual([]);
});

test("typed other-platform check cannot accept Linux evidence", async () => {
	const fixture = await accessFixture(),
		document = structuredClone(fixture.document);
	const feature = document.plan?.features[0];
	if (!feature) throw new Error("Missing feature");
	object(feature).checks = [
		{ command: "bun test", intent: "pass", platform: "other" },
	];
	expect(checkReviewerEvidenceAccess(fixture.input, document)).not.toEqual([]);
});

function synchronizeContext(
	input: Awaited<ReturnType<typeof accessFixture>>["input"],
	document: Awaited<ReturnType<typeof accessFixture>>["document"],
	runIndex = 0,
	callOffset = 0,
) {
	const run = document.runs[runIndex],
		assignment = run?.reviews[0],
		header = input.allCalls[callOffset],
		submit = input.allCalls[callOffset + 2];
	if (!run || !assignment || !header || !submit || !document.plan)
		throw new Error("Missing review fixture");
	const projection = object(object(header.output).workflowData).projection;
	const context = object(projection);
	context.planContext = {
		...document.plan,
		features: document.plan.features.map((feature) => {
			const { kind: _kind, ...fields } = feature;
			return fields;
		}),
	};
	context.feature = document.plan.features.find(
		(feature) => feature.id === run.featureId,
	);
	context.assignment = { ...assignment, result: null };
	context.validations = run.validations.filter((validation) =>
		assignment.validationIds.includes(validation.id),
	);
	context.artifactsChanged = run.artifactsChanged;
	context.completedFeatureIds = document.runs
		.filter(
			(previous) =>
				previous.featureId !== run.featureId &&
				previous.reviews.some(
					(review) =>
						review.result !== null &&
						review.result.recordedRevision < assignment.createdRevision,
				),
		)
		.map((previous) => previous.featureId);
	object(object(object(submit.output).workflowData).operation).entity = run;
}

test("two completed runs accept focused feature proof before final broad gate", async () => {
	const fixture = await accessFixture(),
		document = structuredClone(fixture.document),
		input = structuredClone(fixture.input);
	const first = document.runs[0],
		firstReview = first?.reviews[0],
		firstValidation = first?.validations[0],
		feature = document.plan?.features[0];
	if (
		!first ||
		!firstReview ||
		!firstValidation ||
		!feature ||
		!document.plan ||
		input.hostTrace.kind !== "observed"
	)
		throw new Error("Missing first feature");
	object(firstReview).kind = "feature";
	object(firstValidation).command = "node first-unit";
	object(firstValidation).scope = "focused";
	object(feature).validation = ["node first-unit"];
	const secondFeature = {
		...feature,
		id: "second",
		title: "Second feature",
		validation: ["bun test"],
		dependsOn: [feature.id],
	};
	document.plan.features.push(secondFeature);
	const secondValidation = {
		...firstValidation,
		id: "validation-second",
		featureId: "second",
		runId: "run-second",
		command: "bun test",
		scope: "broad" as const,
		recordedRevision: 8,
	};
	const packet = {
		...packetFixture().packet,
		sessionId: document.id,
		featureId: "second",
		runId: "run-second",
	};
	const envelope = JSON.stringify({
		owner: "flow-review-evidence",
		version: 1,
		kind: "packet",
		packet,
	});
	const evidence = {
		version: 1 as const,
		sha256:
			`sha256:${createHash("sha256").update(envelope).digest("hex")}` as `sha256:${string}`,
	};
	const secondReview = {
		...firstReview,
		id: "review:second",
		featureId: "second",
		runId: "run-second",
		kind: "final" as const,
		createdRevision: 9,
		validationIds: [secondValidation.id],
		evidence,
		result: {
			verdict: "passed" as const,
			terminalDisposition: "submitted" as const,
			findings: [],
			recordedRevision: 10,
		},
	};
	const second = {
		...first,
		id: "run-second",
		featureId: "second",
		startedRevision: 7,
		validations: [secondValidation],
		reviews: [secondReview],
	};
	document.runs.push(second);
	object(document).revision = 10;
	const secondCalls = input.allCalls.map((call, index) => {
		const copy = structuredClone(call);
		copy.native = {
			...copy.native,
			messageId: `msg_second_${index}`,
			partId: `prt_second_${index}`,
			callId: `call_second_${index}`,
			startedAt: 20 + index * 2,
			completedAt: 21 + index * 2,
		};
		object(copy.input.request).assignmentId = secondReview.id;
		object(copy.input.request).featureId = "second";
		const workflow = object(object(copy.output).workflowData);
		if (index === 1) object(workflow.projection).text = JSON.stringify(packet);
		if (index === 1) {
			object(workflow.projection).assignmentId = secondReview.id;
			object(workflow.projection).revision = 9;
		}
		if (index === 0)
			object(workflow.reviewerPager).assignmentId = secondReview.id;
		if (index === 2) object(workflow.operation).revision = 10;
		return copy;
	});
	input.allCalls.push(...secondCalls);
	input.flowCalls = input.allCalls;
	input.packetBytes = [
		...input.packetBytes,
		{
			kind: "observed",
			assignmentId: secondReview.id,
			sourceDigest: secondReview.sourceDigest,
			envelopeBase64: Buffer.from(envelope).toString("base64"),
		},
	];
	input.hostTrace.messages.push(
		...secondCalls.map((call, index) => ({
			id: call.native.messageId,
			sessionId: "ses_child",
			role: "assistant" as const,
			order: 4 + index,
			created: 6 + index,
			parentId: "msg_child_user",
			agent: "flow-reviewer",
			summary: false,
			tools: [{ ...call.native, tool: call.tool, status: call.status }],
		})),
	);
	synchronizeContext(input, document, 0, 0);
	synchronizeContext(input, document, 1, 3);
	expect(checkReviewerEvidenceAccess(input, document)).toEqual([]);
	object(secondValidation).scope = "focused";
	synchronizeContext(input, document, 1, 3);
	expect(checkReviewerEvidenceAccess(input, document)).not.toEqual([]);
});

test("final label and declared extra evidence cannot bypass broad final proof", async () => {
	for (const mutant of [
		"false-feature-label",
		"missing-extra",
		"focused-only",
	]) {
		const fixture = await accessFixture(),
			document = structuredClone(fixture.document),
			input = structuredClone(fixture.input);
		const run = document.runs[0],
			review = run?.reviews[0],
			validation = run?.validations[0];
		if (!run || !review || !validation || !document.plan)
			throw new Error("Missing final run");
		if (mutant === "false-feature-label") object(review).kind = "feature";
		if (mutant === "focused-only") object(validation).scope = "focused";
		if (mutant === "missing-extra")
			document.plan.evidence?.push({
				scope: "extra",
				command: "node extra-proof",
				requirement: "Extra proof",
				environment: "Local",
				platform: "other",
				assertions: [],
			});
		synchronizeContext(input, document);
		expect(checkReviewerEvidenceAccess(input, document)).not.toEqual([]);
	}
});

test.each([
	"noncanonical-base64",
	"invalid-utf8",
	"wrong-envelope",
	"secret-shaped",
	"oversized",
])("original packet decode rejects %s", (mutant) => {
	const fixture = packetFixture();
	let text = fixture.envelope;
	if (mutant === "wrong-envelope")
		text = text.replace("flow-review-evidence", "manager-claimed");
	if (mutant === "secret-shaped") {
		const packet = {
			...fixture.packet,
			changes: [
				{
					path: "fixture.txt",
					before: { kind: "file", mode: 420, digest },
					after: { kind: "file", mode: 420, digest },
					binary: false,
					preexistingDirty: false,
					diff: `api_key: sk-${"a".repeat(32)}`,
				},
			],
		};
		expect(ReviewerPacketSchema.safeParse(packet).success).toBe(true);
		text = JSON.stringify({
			owner: "flow-review-evidence",
			version: 1,
			kind: "packet",
			packet,
		});
	}
	let base64 =
		mutant === "invalid-utf8"
			? Buffer.from([255]).toString("base64")
			: Buffer.from(text).toString("base64");
	if (mutant === "noncanonical-base64") base64 += "\n";
	if (mutant === "oversized") base64 = "A".repeat(6 * 1024 * 1024);
	expect(() => decodeReviewerPacket(base64)).toThrow();
});

test("retained packet observations reject duplicate IDs and decoded hidden secrets", async () => {
	const fixture = packetFixture(),
		observation = collectReviewerPacketBytes(
			[fixture.call],
			[fixture.document],
		)[0];
	if (observation?.kind !== "observed")
		throw new Error("Missing original packet observation");
	const base = {
		schemaVersion: 1,
		flowCalls: [],
		allCalls: [],
		session: null,
		archives: [],
		finalText: "",
	};
	expect(
		ScenarioGradeInputSchema.safeParse({
			...base,
			packetBytes: [observation, observation],
		}).success,
	).toBe(false);
	const secretPacket = {
		...fixture.packet,
		changes: [
			{
				path: "fixture.txt",
				before: { kind: "file", mode: 420, digest },
				after: { kind: "file", mode: 420, digest },
				binary: false,
				preexistingDirty: false,
				diff: "password: secretvalue12345",
			},
		],
	};
	expect(ReviewerPacketSchema.safeParse(secretPacket).success).toBe(true);
	const secretEnvelope = JSON.stringify({
		owner: "flow-review-evidence",
		version: 1,
		kind: "packet",
		packet: secretPacket,
	});
	expect(
		ScenarioGradeInputSchema.safeParse({
			...base,
			packetBytes: [
				{
					...observation,
					envelopeBase64: Buffer.from(secretEnvelope).toString("base64"),
				},
			],
		}).success,
	).toBe(false);
});

test("aggregate packet capture budget makes further assignments explicitly unavailable", () => {
	const fixture = packetFixture(),
		calls: (typeof fixture.call)[] = [],
		documents: (typeof fixture.document)[] = [];
	for (let index = 0; index < 2; index++) {
		const packet = {
			...fixture.packet,
			changes: [
				{
					path: "fixture.txt",
					before: { kind: "file", mode: 420, digest },
					after: { kind: "file", mode: 420, digest },
					binary: false,
					preexistingDirty: false,
					diff: "x".repeat(3 * 1024 * 1024),
				},
			],
		};
		const text = JSON.stringify(packet),
			envelope = JSON.stringify({
				owner: "flow-review-evidence",
				version: 1,
				kind: "packet",
				packet,
			});
		const id = `review:budget${index}`;
		const document = structuredClone(fixture.document);
		const assignment = document.runs[0]?.reviews[0];
		if (!assignment) throw new Error("Missing fixture assignment");
		assignment.id = id;
		assignment.evidence.sha256 = `sha256:${createHash("sha256").update(envelope).digest("hex")}`;
		documents.push(document);
		const pages = text.match(/[\s\S]{1,2048}/g) ?? [];
		for (const [page, chunk] of pages.entries()) {
			const call = structuredClone(fixture.call);
			call.output.workflowData.projection = {
				...call.output.workflowData.projection,
				assignmentId: id,
				text: chunk,
				page,
				totalPages: pages.length,
			};
			calls.push(call);
		}
	}
	const observations = collectReviewerPacketBytes(calls, documents);
	expect(
		observations.map((value) =>
			value.kind === "observed" ? "observed" : value.reason,
		),
	).toEqual(["observed", "limits-exceeded"]);
});

test("paged UTF-8 context and diff with identical page rereads pass", async () => {
	const fixture = await accessFixture(),
		input = structuredClone(fixture.input),
		document = structuredClone(fixture.document);
	const header = input.allCalls[0],
		diff = input.allCalls[1],
		submit = input.allCalls[2],
		run = document.runs[0],
		assignment = run?.reviews[0];
	if (!header || !diff || !submit || !run || !assignment)
		throw new Error("Missing paged fixture");
	const context = object(object(header.output).workflowData).projection;
	const fullContext: Record<string, unknown> = {
		...object(context),
		goal: "😀".repeat(1500),
	};
	object(document).goal = fullContext.goal;
	const contextPages = reviewPacketPages(JSON.stringify(fullContext));
	const packet = {
		...packetFixture().packet,
		sessionId: document.id,
		runId: run.id,
		featureId: run.featureId,
		changes: [
			{
				path: "fixture.txt",
				before: { kind: "file", mode: 420, digest },
				after: { kind: "file", mode: 420, digest },
				binary: false,
				preexistingDirty: false,
				diff: "",
			},
		],
	};
	const emptyPacketText = JSON.stringify(packet);
	const contentOffset = emptyPacketText.indexOf('"diff":"') + '"diff":"'.length;
	const changedFile = packet.changes[0];
	if (!changedFile) throw new Error("Missing changed file");
	changedFile.diff =
		" ".repeat((2045 - (contentOffset % 2048) + 2048) % 2048) +
		"session:abcdef1234" +
		"😀".repeat(1600);
	const envelope = JSON.stringify({
		owner: "flow-review-evidence",
		version: 1,
		kind: "packet",
		packet,
	});
	const evidence = {
		version: 1,
		sha256: `sha256:${createHash("sha256").update(envelope).digest("hex")}`,
	};
	object(assignment).evidence = evidence;
	object(fullContext.assignment).evidence = evidence;
	const correctedContextPages = reviewPacketPages(JSON.stringify(fullContext));
	const diffPages = reviewPacketPages(JSON.stringify(packet));
	expect(diffPages[0]?.endsWith("ses")).toBe(true);
	expect(diffPages[1]?.startsWith("sion:abcdef1234")).toBe(true);
	object(object(header.output).workflowData).projection = {
		view: "reviewer",
		sessionId: document.id,
		inlineContext: "paged",
		assignment: { id: assignment.id },
	};
	object(object(header.output).workflowData).reviewerPager = {
		assignmentId: assignment.id,
		contextPages: correctedContextPages.length,
		diffPages: diffPages.length,
		chunkBytes: 8192,
		assurance: "host-evidence",
	};
	const reads = [
		...correctedContextPages.map((text, page) => ({
			part: "context",
			text,
			page,
			totalPages: correctedContextPages.length,
		})),
		...diffPages.map((text, page) => ({
			part: "diff",
			text,
			page,
			totalPages: diffPages.length,
		})),
		{
			part: "diff",
			text: diffPages[0] ?? "",
			page: 0,
			totalPages: diffPages.length,
		},
	];
	const calls = [
		header,
		...reads.map((page, index) => ({
			...structuredClone(diff),
			native: {
				...diff.native,
				messageId: `msg_page_${index}`,
				partId: `prt_page_${index}`,
				callId: `call_page_${index}`,
				startedAt: 12 + index * 2,
				completedAt: 13 + index * 2,
			},
			output: {
				status: "ok",
				workflowData: {
					projection: {
						view: "reviewer-evidence",
						sessionId: document.id,
						assignmentId: assignment.id,
						sourceDigest: assignment.sourceDigest,
						complete: true,
						assurance: "host-evidence",
						...page,
					},
				},
			},
		})),
		submit,
	];
	submit.native = {
		...submit.native,
		messageId: "msg_submit_pages",
		partId: "prt_submit_pages",
		startedAt: 20 + reads.length * 2,
		completedAt: 21 + reads.length * 2,
	};
	object(object(object(submit.output).workflowData).operation).entity = run;
	input.allCalls = calls;
	input.flowCalls = calls;
	input.packetBytes = [
		{
			kind: "observed",
			assignmentId: assignment.id,
			sourceDigest: assignment.sourceDigest,
			envelopeBase64: Buffer.from(envelope).toString("base64"),
		},
	];
	if (input.hostTrace.kind !== "observed")
		throw new Error("Missing native trace");
	input.hostTrace.messages = input.hostTrace.messages.filter(
		(message) => message.role === "user",
	);
	input.hostTrace.messages.push(
		...calls.map((call, index) => ({
			id: call.native.messageId,
			sessionId: "ses_child",
			role: "assistant" as const,
			order: 1 + index,
			created: 3 + index,
			parentId: "msg_child_user",
			agent: "flow-reviewer",
			summary: false,
			tools: [{ ...call.native, tool: call.tool, status: call.status }],
		})),
	);
	expect(contextPages.length).toBeGreaterThan(1);
	expect(checkReviewerEvidenceAccess(input, document)).toEqual([]);
	const privateInput = ScenarioGradeInputSchema.parse(
		pseudonymizeEvalIds({ schemaVersion: 1, ...input }),
	);
	const privateDocument = pseudonymizeEvalIds(document);
	expect(checkReviewerEvidenceAccess(privateInput, privateDocument)).toEqual(
		[],
	);
	const joinedTransformPages = reviewPacketPages(
		pseudonymizeEvalIds(JSON.stringify(packet)),
	);
	const mutable = structuredClone(privateInput);
	for (const call of mutable.allCalls) {
		const projection = object(object(call.output).workflowData).projection;
		if (projection === undefined) continue;
		const page = object(projection);
		if (page.part === "diff" && typeof page.page === "number")
			page.text = joinedTransformPages[page.page];
	}
	expect(checkReviewerEvidenceAccess(mutable, privateDocument)).not.toEqual([]);
	const wrong = calls.find(
		(call) =>
			object(object(call.output).workflowData).projection &&
			object(object(object(call.output).workflowData).projection).part ===
				"diff",
	);
	if (!wrong) throw new Error("Missing diff page");
	object(object(object(wrong.output).workflowData).projection).text = "altered";
	expect(checkReviewerEvidenceAccess(input, document)).not.toEqual([]);
});

test("one-request lineage rejects unknown continuations and forged one-count inputs", async () => {
	for (const mutant of [
		"missing-trace",
		"missing-token",
		"wrong-token",
		"second-real",
		"compaction",
	]) {
		const fixture = await accessFixture(),
			input = structuredClone(fixture.input);
		if (mutant === "missing-trace") {
			delete object(input).hostTrace;
			expect(checkAutonomousLineage(input)).not.toEqual([]);
			continue;
		}
		if (input.hostTrace.kind !== "observed")
			throw new Error("Missing observed trace");
		const root = input.hostTrace.messages[0];
		if (root?.role !== "user") throw new Error("Missing root request");
		if (mutant === "missing-token")
			object(root.parts[1]).flowTokenSha256 = null;
		else {
			const part = {
				...root.parts[1],
				id: "prt_new",
				partIndex: 0,
				type: "text",
				synthetic: true,
				textBytes: 8,
				flowTokenSha256: root.parts[1]?.flowTokenSha256 ?? null,
				compactionContinue: null as boolean | null,
				automaticCompaction: null,
			};
			if (mutant === "wrong-token")
				part.flowTokenSha256 = `sha256:${"b".repeat(64)}`;
			if (mutant === "second-real") {
				part.synthetic = false;
				part.flowTokenSha256 = null;
			}
			if (mutant === "compaction") {
				part.compactionContinue = true;
			}
			input.hostTrace.messages.push({
				id: "msg_new",
				sessionId: "ses_root",
				order: 1,
				created: 20,
				role: "user",
				parts: [part],
			});
		}
		expect(checkAutonomousLineage(input)).not.toEqual([]);
	}
});

test("erased active feature and fabricated pre-review history are rejected", async () => {
	for (const mutant of [
		"feature",
		"completed",
		"amendments",
		"amendment-evidence",
	]) {
		const fixture = await accessFixture();
		const header = fixture.input.allCalls[0];
		if (!header) throw new Error("Missing header");
		const context = object(
			object(object(header.output).workflowData).projection,
		);
		if (mutant === "feature")
			context.feature = {
				id: object(context.feature).id,
				kind: object(context.feature).kind,
			};
		if (mutant === "completed") context.completedFeatureIds = ["not-completed"];
		if (mutant === "amendments") context.amendments = [{ fabricated: true }];
		if (mutant === "amendment-evidence")
			context.amendmentEvidence = [{ fabricated: true }];
		expect(
			checkReviewerEvidenceAccess(fixture.input, fixture.document),
		).not.toEqual([]);
	}
});

test("unchanged UUID session id still allows per-page native-id privacy transform", async () => {
	const fixture = await accessFixture(),
		input = structuredClone(fixture.input),
		document = structuredClone(fixture.document);
	const header = input.allCalls[0],
		page = input.allCalls[1],
		run = document.runs[0],
		review = run?.reviews[0];
	if (!header || !page || !run || !review) throw new Error("Missing review");
	object(document).id = "12345678-1234-1234-1234-123456789abc";
	const context = object(object(object(header.output).workflowData).projection);
	context.sessionId = document.id;
	const packet = {
		...packetFixture().packet,
		sessionId: document.id,
		runId: run.id,
		featureId: run.featureId,
		changes: [
			{
				path: "fixture.txt",
				before: { kind: "file", mode: 420, digest },
				after: { kind: "file", mode: 420, digest },
				binary: false,
				preexistingDirty: false,
				diff: "reference ses_nativeExample",
			},
		],
	};
	const envelope = JSON.stringify({
		owner: "flow-review-evidence",
		version: 1,
		kind: "packet",
		packet,
	});
	object(review).evidence = {
		version: 1,
		sha256: `sha256:${createHash("sha256").update(envelope).digest("hex")}`,
	};
	const projection = object(
		object(object(page.output).workflowData).projection,
	);
	projection.sessionId = document.id;
	projection.text = JSON.stringify(packet);
	synchronizeContext(input, document);
	input.packetBytes = collectReviewerPacketBytes(input.allCalls, [document]);
	expect(checkReviewerEvidenceAccess(input, document)).toEqual([]);
	const retained = ScenarioGradeInputSchema.parse(
		pseudonymizeEvalIds({ schemaVersion: 1, ...input }),
	);
	expect(
		checkReviewerEvidenceAccess(retained, pseudonymizeEvalIds(document)),
	).toEqual([]);
});

test.each(["missing", "skipped", "managed-path"])(
	"named cases require same-observation passing evidence: %s",
	async (mutant) => {
		const fixture = await accessFixture(),
			document = structuredClone(fixture.document),
			input = structuredClone(fixture.input);
		const feature = document.plan?.features[0],
			run = document.runs[0],
			validation = run?.validations[0];
		if (!feature || !run || !validation || !document.plan?.evidence?.[0])
			throw new Error("Missing evidence");
		const command = "bun test --reporter-outfile=.flow/results.xml";
		object(feature).checks = [
			{
				command,
				intent: "pass",
				platform: "linux",
				assertions: ["required-case"],
			},
		];
		object(feature).validation = [command];
		object(document.plan.evidence[0]).command = command;
		object(validation).command = command;
		object(validation).observedAssertions = [
			{ name: "required-case", status: "passed" },
		];
		object(validation).resultsPath = ".flow/results.xml";
		synchronizeContext(input, document);
		expect(checkReviewerEvidenceAccess(input, document)).toEqual([]);
		if (mutant === "missing") object(validation).observedAssertions = [];
		if (mutant === "skipped")
			object(validation).observedAssertions = [
				{ name: "required-case", status: "skipped" },
			];
		if (mutant === "managed-path")
			object(validation).resultsPath = "unbound.xml";
		synchronizeContext(input, document);
		expect(checkReviewerEvidenceAccess(input, document)).not.toEqual([]);
	},
);

test("prior blocker history is read before the passing review can clear it", async () => {
	const fixture = await accessFixture(),
		document = structuredClone(fixture.document),
		input = structuredClone(fixture.input);
	const run = document.runs[0],
		review = run?.reviews[0],
		header = input.allCalls[0];
	if (!run || !review || !header) throw new Error("Missing review");
	const prior = {
		...structuredClone(run),
		id: "run-prior",
		state: "superseded" as const,
		reviews: [
			{
				...structuredClone(review),
				id: "review:prior",
				createdRevision: 1,
				result: {
					verdict: "failed" as const,
					terminalDisposition: "submitted" as const,
					recordedRevision: 2,
					findings: [
						{
							findingId: "runtime-kernel.R1-01",
							severity: "blocking" as const,
							summary: "Guard missing",
							evidence: "fixture.ts:1",
						},
					],
				},
			},
		],
	};
	document.runs.unshift(prior);
	const context = object(object(object(header.output).workflowData).projection);
	context.priorFindings = [
		{
			findingId: "runtime-kernel.R1-01",
			severity: "blocking",
			summary: "Guard missing",
			evidence: "fixture.ts:1",
		},
	];
	expect(checkReviewerEvidenceAccess(input, document)).toEqual([]);
	context.priorFindings = [];
	expect(checkReviewerEvidenceAccess(input, document)).not.toEqual([]);
});
