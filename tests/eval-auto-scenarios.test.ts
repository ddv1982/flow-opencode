import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AUTO_SCENARIOS } from "../evals/auto-scenarios.js";
import {
	releaseAttemptsFor,
	releaseCaseCatalogSha256,
	releaseCatalog,
	releaseGraderSourceBundle,
	releasePolicySha256,
	releaseProfile,
} from "../evals/release-policy.js";
import { attemptsForScenario, releaseScenarios } from "../evals/run.js";
import { SCENARIOS } from "../evals/scenarios.js";
import packageJson from "../package.json" with { type: "json" };
import { autoQualifiedOutcome } from "./fixtures/auto-qualified-outcome.js";

for (const [kind, id] of [
	["two", "auto-two-features-evidence"],
	["prerequisite", "auto-prerequisite-repair"],
	["audit", "auto-observe-with-required-pass"],
] as const) {
	test(`${id} accepts source-bound completed evidence`, () => {
		const scenario = AUTO_SCENARIOS.find((value) => value.id === id);
		if (!scenario) throw new Error("Missing scenario");
		expect(scenario.check(autoQualifiedOutcome(kind))).toEqual([]);
	});
	test(`${id} rejects missing native provenance and changed immutable gate`, () => {
		const scenario = AUTO_SCENARIOS.find((value) => value.id === id);
		if (!scenario) throw new Error("Missing scenario");
		const absent = { ...autoQualifiedOutcome(kind) };
		delete absent.hostTrace;
		expect(scenario.check(absent)).not.toEqual([]);
		const changed = {
			...autoQualifiedOutcome(kind),
			workspaceChanges: {
				kind: "observed" as const,
				paths: ["scripts/verify.mjs"],
			},
		};
		expect(scenario.check(changed)).not.toEqual([]);
	});
	test(`${id} rejects fixture-allowed edits outside approved targets`, () => {
		const scenario = AUTO_SCENARIOS.find((value) => value.id === id);
		if (!scenario) throw new Error("Missing scenario");
		const fixture = structuredClone(autoQualifiedOutcome(kind));
		const document = object(fixture.archives[0]);
		const features = object(document.plan).features as Array<
			Record<string, unknown>
		>;
		const path = kind === "two" ? "src/report.mjs" : "src/parser.mjs";
		for (const feature of features)
			feature.targets = (feature.targets as string[]).filter(
				(target) => target !== path,
			);
		expect(scenario.check(fixture)).toContain(
			"Changed files exceed fixture or approved scope.",
		);
	});
}

test("approved literal directory target covers a changed fixture file", () => {
	const scenario = AUTO_SCENARIOS.find(
		(value) => value.id === "auto-observe-with-required-pass",
	);
	if (!scenario) throw new Error("Missing audit case");
	const fixture = structuredClone(autoQualifiedOutcome("audit"));
	const document = object(fixture.archives[0]);
	const plan = object(document.plan);
	const feature = object((plan.features as unknown[])[0]);
	feature.targets = ["src"];
	for (const call of [...fixture.allCalls, ...fixture.flowCalls]) {
		if (call.tool !== "flow_status") continue;
		const projection = object(object(call.output).workflowData).projection;
		if (object(projection).view !== "reviewer") continue;
		object(projection).feature = feature;
		object(projection).planContext = plan;
		object(call).rawOutput = JSON.stringify(call.output);
	}
	expect(scenario.check(fixture)).toEqual([]);
});

test("nonzero audit cannot be claimed as passed", () => {
	const scenario = AUTO_SCENARIOS.find(
		(value) => value.id === "auto-observe-with-required-pass",
	);
	if (!scenario) throw new Error("Missing audit case");
	expect(
		scenario.check({
			...autoQualifiedOutcome("audit"),
			finalText: "All checks passed. Audit passed.",
		}),
	).not.toEqual([]);
});

test("historical release policy and case catalog identities remain frozen", async () => {
	for (const [version, policy, catalog] of [
		[
			"9.1.0",
			"sha256:6146ace9217f1c0555e2e0d8c55c79b63f57534b0155f180dbd67e102b2cbd08",
			"sha256:134581f969e030f4194ff48f94e6df4d2fac5ebbd3af57f66cf430a32f7f7b6c",
		],
		[
			"9.2.0",
			"sha256:6146ace9217f1c0555e2e0d8c55c79b63f57534b0155f180dbd67e102b2cbd08",
			"sha256:134581f969e030f4194ff48f94e6df4d2fac5ebbd3af57f66cf430a32f7f7b6c",
		],
		[
			"9.3.0",
			"sha256:be567f530fc5d9e1c25519a22a2d96f9b82aeb3849fe032b4fe2bb6c847ff265",
			"sha256:b0bfc9d312ced4ec67b520b8fcaa3a71f9dd653e3bbb5dbb0edeb500716a9f03",
		],
	] as const) {
		expect(releasePolicySha256(version)).toBe(policy);
		expect(releaseCaseCatalogSha256(SCENARIOS, version)).toBe(catalog);
	}
});

