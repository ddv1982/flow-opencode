// Owns OpenCode tool arg-shape, zod/plugin alignment, and raw-schema
// contract coverage previously grouped in tests/config.test.ts.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tool } from "../../src/adapters/opencode/sdk";
import {
	getOpenCodeToolProjection,
	OPENCODE_TOOL_NAMES,
	OPENCODE_TOOL_PROJECTIONS,
} from "../../src/adapters/opencode/tool-projections.generated";
import { WorkerResultSchema } from "../../src/runtime/schema";
import { asJson, getToolSchemas, projectPath, readJson } from "./helpers";

describe("tool schema config contracts", () => {
	test("OpenCode tool surface is ordered by the adapter projection registry", () => {
		const { tools } = getToolSchemas();

		expect(Object.keys(tools)).toEqual(OPENCODE_TOOL_NAMES);
		expect(
			OPENCODE_TOOL_PROJECTIONS.map((projection) => projection.toolName),
		).toEqual(OPENCODE_TOOL_NAMES);
		expect(
			getOpenCodeToolProjection("flow_run_complete_feature")?.coreAction,
		).toBe("complete_run");
		expect(
			getOpenCodeToolProjection("flow_review_record_final")?.coreAction,
		).toBe("record_reviewer_decision");
		expect(
			getOpenCodeToolProjection("flow_review_record_feature")?.runtimeAction,
		).toBe("record_feature_review");
		expect(
			getOpenCodeToolProjection("flow_review_record_final")?.runtimeAction,
		).toBe("record_final_review");
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

		// These ceilings intentionally leave narrow headroom over the measured
		// evidence-packet schema growth so unrelated future bloat still fails fast.
		expect(totalSize).toBeLessThan(258000);
		expect(schemaSizes.flow_plan_apply).toBeLessThan(71500);
		expect(schemaSizes.flow_plan_context_record).toBeLessThan(58500);
		expect(schemaSizes.flow_run_complete_feature).toBeLessThan(52750);
		expect(schemaSizes.flow_review_record_feature).toBeLessThan(9700);
		expect(schemaSizes.flow_review_record_final).toBeLessThan(31000);
		expect(schemaSizes.flow_review_render).toBeLessThan(31000);
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
				status: "approved",
				summary: "Looks good.",
			}).success,
		).toBe(true);
		expect(schemas.flow_review_record_final.safeParse({}).success).toBe(false);

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
		expect(
			schemas.flow_review_render.safeParse({
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
			}).success,
		).toBe(true);
		expect(schemas.flow_review_render.safeParse({}).success).toBe(false);
	});

	test("worker tool raw args reject JSON-string transport fields and nested result shape", () => {
		const { schemas } = getToolSchemas();
		const schema = schemas.flow_run_complete_feature;

		const validPayload = {
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
	});
});
