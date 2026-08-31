import { describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	currentBunToolchain,
	runPinnedBunSync,
} from "../evals/bun-toolchain.js";
import { packPlugin } from "../evals/harness.js";
import packageJson from "../package.json" with { type: "json" };
import {
	buildHostEvidenceCapabilities,
	collectFieldObservations,
	type EndpointAttempt,
	HOST_METADATA_CONTRACT,
} from "../scripts/probe-opencode-eval-metadata.js";

// This test deliberately proves only the host boundary. Domain and persistence
// behavior belongs in fast deterministic tests; the live smoke verifies that a
// packed release loads in a real OpenCode process with the intended commands
// and hidden-agent isolation. Actual model-driven fan-out is deliberately not
// part of this smoke: it would require provider credentials and would make a
// deterministic package/host compatibility gate depend on model behavior.
const LIVE = process.env.FLOW_LIVE_SMOKE === "1";
const PINNED_OPENCODE_VERSION =
	packageJson.devDependencies["@opencode-ai/plugin"];
const OPENCODE_VERSION =
	process.env.FLOW_OPENCODE_SMOKE_VERSION?.trim() || PINNED_OPENCODE_VERSION;
const STARTUP_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 120_000;

const EXPECTED_COMMANDS = [
	"flow-auto",
	"flow-plan",
	"flow-review",
	"flow-run",
	"flow-status",
] as const;

const EXPECTED_TOOLS = [
	"flow_feature_complete",
	"flow_feature_reset",
	"flow_guidance",
	"flow_plan_approve",
	"flow_plan_save",
	"flow_review_start",
	"flow_run_start",
	"flow_session_close",
	"flow_status",
	"flow_validation_start",
] as const;

const EXPECTED_AGENTS = ["flow-reviewer", "flow-worker"] as const;

type PermissionRule = {
	permission: string;
	pattern: string;
	action: "ask" | "allow" | "deny";
};

type ResolvedAgent = {
	name: string;
	mode?: "subagent" | "primary" | "all";
	steps?: number;
	permission?: PermissionRule[];
};

function wildcardMatches(input: string, pattern: string): boolean {
	const expression = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replaceAll("*", ".*")
		.replaceAll("?", ".");
	return new RegExp(`^${expression}$`, "s").test(input);
}

function permissionFor(
	rules: readonly PermissionRule[],
	permission: string,
	pattern = "*",
): PermissionRule["action"] {
	for (let index = rules.length - 1; index >= 0; index -= 1) {
		const rule = rules[index];
		if (
			rule &&
			wildcardMatches(permission, rule.permission) &&
			wildcardMatches(pattern, rule.pattern)
		) {
			return rule.action;
		}
	}
	return "ask";
}

async function fetchJson(url: string, timeout = REQUEST_TIMEOUT_MS) {
	const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
	if (!response.ok) {
		throw new Error(
			`GET ${url} failed with ${response.status}: ${await response.text()}`,
		);
	}
	return response.json();
}

async function waitForHealth(baseUrl: string): Promise<void> {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const health = (await fetchJson(`${baseUrl}/global/health`, 3_000)) as {
				healthy?: boolean;
			};
			if (health.healthy) return;
		} catch {
			// The process is still starting.
		}
		await Bun.sleep(500);
	}
	throw new Error(`OpenCode did not become healthy at ${baseUrl}.`);
}

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Could not reserve a local port.");
	}
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

async function stopServer(server: ChildProcess): Promise<void> {
	if (server.exitCode !== null) return;
	server.kill("SIGTERM");
	await Promise.race([
		new Promise<void>((resolve) => server.once("exit", () => resolve())),
		Bun.sleep(2_000).then(() => {
			if (server.exitCode === null) server.kill("SIGKILL");
		}),
	]);
}

function observed(
	endpoint: EndpointAttempt["endpoint"],
	response: unknown,
): EndpointAttempt {
	return { kind: "observed", endpoint, response };
}

function createdSession(version = PINNED_OPENCODE_VERSION): EndpointAttempt {
	return observed(HOST_METADATA_CONTRACT.endpoints.createSession, {
		id: "session",
		version,
	});
}

function answeredModel(modelID = "model", providerID = "provider") {
	return {
		info: {
			role: "assistant",
			time: { created: 1, completed: 2 },
			model: { providerID, modelID },
		},
	};
}

function reviewerChild(id = "child", parentID = "parent") {
	return { agent: "flow-reviewer", id, parentID };
}

type EvidenceInput = Parameters<typeof buildHostEvidenceCapabilities>[0];