test("9.4 uses an explicit OpenAI-only prospective catalog and versioned attempts", async () => {
	const catalog = releaseCatalog("9.4.0");
	expect(catalog).toHaveLength(12);
	expect(catalog.every((row) => row.minProviders === 1)).toBe(true);
	expect(
		releaseProfile("9.4.0").requiredModels?.map(
			(model) => `${model.routeProvider}/${model.model}`,
		),
	).toEqual(["openai/gpt-6-sol"]);
	expect(
		releaseScenarios("9.4.0")
			.map((scenario) => scenario.id)
			.slice(-3),
	).toEqual(AUTO_SCENARIOS.map((scenario) => scenario.id));
	expect(releaseAttemptsFor("auto-two-features-evidence", "9.4.0")).toBe(3);
	expect(
		attemptsForScenario("auto-two-features-evidence", {
			kind: "release",
			packageVersion: "9.4.0",
		}),
	).toBe(3);
	expect(() =>
		releaseAttemptsFor("auto-two-features-evidence", "9.3.0"),
	).toThrow();
});

test("implicit release sampling uses the current package version", () => {
	for (const policy of releaseCatalog(packageJson.version))
		expect(attemptsForScenario(policy.caseId, { kind: "release" })).toBe(
			policy.minScoredAttempts,
		);
});

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Expected fixture object");
	return value as Record<string, unknown>;
}

test("first-feature behavior proof must belong to its accepted review", () => {
	const scenario = AUTO_SCENARIOS.find(
		(value) => value.id === "auto-two-features-evidence",
	);
	if (!scenario) throw new Error("Missing two-feature case");
	const fixture = structuredClone(autoQualifiedOutcome("two"));
	const doc = object(fixture.archives[0]),
		run = object((doc.runs as unknown[])[0]),
		review = object((run.reviews as unknown[])[0]);
	review.validationIds = ["unrelated-proof"];
	expect(scenario.check(fixture)).not.toEqual([]);
});

test("outside-target prerequisite cannot be repaired without a bound accepted amendment", () => {
	const scenario = AUTO_SCENARIOS.find(
		(value) => value.id === "auto-prerequisite-repair",
	);
	if (!scenario) throw new Error("Missing prerequisite case");
	const fixture = structuredClone(autoQualifiedOutcome("prerequisite"));
	const doc = object(fixture.archives[0]),
		feature = object((object(doc.plan).features as unknown[])[0]);
	feature.targets = ["src/parser.mjs"];
	expect(scenario.check(fixture)).not.toEqual([]);
});

test("stale or zero audit data cannot replace the nonzero reviewed observation", () => {
	const scenario = AUTO_SCENARIOS.find(
		(value) => value.id === "auto-observe-with-required-pass",
	);
	if (!scenario) throw new Error("Missing audit case");
	for (const mutant of ["source", "exit"] as const) {
		const fixture = structuredClone(autoQualifiedOutcome("audit"));
		const doc = object(fixture.archives[0]),
			run = object((doc.runs as unknown[])[0]),
			observation = object((run.validations as unknown[])[0]);
		if (mutant === "source")
			observation.sourceDigest = `sha256:${"b".repeat(64)}`;
		else observation.exitCode = 0;
		expect(scenario.check(fixture)).not.toEqual([]);
	}
});

