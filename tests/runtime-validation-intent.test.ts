import { expect, test } from "bun:test";
import {
	persistObservedValidation,
	prepareValidation,
} from "../src/application/prepare-validation.js";
import { ValidationStartInputSchema } from "../src/application/schema.js";
import type { Plan } from "../src/domain/session.js";
import {
	activeReview,
	approveSession,
	deterministicEnvironment,
	expectOk,
	FEATURE,
	MemorySessionRepository,
	OUTPUT,
	plan,
	recordObservedValidation,
	revision,
	SOURCE_A,
	startFeatureRun,
} from "./runtime-test-support.js";

const COMMAND = "uvx zizmor .github";

test.each([
	"wrong-host",
	"incomplete",
	"observe-failed",
	"observe-zero",
] as const)(
	"%s focused result cannot replace required nonfinal proof",
	async (invalid) => {
		const command =
			"bun test --reporter=junit --reporter-outfile=.flow/results.xml";
		const survey = invalid.startsWith("observe");
		const first = {
			...plan.features[0]!,
			kind: "inspect" as const,
			validation: [command],
			...(survey
				? {
						checks: [
							{
								command: "survey",
								intent: "observe" as const,
								platform: "linux" as const,
							},
						],
					}
				: {}),
		};
		const repository = new MemorySessionRepository();
		const declared: Plan = {
			...plan,
			features: [
				first,
				{ ...first, id: "later-inspection", dependsOn: [FEATURE] },
			],
			evidence: [
				{
					scope: "gate-observe",
					requirement: "Inspect repository",
					environment: "linux",
					command,
					platform: "linux",
					assertions: [],
				},
				{
					scope: "extra",
					requirement: "Windows case",
					environment: "Windows",
					command,
					platform: "win32",
					assertions: ["Windows case"],
				},
			],
		};
		const flow = await approveSession(repository, deterministicEnvironment(), {
			plan: declared,
			suffix: invalid,
		});
		await startFeatureRun(flow, repository, FEATURE, invalid);
		const prepared = await prepareValidation(
			repository,
			{
				expectedRevision: revision(repository),
				featureId: FEATURE,
				command: survey ? "survey" : command,
				scope: "focused",
			},
			survey ? "linux" : invalid === "wrong-host" ? "darwin" : "win32",
		);
		await persistObservedValidation(repository, {
			...prepared,
			captureId: invalid,
			exitCode: invalid === "observe-failed" ? 12 : 0,
			outputDigest: OUTPUT,
			outputComplete: invalid !== "incomplete",
			...(!survey
				? {
						observedAssertions: [
							{ name: "Windows case", status: "passed" as const },
						],
					}
				: {}),
		});
		const before = revision(repository);
		const review = await flow.reviewStart({
			request: {
				operationId: `review-${invalid}`,
				expectedRevision: before,
				featureId: FEATURE,
				artifactsChanged: [],
				packet: { summary: "Inspect first feature", riskLenses: [] },
			},
		});
		expect(review.status).toBe("error");
		expect(revision(repository)).toBe(before);
		expect(repository.session!.runs[0]!.reviews).toEqual([]);
	},
);

