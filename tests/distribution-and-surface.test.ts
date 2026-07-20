import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import packageJson from "../package.json" with { type: "json" };
import {
	applyFlowConfig,
	createFlowCoreConfigEntries,
} from "../src/config-shared.js";
import {
	cleanupLegacySkills,
	resolveLegacyArchiveRoot,
} from "../src/distribution/legacy-cleanup.js";
import {
	FLOW_GUIDANCE_DEFINITIONS,
	FLOW_GUIDANCE_DOCUMENTS,
	FLOW_GUIDANCE_IDS,
	FLOW_GUIDANCE_TOPICS,
	getFlowGuidance,
} from "../src/guidance/catalog.js";
import FlowPlugin from "../src/index.js";
import { createFlowLog } from "../src/platform/opencode/logging.js";
import { createTools } from "../src/platform/opencode/tools.js";
import { auditLifecycleFlatRequestExamples } from "../src/prompt-quality.js";
import { compiledFlowPromptSurfaces } from "../src/prompt-surfaces.js";
import { resolveFlowPluginVersion } from "../src/version.js";

async function tempDirectory(prefix: string): Promise<string> {
	const path = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`);
	await mkdir(path, { recursive: true });
	return path;
}

async function tempHome(): Promise<string> {
	return tempDirectory("flow-home");
}

async function tempWorkspace(): Promise<string> {
	return tempDirectory("flow-workspace");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function pluginContext(workspace: string) {
	return {
		client: { app: { log() {} } },
		project: {},
		directory: workspace,
		worktree: workspace,
		experimental_workspace: { register() {} },
		serverUrl: new URL("http://localhost"),
		$: {},
	} as unknown as Parameters<typeof FlowPlugin>[0];
}

const activePluginHooks: Array<Awaited<ReturnType<typeof FlowPlugin>>> = [];

async function loadFlowPlugin(context: Parameters<typeof FlowPlugin>[0]) {
	const hooks = await FlowPlugin(context);
	activePluginHooks.push(hooks);
	return hooks;
}

afterEach(async () => {
	for (const hooks of activePluginHooks.splice(0).reverse()) {
		await hooks.dispose?.();
	}
});

async function runFlowCli(args: string[], home?: string) {
	const cliHome = home ?? (await tempHome());
	return spawnSync(process.execPath, ["run", "./src/cli.ts", ...args], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: { ...process.env, HOME: cliHome },
	});
}

function expectSafeFrontmatter(path: string, markdown: string): void {
	expect(markdown, `${path} frontmatter start`).toStartWith("---\n");
	const end = markdown.indexOf("\n---", 4);
	expect(end, `${path} frontmatter end`).toBeGreaterThan(3);
	const unsafe = markdown
		.slice(4, end)
		.split("\n")
		.filter((line) => {
			const match = /^[A-Za-z0-9_-]+:\s+(.*)$/.exec(line);
			if (!match?.[1]) return false;
			const value = match[1].trimStart();
			if (/^["'|>]/.test(value)) return false;
			return /:\s/.test(value);
		});
	expect(unsafe, `${path} unquoted YAML values`).toEqual([]);
}

function nonCanonicalFlowGuidanceReferences(markdown: string): string[] {
	const referenceIdByBasename = new Map(
		FLOW_GUIDANCE_IDS.filter((id) => id.includes("/references/")).map(
			(id) => [id.slice(id.lastIndexOf("/") + 1), id] as const,
		),
	);
	const violations = new Set<string>();
	for (const match of markdown.matchAll(
		/(?<![A-Za-z0-9_.-])(\/?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.md(?:#[A-Za-z0-9_./-]+)?)/g,
	)) {
		const reference = match[1];
		if (!reference) continue;
		const path = reference.split("#", 1)[0];
		if (!path) continue;
		const basename = path.slice(path.lastIndexOf("/") + 1);
		const expected = referenceIdByBasename.get(basename);
		const withoutTraversal = path.replace(/^(?:\/|(?:\.\.?\/)+)/, "");
		const looksLikeGuidancePath =
			withoutTraversal.startsWith("references/") ||
			/^flow(?:-[a-z-]+)?\/references\//.test(withoutTraversal);
		const isBareKnownGuidanceName =
			expected !== undefined && !path.includes("/");
		if (
			(expected &&
				(isBareKnownGuidanceName || looksLikeGuidancePath) &&
				reference !== expected) ||
			(!expected && looksLikeGuidancePath)
		) {
			violations.add(reference);
		}
	}
	return [...violations].sort();
}

async function installPristineLegacyTopic(
	home: string,
	topic: string,
	markerVersion = "4.4.0",
) {
	const definition = FLOW_GUIDANCE_DEFINITIONS.find(
		(candidate) => candidate.name === topic,
	);
	if (!definition) throw new Error(`Unknown topic ${topic}`);
	const folder = join(home, ".config", "opencode", "skills", topic);
	for (const file of definition.files) {
		const path = join(folder, ...file.relativePath.split("/"));
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, file.content, "utf8");
	}
	await writeFile(
		join(folder, ".flow-skill-version"),
		[
			`version=${markerVersion}`,
			...definition.files.map(
				(file) => `file=${file.relativePath} sha256=${sha256(file.content)}`,
			),
			"",
		].join("\n"),
		"utf8",
	);
	return folder;
}

describe("embedded guidance and plugin surface", () => {
	test("keeps the nine state/guidance tools as the core surface", () => {
		expect(Object.keys(createTools({})).sort()).toEqual([
			"flow_feature_complete",
			"flow_feature_reset",
			"flow_guidance",
			"flow_plan_approve",
			"flow_plan_save",
			"flow_review_start",
			"flow_run_start",
			"flow_session_close",
			"flow_status",
		]);
	});

	test("exposes the three harness tools through the composed plugin surface", async () => {
		const workspace = await tempWorkspace();
		const hooks = await loadFlowPlugin(pluginContext(workspace));
		expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([
			"flow_audit_render",
			"flow_feature_complete",
			"flow_feature_reset",
			"flow_guidance",
			"flow_orchestration_admit",
			"flow_plan_approve",
			"flow_plan_save",
			"flow_review_start",
			"flow_run_start",
			"flow_session_close",
			"flow_status",
			"flow_validation_start",
		]);
	});

	test("keeps every guidance id and model-visible reference callable", async () => {
		expect(FLOW_GUIDANCE_TOPICS).toEqual([
			"flow",
			"flow-plan",
			"flow-run",
			"flow-test",
			"flow-review",
			"flow-deslop",
			"flow-ui-quality",
			"flow-commit",
		]);
		expect(FLOW_GUIDANCE_DOCUMENTS).toHaveLength(FLOW_GUIDANCE_IDS.length);
		expect(new Set(FLOW_GUIDANCE_IDS).size).toBe(FLOW_GUIDANCE_IDS.length);
		for (const document of FLOW_GUIDANCE_DOCUMENTS) {
			expect(getFlowGuidance(document.id)).toBe(document);
			expect(document.content.length).toBeGreaterThan(40);
			expect(
				nonCanonicalFlowGuidanceReferences(document.content),
				`${document.id} contains a noncanonical or unknown guidance reference`,
			).toEqual([]);
			expect(
				auditLifecycleFlatRequestExamples(document.content),
				`${document.id} contains a flat lifecycle request example`,
			).toEqual([]);
			if (document.relativePath === "SKILL.md") {
				expectSafeFrontmatter(document.id, document.content);
			}
		}
		for (const [surface, compiled] of Object.entries(
			compiledFlowPromptSurfaces(),
		)) {
			expect(
				nonCanonicalFlowGuidanceReferences(compiled.text),
				`${surface} contains a noncanonical or unknown guidance reference`,
			).toEqual([]);
		}
		expect(
			nonCanonicalFlowGuidanceReferences(
				[
					"`../../flow/references/parallel-synthesis.md`",
					"`parallel-decision.md`",
					"`references/review-rubric.md`",
					"`/flow/references/parallel-decision.md`",
					"`flow/references/not-shipped.md`",
					"[handoff](handoff-format.md)",
					"```text",
					"flow/references/parallel-synthesis.md#record-bounded-accounting",
					"```",
					"`flow-rnu/references/parallel-decision.md`",
				].join("\n"),
			),
		).toEqual([
			"../../flow/references/parallel-synthesis.md",
			"/flow/references/parallel-decision.md",
			"flow-rnu/references/parallel-decision.md",
			"flow/references/not-shipped.md",
			"flow/references/parallel-synthesis.md#record-bounded-accounting",
			"handoff-format.md",
			"parallel-decision.md",
			"references/review-rubric.md",
		]);
		expect(
			nonCanonicalFlowGuidanceReferences(
				"Ordinary artifacts such as `README.md`, `docs/operations.md`, `docs/review-rubric.md`, `examples/parallel-decision.md`, `CHANGELOG.md`, `docs/auth.md`, `/tmp/flow-handoff.md`, and `/tmp/flow-synthesis.md` are not guidance ids.",
			),
		).toEqual([]);

		const guidanceTool = createTools({}).flow_guidance;
		if (!guidanceTool) throw new Error("Expected flow_guidance tool");
		for (const id of FLOW_GUIDANCE_IDS) {
			const output = await guidanceTool.execute(
				{ id },
				{} as Parameters<typeof guidanceTool.execute>[1],
			);
			expect(String(output)).toBe(getFlowGuidance(id).content);
		}
	});

	test("routes optional helpers through package guidance", () => {
		const config = createFlowCoreConfigEntries();
		for (const command of ["flow-auto", "flow-plan", "flow-run"] as const) {
			const template = config.command[command]?.template;
			if (!template) throw new Error(`Missing command ${command}`);
			expect(template).toContain("`flow_guidance`");
			expect(template).not.toContain("setup.skills");
			expect(template).toContain("never a native skill call");
		}
		expect(getFlowGuidance("flow-test").content).toContain(
			"flow_validation_start",
		);
		expect(getFlowGuidance("flow-test").content).toContain("validationRefs");
		expect(getFlowGuidance("flow-test").content).toContain("flow_review_start");
		expect(getFlowGuidance("flow-deslop").content).toContain(
			"flow-deslop/references/smell-rubric.md",
		);
		expect(getFlowGuidance("flow-ui-quality").content).toContain(
			"flow-ui-quality/references/ui-rubric.md",
		);
		expect(getFlowGuidance("flow-commit").content).toContain(
			"only when the user asks",
		);
	});

	test("marks manager and reviewer command dispatch explicitly", () => {
		const commands = createFlowCoreConfigEntries().command;
		for (const name of [
			"flow-auto",
			"flow-plan",
			"flow-run",
			"flow-status",
		] as const) {
			const manager = commands[name];
			if (!manager) throw new Error(`Missing manager command ${name}`);
			expect(manager.subtask).toBe(false);
			expect("agent" in manager).toBe(false);
		}
		const review = commands["flow-review"];
		if (!review) throw new Error("Missing flow-review command");
		expect(review.subtask).toBe(true);
		expect("agent" in review ? review.agent : undefined).toBe("flow-reviewer");
	});

	test("keeps hidden workers isolated from guidance and state changes", () => {
		const config = createFlowCoreConfigEntries();
		expect(Object.keys(config.agent).sort()).toEqual([
			"flow-audit-worker",
			"flow-candidate-worker",
			"flow-evidence-worker",
			"flow-reviewer",
			"flow-validation-worker",
			"flow-verifier-worker",
		]);
		for (const agent of Object.values(config.agent)) {
			expect(agent.hidden).toBe(true);
			expect(agent.permission?.["flow_*"]).toBe("deny");
			expect(agent.permission?.flow_status).toBe("allow");
			expect(agent.permission?.skill).toBe("deny");
		}
		const validationPermission = config.agent["flow-validation-worker"]
			?.permission as Record<string, unknown>;
		const auditPermission = config.agent["flow-audit-worker"]
			?.permission as Record<string, unknown>;
		expect(validationPermission.flow_validation_start).toBe("allow");
		expect(auditPermission.flow_audit_render).toBe("allow");
		for (const [name, agent] of Object.entries(config.agent)) {
			const permission = agent.permission as Record<string, unknown>;
			if (name !== "flow-validation-worker") {
				expect(permission.flow_validation_start).toBeUndefined();
			}
			if (name !== "flow-audit-worker") {
				expect(permission.flow_audit_render).toBeUndefined();
			}
		}
	});

	test("keeps worker model routing configurable by worker class", () => {
		const names = [
			"OPENCODE_FLOW_WORKER_MODEL",
			"OPENCODE_FLOW_READONLY_WORKER_MODEL",
			"OPENCODE_FLOW_REVIEW_WORKER_MODEL",
			"OPENCODE_FLOW_CANDIDATE_WORKER_MODEL",
		] as const;
		const previous = Object.fromEntries(
			names.map((name) => [name, process.env[name]]),
		);
		try {
			process.env.OPENCODE_FLOW_WORKER_MODEL = "provider/fallback";
			process.env.OPENCODE_FLOW_READONLY_WORKER_MODEL = "provider/readonly";
			process.env.OPENCODE_FLOW_REVIEW_WORKER_MODEL = "provider/review";
			process.env.OPENCODE_FLOW_CANDIDATE_WORKER_MODEL = "provider/candidate";
			const agents = createFlowCoreConfigEntries().agent;
			expect(agents["flow-evidence-worker"]?.model).toBe("provider/readonly");
			expect(agents["flow-validation-worker"]?.model).toBe("provider/readonly");
			expect(agents["flow-reviewer"]?.model).toBe("provider/review");
			expect(agents["flow-verifier-worker"]?.model).toBe("provider/review");
			expect(agents["flow-candidate-worker"]?.model).toBe("provider/candidate");
		} finally {
			for (const name of names) {
				const value = previous[name];
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}
	});

	test("initializes concurrently without writing to HOME or following hostile links", async () => {
		const home = await tempHome();
		const workspace = await tempWorkspace();
		const external = join(await tempDirectory("flow-external"), "SKILL.md");
		await writeFile(external, "external-user-content\n", "utf8");
		const hostileFolder = join(home, ".config", "opencode", "skills", "flow");
		await mkdir(hostileFolder, { recursive: true });
		await symlink(external, join(hostileFolder, "SKILL.md"));

		const previousHome = process.env.HOME;
		process.env.HOME = home;
		try {
			await Promise.all(
				Array.from({ length: 12 }, () =>
					loadFlowPlugin(pluginContext(workspace)),
				),
			);
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
		}

		expect(await readFile(external, "utf8")).toBe("external-user-content\n");
		expect(
			(await lstat(join(hostileFolder, "SKILL.md"))).isSymbolicLink(),
		).toBe(true);
		expect(await readdir(hostileFolder)).toEqual(["SKILL.md"]);
	});

	test("flow_status has no distribution setup state", async () => {
		const workspace = await tempWorkspace();
		const statusTool = createTools({}).flow_status;
		if (!statusTool) throw new Error("Expected flow_status tool");
		const output = await statusTool.execute({ request: { view: "compact" } }, {
			directory: workspace,
			worktree: workspace,
		} as Parameters<typeof statusTool.execute>[1]);
		const parsed = JSON.parse(String(output));
		expect(parsed.setup).toBeUndefined();
		expect(parsed.nextAction).toBeString();
	});
});