test("outside-target repair is accepted only with a source-bound failed-gate amendment", () => {
	const scenario = AUTO_SCENARIOS.find(
		(value) => value.id === "auto-prerequisite-repair",
	);
	if (!scenario) throw new Error("Missing prerequisite case");
	const fixture = structuredClone(autoQualifiedOutcome("prerequisite"));
	const doc = object(fixture.archives[0]),
		plan = object(doc.plan),
		feature = object((plan.features as unknown[])[0]),
		run = object((doc.runs as unknown[])[0]),
		review = object((run.reviews as unknown[])[0]);
	feature.targets = ["src/parser.mjs"];
	const validations = run.validations as Array<Record<string, unknown>>,
		pass = validations[0];
	if (!pass) throw new Error("Missing pass");
	pass.recordedRevision = 5;
	review.createdRevision = 6;
	object(review.result).recordedRevision = 7;
	const failed = {
		...pass,
		id: "failed-canonical",
		recordedRevision: 3,
		sourceDigest: `sha256:${"b".repeat(64)}`,
		exitCode: 1,
	};
	validations.unshift(failed);
	const amendment = {
		operationId: "amend-runtime",
		featureId: feature.id,
		runId: run.id,
		validationId: failed.id,
		targets: ["runtime.json"],
		sameGoal: true,
		reversible: true,
		reason: "Unsupported local format",
		repair: "Restore format 2",
		recordedRevision: 4,
	};
	doc.amendments = [amendment];
	const header = fixture.allCalls[0],
		submit = fixture.allCalls[2];
	if (!header || !submit) throw new Error("Missing calls");
	const context = object(object(header.output).workflowData).projection;
	object(context).feature = feature;
	object(context).planContext = plan;
	object(context).assignment = { ...review, result: null };
	object(context).validations = [pass];
	object(context).amendments = [amendment];
	object(context).amendmentEvidence = [failed];
	object(context).nextFindingIdPrefix = `${String(feature.id)}.R6`;
	object(object(object(submit.output).workflowData).operation).revision = 7;
	object(object(object(submit.output).workflowData).operation).entity = run;
	const native = {
		sessionId: "ses_root",
		messageId: "msg_amend",
		partId: "prt_amend",
		partIndex: 0,
		callId: "call_amend",
		startedAt: 10,
		completedAt: 11,
	};
	const call = {
		tool: "flow_plan_amend",
		status: "completed" as const,
		agent: "build",
		sessionIndex: 0,
		input: {
			request: {
				operationId: "amend-runtime",
				expectedRevision: 3,
				featureId: feature.id,
				validationId: failed.id,
				targets: ["runtime.json"],
				sameGoal: true,
				reversible: true,
				reason: "Unsupported local format",
				repair: "Restore format 2",
			},
		},
		output: {
			status: "ok",
			workflowData: {
				operation: {
					operationId: "amend-runtime",
					revision: 4,
					replayed: false,
					entity: amendment,
				},
			},
		},
		rawOutput: "",
		metadata: {},
		native,
	};
	const amended = {
		...fixture,
		allCalls: [call, ...fixture.allCalls],
		flowCalls: [call, ...fixture.flowCalls],
	};
	if (fixture.hostTrace?.kind !== "observed") throw new Error("Missing trace");
	const reviewStart = amended.allCalls.find(
		(value) => value.tool === "flow_review_start",
	);
	if (!reviewStart?.native) throw new Error("Missing review start");
	object(reviewStart.native).startedAt = 15;
	object(reviewStart.native).completedAt = 16;
	const reviewMessage = fixture.hostTrace.messages.find(
		(value) => value.id === reviewStart.native?.messageId,
	);
	if (reviewMessage?.role !== "assistant" || !reviewMessage.tools[0])
		throw new Error("Missing root review witness");
	object(reviewMessage).created = 15;
	object(reviewMessage.tools[0]).startedAt = 15;
	object(reviewMessage.tools[0]).completedAt = 16;
	fixture.hostTrace.messages.push({
		id: native.messageId,
		sessionId: "ses_root",
		role: "assistant",
		order: 0,
		created: 10,
		parentId: "msg_root",
		agent: "build",
		summary: false,
		tools: [{ ...native, tool: call.tool, status: call.status }],
	});
	const rootMessages = fixture.hostTrace.messages
		.filter((value) => value.sessionId === "ses_root")
		.sort((a, b) => a.created - b.created);
	rootMessages.forEach((value, index) => {
		object(value).order = index;
	});
	fixture.hostTrace.messages = [
		...rootMessages,
		...fixture.hostTrace.messages.filter(
			(value) => value.sessionId !== "ses_root",
		),
	];
	expect(scenario.check(amended)).toEqual([]);
	for (const mutant of [
		"native",
		"agent",
		"entity",
		"operation-id",
		"extra-target",
		"wrong-repair",
		"wrong-reason",
	]) {
		const changed = structuredClone(amended),
			proposal = changed.allCalls[0];
		if (!proposal) throw new Error("Missing amendment");
		if (mutant === "native") delete object(proposal).native;
		if (mutant === "agent") object(proposal).agent = "general";
		const request = object(proposal.input.request);
		if (mutant === "extra-target")
			request.targets = ["runtime.json", "unrelated-product-file.mjs"];
		if (mutant === "wrong-repair") request.repair = "Replace product outcome";
		if (mutant === "wrong-reason") request.reason = "Unrelated product work";
		const operation = object(
			object(object(proposal.output).workflowData).operation,
		);
		if (mutant === "entity") operation.entity = { unrelated: true };
		if (mutant === "operation-id") operation.operationId = "not-the-amendment";
		expect(scenario.check(changed)).not.toEqual([]);
	}
	object(call.output.workflowData.operation).replayed = true;
	expect(scenario.check(amended)).not.toEqual([]);
});

