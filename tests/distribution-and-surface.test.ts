import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createFlowCoreConfigEntries } from "../src/config-shared.js";
import {
	FLOW_GUIDANCE_IDS,
	FLOW_MANAGER_KERNEL,
	getFlowGuidance,
} from "../src/guidance/catalog.js";
import FlowPlugin from "../src/index.js";
import {
	AutoDriveCoordinator,
	FLOW_AUTO_METADATA_KEY,
} from "../src/platform/opencode/auto-drive.js";
import { prepareFlowCommand } from "../src/platform/opencode/command-hook.js";
import {
	createNativeFlowHost,
	type NativeFlowHost,
	nativeText,
	projectionOf,
} from "./fixtures/native-flow-host.js";
import { plan } from "./runtime-test-support.js";

const TOOL_NAMES = [
	"flow_feature_complete",
	"flow_feature_reset",
	"flow_guidance",
	"flow_plan_amend",
	"flow_plan_approve",
	"flow_plan_save",
	"flow_review_start",
	"flow_run_start",
	"flow_session_close",
	"flow_status",
	"flow_validation_start",
];
const COMMAND_NAMES = [
	"flow-auto",
	"flow-plan",
	"flow-review",
	"flow-run",
	"flow-status",
];
const hosts: NativeFlowHost[] = [];
const workspaces: string[] = [];
const pendingDecisionObservations = new Set<() => void>();
async function load(options: Parameters<typeof createNativeFlowHost>[1] = {}) {
	const workspace = await mkdtemp(join(tmpdir(), "flow-native-surface-"));
	workspaces.push(workspace);
	const host = await createNativeFlowHost(workspace, options);
	hosts.push(host);
	await host.load(FlowPlugin);
	return { host, workspace };
}
async function idleDecision(
	host: NativeFlowHost,
	id: string,
	receiver?: AutoDriveCoordinator,
) {
	if (pendingDecisionObservations.size)
		throw new Error("Overlapping coordinator observation.");
	const token = host.admissions.findLast(
		(receipt) =>
			receipt.sessionID === id &&
			typeof receipt.payload.metadata?.[FLOW_AUTO_METADATA_KEY] === "string",
	)?.payload.metadata?.[FLOW_AUTO_METADATA_KEY];
	if (!receiver && typeof token !== "string")
		throw new Error("Missing fixture invocation token.");
	const original = AutoDriveCoordinator.prototype.onIdle,
		completed = Promise.withResolvers<void>();
	let failure: unknown;
	const observed = async function (
		this: AutoDriveCoordinator,
		...args: Parameters<typeof original>
	) {
		if (
			args[0] !== id ||
			(receiver
				? this !== receiver
				: this.captureAuthority(id)?.token !== token)
		)
			return original.apply(this, args);
		receiver = this;
		try {
			await original.apply(this, args);
		} catch (error) {
			failure = error;
			throw error;
		} finally {
			completed.resolve();
		}
	};
	AutoDriveCoordinator.prototype.onIdle = observed;
	const cancel = () => {
		if (AutoDriveCoordinator.prototype.onIdle === observed)
			AutoDriveCoordinator.prototype.onIdle = original;
		completed.reject(
			new Error("Fixture disposed before the coordinator decision completed."),
		);
	};
	pendingDecisionObservations.add(cancel);
	try {
		await host.idle(id);
		await completed.promise;
		if (AutoDriveCoordinator.prototype.onIdle !== observed)
			throw new Error("Coordinator observation was replaced.");
		if (failure) throw failure;
		if (!receiver) throw new Error("No matching coordinator completed.");
		return receiver;
	} finally {
		pendingDecisionObservations.delete(cancel);
		if (AutoDriveCoordinator.prototype.onIdle === observed)
			AutoDriveCoordinator.prototype.onIdle = original;
	}
}
async function waitingForPlanApproval(host: NativeFlowHost, id: string) {
	for (;;) {
		const status = await host.response("flow_status", statusInput, id);
		const state = status.workflowData.autoDrive;
		if (
			state &&
			field(state, "state") === "waiting" &&
			field(state, "reason") === "plan-approval"
		)
			return;
	}
}
function exactlyOnce(text: string, fragment: string) {
	expect(text.split(fragment)).toHaveLength(2);
}
const statusInput = { request: { view: "compact" } };
async function save(
	host: NativeFlowHost,
	hostID = "ses_manager",
	goal = "Implement the runtime kernel.",
	expectedRevision = 0,
	nextPlan = plan,
) {
	return host.response(
		"flow_plan_save",
		{
			request: {
				operationId: `save-${expectedRevision}`,
				expectedRevision,
				goal,
				plan: nextPlan,
			},
		},
		hostID,
	);
}
async function approve(
	host: NativeFlowHost,
	revision: number,
	hostID = "ses_manager",
	operationId = "approve",
) {
	return host.response(
		"flow_plan_approve",
		{ request: { operationId, expectedRevision: revision } },
		hostID,
	);
}
function field(value: unknown, name: string) {
	return z.record(z.string(), z.unknown()).parse(value)[name];
}
afterEach(async () => {
	for (const cancel of pendingDecisionObservations) cancel();
	pendingDecisionObservations.clear();
	const errors: unknown[] = [];
	for (const host of hosts.splice(0).reverse())
		try {
			await host.dispose();
		} catch (error) {
			errors.push(error);
		}
	for (const workspace of workspaces.splice(0).reverse())
		try {
			await rm(workspace, { recursive: true, force: true });
		} catch (error) {
			errors.push(error);
		}
	if (errors.length)
		throw new AggregateError(errors, "Native surface cleanup failed.");
});