function evidence(overrides: Partial<EvidenceInput> = {}) {
	return buildHostEvidenceCapabilities({
		opencodeVersion: PINNED_OPENCODE_VERSION,
		generatedAt: "2026-08-24T00:00:00.000Z",
		parentSessionId: "parent",
		endpointResponses: [createdSession()],
		childSessions: observed(HOST_METADATA_CONTRACT.endpoints.childSessions, [
			reviewerChild(),
		]),
		parentMessages: observed(HOST_METADATA_CONTRACT.endpoints.parentMessages, [
			answeredModel("manager"),
		]),
		childMessages: [
			{
				sessionId: "child",
				messages: observed(HOST_METADATA_CONTRACT.endpoints.childMessages, [
					answeredModel("reviewer"),
				]),
			},
		],
		...overrides,
	});
}

describe("OpenCode eval metadata probe", () => {
	test("pins the Phase 0 host, endpoints, and reviewer bound", () => {
		expect(HOST_METADATA_CONTRACT.hostVersion).toBe("1.18.6");
		expect(HOST_METADATA_CONTRACT.endpoints).toEqual({
			agents: "GET /agent",
			createSession: "POST /session",
			dispatchReview: "POST /session/:id/command",
			parentMessages: "GET /session/:id/message",
			childSessions: "GET /session/:id/children",
			childMessages: "GET /session/:child_id/message",
		});
		expect(HOST_METADATA_CONTRACT.limits).toEqual({
			requestTimeoutMs: 120_000,
			reviewerSteps: 8,
		});
	});

	test("redacts compound sensitive keys but keeps identity field labels", () => {
		const fields = collectFieldObservations({
			info: {
				model: { providerID: "provider-secret", modelID: "model-secret" },
			},
			parts: [
				{
					apiKey: "secret",
					accessToken: "secret",
					promptText: "secret",
					toolOutput: "secret",
					credential: "secret",
				},
			],
		});
		expect(fields).toEqual([
			{ path: "info", kind: "object" },
			{ path: "info.model", kind: "object" },
			{ path: "info.model.modelID", kind: "string" },
			{ path: "info.model.providerID", kind: "string" },
			{ path: "parts", kind: "array" },
			{ path: "parts[]", kind: "object" },
		]);
	});

	test("records completed parent and reviewer identities and raw parent linkage as labels", () => {
		const capabilities = evidence({
			parentSessionId: "ses_parent_raw",
			childSessions: observed(HOST_METADATA_CONTRACT.endpoints.childSessions, [
				reviewerChild("ses_child_raw", "ses_parent_raw"),
			]),
			parentMessages: observed(
				HOST_METADATA_CONTRACT.endpoints.parentMessages,
				[answeredModel("manager-secret", "provider-secret")],
			),
			childMessages: [
				{
					sessionId: "ses_child_raw",
					messages: observed(HOST_METADATA_CONTRACT.endpoints.childMessages, [
						answeredModel("reviewer-secret", "provider-secret"),
					]),
				},
			],
		});
		expect(capabilities.capabilities).toMatchObject({
			hostVersion: {
				kind: "observed",
				matchesRequested: true,
				fieldPath: "version",
			},
			parentManagerModelIdentity: {
				kind: "observed",
				actors: [
					{
						actor: "parent-1",
						fieldPaths: ["[].info.model.modelID", "[].info.model.providerID"],
					},
				],
			},
			childReviewerModelIdentity: {
				kind: "observed",
				actors: [
					{
						actor: "child-1",
						fieldPaths: ["[].info.model.modelID", "[].info.model.providerID"],
					},
				],
			},
			childLineage: {
				kind: "observed",
				links: [
					{
						parent: "parent-1",
						child: "child-1",
						fieldPaths: ["[].id", "[].parentID"],
					},
				],
			},
		});
		expect(capabilities).toMatchObject({
			unsupportedClaims: [],
			result: { kind: "complete" },
		});
		expect(JSON.stringify(capabilities)).not.toMatch(
			/ses_(parent|child)_raw|provider-secret|reviewer-secret/,
		);
	});

	for (const scenario of [
		{
			name: "host-version-mismatch",
			overrides: { endpointResponses: [createdSession("9.9.9")] },
			result: "host-version-mismatch",
		},
		{
			name: "parent-model-field-unavailable",
			overrides: {
				parentMessages: observed(
					HOST_METADATA_CONTRACT.endpoints.parentMessages,
					[{ info: { role: "assistant", time: { completed: 2 } } }],
				),
			},
			result: "required-capability-unavailable",
			unsupported: ["parent-manager-model-identity"],
		},
		{
			name: "child-model-field-unavailable",
			overrides: {
				childMessages: [
					{
						sessionId: "child",
						messages: observed(HOST_METADATA_CONTRACT.endpoints.childMessages, [
							{ info: { role: "assistant", time: { completed: 2 } } },
						]),
					},
				],
			},
			result: "required-capability-unavailable",
			unsupported: ["child-reviewer-model-identity"],
		},
		{
			name: "endpoint-failure",
			overrides: {
				childSessions: {
					kind: "endpoint-failure" as const,
					endpoint: HOST_METADATA_CONTRACT.endpoints.childSessions,
				},
				parentMessages: {
					kind: "endpoint-failure" as const,
					endpoint: HOST_METADATA_CONTRACT.endpoints.parentMessages,
				},
				childMessages: [],
			},
			result: "endpoint-failure",
			unsupported: [],
		},
		{
			name: "review-command-failure",
			overrides: {
				endpointResponses: [
					createdSession(),
					{
						kind: "endpoint-failure" as const,
						endpoint: HOST_METADATA_CONTRACT.endpoints.dispatchReview,
					},
				],
			},
			result: "endpoint-failure",
			unsupported: [],
		},
		{
			name: "mismatched-reviewer-parent",
			overrides: {
				childSessions: observed(
					HOST_METADATA_CONTRACT.endpoints.childSessions,
					[reviewerChild("child", "different-parent")],
				),
				childMessages: [],
			},
			result: "reviewer-child-not-observed",
			unsupported: ["child-reviewer-model-identity", "child-session-lineage"],
			lineage: "parent-mismatch",
		},
		{
			name: "non-reviewer-child",
			overrides: {
				childSessions: observed(
					HOST_METADATA_CONTRACT.endpoints.childSessions,
					[{ agent: "flow-worker", id: "child", parentID: "parent" }],
				),
				childMessages: [],
			},
			result: "reviewer-child-not-observed",
			unsupported: [],
			lineage: "reviewer-child-not-observed",
		},
		{
			name: "unanswered-reviewer",
			overrides: {
				childMessages: [
					{
						sessionId: "child",
						messages: observed(HOST_METADATA_CONTRACT.endpoints.childMessages, [
							{
								info: {
									role: "user",
									model: { providerID: "provider", modelID: "reviewer" },
								},
							},
						]),
					},
				],
			},
			result: "model-did-not-answer",
		},
		{
			name: "failed-parent-message",
			overrides: {
				parentMessages: observed(
					HOST_METADATA_CONTRACT.endpoints.parentMessages,
					[
						{
							info: {
								error: { name: "ProviderError" },
								model: { providerID: "provider", modelID: "manager" },
							},
						},
					],
				),
			},
			result: "model-did-not-answer",
		},
	] as const) {
		test(`reports ${scenario.name}`, () => {
			const capabilities = evidence(scenario.overrides);
			expect(capabilities.result).toEqual({
				kind: "inconclusive",
				reason: scenario.result,
			});
			if (scenario.unsupported)
				expect(capabilities.unsupportedClaims).toEqual(scenario.unsupported);
			if (scenario.lineage)
				expect(capabilities.capabilities.childLineage).toMatchObject({
					kind: "unobserved",
					reason: scenario.lineage,
				});
		});
	}
});