test.each([
	["feature", "focused"],
	["feature", "broad"],
	["final", "focused"],
	["final", "broad"],
] as const)(
	"opposite-host %s review with %s extra requires canonical support only at final",
	async (kind, scope) => {
		const command =
			"bun test --reporter=junit --reporter-outfile=.flow/results.xml";
		const first = {
			...plan.features[0]!,
			kind: "inspect" as const,
			validation: [command],
		};
		const repository = new MemorySessionRepository();
		const declared: Plan = {
			...plan,
			features: [
				first,
				...(kind === "feature"
					? [{ ...first, id: "later-inspection", dependsOn: [FEATURE] }]
					: []),
			],
			evidence: [
				{
					scope: "gate-observe",
					requirement: "Inspect repository",
					environment: "linux",
					command,
					platform: "linux",
					assertions: [],
				},
				{
					scope: "extra",
					requirement: "Windows case",
					environment: "Windows",
					command,
					platform: "win32",
					assertions: ["Windows case"],
				},
			],
		};
		const flow = await approveSession(repository, deterministicEnvironment(), {
			plan: declared,
			suffix: "wrong-broad-host",
		});
		await startFeatureRun(flow, repository, FEATURE, "wrong-broad-host");
		const prepared = await prepareValidation(
			repository,
			{
				expectedRevision: revision(repository),
				featureId: FEATURE,
				command,
				scope,
			},
			"win32",
		);
		await persistObservedValidation(repository, {
			...prepared,
			captureId: "wrong-broad",
			exitCode: 0,
			outputDigest: OUTPUT,
			outputComplete: true,
			observedAssertions: [{ name: "Windows case", status: "passed" }],
		});
		const before = revision(repository);
		const review = await flow.reviewStart({
			request: {
				operationId: "wrong-host-review",
				expectedRevision: before,
				featureId: FEATURE,
				artifactsChanged: [],
				packet: { summary: "Inspect first feature", riskLenses: [] },
			},
		});
		expect(review.status).toBe(kind === "final" ? "error" : "ok");
		if (kind === "final") {
			expect(revision(repository)).toBe(before);
			expect(repository.session!.runs[0]!.reviews).toEqual([]);
		} else {
			expect(activeReview(repository).validationIds).toEqual(["wrong-broad"]);
		}
	},
);

test("opposite-host same-command extra proof is included with the observed gate in the assignment", async () => {
	const command =
		"bun test --reporter=junit --reporter-outfile=.flow/results.xml";
	const repository = new MemorySessionRepository();
	const declared: Plan = {
		...plan,
		features: plan.features.map((feature) => ({
			...feature,
			kind: "inspect",
			validation: [command],
		})),
		evidence: [
			{
				scope: "gate-observe",
				requirement: "Inspect repository",
				environment: "linux",
				command,
				platform: "linux",
				assertions: [],
			},
			{
				scope: "extra",
				requirement: "Windows case",
				environment: "Windows",
				command,
				platform: "win32",
				assertions: ["Windows case"],
			},
		],
	};
	const flow = await approveSession(repository, deterministicEnvironment(), {
		plan: declared,
		suffix: "opposite-host",
	});
	await startFeatureRun(flow, repository, FEATURE, "opposite-host");
	const record = async (
		scope: "focused" | "broad",
		host: "linux" | "win32",
		exitCode: number,
	) => {
		const prepared = await prepareValidation(
			repository,
			{
				expectedRevision: revision(repository),
				featureId: FEATURE,
				command,
				scope,
			},
			host,
		);
		return persistObservedValidation(repository, {
			...prepared,
			captureId: `capture-${scope}`,
			exitCode,
			outputDigest: OUTPUT,
			outputComplete: true,
			observedAssertions: [
				{ name: "Windows case", status: exitCode === 0 ? "passed" : "skipped" },
			],
		});
	};
	const broad = await record("broad", "linux", 1);
	const missing = await flow.status({ request: { view: "compact" } });
	expectOk(missing);
	expect(missing.workflowData.projection).toMatchObject({
		nextAction: "await-user-direction",
	});
	const extra = await record("focused", "win32", 0);
	const review = await flow.reviewStart({
		request: {
			operationId: "opposite-host-review",
			expectedRevision: revision(repository),
			featureId: FEATURE,
			artifactsChanged: [],
			packet: { summary: "Inspect gate and Windows proof", riskLenses: [] },
		},
	});
	expectOk(review);
	if (!("validations" in review.workflowData.projection))
		throw new Error("Reviewer view missing");
	expect(review.workflowData.projection.validations).toEqual([broad, extra]);
	expect(activeReview(repository).validationIds).toEqual([broad.id, extra.id]);
});