describe("Flow distribution surface", () => {
	test("registers eleven native tools, five commands, configured hidden roles, and four guides", async () => {
		const { host } = await load({
			modelPreferences: {
				planning: {
					kind: "model",
					model: { providerID: "test", id: "planning" },
				},
			},
		});
		expect(FlowPlugin.id).toBe("opencode-plugin-flow");
		expect([...host.tools.keys()].sort()).toEqual(TOOL_NAMES);
		expect([...host.commands.keys()].sort()).toEqual(COMMAND_NAMES);
		expect([...host.agents.keys()]).toEqual([
			"flow-planner",
			"flow-reviewer",
			"flow-worker",
		]);
		for (const agent of host.agents.values()) expect(agent.hidden).toBe(true);
		expect(FLOW_GUIDANCE_IDS).toEqual([
			"flow",
			"flow-plan",
			"flow-run",
			"flow-review",
		]);
		const response = await host.response("flow_status", statusInput);
		const entry = await readFile(
			join(import.meta.dir, "../src/platform/opencode/plugin.ts"),
		);
		expect(response.workflowData.runtimeIdentity).toEqual({
			packageVersion: "10.0.0",
			pluginEntrySha256: `sha256:${createHash("sha256").update(entry).digest("hex")}`,
		});
	});
	test("captures reviewer plugin options once and preserves deterministic status text", async () => {
		const options = { reviewer: { model: "provider/reviewer", steps: 80 } };
		const { host } = await load(options);
		options.reviewer.model = "changed/after-startup";
		options.reviewer.steps = 12;
		await host.context.agent.reload();
		expect(host.agents.get("flow-reviewer")).toMatchObject({
			model: { providerID: "provider", id: "reviewer" },
			steps: 80,
		});
		const response = await host.response("flow_status", statusInput);
		expect(response.workflowData.reviewerConfiguration).toMatchObject({
			scope: "current-plugin-process",
			model: {
				kind: "explicit",
				source: "plugin-option",
				requested: "provider/reviewer",
			},
			steps: { requested: 80 },
			availability: "unverified",
		});
		expect(response.workflowData.statusReport).toEqual([
			"View: compact",
			"Status: idle",
			"Revision: 0",
			"Next action: flow_plan_save",
			"No active Flow session.",
			"Action guidance: inspect the repository and save one draft plan with flow_plan_save.",
			"Findings digest: none",
		]);
	});
	test("isolates worker permissions and keeps native reviewer dispatch separate", async () => {
		const { agent, command } = createFlowCoreConfigEntries();
		expect(agent["flow-worker"]).toMatchObject({
			mode: "subagent",
			hidden: true,
		});
		expect(agent["flow-worker"]).not.toHaveProperty("model");
		expect(agent["flow-worker"]).not.toHaveProperty("steps");
		expect(agent["flow-reviewer"].permissions).toContainEqual({
			action: "flow_feature_complete",
			resource: "*",
			effect: "allow",
		});
		expect(agent["flow-worker"].permissions).toContainEqual({
			action: "edit",
			resource: "**/.git/**",
			effect: "deny",
		});
		for (const name of [
			"flow-auto",
			"flow-plan",
			"flow-run",
			"flow-status",
		] as const)
			expect(command[name]?.subtask).toBe(false);
		const { host } = await load({ reviewer: { model: "test/reviewer" } });
		await host.command("flow-review", "assignment-1");
		const child = [...host.sessions.values()].find(
			(session) => session.parentID === "ses_manager",
		);
		expect(child).toMatchObject({
			agent: "flow-reviewer",
			model: { providerID: "test", id: "reviewer" },
		});
		expect(host.prompts.at(-1)).toMatchObject({
			sessionID: child?.id,
			text: expect.stringContaining("Assignment: assignment-1"),
		});
	});
	test("refuses to load the home directory before registering native tools", async () => {
		const host = await createNativeFlowHost(homedir());
		hosts.push(host);
		await expect(host.load(FlowPlugin)).rejects.toThrow(
			"Flow refuses to use the home directory itself",
		);
		expect(host.tools.size).toBe(0);
	});
});