describe("live OpenCode smoke configuration", () => {
	test("uses the pinned host unless compatibility monitoring overrides it", () => {
		expect(PINNED_OPENCODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		expect(
			process.env.FLOW_OPENCODE_SMOKE_VERSION?.trim()
				? OPENCODE_VERSION
				: PINNED_OPENCODE_VERSION,
		).toBe(OPENCODE_VERSION);
		expect(EXPECTED_COMMANDS).toHaveLength(5);
		expect(EXPECTED_TOOLS).toHaveLength(10);
		expect(EXPECTED_AGENTS).toHaveLength(2);
	});
});

describe.skipIf(!LIVE)(`live OpenCode ${OPENCODE_VERSION} smoke`, () => {
	test(
		"loads the packed plugin and enforces the small public surface",
		async () => {
			const repositoryRoot = join(import.meta.dir, "..");
			const toolchain = currentBunToolchain(packageJson.packageManager);
			const scratch = await mkdtemp(join(tmpdir(), "flow-live-smoke-"));
			const childHome = join(scratch, "home");
			const childCache = join(scratch, "cache");
			const project = join(scratch, "project");
			await mkdir(childHome, { recursive: true });
			await mkdir(join(project, ".opencode"), { recursive: true });

			const tarball = await packPlugin(repositoryRoot, scratch, toolchain);
			expect((await lstat(tarball)).isFile()).toBe(true);

			// Populate OpenCode's exact-version package cache from the candidate
			// tarball so the documented config exercises these exact package bytes.
			const packageCache = join(
				childCache,
				"opencode",
				"packages",
				`opencode-plugin-flow@${packageJson.version}`,
			);
			await mkdir(packageCache, { recursive: true });
			await writeFile(
				join(packageCache, "package.json"),
				`${JSON.stringify({ dependencies: { "opencode-plugin-flow": `file:${tarball}` } }, null, 2)}\n`,
				"utf8",
			);
			const install = runPinnedBunSync(toolchain, ["install"], {
				cwd: packageCache,
			});
			expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);
			await writeFile(
				join(project, "opencode.json"),
				`${JSON.stringify(
					{
						plugin: [
							[
								`opencode-plugin-flow@${packageJson.version}`,
								{ reviewer: { steps: 80 } },
							],
						],
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			const port = await availablePort();
			const baseUrl = `http://127.0.0.1:${port}`;
			const server = spawn(
				toolchain.executable,
				[
					"x",
					`opencode-ai@${OPENCODE_VERSION}`,
					"serve",
					"--port",
					String(port),
					"--hostname",
					"127.0.0.1",
				],
				{
					cwd: project,
					env: {
						...toolchain.environment,
						HOME: childHome,
						OPENCODE_TEST_HOME: childHome,
						XDG_CACHE_HOME: childCache,
						XDG_CONFIG_HOME: join(childHome, ".config"),
						XDG_DATA_HOME: join(childHome, ".local", "share"),
						XDG_STATE_HOME: join(childHome, ".local", "state"),
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			let serverOutput = "";
			server.stdout?.on("data", (chunk) => {
				serverOutput += String(chunk);
			});
			server.stderr?.on("data", (chunk) => {
				serverOutput += String(chunk);
			});

			try {
				await waitForHealth(baseUrl);
				const commands = (await fetchJson(`${baseUrl}/command`)) as Array<{
					name: string;
				}>;
				expect(
					commands
						.map((command) => command.name)
						.filter((name) => name.startsWith("flow-"))
						.sort(),
				).toEqual([...EXPECTED_COMMANDS].sort());

				const toolIds = (await fetchJson(
					`${baseUrl}/experimental/tool/ids`,
				)) as string[];
				expect(
					toolIds.filter((name) => name.startsWith("flow_")).sort(),
				).toEqual([...EXPECTED_TOOLS].sort());

				const agents = (await fetchJson(`${baseUrl}/agent`)) as ResolvedAgent[];
				const flowAgents = agents.filter((agent) =>
					agent.name.startsWith("flow-"),
				);
				expect(flowAgents.map((agent) => agent.name).sort()).toEqual([
					...EXPECTED_AGENTS,
				]);
				const reviewer = flowAgents.find(
					(agent) => agent.name === "flow-reviewer",
				);
				if (!reviewer) throw new Error("Flow reviewer was not registered.");
				expect(reviewer.mode).toBe("subagent");
				expect(reviewer.steps).toBe(80);
				for (const permission of [
					"edit",
					"bash",
					"external_directory",
					"skill",
					"task",
				]) {
					expect(permissionFor(reviewer.permission ?? [], permission)).toBe(
						"deny",
					);
				}
				const reviewerAllowedTools = new Set([
					"flow_status",
					"flow_feature_complete",
				]);
				for (const toolId of EXPECTED_TOOLS) {
					expect(permissionFor(reviewer.permission ?? [], toolId)).toBe(
						reviewerAllowedTools.has(toolId) ? "allow" : "deny",
					);
				}

				const worker = flowAgents.find((agent) => agent.name === "flow-worker");
				if (!worker) throw new Error("Flow worker was not registered.");
				expect(worker.mode).toBe("subagent");
				expect(
					permissionFor(worker.permission ?? [], "edit", "src/index.ts"),
				).toBe("allow");
				for (const protectedPath of [
					".flow",
					".flow/session.json",
					".git",
					".git/config",
				]) {
					expect(
						permissionFor(worker.permission ?? [], "edit", protectedPath),
					).toBe("deny");
				}
				expect(permissionFor(worker.permission ?? [], "bash", "bun test")).toBe(
					"deny",
				);
				for (const permission of [
					"external_directory",
					"skill",
					"task",
					"flow_status",
					"flow_plan_save",
					"flow_feature_complete",
				]) {
					expect(permissionFor(worker.permission ?? [], permission)).toBe(
						"deny",
					);
				}
				await expect(lstat(join(project, ".flow"))).rejects.toMatchObject({
					code: "ENOENT",
				});
			} catch (error) {
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}\nServer output:\n${serverOutput}`,
				);
			} finally {
				await stopServer(server);
				await rm(scratch, { recursive: true, force: true });
			}
		},
		STARTUP_TIMEOUT_MS + 2 * REQUEST_TIMEOUT_MS,
	);
});
