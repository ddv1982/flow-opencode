import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildContextPackProjection } from "../../src/runtime/context-pack";
import { buildProjectStructureMap } from "../../src/runtime/project-structure-map";
import {
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	sampleSession,
	toolContext,
} from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } =
	createTempDirRegistry("flow-context-pack-");

afterEach(() => {
	cleanupTempDirs();
});

describe("context pack traceability", () => {
	test("treats changed artifacts inside review scope as planned context", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const context = toolContext(worktree);

		await tools.flow_plan_save.execute(
			{ goal: "Trace scoped context" },
			context,
		);
		await tools.flow_plan_save.execute(
			{
				planning: {
					repoProfile: ["TypeScript plugin using bun test"],
					research: ["Inspected src/planned.ts and src/generated.ts"],
				},
				plan: {
					...samplePlan(),
					features: [
						{
							id: "planned-change",
							title: "Change reviewed file",
							summary: "Update a file named in review scope.",
							fileTargets: ["src/planned.ts"],
							reviewScope: [
								{
									id: "generated-file",
									kind: "file",
									target: "src/generated.ts",
									description: "Generated context updated by the feature",
								},
							],
							verification: ["bun test"],
							status: "pending",
						},
						{
							id: "follow-up",
							title: "Keep session open",
							summary: "Leave a second feature pending.",
							fileTargets: ["src/follow-up.ts"],
							verification: ["bun test"],
							status: "pending",
						},
					],
				},
			},
			context,
		);
		await tools.flow_plan_approve.execute({}, context);
		await tools.flow_run_start.execute({}, context);
		await tools.flow_feature_complete.execute(
			{
				contractVersion: "1",
				status: "ok",
				summary: "Changed a scoped generated file.",
				artifactsChanged: [{ path: "src/generated.ts" }],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tests passed.",
					},
				],
				decisions: [],
				nextStep: "Continue to follow-up.",
				validationScope: "targeted",
				featureResult: {
					featureId: "planned-change",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking feature findings.",
					blockingFindings: [],
				},
			},
			context,
		);

		const status = JSON.parse(await tools.flow_status.execute({}, context)) as {
			contextDiagnostics?: Array<{ id: string }>;
			contextTraceability?: {
				unplannedChangedArtifacts: string[];
				features: Array<{ id: string; gaps: Array<{ id: string }> }>;
			};
		};
		const changedFeature = status.contextTraceability?.features.find(
			(feature) => feature.id === "planned-change",
		);

		expect(
			status.contextDiagnostics?.map((item) => item.id) ?? [],
		).not.toContain("changed_artifacts_outside_planned_context");
		expect(status.contextTraceability?.unplannedChangedArtifacts).toEqual([]);
		expect(changedFeature?.gaps.map((gap) => gap.id)).not.toContain(
			"feature_changed_artifacts_outside_scope",
		);
	});

	test("marks changed artifacts without validation as validation-blocked", () => {
		const session = sampleSession("Detect validation gaps");
		const plan = samplePlan();
		session.plan = plan;
		session.approval = "approved";
		session.status = "running";
		session.execution.activeFeatureId = "setup-runtime";
		session.execution.history = [
			{
				featureId: "setup-runtime",
				status: "needs_input",
				summary: "Changed code before validation.",
				recordedAt: "2026-01-01T00:00:00.000Z",
				nextStep: "Run validation.",
				validationRun: [],
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				decisions: [],
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "not_recorded",
				},
				featureReview: {
					status: "needs_followup",
					summary: "Validation is missing.",
					blockingFindings: [{ summary: "No validation evidence." }],
				},
			},
		];

		const contextPack = buildContextPackProjection(session);

		expect(contextPack.workflowReadiness.state).toBe("blocked_by_validation");
		expect(contextPack.workflowReadiness.blocking[0]?.id).toBe(
			"feature_changed_without_validation",
		);
		expect(
			contextPack.traceability.features.find(
				(feature) => feature.id === "setup-runtime",
			)?.gaps[0]?.id,
		).toBe("feature_changed_without_validation");
		expect(contextPack.quality.rating).toBe("weak");
	});

	test("warns on broad targets without marking matching artifacts as scope drift", () => {
		const session = sampleSession("Detect broad target context");
		session.planning.repoProfile = ["TypeScript plugin using bun test"];
		session.planning.research = ["Inspected repo root for broad change scope"];
		session.plan = {
			...samplePlan(),
			features: [
				{
					id: "broad-change",
					title: "Broad change",
					summary: "Allow a broad change while warning about specificity.",
					fileTargets: ["."],
					verification: ["bun test"],
					status: "pending",
				},
			],
		};
		session.approval = "approved";
		session.status = "running";
		session.execution.activeFeatureId = "broad-change";
		session.execution.history = [
			{
				featureId: "broad-change",
				status: "ok",
				summary: "Changed source under broad target.",
				recordedAt: "2026-01-01T00:00:00.000Z",
				nextStep: "Review.",
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tests passed.",
					},
				],
				artifactsChanged: [{ path: "src/a.ts" }],
				decisions: [],
				featureResult: {
					featureId: "broad-change",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
		];

		const contextPack = buildContextPackProjection(session);
		const changedFeature = contextPack.traceability.features.find(
			(feature) => feature.id === "broad-change",
		);

		expect(contextPack.traceability.unplannedChangedArtifacts).toEqual([]);
		expect(
			contextPack.diagnostics.map((diagnostic) => diagnostic.id),
		).toContain("broad_target_without_narrowed_scope");
		expect(
			contextPack.diagnostics.map((diagnostic) => diagnostic.id),
		).not.toContain("changed_artifacts_outside_planned_context");
		expect(changedFeature?.gaps.map((gap) => gap.id)).not.toContain(
			"feature_changed_artifacts_outside_scope",
		);
		expect(
			contextPack.workflowReadiness.blocking.map((item) => item.id),
		).not.toContain("feature_changed_artifacts_outside_scope");
	});

	test("matches planned validation against the feature's own evidence", () => {
		const session = sampleSession("Detect feature validation mismatch");
		session.plan = {
			...samplePlan(),
			features: [
				{
					id: "feature-a",
					title: "Feature A",
					summary: "Change feature A.",
					fileTargets: ["src/a.ts"],
					verification: ["bun test tests/a.test.ts"],
					status: "pending",
				},
				{
					id: "feature-b",
					title: "Feature B",
					summary: "Record unrelated validation.",
					fileTargets: ["src/b.ts"],
					verification: ["bun test tests/b.test.ts"],
					status: "pending",
				},
			],
		};
		session.approval = "approved";
		session.status = "running";
		session.execution.history = [
			{
				featureId: "feature-a",
				status: "ok",
				summary: "Changed feature A with mismatched validation.",
				recordedAt: "2026-01-01T00:00:00.000Z",
				nextStep: "Review validation.",
				validationRun: [
					{
						command: "bun test tests/wrong.test.ts",
						status: "passed",
						summary: "Wrong targeted test passed.",
					},
				],
				artifactsChanged: [{ path: "src/a.ts" }],
				decisions: [],
				featureResult: {
					featureId: "feature-a",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
			{
				featureId: "feature-b",
				status: "ok",
				summary: "Ran the command planned for feature A.",
				recordedAt: "2026-01-01T00:01:00.000Z",
				nextStep: "Continue.",
				validationRun: [
					{
						command: "bun test tests/a.test.ts",
						status: "passed",
						summary: "Feature A test passed from another feature.",
					},
				],
				artifactsChanged: [],
				decisions: [],
			},
		];

		const contextPack = buildContextPackProjection(session);

		expect(
			contextPack.diagnostics.map((diagnostic) => ({
				id: diagnostic.id,
				featureId: diagnostic.featureId,
			})),
		).toContainEqual({
			id: "feature_validation_not_matched_to_plan",
			featureId: "feature-a",
		});
		expect(
			contextPack.quality.checks.find(
				(check) => check.id === "validation_traceability",
			)?.status,
		).toBe("warn");
	});

	test("flow_context exposes a read-only summary with project structure", async () => {
		const worktree = makeTempDir();
		await mkdir(join(worktree, "src", "runtime"), { recursive: true });
		await mkdir(join(worktree, "tests"), { recursive: true });
		await writeFile(join(worktree, "package.json"), '{"scripts":{}}');
		await writeFile(join(worktree, "src", "runtime", "session.ts"), "");
		await writeFile(join(worktree, "tests", "session.test.ts"), "");
		const tools = createTestTools();
		const context = toolContext(worktree);

		await tools.flow_plan_save.execute(
			{ goal: "Inspect context projection" },
			context,
		);
		await tools.flow_plan_save.execute(
			{
				planning: {
					workflowProfile: "bugfix",
					repoProfile: ["TypeScript plugin using bun test"],
					research: [
						"Inspected src/runtime/session.ts and tests/session.test.ts",
					],
				},
				plan: {
					...samplePlan(),
					features: [
						{
							id: "fix-session",
							title: "Fix session behavior",
							summary: "Patch the runtime session bug.",
							fileTargets: ["src/runtime/session.ts"],
							reviewScope: [
								{
									id: "session-tests",
									kind: "file",
									target: "tests/session.test.ts",
								},
							],
							verification: ["bun test tests/session.test.ts"],
							status: "pending",
						},
					],
				},
			},
			context,
		);

		const response = JSON.parse(
			await tools.flow_context.execute({}, context),
		) as {
			status: string;
			context: {
				workflowProfile: string;
				contextQuality: { score: number; rating: string };
				projectStructure: {
					entryCount: number;
					ignoreSources: string[];
					entries: Array<{ path: string; role: string }>;
				};
			};
		};

		expect(response.status).toBe("ok");
		expect(response.context.workflowProfile).toBe("bugfix");
		expect(response.context.contextQuality.score).toBeGreaterThanOrEqual(85);
		expect(response.context.projectStructure.entryCount).toBeGreaterThan(0);
		expect(response.context.projectStructure.ignoreSources).toEqual(
			expect.arrayContaining(["built-in-directories", "sensitive-names"]),
		);
		expect(response.context.projectStructure.entries).toContainEqual(
			expect.objectContaining({
				path: "src/runtime/session.ts",
				role: "planned",
			}),
		);
	});

	test("project structure map ignores Flow state and marks changed artifacts", async () => {
		const worktree = makeTempDir();
		await mkdir(join(worktree, ".flow", "active"), { recursive: true });
		await mkdir(join(worktree, "custom-generated"), { recursive: true });
		await mkdir(join(worktree, "secrets"), { recursive: true });
		await mkdir(join(worktree, "src"), { recursive: true });
		await writeFile(
			join(worktree, ".gitignore"),
			["ignored.log", "custom-generated/"].join("\n"),
		);
		await writeFile(join(worktree, ".env"), "FLOW_SECRET=hidden");
		await writeFile(join(worktree, ".env.local"), "FLOW_SECRET=hidden");
		await writeFile(
			join(worktree, ".npmrc"),
			"//registry.example/:_authToken=x",
		);
		await writeFile(join(worktree, "certificate.pem"), "secret");
		await writeFile(join(worktree, "custom-generated", "output.ts"), "");
		await writeFile(join(worktree, ".flow", "active", "internal.json"), "{}");
		await writeFile(join(worktree, "ignored.log"), "ignored");
		await writeFile(join(worktree, "secrets", "token.txt"), "secret");
		await writeFile(join(worktree, "src", "changed.ts"), "");
		const session = sampleSession("Map project structure");
		session.plan = {
			...samplePlan(),
			features: [
				{
					id: "map-structure",
					title: "Map structure",
					summary: "Map changed runtime structure.",
					fileTargets: [
						"src",
						".env.local",
						"custom-generated",
						"../outside.ts",
						"/tmp/outside.ts",
					],
					verification: ["bun test"],
					status: "pending",
				},
			],
		};
		session.execution.history = [
			{
				featureId: "map-structure",
				status: "ok",
				summary: "Changed source.",
				recordedAt: "2026-01-01T00:00:00.000Z",
				nextStep: "Review.",
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tests passed.",
					},
				],
				artifactsChanged: [
					{ path: "src/changed.ts" },
					{ path: ".env" },
					{ path: "ignored.log" },
					{ path: "secrets/token.txt" },
					{ path: "../outside.ts" },
					{ path: "/tmp/outside.ts" },
				],
				decisions: [],
				featureResult: {
					featureId: "map-structure",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
		];

		const map = await buildProjectStructureMap(worktree, session);
		const mappedPaths = map.entries.map((entry) => entry.path);

		expect(map.ignoreSources).toEqual(
			expect.arrayContaining([
				"built-in-directories",
				"sensitive-names",
				".gitignore",
			]),
		);
		expect(mappedPaths.some((path) => path.startsWith(".flow"))).toBe(false);
		expect(
			mappedPaths.some((path) => path.startsWith("custom-generated")),
		).toBe(false);
		expect(mappedPaths.some((path) => path.startsWith("secrets"))).toBe(false);
		expect(mappedPaths).not.toEqual(
			expect.arrayContaining([
				".env",
				".env.local",
				".npmrc",
				"certificate.pem",
				"ignored.log",
			]),
		);
		expect(map.focus.plannedTargetsRedacted).toBe(4);
		expect(map.focus.changedArtifactsRedacted).toBe(5);
		expect(map.focus.plannedTargets).not.toEqual(
			expect.arrayContaining([
				".env.local",
				"custom-generated",
				"../outside.ts",
				"/tmp/outside.ts",
			]),
		);
		expect(map.focus.changedArtifacts).not.toEqual(
			expect.arrayContaining([
				".env",
				"ignored.log",
				"secrets/token.txt",
				"../outside.ts",
				"/tmp/outside.ts",
			]),
		);
		expect(map.focus.plannedTargets).toContain(
			"[redacted sensitive or ignored path]",
		);
		expect(map.focus.changedArtifacts).toContain(
			"[redacted sensitive or ignored path]",
		);
		expect(map.entries).toContainEqual(
			expect.objectContaining({ path: "src/changed.ts", role: "changed" }),
		);
	});

	test("project structure map redacts unsafe focus paths without gitignore", async () => {
		const worktree = makeTempDir();
		await mkdir(join(worktree, "src"), { recursive: true });
		await writeFile(join(worktree, "src", "changed.ts"), "");
		const session = sampleSession("Redact unsafe focus paths");
		session.plan = {
			...samplePlan(),
			features: [
				{
					id: "redact-focus",
					title: "Redact focus",
					summary: "Redact unsafe project map focus entries.",
					fileTargets: ["src", "../outside.ts", "/tmp/outside.ts"],
					verification: ["bun test"],
					status: "pending",
				},
			],
		};
		session.execution.history = [
			{
				featureId: "redact-focus",
				status: "ok",
				summary: "Changed source.",
				recordedAt: "2026-01-01T00:00:00.000Z",
				nextStep: "Review.",
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tests passed.",
					},
				],
				artifactsChanged: [
					{ path: "src/changed.ts" },
					{ path: "../outside.ts" },
					{ path: "/tmp/outside.ts" },
				],
				decisions: [],
				featureResult: {
					featureId: "redact-focus",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
		];

		const map = await buildProjectStructureMap(worktree, session);

		expect(map.ignoreSources).not.toContain(".gitignore");
		expect(map.focus.plannedTargetsRedacted).toBe(2);
		expect(map.focus.changedArtifactsRedacted).toBe(2);
		expect(map.focus.plannedTargets).not.toEqual(
			expect.arrayContaining(["../outside.ts", "/tmp/outside.ts"]),
		);
		expect(map.focus.changedArtifacts).not.toEqual(
			expect.arrayContaining(["../outside.ts", "/tmp/outside.ts"]),
		);
		expect(map.focus.plannedTargets).toContain(
			"[redacted sensitive or ignored path]",
		);
		expect(map.focus.changedArtifacts).toContain(
			"[redacted sensitive or ignored path]",
		);
	});

	test("marks unplanned changed artifacts as context-blocked after approval", () => {
		const session = sampleSession("Detect scope drift");
		session.plan = samplePlan();
		session.approval = "approved";
		session.status = "ready";
		session.execution.history = [
			{
				featureId: "setup-runtime",
				status: "ok",
				summary: "Changed code outside the planned target.",
				recordedAt: "2026-01-01T00:00:00.000Z",
				nextStep: "Review scope drift.",
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tests passed.",
					},
				],
				artifactsChanged: [{ path: "src/unplanned.ts" }],
				decisions: [],
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
		];

		const contextPack = buildContextPackProjection(session);

		expect(contextPack.workflowReadiness.state).toBe("blocked_by_context");
		expect(
			contextPack.workflowReadiness.blocking.map((item) => item.id),
		).toEqual(
			expect.arrayContaining([
				"changed_artifacts_outside_planned_context",
				"feature_changed_artifacts_outside_scope",
			]),
		);
		expect(contextPack.traceability.unplannedChangedArtifacts).toEqual([
			"src/unplanned.ts",
		]);
	});

	test("compact status exposes workflow readiness and traceability summary", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const context = toolContext(worktree);

		await tools.flow_plan_save.execute(
			{ goal: "Expose compact status" },
			context,
		);
		await tools.flow_plan_save.execute(
			{
				planning: {
					repoProfile: ["TypeScript plugin using bun test"],
					research: ["Inspected runtime status presenters"],
				},
				plan: samplePlan(),
			},
			context,
		);

		const compact = JSON.parse(
			await tools.flow_status.execute({ view: "compact" }, context),
		) as {
			workflowReadiness?: {
				state: string;
				blockingCount: number;
				warningCount: number;
				nextAction: string;
			};
			contextTraceability?: {
				plannedTargetCount: number;
				changedArtifactCount: number;
				validationCommandCount: number;
			};
		};

		expect(compact.workflowReadiness?.state).toBe("planning_ready");
		expect(compact.workflowReadiness?.blockingCount).toBe(0);
		expect(compact.workflowReadiness?.nextAction).toContain("Finish the plan");
		expect(compact.contextTraceability?.plannedTargetCount).toBeGreaterThan(0);
		expect(compact.contextTraceability?.changedArtifactCount).toBe(0);
		expect(compact.contextTraceability?.validationCommandCount).toBe(0);
	});
});