describe("native command preparation", () => {
	test("preserves raw manager arguments exactly once and targets the reviewer assignment", async () => {
		const { host } = await load();
		const raw = "\t  simplify it\n  exactly \t\n";
		const command = await host.command("flow-plan", raw);
		expect(command?.text).toStartWith(`Flow flow-plan: ${raw}\n\n`);
		exactlyOnce(command?.text ?? "", raw);
		expect(command?.text).toContain("# Flow plan router");
		const empty = await host.command("flow-status", " \t\n");
		expect(empty?.text).toStartWith("Flow flow-status\n\n");
		await host.command("flow-review", "assignment-1");
		expect(host.prompts.at(-1)?.text).toContain("Assignment: assignment-1");
	});
	test("rejects native command dispatch from child sessions and malformed recovery options", async () => {
		const { host } = await load();
		host.ensureSession("ses_child", {
			parentID: "ses_parent",
			agent: "flow-reviewer",
		});
		await expect(host.command("flow-run", "", "ses_child")).rejects.toThrow(
			"primary manager",
		);
		expect(() =>
			prepareFlowCommand("flow-auto", "--recovery=delegated Repair"),
		).toThrow("Recovery requires");
		expect(host.prompts).toEqual([]);
	});
});

describe("flow-auto native continuation", () => {
	for (const [kind, goal, expectedApproval] of [
		[
			"new-anchor",
			"Review codebase, then create a phased plan with case named `audit finding`",
			true,
		],
		[
			"new-anchor",
			"Audit codebase with case named `audit finding` and produce a roadmap",
			true,
		],
		[
			"uncertain",
			"Review codebase and improve architecture with case named `audit finding`",
			false,
		],
		[
			"uncertain",
			"Review codebase and build a dashboard with case named `audit finding`",
			false,
		],
		[
			"mixed-work",
			"Review codebase with case named `audit finding`, create a phased plan, then improve architecture",
			false,
		],
		[
			"mixed-work",
			"Review codebase with case named `audit finding`, create a phased plan, then build a dashboard",
			false,
		],
		[
			"mixed-work",
			"Review the codebase with case named `audit finding`, then implement the fixes",
			false,
		],
		[
			"mixed-work",
			"Review case named `audit finding`, then repair the defects and update dependencies",
			false,
		],
		[
			"preexisting-anchor",
			"Review codebase with case named `audit finding`",
			false,
		],
		[
			"plan-only",
			"Just draft a Flow plan for case named `audit finding`",
			false,
		],
		["plan-only", "I only want a plan for case named `audit finding`", false],
		["plan-only", "Just give me a plan for case named `audit finding`", false],
		[
			"review-without-implementation",
			"Review case named `audit finding`, then create a roadmap; do not implement yet",
			true,
		],
		[
			"review-without-implementation",
			"Review the codebase and create a phased plan for case named `audit finding`; stop before implementation",
			true,
		],
		[
			"plan-only",
			"Just create a phased plan for case named `audit finding`, then implement the improvements",
			false,
		],
		["uncertain", "Create a phased plan for case named `audit finding`", false],
		[
			"uncertain",
			"Create a Flow plan for reviewing the codebase later with case named `audit finding`",
			false,
		],
		[
			"uncertain",
			"Create a Flow plan for review of the codebase later with case named `audit finding`",
			false,
		],
		["plan-only", "Review case named `audit finding`; do not run", false],
		[
			"plan-only",
			"Review case named `audit finding`; wait for approval",
			false,
		],
	] as const) {
		test(`inspect approval for ${kind}: ${goal}`, async () => {
			const { host } = await load();
			const manager = "ses_inspect";
			if (kind === "preexisting-anchor")
				await host.command("flow-plan", goal, manager);
			await host.command("flow-auto", `--recovery=off ${goal}`, manager);
			const provisional = await host.response(
				"flow_status",
				statusInput,
				manager,
			);
			expect(projectionOf(provisional)).toMatchObject({
				status: "planning",
				revision: 0,
				goal,
			});
			const inspectPlan = {
				...plan,
				features: plan.features.map((feature) => ({
					...feature,
					kind: "inspect" as const,
				})),
			};
			const saved = await save(host, manager, goal, 0, inspectPlan);
			expect(saved.status).toBe("ok");
			expect(projectionOf(saved).sessionId).toBe(
				projectionOf(provisional).sessionId,
			);
			const approval = expectedApproval
				? host.nextSynthetic(manager, (input) =>
						input.text.includes("Approve this one draft"),
					)
				: null;
			await idleDecision(host, manager);
			if (approval) await approval;
			else await waitingForPlanApproval(host, manager);
			expect(
				host.synthetics.filter((input) =>
					input.text.includes("Approve this one draft"),
				),
			).toHaveLength(Number(expectedApproval));
		});
	}
	test("binds a named acceptance case to the originating native host", async () => {
		const { host } = await load();
		const owner = "ses_owner";
		await host.command(
			"flow-auto",
			"--recovery=off Implement this; acceptance has a case named `linux-skipped observation`.",
			owner,
		);
		const saved = await save(host, owner, "Implement the named case.");
		expect(saved.status).toBe("ok");
		expect(
			(await approve(host, 1, "ses_other", "other-approve")).summary,
		).toContain("originating OpenCode session");
		expect((await approve(host, 1, owner)).summary).toContain(
			"linux-skipped observation",
		);
		const repairedPlan = {
			...plan,
			evidence: (plan.evidence ?? []).map((entry, index) =>
				index
					? entry
					: {
							...entry,
							command:
								"bun test --reporter=junit --reporter-outfile=.flow/results.xml",
							assertions: ["linux-skipped observation"],
						},
			),
		};
		expect(
			(await save(host, owner, "Implement the named case.", 1, repairedPlan))
				.status,
		).toBe("ok");
		expect((await approve(host, 2, owner, "approve-repaired")).status).toBe(
			"ok",
		);
	});
	test("leaves non-Flow malformed after-hook content untouched", async () => {
		const { host } = await load();
		const native = await host.toolContext("flow_plan_approve", {});
		const result = { content: "not-json", metadata: {} };
		await host.toolHooks.emit("execute.after", {
			tool: "flow_plan_approve",
			sessionID: native.sessionID,
			messageID: native.messageID,
			agent: native.agent,
			id: native.id,
			input: {},
			status: "completed",
			result,
		});
		expect(result.content).toBe("not-json");
	});
	test("stop and cancel preserve durable state and do not revoke another host", async () => {
		const { host, workspace } = await load();
		const saved = await save(host);
		const original = await readFile(
			join(workspace, ".flow/session.json"),
			"utf8",
		);
		for (const directive of ["stop", "cancel"]) {
			await host.command("flow-auto", "--recovery=off Continue", "ses_owner");
			await host.command("flow-auto", directive, "ses_owner");
			expect(host.prompts.at(-1)).toMatchObject({
				text: "/flow-auto stop",
				resume: false,
			});
			await host.idle("ses_owner");
			expect(host.synthetics).toEqual([]);
			expect(
				await readFile(join(workspace, ".flow/session.json"), "utf8"),
			).toBe(original);
		}
		await host.command("flow-auto", "--recovery=off Continue", "ses_owner");
		await host.command("flow-auto", "stop", "ses_other");
		await host.admit("stop /flow-auto", "ses_other");
		const stoppedOther = await host.response(
			"flow_status",
			statusInput,
			"ses_other",
		);
		expect(stoppedOther.workflowData.autoDrive).toBeUndefined();
		const owner = await host.response("flow_status", statusInput, "ses_owner");
		expect(owner.workflowData.autoDrive).toMatchObject({ state: "active" });
		expect(projectionOf(owner).sessionId).toBe(projectionOf(saved).sessionId);
		await writeFile(join(workspace, ".flow/session.json"), "{broken");
		await expect(
			host.command("flow-auto", "stop", "ses_owner"),
		).resolves.toMatchObject({ text: "/flow-auto stop", resume: false });
	});
	test.each([
		["ses_owner", 1],
		["ses_other", 0],
	] as const)(
		"an idle-created workflow is adopted only from same-host save by %s",
		async (creator, expected) => {
			const { host } = await load();
			await host.command("flow-auto", "--recovery=off", "ses_owner");
			const saved = await save(
				host,
				creator,
				"Bind idle continuation ownership.",
			);
			expect(saved.status).toBe("ok");
			expect((await approve(host, 1, "ses_owner")).status).toBe("ok");
			const continued = expected ? host.nextSynthetic("ses_owner") : null;
			await idleDecision(host, "ses_owner");
			if (continued) await continued;
			expect(host.synthetics).toHaveLength(expected);
		},
	);
	test("another host's accepted mutation and its exact owner replay cannot grant automatic authority", async () => {
		const { host } = await load();
		await save(host);
		await host.command("flow-auto", "--recovery=off", "ses_owner");
		await host.response("flow_status", statusInput, "ses_owner");
		const coordinator = await idleDecision(host, "ses_owner");
		await waitingForPlanApproval(host, "ses_owner");
		await host.admit("Approve the plan.", "ses_owner");
		await host.beginTurn("ses_owner");
		expect((await approve(host, 1, "ses_other")).status).toBe("ok");
		const replay = await approve(host, 1, "ses_owner");
		expect(replay.workflowData.operation?.replayed).toBe(true);
		await idleDecision(host, "ses_owner", coordinator);
		expect(host.synthetics).toEqual([]);
	});
	test("missing native request identity rejects a mutation before durable effect", async () => {
		const { host, workspace } = await load();
		await save(host);
		const before = await readFile(
			join(workspace, ".flow/session.json"),
			"utf8",
		);
		const native = await host.toolContext("flow_plan_approve", {
			request: { operationId: "unknown-approve", expectedRevision: 1 },
		});
		host.messages.set("ses_manager", []);
		await expect(
			host.invoke(
				"flow_plan_approve",
				{ request: { operationId: "unknown-approve", expectedRevision: 1 } },
				native,
			),
		).rejects.toThrow("assistant identity");
		expect(await readFile(join(workspace, ".flow/session.json"), "utf8")).toBe(
			before,
		);
	});
	test("a same-host assistant from an older native request cannot mutate after real steer", async () => {
		const { host, workspace } = await load();
		await save(host);
		const args = {
			request: { operationId: "stale-approve", expectedRevision: 1 },
		};
		const old = await host.toolContext("flow_plan_approve", args);
		const before = await readFile(
			join(workspace, ".flow/session.json"),
			"utf8",
		);
		await host.admit("Approve the plan.");
		await host.beginTurn();
		await expect(host.invoke("flow_plan_approve", args, old)).rejects.toThrow();
		expect(await readFile(join(workspace, ".flow/session.json"), "utf8")).toBe(
			before,
		);
	});
	test("a durably accepted close retains retry authority when archive publication fails", async () => {
		const { host, workspace } = await load();
		const saved = await save(host);
		await host.command("flow-auto", "--recovery=off", "ses_close");
		await host.response("flow_status", statusInput, "ses_close");
		await idleDecision(host, "ses_close");
		await waitingForPlanApproval(host, "ses_close");
		await host.admit("Defer this session.", "ses_close");
		await writeFile(join(workspace, ".flow/history"), "unsafe\n");
		const closed = await host.response(
			"flow_session_close",
			{
				request: {
					operationId: "pending-close",
					expectedRevision: 1,
					sessionId: projectionOf(saved).sessionId,
					kind: "deferred",
					summary: "Deferred by user.",
				},
			},
			"ses_close",
		);
		expect(closed).toMatchObject({
			status: "error",
			workflowData: {
				operation: { replayed: false },
				closeState: { durableAccepted: true },
			},
		});
		await unlink(join(workspace, ".flow/history"));
		await mkdir(join(workspace, ".flow/history"));
		const retried = host.nextSynthetic("ses_close");
		await host.idle("ses_close");
		await retried;
		expect(host.synthetics).toHaveLength(1);
		expect(host.synthetics[0]?.text).toContain("flow_session_close");
	});
	test("accepted approval survives decorated native after-hooks and submits one queued continuation with the manager model", async () => {
		const { host } = await load();
		await save(host);
		const manager = "ses_owner";
		const session = host.ensureSession(manager, {
			agent: "build",
			model: { providerID: "provider", id: "approved-model", variant: "high" },
		});
		await host.command("flow-auto", "--recovery=off", manager);
		await host.response("flow_status", statusInput, manager);
		const coordinator = await idleDecision(host, manager);
		await waitingForPlanApproval(host, manager);
		expect(host.synthetics).toEqual([]);
		await host.admit("What do you recommend?", manager);
		await host.response("flow_status", statusInput, manager);
		await idleDecision(host, manager, coordinator);
		await waitingForPlanApproval(host, manager);
		expect(host.synthetics).toEqual([]);
		await host.admit("Approve the plan.", manager);
		const args = {
			request: { operationId: "decorated-approve", expectedRevision: 1 },
		};
		const native = await host.toolContext("flow_plan_approve", args, manager);
		const result = await host.invoke("flow_plan_approve", args, native);
		const decorated = { content: `${nativeText(result)}\n\n[audit-footer]` };
		await host.toolHooks.emit("execute.after", {
			tool: "flow_plan_approve",
			sessionID: native.sessionID,
			messageID: native.messageID,
			agent: native.agent,
			id: native.id,
			input: args,
			status: "completed",
			result: decorated,
		});
		expect(decorated.content).toEndWith("[audit-footer]");
		const continuation = host.nextSynthetic(manager);
		await idleDecision(host, manager, coordinator);
		await continuation;
		expect(host.synthetics).toHaveLength(1);
		const dispatched = host.synthetics[0];
		expect(dispatched).toMatchObject({
			sessionID: manager,
			delivery: "queue",
			resume: true,
			metadata: { [FLOW_AUTO_METADATA_KEY]: expect.any(String) },
		});
		expect(session.model).toEqual({
			providerID: "provider",
			id: "approved-model",
			variant: "high",
		});
		exactlyOnce(dispatched?.text ?? "", FLOW_MANAGER_KERNEL);
		expect(dispatched?.text).toContain(
			"Load flow-run guidance before any feature or closure route",
		);
		expect(dispatched?.text).toContain("replay archiveRetry exactly");
		const compact = await host.response("flow_status", statusInput, manager);
		expect(compact.workflowData).not.toHaveProperty("autoTiming");
		expect(compact.workflowData.autoDrive).toMatchObject({ state: "active" });
		const detail = await host.response(
			"flow_status",
			{ request: { view: "detail" } },
			manager,
		);
		expect(detail.workflowData.autoTiming).toMatchObject({
			scope: "latest-flow-auto-in-current-plugin-process",
			authoritative: false,
			state: "active",
		});
		await idleDecision(host, manager, coordinator);
		expect(host.synthetics).toHaveLength(1);
		await host.events.emit({
			id: "evt_interrupt",
			created: 100,
			type: "session.execution.interrupted",
			data: { sessionID: manager, reason: "user" },
			durable: { aggregateID: manager, seq: 1, version: 1 },
		});
		await host.idle(manager);
		expect(host.synthetics).toHaveLength(1);
	});
	test("automatic compaction keeps the manager kernel and checked continuation authority", async () => {
		const { host } = await load();
		await save(host);
		await host.command("flow-auto", "--recovery=off", "ses_owner");
		await host.response("flow_status", statusInput, "ses_owner");
		const system = await host.compact("ses_owner");
		const text = system
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		exactlyOnce(text, FLOW_MANAGER_KERNEL);
		expect(text).toContain("/flow-auto continuation");
		expect(text).toContain("replay archiveRetry exactly");
		expect(
			(await host.response("flow_status", statusInput, "ses_owner"))
				.workflowData.autoDrive,
		).toMatchObject({ state: "active" });
	});
});