describe("command and config hooks", () => {
	test("keeps Flow operational across simultaneous OpenCode project contexts", async () => {
		const workspaces = await Promise.all(
			Array.from({ length: 11 }, () => tempWorkspace()),
		);
		const hooksByProject = await Promise.all(
			workspaces.map((workspace) => loadFlowPlugin(pluginContext(workspace))),
		);

		for (const hooks of hooksByProject) {
			const config = {};
			if (!hooks.config) throw new Error("Expected config hook");
			await hooks.config(config);

			const preflight = hooks["command.execute.before"];
			if (!preflight) throw new Error("Expected command preflight hook");
			const output = { parts: [{ type: "text", text: "stale" }] };
			await preflight(
				{
					command: "flow-plan",
					sessionID: "multi-project",
					arguments: "verify project isolation",
				},
				output as unknown as Parameters<typeof preflight>[1],
			);
			expect(output.parts[1]?.text).toContain("Bundled flow-plan/SKILL.md");
		}
	});

	test.each([
		{
			profile: "control",
			rollout: "control",
			expected: "do not add flow_orchestration_admit ceremony",
		},
		{
			profile: "assurance",
			rollout: "enforce",
			expected: "Use broader admitted evidence",
		},
	] as const)(
		"injects the trusted $profile runtime policy without relaxing receipts",
		async ({ profile, rollout, expected }) => {
			const previousProfile = process.env.OPENCODE_FLOW_HARNESS_PROFILE;
			const previousRollout = process.env.OPENCODE_FLOW_ROLLOUT_MODE;
			process.env.OPENCODE_FLOW_HARNESS_PROFILE = profile;
			process.env.OPENCODE_FLOW_ROLLOUT_MODE = rollout;
			try {
				const workspace = await tempWorkspace();
				const hooks = await loadFlowPlugin(pluginContext(workspace));
				const preflight = hooks["command.execute.before"];
				if (!preflight) throw new Error("Expected command preflight hook");
				const output = { parts: [{ type: "text", text: "stale" }] };
				await preflight(
					{ command: "flow-plan", sessionID: "test", arguments: "goal" },
					output as unknown as Parameters<typeof preflight>[1],
				);
				const prompt = output.parts.map((part) => part.text).join("\n");
				expect(prompt).toContain(`Profile: \`${profile}\``);
				expect(prompt).toContain(`Rollout: \`${rollout}\``);
				expect(prompt).toContain(expected);
				expect(prompt).toContain("Validation receipts remain mandatory");
			} finally {
				if (previousProfile === undefined) {
					delete process.env.OPENCODE_FLOW_HARNESS_PROFILE;
				} else {
					process.env.OPENCODE_FLOW_HARNESS_PROFILE = previousProfile;
				}
				if (previousRollout === undefined) {
					delete process.env.OPENCODE_FLOW_ROLLOUT_MODE;
				} else {
					process.env.OPENCODE_FLOW_ROLLOUT_MODE = previousRollout;
				}
			}
		},
	);

	test("rewrites stale command bodies with canonical package guidance", async () => {
		const workspace = await tempWorkspace();
		const hooks = await loadFlowPlugin(pluginContext(workspace));
		const preflight = hooks["command.execute.before"];
		if (!preflight) throw new Error("Expected command preflight hook");
		const output = {
			parts: [{ type: "text", text: "stale native skill body" }],
		};
		await preflight(
			{
				command: "/flow-plan",
				sessionID: "test",
				arguments: "preserve $$ and $& literally",
			},
			output as unknown as Parameters<typeof preflight>[1],
		);
		expect(output.parts).toHaveLength(2);
		expect(output.parts[0]?.text).toBe(
			"Flow plan: preserve $$ and $& literally",
		);
		expect(output.parts[1]?.text).toContain("Bundled flow-plan/SKILL.md");
		expect(output.parts[1]?.text).toContain("preserve $$ and $& literally");
		expect(output.parts[1]?.text).toContain(
			"## Active Flow harness runtime policy",
		);
		expect(output.parts[1]?.text).toContain("Profile: `standard`");
		expect(output.parts[1]?.text).not.toContain("stale native skill body");
	});

	test("rewrites the canonical review subtask prompt in place", async () => {
		const workspace = await tempWorkspace();
		const hooks = await loadFlowPlugin(pluginContext(workspace));
		const preflight = hooks["command.execute.before"];
		if (!preflight) throw new Error("Expected command preflight hook");
		const output = {
			parts: [
				{
					type: "subtask",
					agent: "flow-reviewer",
					description: "review",
					command: "flow-review",
					prompt: "stale",
				},
			],
		};
		await preflight(
			{ command: "flow-review", sessionID: "test", arguments: "auth" },
			output as unknown as Parameters<typeof preflight>[1],
		);
		expect(output.parts).toHaveLength(1);
		expect(output.parts[0]?.prompt).toContain("`flow-reviewer` contract");
	});

	test("fails closed when review subtask dispatch is malformed", async () => {
		const workspace = await tempWorkspace();
		const hooks = await loadFlowPlugin(pluginContext(workspace));
		const preflight = hooks["command.execute.before"];
		if (!preflight) throw new Error("Expected command preflight hook");
		const input = {
			command: "flow-review",
			sessionID: "test",
			arguments: "auth",
		};
		const malformedParts = [
			[{ type: "text", text: "missing subtask" }],
			[
				{
					type: "subtask",
					agent: "build",
					description: "review",
					command: "flow-review",
					prompt: "stale",
				},
			],
			[
				{
					type: "subtask",
					agent: "flow-reviewer",
					description: "review",
					command: "flow-plan",
					prompt: "stale",
				},
			],
			[
				{
					type: "subtask",
					agent: "flow-reviewer",
					description: "review",
					command: "flow-review",
					prompt: "stale",
				},
				{
					type: "subtask",
					agent: "flow-reviewer",
					description: "duplicate",
					command: "flow-review",
					prompt: "stale",
				},
			],
		];
		for (const parts of malformedParts) {
			await expect(
				preflight(input, { parts } as unknown as Parameters<
					typeof preflight
				>[1]),
			).rejects.toThrow("Flow refused to execute /flow-review");
		}
	});

	test("preserves non-text parts in manager commands", async () => {
		const workspace = await tempWorkspace();
		const hooks = await loadFlowPlugin(pluginContext(workspace));
		const preflight = hooks["command.execute.before"];
		if (!preflight) throw new Error("Expected command preflight hook");
		const output = {
			parts: [
				{ type: "text", text: "stale" },
				{ type: "file", url: "file:///spec.md" },
			],
		};
		await preflight(
			{ command: "flow-plan", sessionID: "test", arguments: "goal" },
			output as unknown as Parameters<typeof preflight>[1],
		);
		expect(
			output.parts.some(
				(part) => part.type === "file" && part.url === "file:///spec.md",
			),
		).toBe(true);
		expect(output.parts.filter((part) => part.type === "text")).toHaveLength(2);
	});

	test("fails closed when a manager command receives a subtask", async () => {
		const workspace = await tempWorkspace();
		const hooks = await loadFlowPlugin(pluginContext(workspace));
		const preflight = hooks["command.execute.before"];
		if (!preflight) throw new Error("Expected command preflight hook");
		await expect(
			preflight(
				{ command: "flow-plan", sessionID: "test", arguments: "goal" },
				{
					parts: [
						{
							type: "subtask",
							agent: "flow-reviewer",
							description: "unexpected",
							command: "flow-plan",
							prompt: "stale",
						},
					],
				} as unknown as Parameters<typeof preflight>[1],
			),
		).rejects.toThrow("unexpected subtask part");
	});

	test("ignores prototype member command names", async () => {
		const workspace = await tempWorkspace();
		const hooks = await loadFlowPlugin(pluginContext(workspace));
		const preflight = hooks["command.execute.before"];
		if (!preflight) throw new Error("Expected command preflight hook");
		for (const command of ["toString", "constructor", "valueOf"]) {
			const output = { parts: [{ type: "text", text: "user content" }] };
			await preflight(
				{ command, sessionID: "test", arguments: "" },
				output as unknown as Parameters<typeof preflight>[1],
			);
			expect(output.parts).toEqual([{ type: "text", text: "user content" }]);
		}
	});

	test("registers config entries without workspace filesystem writes", async () => {
		const workspace = await tempWorkspace();
		const hooks = await loadFlowPlugin(pluginContext(workspace));
		const config = { instructions: ["AGENTS.md"] };
		if (!hooks.config) throw new Error("Expected config hook");
		await hooks.config(config);
		expect(config.instructions).toEqual(["AGENTS.md"]);
		expect(await readdir(workspace)).toEqual([]);
	});

	test("does not inspect or wait on workspace Flow state during config", async () => {
		const workspace = await tempWorkspace();
		await mkdir(join(workspace, ".flow", "session.lock"), { recursive: true });
		const hooks = await loadFlowPlugin(pluginContext(workspace));
		const config = { instructions: ["AGENTS.md"] };
		if (!hooks.config) throw new Error("Expected config hook");
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				hooks.config(config),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error("config hook waited on workspace state")),
						250,
					);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
		expect(config.instructions).toEqual(["AGENTS.md"]);
		expect(await readdir(join(workspace, ".flow"))).toEqual(["session.lock"]);
	});

	test("reports reserved command and agent collisions", () => {
		const collisions: Array<{ kind: string; name: string }> = [];
		const config = {
			agent: { "flow-reviewer": { description: "user reviewer" } },
			command: { "flow-plan": { template: "user template" } },
		};
		applyFlowConfig(config, {
			onCollision: (kind, name) => collisions.push({ kind, name }),
		});
		expect(collisions).toEqual([
			{ kind: "agent", name: "flow-reviewer" },
			{ kind: "command", name: "flow-plan" },
		]);
	});

	test("swallows rejected logging transport promises", async () => {
		const rejections: unknown[] = [];
		const onRejection = (reason: unknown) => rejections.push(reason);
		process.on("unhandledRejection", onRejection);
		try {
			const log = createFlowLog({
				client: { app: { log: () => Promise.reject(new Error("down")) } },
			});
			log("info", "hello");
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(rejections).toEqual([]);
		} finally {
			process.off("unhandledRejection", onRejection);
		}
	});
});