test("audit report must retain the observed advisory count", () => {
	const scenario = AUTO_SCENARIOS.find(
		(value) => value.id === "auto-observe-with-required-pass",
	);
	if (!scenario) throw new Error("Missing audit case");
	for (const finalText of [
		"Audit failed, required gate passed.",
		"Audit found 9 outstanding items, required gate passed.",
		"Audit found 9 outstanding items; required gate passed 12 assertions.",
		"Audit found 12 advisory items; audit found 9 more items.",
	])
		expect(
			scenario.check({ ...autoQualifiedOutcome("audit"), finalText }),
		).not.toEqual([]);
});

test("fixed gates distinguish broken baseline from required implemented behavior", async () => {
	for (const scenario of AUTO_SCENARIOS) {
		const root = await mkdtemp(join(tmpdir(), "text-project-"));
		try {
			for (const [path, text] of Object.entries(scenario.files)) {
				await mkdir(dirname(join(root, path)), { recursive: true });
				await writeFile(join(root, path), text);
			}
			expect(
				spawnSync("node", ["scripts/verify.mjs"], { cwd: root }).status,
			).not.toBe(0);
			if (scenario.id === "auto-two-features-evidence") {
				await writeFile(
					join(root, "src/tokens.mjs"),
					"export function tokens(input) { return (input ?? '').trim().split(/\\s+/).filter(Boolean); }\n",
				);
				await writeFile(
					join(root, "src/report.mjs"),
					"import {tokens} from './tokens.mjs'; export function report(input) { const values=tokens(input); return {total:values.length,unique:new Set(values).size}; }\n",
				);
				expect(
					spawnSync("node", ["scripts/check-tokens.mjs"], { cwd: root }).status,
				).toBe(0);
			} else {
				await writeFile(
					join(root, "src/parser.mjs"),
					"export function parse(input) { return (input ?? '').trim(); }\n",
				);
				if (scenario.id === "auto-prerequisite-repair")
					await writeFile(join(root, "runtime.json"), '{"formatVersion":2}\n');
				if (scenario.id === "auto-observe-with-required-pass")
					expect(
						spawnSync("node", ["scripts/audit.mjs"], { cwd: root }).status,
					).toBe(12);
			}
			expect(
				spawnSync("node", ["scripts/verify.mjs"], { cwd: root }).status,
			).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
});

test("completed archives require genuine primary close binding", () => {
	const scenario = AUTO_SCENARIOS.find(
		(value) => value.id === "auto-two-features-evidence",
	);
	if (!scenario) throw new Error("Missing case");
	for (const mutant of [
		"missing",
		"native",
		"agent",
		"entity",
		"revision",
		"closure-fields",
	]) {
		const fixture = structuredClone(autoQualifiedOutcome("two"));
		const close = fixture.allCalls.find(
			(call) => call.tool === "flow_session_close",
		);
		if (!close) throw new Error("Missing genuine close");
		if (mutant === "missing")
			object(fixture).allCalls = fixture.allCalls.filter(
				(call) => call !== close,
			);
		if (mutant === "native") delete object(close).native;
		if (mutant === "agent") object(close).agent = "flow-reviewer";
		const operation = object(
			object(object(close.output).workflowData).operation,
		);
		if (mutant === "entity") operation.entity = { unrelated: true };
		if (mutant === "revision") operation.revision = 999;
		if (mutant === "closure-fields")
			object(fixture.archives[0]).closure = { kind: "completed" };
		expect(() => scenario.check(fixture)).not.toThrow();
		expect(scenario.check(fixture)).not.toEqual([]);
	}
});

test("a historical pass cannot replace final-source canonical validation", () => {
	const scenario = AUTO_SCENARIOS.find(
		(value) => value.id === "auto-two-features-evidence",
	);
	if (!scenario) throw new Error("Missing case");
	const fixture = structuredClone(autoQualifiedOutcome("two"));
	const doc = object(fixture.archives[0]),
		runs = doc.runs as Array<Record<string, unknown>>,
		first = runs[0],
		last = runs[1];
	if (!first || !last) throw new Error("Missing two runs");
	object((first.validations as unknown[])[0]).command =
		"node scripts/verify.mjs";
	object((first.validations as unknown[])[0]).scope = "broad";
	object((last.validations as unknown[])[0]).command = "node unrelated.mjs";
	object(doc.plan).evidence = [];
	expect(scenario.check(fixture)).not.toEqual([]);
});

test("grader source bundle includes prospective checks and independent packet oracle", async () => {
	const bundle = releaseGraderSourceBundle(join(import.meta.dir, ".."));
	const paths = bundle.files.map((file) => file.path);
	for (const path of [
		"evals/auto-scenarios.ts",
		"evals/auto-scenario-checks.ts",
		"evals/reviewer-access.ts",
		"evals/reviewer-packet-bytes.ts",
	])
		expect(paths).toContain(path);
});