describe("duplicate native runtime guard", () => {
	test("rejects duplicate setup, releases its failed registration, and preserves owner stop", async () => {
		const { host, workspace } = await load();
		await host.command("flow-auto", "--recovery=off", "ses_owner");
		const duplicate = await createNativeFlowHost(workspace);
		hosts.push(duplicate);
		await expect(duplicate.load(FlowPlugin)).rejects.toThrow(
			"duplicate-instances",
		);
		expect(duplicate.tools.size).toBe(0);
		await expect(
			host.command("flow-auto", "stop", "ses_owner"),
		).resolves.toMatchObject({ text: "/flow-auto stop", resume: false });
		expect((await host.response("flow_status", statusInput)).status).toBe("ok");
		for (const id of ["flow", "flow-run"] as const) {
			const output = nativeText(await host.call("flow_guidance", { id }));
			expect(output).toBe(getFlowGuidance(id).content);
			exactlyOnce(output, FLOW_MANAGER_KERNEL);
		}
	});
});

test("planner cannot mutate Flow even through direct native tool execution", async () => {
	const { host, workspace } = await load();
	host.ensureSession("ses_planner", {
		agent: "flow-planner",
		parentID: "ses_manager",
	});
	for (const name of TOOL_NAMES) {
		const output = nativeText(await host.call(name, {}, "ses_planner"));
		if (name === "flow_guidance")
			expect(output).toContain("verified workspace session");
		else {
			const value: unknown = JSON.parse(output);
			expect(value).toMatchObject({ status: "error" });
		}
	}
	await expect(
		readFile(join(workspace, ".flow/session.json")),
	).rejects.toMatchObject({ code: "ENOENT" });
});

