// Owns OpenCode tool arg-shape, zod/plugin alignment, and raw-schema
// contract coverage previously grouped in tests/config.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { ToolContext as OpenCodeToolContext } from "@opencode-ai/plugin/tool";
import { z } from "zod";
import { tool } from "../../src/adapters/opencode/sdk";
import { renderOpenCodeToolCoreSummary } from "../../src/adapters/opencode/tool-surface/core-action-projection";
import {
	FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY,
	FlowReviewRenderArgsSchema,
} from "../../src/adapters/opencode/tool-surface/schemas";
import {
	getOpenCodeToolRegistryEntry,
	OPENCODE_TOOL_NAMES_FROM_REGISTRY,
	OPENCODE_TOOL_REGISTRY,
} from "../../src/adapters/opencode/tool-surface/tool-registry";
import { type CoreActionName, coreActionByName } from "../../src/core/registry";
import {
	FinalReviewerDecisionSchema,
	FlowReviewRecordFeatureArgsSchema,
	PlanArgsSchema,
	PlanningContextArgsSchema,
	WorkerResultArgsSchema,
	WorkerResultSchema,
} from "../../src/runtime/schema";
import {
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	toolContext,
} from "../runtime-test-helpers";
import { asJson, getToolSchemas, projectPath, readJson } from "./helpers";

type IsRequired<T, K extends keyof T> =
	Record<string, never> extends Pick<T, K> ? false : true;
type Assert<T extends true> = T;
type OpenCodeToolContextRequiredAssertions = [
	Assert<IsRequired<OpenCodeToolContext, "agent">>,
	Assert<IsRequired<OpenCodeToolContext, "sessionID">>,
	Assert<IsRequired<OpenCodeToolContext, "messageID">>,
	Assert<IsRequired<OpenCodeToolContext, "abort">>,
	Assert<IsRequired<OpenCodeToolContext, "metadata">>,
	Assert<IsRequired<OpenCodeToolContext, "ask">>,
];

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

