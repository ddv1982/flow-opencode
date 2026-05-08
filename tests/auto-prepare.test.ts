import { afterEach, describe, expect, test } from "bun:test";
import {
	captureOpenCodeAttachments,
	clearFlowAttachments,
} from "../src/adapters/opencode/attachment-store";
import { readValidStackStandardsProfileCache } from "../src/runtime/application/stack-standards-profile";
import { createSession, saveSession } from "../src/runtime/session";
import {
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

const PNG_HEADER_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function dataUrl(mime: string, bytes: Buffer) {
	return `data:${mime};base64,${bytes.toString("base64")}`;
}

const sampleStackProfile = {
	languages: [
		{ name: "TypeScript", evidenceRefs: ["tsconfig.json"], confidence: "high" },
	],
	frameworks: [],
	runtimes: [],
	packageManagers: [
		{ name: "bun", evidenceRefs: ["package.json"], confidence: "high" },
	],
	tools: [],
} as const;

const sampleStandardsProfile = {
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
	gaps: [],
	precedence: ["local repo guidance before external standards"],
} as const;

afterEach(() => {
	clearFlowAttachments();
	cleanupTempDirs();
});

describe("flow_auto_prepare semantics", () => {
	test("resume mode returns /flow-auto resume for empty input and explicit resume", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		await saveSession(worktree, createSession("Build a workflow plugin"));

		for (const input of [{}, { argumentString: "resume" }]) {
			const response = await tools.flow_auto_prepare.execute(input, {
				worktree,
			} as never);
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe("ok");
			expect(parsed.mode).toBe("resume");
			expect(parsed.goal).toBe("Build a workflow plugin");
			expect(parsed.phase).toBe("planning");
			expect(parsed.lane).toBe("lite");
			expect(parsed.nextCommand).toBe("/flow-auto resume");
		}
	});

	test("missing session plus empty input returns missing_goal with /flow-auto <goal>", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute({}, {
			worktree,
		} as never);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing_goal");
		expect(parsed.phase).toBe("idle");
		expect(parsed.lane).toBe("lite");
		expect(parsed.nextCommand).toBe("/flow-auto <goal>");
		expect(String(parsed.summary)).toContain("goal");
	});

	test("returns materialization guidance for supported current-message attachments without leaking data URLs", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		captureOpenCodeAttachments({
			sessionId: "session-1",
			messageId: "message-1",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "hero.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
			],
		});

		const response = await tools.flow_auto_prepare.execute(
			{ argumentString: "Use the attached image" },
			toolContext(worktree, undefined, {
				sessionID: "session-1",
				messageID: "message-1",
			}),
		);
		const parsed = JSON.parse(response);

		expect(parsed.attachmentGuidance).toMatchObject({
			status: "available",
			source: "current_message",
			materializationRequired: true,
			materialize: {
				tool: "flow_attachments_materialize",
				args: { destinationDirectory: "assets/flow-attachments" },
				useImplicitCurrentBatch: true,
			},
			attachments: [{ id: "png-1", filename: "hero.png", mime: "image/png" }],
			skipped: [],
		});
		expect(parsed.attachmentGuidance.materialize.args).not.toHaveProperty(
			"attachments",
		);
		expect(JSON.stringify(parsed.attachmentGuidance)).not.toContain(
			"data:image",
		);
	});

	test("returns none guidance when no attachments exist for the OpenCode session", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute(
			{ argumentString: "Improve recovery" },
			toolContext(worktree, undefined, { sessionID: "session-1" }),
		);
		const parsed = JSON.parse(response);

		expect(parsed.attachmentGuidance).toMatchObject({
			status: "none",
			source: "none",
			materializationRequired: false,
			materialize: null,
			attachments: [],
			skipped: [],
		});
	});

	test("returns required guidance for mixed and unsupported-only latest batches", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		captureOpenCodeAttachments({
			sessionId: "mixed-session",
			parts: [
				{
					id: "png-1",
					type: "file",
					mime: "image/png",
					filename: "safe.png",
					url: dataUrl("image/png", PNG_HEADER_BYTES),
				},
				{
					id: "svg-1",
					type: "file",
					mime: "image/svg+xml",
					filename: "unsafe.svg",
					url: "data:image/svg+xml;base64,PHN2Zy8+",
				},
			],
		});
		captureOpenCodeAttachments({
			sessionId: "unsupported-session",
			parts: [
				{
					id: "svg-2",
					type: "file",
					mime: "image/svg+xml",
					filename: "only.svg",
					url: "data:image/svg+xml;base64,PHN2Zy8+",
				},
			],
		});

		const mixed = JSON.parse(
			await tools.flow_auto_prepare.execute(
				{ argumentString: "Use assets" },
				toolContext(worktree, undefined, { sessionID: "mixed-session" }),
			),
		);
		const unsupported = JSON.parse(
			await tools.flow_auto_prepare.execute(
				{ argumentString: "Use assets" },
				toolContext(worktree, undefined, {
					sessionID: "unsupported-session",
				}),
			),
		);

		expect(mixed.attachmentGuidance.status).toBe("mixed");
		expect(mixed.attachmentGuidance.source).toBe("latest_batch");
		expect(mixed.attachmentGuidance.materializationRequired).toBe(true);
		expect(mixed.attachmentGuidance.attachments).toHaveLength(1);
		expect(mixed.attachmentGuidance.skipped).toEqual([
			expect.objectContaining({ attachmentId: "svg-1" }),
		]);
		expect(mixed.attachmentGuidance.materialize.args).not.toHaveProperty(
			"attachments",
		);
		expect(unsupported.attachmentGuidance.status).toBe("unsupported_only");
		expect(unsupported.attachmentGuidance.materializationRequired).toBe(true);
		expect(unsupported.attachmentGuidance.attachments).toEqual([]);
		expect(unsupported.attachmentGuidance.skipped).toEqual([
			expect.objectContaining({ attachmentId: "svg-2" }),
		]);
	});

	test("planning context schema accepts a decision log payload", async () => {
		const tools = createTestTools();
		const worktree = makeTempDir();
		await tools.flow_plan_start.execute({ goal: "Build a workflow plugin" }, {
			worktree,
		} as never);

		const response = await tools.flow_plan_context_record.execute(
			{
				repoProfile: ["TypeScript", "Bun"],
				packageManager: "bun",
				research: [
					"Confirm Bun plugin packaging docs if local evidence is unclear.",
				],
				stackProfile: sampleStackProfile,
				standardsProfile: sampleStandardsProfile,
				decisionLog: [
					{
						question:
							"How should autonomous mode handle unresolved architecture choices?",
						decisionMode: "recommend_confirm",
						decisionDomain: "architecture",
						options: [
							{ label: "Pause and ask", tradeoffs: ["safer", "slower"] },
							{ label: "Auto-guess", tradeoffs: ["faster", "riskier"] },
						],
						recommendation: "Pause and ask",
						rationale: ["Preserves user intent for meaningful decisions."],
					},
				],
			},
			{ worktree } as never,
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.session.planning.packageManager).toBe("bun");
		expect(parsed.session.planning.decisionLog).toHaveLength(1);
		expect(parsed.session.planning.decisionLog[0]).toMatchObject({
			decisionMode: "recommend_confirm",
			decisionDomain: "architecture",
		});
		const cachedProfile = await readValidStackStandardsProfileCache(
			worktree,
			undefined,
			{ packageManager: "bun", ambiguous: false },
		);
		expect(cachedProfile?.stackProfile?.languages[0]?.name).toBe("TypeScript");
		expect(cachedProfile?.standardsProfile?.localGuidelines[0]?.reference).toBe(
			"AGENTS.md",
		);
	});

	test("plan apply writes a strict readable stack standards cache", async () => {
		const tools = createTestTools();
		const worktree = makeTempDir();
		await tools.flow_plan_start.execute({ goal: "Build a workflow plugin" }, {
			worktree,
		} as never);

		const response = await tools.flow_plan_apply.execute(
			{
				plan: samplePlan(),
				planning: {
					repoProfile: ["TypeScript", "Bun"],
					packageManager: "bun",
					stackProfile: sampleStackProfile,
					standardsProfile: sampleStandardsProfile,
				},
			},
			{ worktree } as never,
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		const cachedProfile = await readValidStackStandardsProfileCache(
			worktree,
			undefined,
			{ packageManager: "bun", ambiguous: false },
		);
		expect(cachedProfile?.stackProfile?.packageManagers[0]?.name).toBe("bun");
		expect(cachedProfile).not.toHaveProperty("repoProfile");
	});
});