test("model handoff distinguishes requested roles from bounded native manager observations", async () => {
	const { host } = await load({
		modelPreferences: {
			planning: { kind: "model", model: { providerID: "test", id: "planner" } },
			review: { kind: "model", model: { providerID: "test", id: "reviewer" } },
		},
	});
	const selected = host.ensureSession("ses_manager", {
		model: { providerID: "test", id: "coding", variant: "high" },
	});
	const result = await host.response("flow_status", statusInput);
	expect(selected.model).toEqual({
		providerID: "test",
		id: "coding",
		variant: "high",
	});
	expect(result.workflowData.modelConfiguration).toMatchObject({
		planning: {
			requested: "test/planner",
			mode: "specialist-advice",
			availability: "unverified",
		},
		review: { requested: "test/reviewer", availability: "unverified" },
		implementation: {
			observed: { providerID: "test", modelID: "coding", variant: "high" },
		},
	});
	host.ensureSession("ses_planner", {
		agent: "flow-planner",
		parentID: "ses_manager",
		model: { providerID: "test", id: "planner" },
	});
	await host.beginTurn("ses_planner");
	expect(
		field(
			field(
				(await host.response("flow_status", statusInput)).workflowData
					.modelConfiguration,
				"implementation",
			),
			"observed",
		),
	).toEqual({ providerID: "test", modelID: "coding", variant: "high" });
	for (let index = 0; index < 128; index++) {
		await host.admit("Inspect.", `ses_other_${index}`);
		await host.beginTurn(`ses_other_${index}`);
	}
	expect(
		field(
			field(
				(await host.response("flow_status", statusInput)).workflowData
					.modelConfiguration,
				"implementation",
			),
			"observed",
		),
	).toBeNull();
});