describe("tool schema config contracts", () => {
	test("installed OpenCode ToolContext keeps required execution fields", () => {
		const requiredAssertions: OpenCodeToolContextRequiredAssertions = [
			true,
			true,
			true,
			true,
			true,
			true,
		];
		const requiredFields = [
			"agent",
			"sessionID",
			"messageID",
			"abort",
			"metadata",
			"ask",
		] as const satisfies readonly (keyof OpenCodeToolContext)[];

		expect(requiredAssertions).toEqual([true, true, true, true, true, true]);
		expect(requiredFields).toEqual([
			"agent",
			"sessionID",
			"messageID",
			"abort",
			"metadata",
			"ask",
		]);
	});

	test("OpenCode tool surface is ordered by the adapter registry", () => {
		const { tools } = getToolSchemas();

		expect(Object.keys(tools)).toEqual(OPENCODE_TOOL_NAMES_FROM_REGISTRY);
		expect(
			getOpenCodeToolRegistryEntry("flow_run_complete_feature")?.coreAction,
		).toBe("complete_run");
		expect(
			getOpenCodeToolRegistryEntry("flow_review_record_final")?.coreAction,
		).toBe("record_reviewer_decision");
		expect(
			getOpenCodeToolRegistryEntry("flow_review_record_feature")
				?.runtimeActionBinding,
		).toEqual({ kind: "mutation", name: "record_feature_review" });
		expect(
			getOpenCodeToolRegistryEntry("flow_review_record_final")
				?.runtimeActionBinding,
		).toEqual({ kind: "mutation", name: "record_final_review" });
	});

	test("reset feature metadata tracks the review transition owner", () => {
		const registryEntry = getOpenCodeToolRegistryEntry("flow_reset_feature");
		const coreAction = coreActionByName("reset_feature");

		expect(registryEntry).toBeDefined();
		expect(coreAction).not.toBeNull();
		expect(registryEntry?.coreAction).toBe("reset_feature");
		expect(coreAction?.policyOwners).toContain(
			"src/runtime/transitions/review.ts",
		);
		expect(coreAction?.policyOwners).not.toContain(
			"src/runtime/transitions/recovery.ts",
		);
	});

	test("OpenCode registry references existing core action metadata", () => {
		for (const entry of OPENCODE_TOOL_REGISTRY) {
			if (!entry.coreAction) {
				continue;
			}
			const coreAction = coreActionByName(entry.coreAction);
			if (!coreAction) {
				throw new Error(
					`Missing core action registry entry for ${entry.coreAction}`,
				);
			}

			expect(coreAction.emits).toBeDefined();
			expect(coreAction.invariantIds).toBeDefined();
		}
	});

	test("OpenCode core summaries tolerate absent and stale core actions", () => {
		expect(
			renderOpenCodeToolCoreSummary({
				coreActionName: "complete_run",
				runtimeAction: "complete_run",
			}),
		).toContain("- Core action: `complete_run`");
		expect(renderOpenCodeToolCoreSummary({ coreActionName: null })).toBeNull();
		expect(
			renderOpenCodeToolCoreSummary({
				coreActionName: "missing_projected_action" as CoreActionName,
				runtimeAction: "complete_run",
			}),
		).toBeNull();
	});

	test("exports OpenCode raw arg shapes for every tool", () => {
		const { tools, schemas } = getToolSchemas();

		for (const [name, definition] of Object.entries(tools)) {
			expect(definition).toBeDefined();
			expect(typeof definition.args).toBe("object");
			expect(definition.args).not.toBeNull();

			for (const [field, value] of Object.entries(definition.args)) {
				expect(field.length).toBeGreaterThan(0);
				expect(typeof value).toBe("object");
				expect(value).not.toBeNull();
			}

			expect(schemas[name as keyof typeof schemas]).toBeDefined();

			expect(name.length).toBeGreaterThan(0);
		}
	});

	test("records default OpenCode tool surface counts by kind and mode", () => {
		const { tools } = getToolSchemas();
		const countBy = <K extends string>(values: readonly K[]) =>
			Object.fromEntries(
				[...new Set(values)].map((value) => [
					value,
					values.filter((item) => item === value).length,
				]),
			);
		const exposedToolNames = Object.keys(tools);
		const modes = OPENCODE_TOOL_REGISTRY.flatMap((entry) => entry.allowedModes);

		expect(exposedToolNames).toEqual(OPENCODE_TOOL_NAMES_FROM_REGISTRY);
		expect(exposedToolNames).toHaveLength(18);
		expect(
			countBy(OPENCODE_TOOL_REGISTRY.map((entry) => entry.surfaceKind)),
		).toEqual({
			read: 5,
			workspace: 3,
			mutation: 9,
			render: 1,
		});
		expect(
			countBy(OPENCODE_TOOL_REGISTRY.map((entry) => entry.mutationClass)),
		).toEqual({
			none: 6,
			control: 2,
			planning: 5,
			execution: 3,
			review: 2,
		});
		expect(countBy(modes)).toEqual({
			"flow-control": 7,
			"flow-plan": 5,
			"flow-auto": 10,
			"flow-run": 4,
			"flow-worker": 4,
			"flow-review": 1,
		});
	});

	test("keeps the global Flow raw object schema surface within a bounded budget", () => {
		const { tools } = getToolSchemas();
		const schemaSizes = Object.fromEntries(
			Object.entries(tools).map(([name, definition]) => [
				name,
				JSON.stringify(tool.schema.object(definition.args)).length,
			]),
		);
		const totalSize = Object.values(schemaSizes).reduce(
			(total, size) => total + size,
			0,
		);

		// These ceilings intentionally leave narrow headroom over measured growth
		// (including finalReview/suggestedValidation, planning.reviewFindings,
		// and prior test-evidence input aliases) so unrelated future
		// bloat still fails fast.
		expect(totalSize).toBeLessThan(397000);
		expect(schemaSizes.flow_plan_apply).toBeLessThan(78500);
		expect(schemaSizes.flow_plan_context_record).toBeLessThan(60500);
		expect(schemaSizes.flow_run_complete_feature).toBeLessThan(108500);
		expect(schemaSizes.flow_review_record_feature).toBeLessThan(20000);
		expect(schemaSizes.flow_review_record_final).toBeLessThan(86500);
		expect(schemaSizes.flow_review_render).toBeLessThan(70000);
	});

	test("pins zod to the plugin SDK's effective zod contract", async () => {
		const projectPackage = await readJson("package.json");
		const pluginPackage = await readJson(
			"node_modules/@opencode-ai/plugin/package.json",
		);
		const rootZodPackage = await readJson("node_modules/zod/package.json");
		const nestedPluginZodPath =
			"node_modules/@opencode-ai/plugin/node_modules/zod/package.json";
		const pluginZodPackage = await readJson(
			existsSync(projectPath(nestedPluginZodPath))
				? nestedPluginZodPath
				: "node_modules/zod/package.json",
		);

		expect(projectPackage.dependencies).toMatchObject({
			zod: rootZodPackage.version,
		});
		expect(pluginPackage.dependencies).toMatchObject({
			zod: pluginZodPackage.version,
		});
		expect(rootZodPackage.version).toBe(pluginZodPackage.version);
	});

	test("runtime-owned OpenCode payload schemas document adapter/runtime parity intent", () => {
		const { schemas } = getToolSchemas();
		const RuntimeFlowPlanApplyArgsSchema = z
			.object({
				plan: PlanArgsSchema,
				planning: PlanningContextArgsSchema.optional(),
			})
			.strict();
		const runtimeOwnedTools = [
			"flow_plan_context_record",
			"flow_plan_apply",
			"flow_run_complete_feature",
			"flow_review_record_feature",
			"flow_review_record_final",
		] as const;
		const expectAdapterRuntimeAgreement = (
			adapterSchema: { safeParse: (payload: unknown) => { success: boolean } },
			runtimeSchema: { safeParse: (payload: unknown) => { success: boolean } },
			payload: unknown,
			expected: boolean,
		) => {
			expect(adapterSchema.safeParse(payload).success).toBe(expected);
			expect(runtimeSchema.safeParse(payload).success).toBe(expected);
		};

		for (const toolName of runtimeOwnedTools) {
			expect(
				FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY[toolName].payloadSchemaOwners,
			).toContain("src/runtime/schema.ts");
		}

		const validPlanningContext = {
			repoProfile: ["TypeScript"],
			packageManager: "bun",
			research: ["Use local schema contracts as source of truth."],
		};
		expectAdapterRuntimeAgreement(
			schemas.flow_plan_context_record,
			PlanningContextArgsSchema,
			validPlanningContext,
			true,
		);
		expectAdapterRuntimeAgreement(
			schemas.flow_plan_context_record,
			PlanningContextArgsSchema,
			{ ...validPlanningContext, packageManager: "cargo" },
			false,
		);
		const validPlanApply = {
			plan: {
				summary: "Implement a workflow.",
				overview: "Create one feature.",
				features: [
					{
						id: "setup-runtime",
						title: "Create runtime helpers",
						summary: "Add runtime helpers.",
						fileTargets: ["src/runtime/session.ts"],
						verification: ["bun test"],
					},
				],
			},
			planning: validPlanningContext,
		};
		expectAdapterRuntimeAgreement(
			schemas.flow_plan_apply,
			RuntimeFlowPlanApplyArgsSchema,
			validPlanApply,
			true,
		);
		expectAdapterRuntimeAgreement(
			schemas.flow_plan_apply,
			RuntimeFlowPlanApplyArgsSchema,
			{
				...validPlanApply,
				plan: {
					...validPlanApply.plan,
					features: [{ ...validPlanApply.plan.features[0], id: "Bad Id" }],
				},
			},
			false,
		);
		const validWorkerResult = {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		};
		expectAdapterRuntimeAgreement(
			schemas.flow_run_complete_feature,
			WorkerResultArgsSchema,
			validWorkerResult,
			true,
		);
		expectAdapterRuntimeAgreement(
			schemas.flow_run_complete_feature,
			WorkerResultArgsSchema,
			{ ...validWorkerResult, nextStep: undefined },
			false,
		);
		expectAdapterRuntimeAgreement(
			schemas.flow_run_complete_feature,
			WorkerResultArgsSchema,
			{
				...validWorkerResult,
				featureResult: {
					...validWorkerResult.featureResult,
					featureId: "Bad Id",
				},
			},
			false,
		);

		const validFeatureReview = {
			scope: "feature",
			featureId: "setup-runtime",
			status: "approved",
			summary: "Looks good.",
		};
		expectAdapterRuntimeAgreement(
			schemas.flow_review_record_feature,
			FlowReviewRecordFeatureArgsSchema,
			validFeatureReview,
			true,
		);
		expectAdapterRuntimeAgreement(
			schemas.flow_review_record_feature,
			FlowReviewRecordFeatureArgsSchema,
			{ scope: "final", status: "approved", summary: "Wrong scope." },
			false,
		);

		const validFinalReview = {
			scope: "final",
			reviewDepth: "broad",
			reviewedSurfaces: ["changed_files"],
			evidenceSummary: "Checked changed files.",
			validationAssessment: "No validation was available.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: [],
			},
			status: "approved",
			summary: "Looks good.",
		};
		expectAdapterRuntimeAgreement(
			schemas.flow_review_record_final,
			FinalReviewerDecisionSchema,
			validFinalReview,
			true,
		);
		expectAdapterRuntimeAgreement(
			schemas.flow_review_record_final,
			FinalReviewerDecisionSchema,
			{ ...validFinalReview, evidenceRefs: undefined },
			false,
		);
	});

	test("planning runtime parse schemas reject unknown adapter-facing keys narrowly", () => {
		const adapterSchema = (
			toolName: "flow_plan_apply" | "flow_plan_context_record",
		) =>
			FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY[toolName].argsSchema as {
				safeParse: (payload: unknown) => { success: boolean };
			};
		const validPlanningContext = {
			repoProfile: ["TypeScript"],
			packageManager: "bun",
			research: ["Use local schema contracts as source of truth."],
		};
		const validPlan = {
			summary: "Implement a workflow.",
			overview: "Create one feature.",
			features: [
				{
					id: "setup-runtime",
					title: "Create runtime helpers",
					summary: "Add runtime helpers.",
					fileTargets: ["src/runtime/session.ts"],
					verification: ["bun test"],
				},
			],
		};
		const validPlanApply = {
			plan: validPlan,
			planning: validPlanningContext,
		};

		expect(
			PlanArgsSchema.safeParse({ ...validPlan, unexpected: true }).success,
		).toBe(false);
		expect(
			PlanningContextArgsSchema.safeParse({
				...validPlanningContext,
				unexpected: true,
			}).success,
		).toBe(false);
		expect(
			adapterSchema("flow_plan_apply").safeParse({
				...validPlanApply,
				unexpected: true,
			}).success,
		).toBe(false);
		expect(
			adapterSchema("flow_plan_apply").safeParse({
				...validPlanApply,
				plan: { ...validPlan, unexpected: true },
			}).success,
		).toBe(false);
		expect(
			adapterSchema("flow_plan_apply").safeParse({
				...validPlanApply,
				planning: { ...validPlanningContext, unexpected: true },
			}).success,
		).toBe(false);
		expect(
			adapterSchema("flow_plan_context_record").safeParse({
				...validPlanningContext,
				unexpected: true,
			}).success,
		).toBe(false);

		const { schemas } = getToolSchemas();
		expect(schemas.flow_status.safeParse({ extra: true }).success).toBe(true);
		expect(schemas.flow_history.safeParse({ extra: true }).success).toBe(true);
	});

	test("planning tools reject unknown keys through execute validation path", async () => {
		const tools = createTestTools();
		const worktree = makeTempDir();
		const validPlanningContext = {
			repoProfile: ["TypeScript"],
			packageManager: "bun",
			research: ["Use local schema contracts as source of truth."],
		};
		const validPlanApply = {
			plan: samplePlan(),
			planning: validPlanningContext,
		};
		const cases = [
			{
				name: "context top-level",
				toolName: "flow_plan_context_record",
				payload: { ...validPlanningContext, unexpectedPlanningKey: true },
				expectedFragments: ["unexpectedPlanningKey"],
			},
			{
				name: "apply outer",
				toolName: "flow_plan_apply",
				payload: { ...validPlanApply, unexpectedOuterKey: true },
				expectedFragments: ["unexpectedOuterKey"],
			},
			{
				name: "apply nested plan",
				toolName: "flow_plan_apply",
				payload: {
					...validPlanApply,
					plan: { ...validPlanApply.plan, unexpectedPlanKey: true },
				},
				expectedFragments: ["plan", "unexpectedPlanKey"],
			},
			{
				name: "apply nested planning",
				toolName: "flow_plan_apply",
				payload: {
					...validPlanApply,
					planning: { ...validPlanningContext, unexpectedPlanningKey: true },
				},
				expectedFragments: ["planning", "unexpectedPlanningKey"],
			},
		] as const;

		for (const testCase of cases) {
			const response = await tools[testCase.toolName].execute(
				testCase.payload,
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);
			const responseText = JSON.stringify(parsed);

			expect(parsed.status, testCase.name).toBe("error");
			expect(String(parsed.summary), testCase.name).toContain(
				"Tool argument validation failed",
			);
			for (const fragment of testCase.expectedFragments) {
				expect(responseText, testCase.name).toContain(fragment);
			}
		}
	});

	test("final review reviewContextPack raw schemas match runtime structured schema", () => {
		const { schemas } = getToolSchemas();
		const structuredReviewContextPack = {
			task: "Review tool schema contract",
			changedFiles: ["src/runtime/session.ts"],
			includedContext: [
				{
					path: "src/runtime/session.ts",
					reason: "changed_file",
					surface: "changed_files",
					summary: "Runtime session state changed.",
				},
			],
			relationships: [
				{
					from: "src/adapters/opencode/tool-surface/schemas.ts",
					to: "src/runtime/schema-review-shared.ts",
					kind: "schema_source",
					summary: "Adapter raw schema mirrors runtime review context shape.",
				},
			],
			validationEvidence: [
				{
					command: "bun test tests/config/tool-schemas.test.ts",
					status: "passed",
					summary: "Tool schema parity verified.",
				},
			],
			suggestedValidation: ["bun test tests/config/tool-schemas.test.ts"],
			coverageGaps: [],
			reviewedSurfaces: ["changed_files", "validation_evidence"],
		};
		const compactReviewContextPack = {
			...structuredReviewContextPack,
			includedContext: ["compact context entry rejected by adapter"],
			relationships: ["compact relationship entry rejected by adapter"],
			validationEvidence: ["compact validation entry rejected by adapter"],
		};
		const finalReview = {
			scope: "final",
			reviewDepth: "broad",
			reviewedSurfaces: ["changed_files"],
			evidenceSummary: "Checked changed files.",
			validationAssessment: "No validation was available.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: [],
			},
			status: "approved",
			summary: "Looks good.",
			reviewContextPack: structuredReviewContextPack,
		};
		const compactContextFinalReview = {
			...finalReview,
			reviewContextPack: compactReviewContextPack,
		};
		const workerResultWithFinalReview = {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
			finalReview: {
				status: "passed",
				summary: "Final review passed.",
				reviewDepth: "broad",
				reviewedSurfaces: ["changed_files"],
				evidenceSummary: "Reviewed changed files.",
				validationAssessment: "No validation was available.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: [],
				},
				reviewContextPack: structuredReviewContextPack,
			},
		};
		const workerResultWithCompactFinalReviewContext = {
			...workerResultWithFinalReview,
			finalReview: {
				...workerResultWithFinalReview.finalReview,
				reviewContextPack: compactReviewContextPack,
			},
		};

		expect(
			schemas.flow_review_record_final.safeParse(finalReview).success,
		).toBe(true);
		expect(FinalReviewerDecisionSchema.safeParse(finalReview).success).toBe(
			true,
		);
		expect(
			schemas.flow_review_record_final.safeParse(compactContextFinalReview)
				.success,
		).toBe(false);
		expect(
			FinalReviewerDecisionSchema.safeParse(compactContextFinalReview).success,
		).toBe(false);
		expect(
			schemas.flow_run_complete_feature.safeParse(workerResultWithFinalReview)
				.success,
		).toBe(true);
		expect(
			WorkerResultArgsSchema.safeParse(workerResultWithFinalReview).success,
		).toBe(true);
		expect(
			schemas.flow_run_complete_feature.safeParse(
				workerResultWithCompactFinalReviewContext,
			).success,
		).toBe(false);
		expect(
			WorkerResultArgsSchema.safeParse(
				workerResultWithCompactFinalReviewContext,
			).success,
		).toBe(false);
		expect(
			FLOW_TOOL_PAYLOAD_SCHEMA_REGISTRY.flow_review_record_final
				.payloadSchemaOwners,
		).toEqual([
			"src/adapters/opencode/tool-surface/schemas.ts",
			"src/runtime/schema.ts",
		]);
	});

	test("non-worker tool schemas accept representative valid payloads and reject invalid ones", () => {
		const { schemas, tools } = getToolSchemas();
		const evidencePacket = {
			id: "packet:tool-schema",
			purpose: "planning",
			summary: "Tool schema packet evidence.",
			sourceRefs: ["src/runtime/schema.ts"],
			selectedContext: ["src/runtime/schema.ts"],
			excludedContext: ["dist/index.js"],
			validationEvidence: [
				{
					command: "bun test tests/config/tool-schemas.test.ts",
					status: "passed",
					summary: "Tool schema contract passed.",
				},
			],
		};

		expect(schemas.flow_status.safeParse({}).success).toBe(true);
		expect(schemas.flow_status.safeParse({ view: "compact" }).success).toBe(
			true,
		);
		expect(schemas.flow_status.safeParse({ view: "detailed" }).success).toBe(
			true,
		);
		expect(schemas.flow_status.safeParse({ view: "bad" }).success).toBe(false);
		expect(schemas.flow_status.safeParse({ extra: true }).success).toBe(true);
		expect(schemas.flow_doctor.safeParse({}).success).toBe(true);
		expect(schemas.flow_doctor.safeParse({ view: "compact" }).success).toBe(
			true,
		);
		expect(schemas.flow_doctor.safeParse({ view: "detailed" }).success).toBe(
			true,
		);
		expect(schemas.flow_doctor.safeParse({ view: "bad" }).success).toBe(false);
		expect(schemas.flow_doctor.safeParse({ extra: true }).success).toBe(true);
		expect(schemas.flow_history.safeParse({}).success).toBe(true);
		expect(schemas.flow_history.safeParse({ extra: true }).success).toBe(true);
		expect(
			schemas.flow_history_show.safeParse({ sessionId: "abc123" }).success,
		).toBe(true);
		expect(schemas.flow_history_show.safeParse({}).success).toBe(false);
		expect(
			schemas.flow_session_activate.safeParse({ sessionId: "abc123" }).success,
		).toBe(true);
		expect(schemas.flow_session_activate.safeParse({}).success).toBe(false);

		expect(
			schemas.flow_plan_start.safeParse({ goal: "Build a workflow plugin" })
				.success,
		).toBe(true);
		expect(schemas.flow_plan_start.safeParse({ goal: 123 }).success).toBe(
			false,
		);
		expect(
			schemas.flow_plan_context_record.safeParse({
				repoProfile: ["TypeScript"],
				packageManager: "pnpm",
				stackProfile: {
					languages: [
						{
							name: "TypeScript",
							evidenceRefs: ["tsconfig.json"],
							confidence: "high",
						},
					],
					frameworks: [],
					runtimes: [],
					packageManagers: [
						{
							name: "pnpm",
							evidenceRefs: ["package.json"],
							confidence: "high",
						},
					],
					tools: [],
				},
				standardsProfile: {
					localGuidelines: [
						{
							title: "AGENTS.md",
							sourceType: "local",
							reference: "AGENTS.md",
							confidence: "high",
						},
					],
					externalGuidance: [],
					rules: [
						{
							summary: "Prefer existing package scripts.",
							sourceRefs: ["package.json"],
							priority: "local",
						},
					],
					gaps: [
						{
							stackItem: "React",
							reason: "No local accessibility guidance was detected.",
							suggestedResearch: ["official React accessibility documentation"],
						},
					],
					precedence: ["local repo guidance before external standards"],
				},
				research: ["Check docs if local evidence is insufficient."],
				evidencePackets: [evidencePacket],
				decisionLog: [
					{
						question: "Which path should auto mode recommend?",
						options: [{ label: "Pause and ask", tradeoffs: ["safer"] }],
						recommendation: "Pause and ask",
						rationale: ["Keeps human control on meaningful decisions."],
					},
				],
			}).success,
		).toBe(true);

		expect(
			schemas.flow_plan_apply.safeParse({
				plan: {
					summary: "Implement a workflow.",
					overview: "Create one feature.",
					features: [
						{
							id: "setup-runtime",
							title: "Create runtime helpers",
							summary: "Add runtime helpers.",
							fileTargets: ["src/runtime/session.ts"],
							verification: ["bun test"],
						},
					],
				},
				planning: { evidencePackets: [evidencePacket] },
			}).success,
		).toBe(true);
		expect(
			schemas.flow_plan_apply.safeParse({
				plan: { summary: "Missing fields" },
			}).success,
		).toBe(false);

		expect(
			schemas.flow_plan_approve.safeParse({ featureIds: ["setup-runtime"] })
				.success,
		).toBe(true);
		expect(
			schemas.flow_plan_approve.safeParse({ featureIds: [1] }).success,
		).toBe(false);

		expect(
			schemas.flow_plan_select_features.safeParse({
				featureIds: ["setup-runtime"],
			}).success,
		).toBe(true);
		expect(schemas.flow_plan_select_features.safeParse({}).success).toBe(false);

		expect(
			schemas.flow_run_start.safeParse({ featureId: "setup-runtime" }).success,
		).toBe(true);
		expect(schemas.flow_run_start.safeParse({ featureId: 1 }).success).toBe(
			false,
		);

		expect(
			schemas.flow_review_record_feature.safeParse({
				scope: "feature",
				featureId: "setup-runtime",
				status: "approved",
				summary: "Looks good.",
			}).success,
		).toBe(true);
		expect(schemas.flow_review_record_feature.safeParse({}).success).toBe(
			false,
		);
		expect(
			schemas.flow_review_record_final.safeParse({
				scope: "final",
				reviewScopeLedger: [
					{
						scopeId: "feature:setup-runtime",
						status: "reviewed_no_findings",
						evidenceRefs: ["tests/config/tool-schemas.test.ts"],
						residualRisk: "No additional risk found.",
					},
				],
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: [],
					validationCommands: ["bun test"],
				},
				evidencePackets: [{ ...evidencePacket, purpose: "review" }],
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				behaviorChecks: [
					{
						riskClass: "test_evidence_authenticity",
						result: "gap_recorded",
						invariant: "Current tests miss async interleaving scenarios.",
						entrypointRefs: ["src/runtime/session.ts"],
						stateOwnerRefs: [],
						lifecycleOwnerRefs: [],
						failurePath: "Concurrent updates can bypass assertions.",
						testEvidenceRefs: ["tests/runtime/final-review-contracts.test.ts"],
						validationRefs: ["bun test"],
						remainingGap: "Add concurrent interleaving coverage.",
					},
				],
				validationCoverage: [
					{
						command: "bun test",
						behaviorClasses: ["test_evidence_authenticity"],
						proves: ["Existing runtime tests pass for covered paths."],
						gaps: ["Concurrent interleaving remains uncovered."],
						testEvidenceRefs: ["tests/runtime/final-review-contracts.test.ts"],
					},
				],
				status: "approved",
				summary: "Looks good.",
			}).success,
		).toBe(true);
		expect(schemas.flow_review_record_final.safeParse({}).success).toBe(false);
		expect(
			schemas.flow_review_record_final.safeParse({
				scope: "final",
				reviewDepth: "broad",
				reviewedSurfaces: ["changed_files"],
				evidenceSummary: "Checked changed files.",
				validationAssessment: "No validation was available.",
				status: "approved",
				summary: "Looks good.",
			}).success,
		).toBe(false);
		expect(
			schemas.flow_review_record_final.safeParse({
				scope: "final",
				reviewDepth: "broad",
				reviewedSurfaces: ["changed_files"],
				evidenceSummary: "Checked changed files.",
				validationAssessment: "No validation was available.",
				evidenceRefs: {},
				status: "approved",
				summary: "Looks good.",
			}).success,
		).toBe(false);

		const reviewContextPack = {
			task: "Review tool schema contract",
			changedFiles: ["src/runtime/session.ts"],
			includedContext: [],
			relationships: [],
			validationEvidence: [],
			suggestedValidation: [],
			coverageGaps: [],
			reviewedSurfaces: ["changed_files"],
		};
		const finalReviewWithContextPack = {
			scope: "final",
			reviewDepth: "broad",
			reviewedSurfaces: ["changed_files"],
			evidenceSummary: "Checked changed files.",
			validationAssessment: "No validation was available.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: [],
			},
			status: "approved",
			summary: "Looks good.",
			reviewContextPack,
		};
		const finalReviewTool = tools.flow_review_record_final;
		expect(finalReviewTool).toBeDefined();
		if (!finalReviewTool) return;
		const rawOpenCodeFinalReviewSchema = tool.schema.object(
			finalReviewTool.args,
		);
		expect(
			rawOpenCodeFinalReviewSchema.safeParse(finalReviewWithContextPack)
				.success,
		).toBe(true);
		expect(
			rawOpenCodeFinalReviewSchema.safeParse({
				...finalReviewWithContextPack,
				evidenceRefs: undefined,
			}).success,
		).toBe(false);
		expect(
			rawOpenCodeFinalReviewSchema.safeParse({
				...finalReviewWithContextPack,
				evidenceRefs: {},
			}).success,
		).toBe(false);
		expect(
			rawOpenCodeFinalReviewSchema.safeParse({
				...finalReviewWithContextPack,
				reviewContextPack: {},
			}).success,
		).toBe(false);
		expect(
			rawOpenCodeFinalReviewSchema.safeParse({
				...finalReviewWithContextPack,
				reviewContextPack: {
					...reviewContextPack,
					unexpected: true,
				},
			}).success,
		).toBe(false);

		expect(
			schemas.flow_session_close.safeParse({ kind: "completed" }).success,
		).toBe(true);
		expect(
			schemas.flow_session_close.safeParse({ anything: true }).success,
		).toBe(false);
		expect(
			schemas.flow_reset_feature.safeParse({ featureId: "setup-runtime" })
				.success,
		).toBe(true);
		expect(schemas.flow_reset_feature.safeParse({}).success).toBe(false);
		expect(
			schemas.flow_reset_feature.safeParse({ featureId: "Bad Id" }).success,
		).toBe(false);
		const reviewTarget = {
			repoRoot: "/tmp/flow-review-test-repo",
			repoName: "flow-review-test-repo",
			generatedAt: "2026-06-01T00:00:00.000Z",
			invokedFromCwd: "/tmp/flow-review-test-repo",
		};
		const reviewRenderPayload = {
			reviewTarget,
			requestedDepth: "deep_audit",
			achievedDepth: "deep_audit",
			repoSummary: "Repo summary.",
			overallVerdict: "Overall verdict.",
			discoveredSurfaces: [],
			evidencePackets: [{ ...evidencePacket, purpose: "audit" }],
			coverageNotes: [],
			validationRun: [],
			findings: [],
			view: "both",
		};
		expect(
			schemas.flow_review_render.safeParse(reviewRenderPayload).success,
		).toBe(true);
		expect(
			FlowReviewRenderArgsSchema.safeParse({
				...reviewRenderPayload,
				reviewTarget: undefined,
			}).success,
		).toBe(false);
		expect(
			FlowReviewRenderArgsSchema.safeParse({
				...reviewRenderPayload,
				reviewTarget: undefined,
				view: "structured",
			}).success,
		).toBe(true);
		expect(schemas.flow_review_render.safeParse({}).success).toBe(false);
	});

	test("worker tool raw args reject JSON-string transport fields and nested result shape", () => {
		const { schemas } = getToolSchemas();
		const schema = schemas.flow_run_complete_feature;

		const validPayload = {
			contractVersion: "1",
			reviewScopeLedger: [
				{
					scopeId: "feature:setup-runtime",
					status: "reviewed_no_findings",
					evidenceRefs: ["tests/config/tool-schemas.test.ts"],
					residualRisk: "No additional risk found.",
				},
			],
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		};

		const invalidJsonTransport = { workerJson: asJson(validPayload) };
		const invalidNestedPayload = {
			contractVersion: "1",
			result: validPayload,
		};

		expect(schema.safeParse(validPayload).success).toBe(true);
		expect(schema.safeParse(invalidJsonTransport).success).toBe(false);
		expect(schema.safeParse(invalidNestedPayload).success).toBe(false);
	});

	test("worker tool raw schema stays structurally aligned while runtime schema enforces stricter cross-field rules", () => {
		const { schemas } = getToolSchemas();
		const rawSchema = schemas.flow_run_complete_feature;

		const validCompletion = {
			contractVersion: "1",
			reviewScopeLedger: [
				{
					scopeId: "feature:setup-runtime",
					status: "reviewed_no_findings",
					evidenceRefs: ["tests/config/tool-schemas.test.ts"],
					residualRisk: "No additional risk found.",
				},
			],
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		};

		const invalidCrossField = {
			contractVersion: "1",
			status: "needs_input",
			summary: "Waiting on input.",
			artifactsChanged: [],
			validationRun: [],
			decisions: [],
			nextStep: "Ask the operator.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
			},
			featureReview: {
				status: "needs_followup",
				summary: "Blocked.",
				blockingFindings: [],
			},
		};

		expect(rawSchema.safeParse(validCompletion).success).toBe(true);
		expect(WorkerResultSchema.safeParse(validCompletion).success).toBe(true);

		const invalidWorkerFinalReviewMissingEvidenceRefs = {
			...validCompletion,
			finalReview: {
				status: "passed",
				summary: "Final review passed.",
				reviewDepth: "broad",
				reviewedSurfaces: ["changed_files"],
				evidenceSummary: "Reviewed changed files.",
				validationAssessment: "No validation was available.",
			},
		};
		expect(
			rawSchema.safeParse(invalidWorkerFinalReviewMissingEvidenceRefs).success,
		).toBe(false);
		expect(
			WorkerResultSchema.safeParse(invalidWorkerFinalReviewMissingEvidenceRefs)
				.success,
		).toBe(false);

		expect(rawSchema.safeParse(invalidCrossField).success).toBe(true);
		expect(WorkerResultSchema.safeParse(invalidCrossField).success).toBe(false);
	});

	test("worker tool raw schema rejects invalid feature ids before runtime parsing", () => {
		const { schemas } = getToolSchemas();
		const rawSchema = schemas.flow_run_complete_feature;

		const invalidFeatureId = {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: { featureId: "Bad Id", verificationStatus: "passed" },
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		};

		expect(rawSchema.safeParse(invalidFeatureId).success).toBe(false);
		expect(WorkerResultSchema.safeParse(invalidFeatureId).success).toBe(false);
	});

	test("planning tool schema matches runtime feature id format constraints", () => {
		const { schemas } = getToolSchemas();

		const validPlan = {
			plan: {
				summary: "Implement a workflow.",
				overview: "Create one feature.",
				features: [
					{
						id: "setup-runtime",
						title: "Create runtime helpers",
						summary: "Add runtime helpers.",
						fileTargets: ["src/runtime/session.ts"],
						verification: ["bun test"],
					},
				],
			},
		};

		const invalidPlan = {};
		const invalidJsonTransport = { planJson: asJson(validPlan) };

		expect(schemas.flow_plan_apply.safeParse(validPlan).success).toBe(true);
		expect(schemas.flow_plan_apply.safeParse(invalidPlan).success).toBe(false);
		expect(
			schemas.flow_plan_apply.safeParse(invalidJsonTransport).success,
		).toBe(false);
	});

	test("public tool surface excludes string-transport alias tools", () => {
		const { tools } = getToolSchemas();

		expect("flow_review_record_feature_from_raw" in tools).toBe(false);
		expect("flow_review_record_final_from_raw" in tools).toBe(false);
		expect("flow_run_complete_feature_from_raw" in tools).toBe(false);
		expect(Object.keys(tools).some((name) => name.includes("_from_raw"))).toBe(
			false,
		);
		expect("flow_attachments_materialize" in tools).toBe(false);
	});
});