test("legacy canonical OS binds broad arming while typed OS binds every scope", async () => {
	const repository = new MemorySessionRepository();
	const command =
		"bun test --reporter=junit --reporter-outfile=.flow/results.xml";
	const declared: Plan = {
		...plan,
		features: plan.features.map((feature) => ({
			...feature,
			kind: "inspect",
			validation: [command],
			checks: [{ command: "typed check", intent: "pass", platform: "win32" }],
		})),
		evidence: [
			{
				scope: "gate-observe",
				requirement: "Inspect repository",
				environment: "linux",
				command,
				platform: "linux",
				assertions: [],
			},
			{
				scope: "extra",
				requirement: "Windows case",
				environment: "Windows",
				command,
				platform: "win32",
				assertions: ["Windows case"],
			},
		],
	};
	const flow = await approveSession(repository, deterministicEnvironment(), {
		plan: declared,
		suffix: "platform-scope",
	});
	await startFeatureRun(flow, repository, FEATURE, "platform-scope");
	for (const scope of ["focused", "broad"] as const) {
		const legacy = await prepareValidation(
			repository,
			{
				expectedRevision: revision(repository),
				featureId: FEATURE,
				command,
				scope,
			},
			"win32",
		);
		expect(legacy.declaredPlatform).toBe(
			scope === "broad" ? "linux" : undefined,
		);
	}
	const typedFocused = await prepareValidation(
		repository,
		{
			expectedRevision: revision(repository),
			featureId: FEATURE,
			command: "typed check",
			scope: "focused",
		},
		"linux",
	);
	expect(typedFocused.declaredPlatform).toBe("win32");
	const typedRepository = new MemorySessionRepository();
	const typedPlan: Plan = {
		...plan,
		features: plan.features.map((feature) => ({
			...feature,
			checks: [{ command: "bun test", intent: "pass", platform: "win32" }],
		})),
	};
	const typedFlow = await approveSession(
		typedRepository,
		deterministicEnvironment(),
		{ plan: typedPlan, suffix: "typed-platform" },
	);
	await startFeatureRun(typedFlow, typedRepository, FEATURE, "typed-platform");
	const typedBroad = await prepareValidation(
		typedRepository,
		{
			expectedRevision: revision(typedRepository),
			featureId: FEATURE,
			command: "bun test",
			scope: "broad",
		},
		"linux",
	);
	expect(typedBroad.declaredPlatform).toBe("win32");
});

test.each([0, 1])(
	"legacy observed gate with same-command named extra keeps its own exit-%i requirement",
	async (exitCode) => {
		const command =
			"bun test --reporter=junit --reporter-outfile=.flow/results.xml";
		const repository = new MemorySessionRepository();
		const declared: Plan = {
			...plan,
			features: plan.features.map((feature) => ({
				...feature,
				kind: "inspect",
				validation: [command],
			})),
			evidence: [
				{
					scope: "gate-observe",
					requirement: "Inspect repository",
					environment: "this host",
					command,
					platform: "other",
					assertions: [],
				},
				{
					scope: "extra",
					requirement: "Named behavior passes",
					environment: "this host",
					command,
					platform: "linux",
					assertions: ["Accepted case"],
				},
			],
		};
		const flow = await approveSession(repository, deterministicEnvironment(), {
			plan: declared,
			suffix: `legacy-shared-${exitCode}`,
		});
		await startFeatureRun(
			flow,
			repository,
			FEATURE,
			`legacy-shared-${exitCode}`,
		);
		const prepared = await prepareValidation(
			repository,
			{
				expectedRevision: revision(repository),
				featureId: FEATURE,
				command,
				scope: "broad",
			},
			"linux",
		);
		expect(prepared.intent).toBe("observe");
		expect(prepared.assertions).toEqual(["Accepted case"]);
		const recorded = await persistObservedValidation(repository, {
			...prepared,
			captureId: `shared-${exitCode}`,
			exitCode,
			outputDigest: OUTPUT,
			outputComplete: true,
			observedAssertions: [{ name: "Accepted case", status: "passed" }],
		});
		expect(recorded.intent).toBe("observe");
		const status = await flow.status({ request: { view: "compact" } });
		expectOk(status);
		expect(status.workflowData.projection).toMatchObject({
			nextAction: exitCode === 0 ? "flow_review_start" : "await-user-direction",
		});
	},
);