test("production plugin options cannot supply experimental recovery profiles", async () => {
	const { host } = await load({
		recoveryTreatment: { origin: "simulation", arm: "manager-plus-jev" },
		profiles: [
			{
				id: "injected",
				model: "jev-1.13.0",
				rubric: "recovery-v1",
				policy: "bounded-recovery-v1",
				choice: 0,
				goal: 0,
				suitability: 0,
			},
		],
	});
	await expect(
		host.command(
			"flow-auto",
			"--recovery=delegated --recovery-calls=3 --recovery-usd=0.01 Repair parser",
		),
	).rejects.toThrow("No release-owned live qualification");
});

test("attachment-only native user direction can close a stopped recovery workflow", async () => {
	const { host } = await load();
	const saved = await save(host);
	await host.command(
		"flow-auto",
		"--recovery=shadow --recovery-calls=2 --recovery-usd=0.01 Continue",
	);
	await host.command("flow-auto", "stop");
	await host.admit("", "ses_manager", {
		files: [{ uri: "data:image/png;base64,AA==" }],
	});
	const closed = await host.response("flow_session_close", {
		request: {
			operationId: "attachment-close",
			expectedRevision: 1,
			sessionId: projectionOf(saved).sessionId,
			kind: "abandoned",
			summary: "Directed by the user attachment.",
		},
	});
	expect(closed.status).toBe("ok");
});