describe("explicit legacy cleanup", () => {
	test("dry-runs without writes and archives pristine folders only on apply", async () => {
		const home = await tempHome();
		const folder = await installPristineLegacyTopic(home, "flow-test");
		const dryRun = await cleanupLegacySkills({ home });
		expect(
			dryRun.results.find((result) => result.name === "flow-test")?.status,
		).toBe("eligible");
		expect(await readFile(join(folder, "SKILL.md"), "utf8")).toContain(
			"# Flow Test",
		);

		const applied = await cleanupLegacySkills({ home, apply: true });
		const result = applied.results.find(
			(candidate) => candidate.name === "flow-test",
		);
		expect(result?.status).toBe("archived");
		expect(result?.archivePath).toStartWith(resolveLegacyArchiveRoot(home));
		await expect(lstat(folder)).rejects.toMatchObject({ code: "ENOENT" });
		expect(
			await readFile(join(result?.archivePath ?? "", "SKILL.md"), "utf8"),
		).toContain("# Flow Test");
	});

	test("refuses malformed and non-v4 marker versions", async () => {
		const home = await tempHome();
		const cases = [
			{
				topic: "flow-test",
				version: "5.0.0",
				reason: "supported legacy range",
			},
			{
				topic: "flow-commit",
				version: "99.0.0",
				reason: "supported legacy range",
			},
			{
				topic: "flow-run",
				version: "3.3.22",
				reason: "supported legacy range",
			},
			{ topic: "flow-plan", version: "4.4", reason: "valid semantic version" },
		];
		const folders = new Map<string, string>();
		for (const entry of cases) {
			folders.set(
				entry.topic,
				await installPristineLegacyTopic(home, entry.topic, entry.version),
			);
		}

		const report = await cleanupLegacySkills({ home, apply: true });
		for (const entry of cases) {
			const result = report.results.find(
				(candidate) => candidate.name === entry.topic,
			);
			expect(result?.status).toBe("refused");
			expect(result?.reason).toContain(entry.reason);
			expect((await lstat(folders.get(entry.topic) ?? "")).isDirectory()).toBe(
				true,
			);
		}
	});

	test("concurrent cleanup archives once without clobbering", async () => {
		const home = await tempHome();
		await installPristineLegacyTopic(home, "flow-test");
		const reports = await Promise.all(
			Array.from({ length: 8 }, () =>
				cleanupLegacySkills({ home, apply: true }),
			),
		);
		const results = reports.flatMap((report) =>
			report.results.filter((result) => result.name === "flow-test"),
		);
		expect(
			results.filter((result) => result.status === "archived"),
		).toHaveLength(1);
		expect(
			results.every((result) =>
				["archived", "absent", "refused"].includes(result.status),
			),
		).toBe(true);
		const archives = await readdir(resolveLegacyArchiveRoot(home));
		expect(
			archives.filter((name) => name.startsWith("flow-test-")),
		).toHaveLength(1);
	});

	test("retries verification when a moved archive is temporarily unavailable", async () => {
		const home = await tempHome();
		await installPristineLegacyTopic(home, "flow-test");
		let restoration: Promise<void> | undefined;
		const report = await cleanupLegacySkills({
			home,
			apply: true,
			afterQuarantine: async ({ archivePath }) => {
				const displacedPath = `${archivePath}.transient`;
				await rename(archivePath, displacedPath);
				restoration = sleep(5).then(() => rename(displacedPath, archivePath));
				void restoration.catch(() => undefined);
			},
		});
		await restoration;

		expect(
			report.results.find((result) => result.name === "flow-test")?.status,
		).toBe("archived");
	});

	test("does not claim a concurrently relocated archive is quarantined", async () => {
		const home = await tempHome();
		await installPristineLegacyTopic(home, "flow-test");
		let relocatedPath: string | undefined;
		const report = await cleanupLegacySkills({
			home,
			apply: true,
			afterQuarantine: async ({ name, archivePath }) => {
				if (name !== "flow-test") return;
				relocatedPath = `${archivePath}.concurrent`;
				await rename(archivePath, relocatedPath);
			},
		});
		const result = report.results.find(
			(candidate) => candidate.name === "flow-test",
		);

		expect(result?.status).toBe("refused");
		expect(result?.reason).toContain("archive moved again");
		expect(result?.archivePath).toBeUndefined();
		expect(
			await readFile(join(relocatedPath ?? "", "SKILL.md"), "utf8"),
		).toContain("# Flow Test");
	});

	test("post-move changes are preserved in quarantine and never accepted as pristine", async () => {
		const home = await tempHome();
		const folder = await installPristineLegacyTopic(home, "flow-test");
		const report = await cleanupLegacySkills({
			home,
			apply: true,
			afterQuarantine: async ({ name, archivePath }) => {
				if (name === "flow-test") {
					await writeFile(join(archivePath, "user-notes.md"), "preserve me\n");
				}
			},
		});
		const result = report.results.find(
			(candidate) => candidate.name === "flow-test",
		);

		expect(result?.status).toBe("quarantined");
		expect(result?.archivePath).toStartWith(resolveLegacyArchiveRoot(home));
		await expect(lstat(folder)).rejects.toMatchObject({ code: "ENOENT" });
		expect(
			await readFile(join(result?.archivePath ?? "", "user-notes.md"), "utf8"),
		).toBe("preserve me\n");
	});

	test("refuses foreign, edited, and extra-content folders", async () => {
		const home = await tempHome();
		const foreign = join(home, ".config", "opencode", "skills", "flow");
		await mkdir(foreign, { recursive: true });
		await writeFile(join(foreign, "SKILL.md"), "user skill\n", "utf8");
		const edited = await installPristineLegacyTopic(home, "flow-test");
		await writeFile(join(edited, "SKILL.md"), "user edit\n", "utf8");
		const extra = await installPristineLegacyTopic(home, "flow-commit");
		await writeFile(join(extra, "notes.md"), "user notes\n", "utf8");

		const report = await cleanupLegacySkills({ home, apply: true });
		for (const topic of ["flow", "flow-test", "flow-commit"]) {
			expect(
				report.results.find((result) => result.name === topic)?.status,
			).toBe("refused");
		}
		expect(await readFile(join(foreign, "SKILL.md"), "utf8")).toBe(
			"user skill\n",
		);
		expect(await readFile(join(edited, "SKILL.md"), "utf8")).toBe(
			"user edit\n",
		);
		expect(await readFile(join(extra, "notes.md"), "utf8")).toBe(
			"user notes\n",
		);
	});

	test("refuses folder and file symlinks without touching their targets", async () => {
		const home = await tempHome();
		const externalFolder = await tempDirectory("flow-external-folder");
		await writeFile(join(externalFolder, "SKILL.md"), "external folder\n");
		const root = join(home, ".config", "opencode", "skills");
		await mkdir(root, { recursive: true });
		await symlink(externalFolder, join(root, "flow"), "dir");

		const fileFolder = await installPristineLegacyTopic(home, "flow-test");
		const externalFile = join(
			await tempDirectory("flow-external-file"),
			"x.md",
		);
		await writeFile(externalFile, "external file\n");
		const marker = [
			"version=4.4.0",
			`file=SKILL.md sha256=${sha256("external file\n")}`,
			"",
		].join("\n");
		await writeFile(join(fileFolder, ".flow-skill-version"), marker);
		await unlink(join(fileFolder, "SKILL.md"));
		await symlink(externalFile, join(fileFolder, "SKILL.md"));

		const report = await cleanupLegacySkills({ home, apply: true });
		expect(
			report.results.find((result) => result.name === "flow")?.status,
		).toBe("refused");
		expect(
			report.results.find((result) => result.name === "flow-test")?.status,
		).toBe("refused");
		expect(await readFile(join(externalFolder, "SKILL.md"), "utf8")).toBe(
			"external folder\n",
		);
		expect(await readFile(externalFile, "utf8")).toBe("external file\n");
		expect((await lstat(join(root, "flow"))).isSymbolicLink()).toBe(true);
		expect((await lstat(join(fileFolder, "SKILL.md"))).isSymbolicLink()).toBe(
			true,
		);
	});

	test("CLI makes cleanup mode explicit and reports package version", async () => {
		const invalid = await runFlowCli(["legacy-cleanup"]);
		expect(invalid.status).toBe(2);
		expect(invalid.stderr).toContain("<--dry-run|--apply>");

		const help = await runFlowCli(["--help"]);
		expect(help.status).toBe(0);
		expect(help.stdout).toContain("never deletes");

		const version = await runFlowCli(["--version"]);
		expect(version.status).toBe(0);
		expect(version.stdout.trim()).toBe(packageJson.version);
		expect(resolveFlowPluginVersion()).toBe(packageJson.version);
	});
});