test.each([
	["change", "passed"],
	["inspect", "passed"],
] as const)(
	"%s supplemental observation survives %s review and delivery without raw output",
	async (kind, verdict) => {
		const repository = new MemorySessionRepository();
		const declared: Plan = {
			...plan,
			features: plan.features.map((feature) => ({
				...feature,
				kind,
				checks: [{ command: COMMAND, intent: "observe", platform: "linux" }],
			})),
		};
		const flow = await approveSession(repository, deterministicEnvironment(), {
			plan: declared,
			suffix: "observation",
		});
		await startFeatureRun(flow, repository, FEATURE, "observation");
		await recordObservedValidation(repository, { captureId: "broad" });
		const missing = await flow.status({ request: { view: "compact" } });
		expectOk(missing);
		expect(missing.workflowData.projection).toMatchObject({
			nextAction: "flow_validation_start",
		});
		const observation = await recordObservedValidation(repository, {
			captureId: "supplemental",
			command: COMMAND,
			scope: "focused",
			exitCode: 12,
		});
		expect(observation.intent).toBe("observe");
		const ready = await flow.status({ request: { view: "compact" } });
		expectOk(ready);
		expect(ready.workflowData.projection).toMatchObject({
			nextAction: "flow_review_start",
		});
		expectOk(
			await flow.reviewStart({
				request: {
					operationId: "review-observation",
					expectedRevision: revision(repository),
					featureId: FEATURE,
					artifactsChanged: [],
					packet: {
						summary: "Review CI filter and existing audit findings",
						riskLenses: [],
					},
				},
			}),
		);
		const view = await flow.status({
			request: { view: "reviewer", assignmentId: activeReview(repository).id },
		});
		expectOk(view);
		if (!("validations" in view.workflowData.projection))
			throw new Error("Reviewer view missing");
		expect(view.workflowData.projection.validations).toContainEqual(
			observation,
		);
		expect(view.workflowData.projection).toMatchObject({
			feature: {
				checks: [{ command: COMMAND, intent: "observe", platform: "linux" }],
			},
		});
		const submitted = await flow.featureComplete({
			request: {
				operationId: "complete-observation",
				expectedRevision: revision(repository),
				featureId: FEATURE,
				assignmentId: activeReview(repository).id,
				summary: "CI filter passes; pre-existing audit findings documented",
				result: {
					verdict,
					terminalDisposition: "submitted",
					findings:
						kind === "inspect"
							? [
									{
										severity: "advisory",
										summary: "Pre-existing audit findings",
										evidence: `${COMMAND} exited 12 on linux for ${SOURCE_A}`,
									},
								]
							: [],
				},
			},
		});
		expect(submitted.status, submitted.summary).toBe("ok");
		const id = repository.session!.id;
		const closed = await flow.sessionClose({
			request: {
				operationId: "close-observation",
				expectedRevision: revision(repository),
				sessionId: id,
				kind: "completed",
				summary: "Delivered CI filter and audit findings",
			},
		});
		expectOk(closed);
		expect(closed.workflowData.delivery.observations).toEqual([observation]);
		const report = closed.workflowData.delivery.report.join("\n");
		for (const metadata of [
			COMMAND,
			"exit 12",
			"host linux",
			SOURCE_A,
			OUTPUT,
			"does not claim the command passed",
		])
			expect(report).toContain(metadata);
		expect(observation).not.toHaveProperty("outputExcerpt");
		expect(observation).not.toHaveProperty("output");
	},
);

test("public validation callers cannot supply intent or a finding summary as acceptance authority", () => {
	const request = {
		expectedRevision: 3,
		featureId: FEATURE,
		command: COMMAND,
		scope: "focused",
	};
	for (const claim of [
		{ intent: "observe" },
		{ summary: "Only unrelated suggestions" },
	])
		expect(
			ValidationStartInputSchema.safeParse({
				request: { ...request, ...claim },
			}).success,
		).toBe(false);
});
