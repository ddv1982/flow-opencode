import { afterEach, expect, spyOn, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";
import {
	CapturingRecoveryController,
	RawRecoveryCaptureSchema,
} from "../evals/recovery-decisions/capture.js";
import CapturePlugin from "../evals/recovery-decisions/capture-plugin.js";
import { importSnapshot } from "../evals/recovery-decisions/dataset.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import {
	RecoveryController,
	RecoveryProposalSchema,
} from "../src/application/recovery-policy.js";
import FlowPlugin from "../src/index.js";
import { frozenCampaignFixture } from "./recovery-campaign-support.js";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});
const context = {
	hostSessionId: "host",
	messageId: "assistant",
	agent: "build",
};
async function setup() {
	const root = await mkdtemp(join(tmpdir(), "recovery-capture-"));
	roots.push(root);
	const workspace = join(root, "workspace");
	await mkdir(workspace);
	const fixture = await frozenCampaignFixture();
	const proposal = RecoveryProposalSchema.parse({
		id: "proposal",
		sessionId: fixture.session.id,
		expectedRevision: fixture.session.revision,
		candidates: [
			{
				id: "retry",
				action: "retry",
				featureId: "parser",
				remedy: "Add null guard",
				changedFromPreviousAttempt: "Handle null",
				findingIds: ["finding"],
			},
		],
	});
	return {
		root,
		workspace,
		directory: join(root, "captures"),
		...fixture,
		proposal,
	};
}
async function records(directory: string) {
	return Promise.all(
		(await readdir(directory)).map(async (file) =>
			RawRecoveryCaptureSchema.parse(
				JSON.parse(await readFile(join(directory, file), "utf8")),
			),
		),
	);
}

test("capture preserves the delegated snapshot when callers mutate pending arguments", async () => {
	const f = await setup();
	const controller = await CapturingRecoveryController.create(
		f.workspace,
		f.directory,
	);
	const original = RecoveryController.prototype.guard;
	let actual: unknown;
	const spy = spyOn(RecoveryController.prototype, "guard").mockImplementation(
		function (this: RecoveryController, ctx) {
			return {
				...original.call(this, ctx),
				propose: async (...args) => {
					actual = args;
					return { kind: "unavailable", reason: "capture-only" };
				},
			};
		},
	);
	try {
		const expected = structuredClone({
			session: f.session,
			sourceDigest: f.sourceDigest,
			proposal: f.proposal,
		});
		const guard = controller.guard(context);
		const pending = guard.propose(f.session, f.sourceDigest, f.proposal);
		f.proposal.id = "mutated";
		Object.assign(f.session, { revision: f.session.revision + 1 });
		expect(await pending).toEqual({
			kind: "unavailable",
			reason: "capture-only",
		});
		const [record] = await records(f.directory);
		expect(record?.payload).toEqual(expected);
		expect(actual).toEqual([
			expected.session,
			expected.sourceDigest,
			expected.proposal,
		]);
		expect(record?.payloadDigest).toBe(datasetDigest(expected));
		expect(record?.context).toEqual(context);
		expect(() => importSnapshot(record)).toThrow();
		expect((await lstat(f.directory)).mode & 0o777).toBe(0o700);
		for (const file of await readdir(f.directory))
			expect((await lstat(join(f.directory, file))).mode & 0o777).toBe(0o600);
	} finally {
		spy.mockRestore();
	}
});

test("fresh external canonical directory is required", async () => {
	const f = await setup();
	await symlink(f.workspace, join(f.root, "alias"));
	for (const path of [
		"relative",
		f.workspace,
		join(f.workspace, "capture"),
		join(f.root, "alias", "capture"),
		join(f.root, "missing", "capture"),
	])
		await expect(
			CapturingRecoveryController.create(f.workspace, path),
		).rejects.toThrow("fresh private directory");
	await mkdir(f.directory, { mode: 0o700 });
	await expect(
		CapturingRecoveryController.create(f.workspace, f.directory),
	).rejects.toThrow();
	await symlink(f.directory, join(f.root, "destination-link"));
	await expect(
		CapturingRecoveryController.create(
			f.workspace,
			join(f.root, "destination-link"),
		),
	).rejects.toThrow();
});

test("failed private writes stop before controller delegation and expose no private detail", async () => {
	const f = await setup();
	const controller = await CapturingRecoveryController.create(
		f.workspace,
		f.directory,
	);
	await chmod(f.directory, 0o755);
	const guard = controller.guard(context);
	await expect(
		guard.propose(f.session, f.sourceDigest, f.proposal),
	).rejects.toThrow("Recovery capture failed; assessment was not attempted.");
	expect(await readdir(f.directory)).toEqual([]);
	await chmod(f.directory, 0o700);
	await expect(
		guard.propose(f.session, f.sourceDigest, f.proposal),
	).rejects.toThrow("explicit active recovery command");
	expect(await records(f.directory)).toHaveLength(1);
});

test("concurrent reservations cap records while retaining rejected proposal inputs", async () => {
	const f = await setup();
	const controller = await CapturingRecoveryController.create(
		f.workspace,
		f.directory,
	);
	const guard = controller.guard(context);
	const outcomes = await Promise.allSettled(
		Array.from({ length: 130 }, (_, i) =>
			guard.propose(f.session, f.sourceDigest, { ...f.proposal, id: `p-${i}` }),
		),
	);
	expect(await records(f.directory)).toHaveLength(128);
	expect(
		outcomes.filter(
			(x) =>
				x.status === "rejected" && String(x.reason).includes("capture failed"),
		),
	).toHaveLength(2);
	expect(new Set((await records(f.directory)).map((r) => r.id)).size).toBe(128);
});

function pluginContext(workspace: string) {
	return {
		directory: workspace,
		worktree: workspace,
		project: {},
		serverUrl: new URL("http://localhost"),
		$: {},
		experimental_workspace: { register() {} },
		client: {
			app: { log() {} },
			session: { message: async () => ({ data: undefined }) },
		},
	} as unknown as Parameters<typeof FlowPlugin>[0];
}
function toolContext(workspace: string): ToolContext {
	return {
		directory: workspace,
		worktree: workspace,
		sessionID: "host",
		messageID: "assistant",
		agent: "build",
		abort: new AbortController().signal,
		metadata() {},
		async ask() {},
	};
}
test("actual opt-in flow_status captures exact workspace inputs; ordinary plugin does not", async () => {
	const f = await setup();
	for (const [name, bytes] of Object.entries(f.fixture.files)) {
		await mkdir(dirname(join(f.workspace, name)), { recursive: true });
		await writeFile(join(f.workspace, name), bytes);
	}
	for (const args of [
		["init", "--initial-branch=main"],
		["add", "."],
	])
		expect(Bun.spawnSync(["git", "-C", f.workspace, ...args]).exitCode).toBe(0);
	const ordinary = await FlowPlugin(pluginContext(f.workspace));
	try {
		await ordinary.tool?.flow_status?.execute(
			{ request: { view: "compact" }, recoveryProposal: f.proposal },
			toolContext(f.workspace),
		);
		expect(await readdir(f.root)).toEqual(["workspace"]);
	} finally {
		await ordinary.dispose?.();
	}
	const hooks = await CapturePlugin(pluginContext(f.workspace), {
		captureDirectory: f.directory,
	});
	try {
		const result = await hooks.tool?.flow_status?.execute(
			{ request: { view: "compact" }, recoveryProposal: f.proposal },
			toolContext(f.workspace),
		);
		expect(result).toContain("explicit active recovery command");
		const [record] = await records(f.directory);
		expect(record?.payload).toEqual({
			session: f.session,
			sourceDigest: f.sourceDigest,
			proposal: f.proposal,
		});
	} finally {
		await hooks.dispose?.();
	}
});

test("encoded record and total byte bounds are enforced before dispatch", async () => {
	const f = await setup();
	const controller = await CapturingRecoveryController.create(
		f.workspace,
		f.directory,
	);
	await expect(
		controller
			.guard({ ...context, agent: "x".repeat(1024 * 1024) })
			.propose(f.session, f.sourceDigest, f.proposal),
	).rejects.toThrow("capture failed");
	expect(await readdir(f.directory)).toEqual([]);
	const guard = controller.guard({ ...context, agent: "x".repeat(900000) });
	const outcomes = await Promise.allSettled(
		Array.from({ length: 20 }, () =>
			guard.propose(f.session, f.sourceDigest, f.proposal),
		),
	);
	const files = await readdir(f.directory);
	expect(files.length).toBeGreaterThan(0);
	expect(files.length).toBeLessThan(20);
	const sizes = await Promise.all(
		files.map(async (name) => (await lstat(join(f.directory, name))).size),
	);
	expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(
		16 * 1024 * 1024,
	);
	expect(
		outcomes.filter(
			(x) =>
				x.status === "rejected" && String(x.reason).includes("capture failed"),
		),
	).toHaveLength(20 - files.length);
});

test("active shadow capture preserves unavailable advice and never grants a mutation", async () => {
	const f = await setup();
	const controller = await CapturingRecoveryController.create(
		f.workspace,
		f.directory,
	);
	const baseline = new RecoveryController({
		async assess() {
			return { kind: "unavailable", reason: "capture-only" };
		},
	});
	const finding = f.session.runs.at(-1)?.reviews.at(-1)?.result
		?.findings[0]?.findingId;
	const feature = f.session.runs.at(-1)?.featureId;
	const candidate = f.proposal.candidates[0];
	if (!finding || !feature || !candidate)
		throw new Error("Missing blocked fixture finding.");
	const proposal = {
		...f.proposal,
		candidates: [
			{
				...candidate,
				featureId: feature,
				findingIds: [finding],
			},
		],
	};
	for (const instance of [controller, baseline]) {
		instance.activate("host", { mode: "shadow", maxCalls: 2, maxUsd: 0.01 });
		instance.observeMessage("host", "user", false);
		instance.observeAssistant("host", "assistant", "user");
	}
	const expected = await baseline
		.guard(context)
		.propose(f.session, f.sourceDigest, proposal);
	expect(
		await controller
			.guard(context)
			.propose(f.session, f.sourceDigest, proposal),
	).toEqual(expected);
	expect(expected).toMatchObject({
		kind: "unavailable",
		mode: "shadow",
		reason: "provider",
		selectedCandidateId: null,
		action: null,
	});
	expect(expected).not.toHaveProperty("recommended");
	expect(controller.snapshot()).toEqual(baseline.snapshot());
	expect((await records(f.directory))[0]?.payload.proposal).toEqual(proposal);
});

test("filesystem I/O failure never calls the original proposal guard", async () => {
	const f = await setup();
	const controller = await CapturingRecoveryController.create(
		f.workspace,
		f.directory,
	);
	const original = RecoveryController.prototype.guard;
	let calls = 0;
	const spy = spyOn(RecoveryController.prototype, "guard").mockImplementation(
		function (this: RecoveryController, ctx) {
			return {
				...original.call(this, ctx),
				propose: async () => {
					calls++;
				},
			};
		},
	);
	try {
		const guard = controller.guard(context);
		await rm(f.directory, { recursive: true });
		await expect(
			guard.propose(f.session, f.sourceDigest, f.proposal),
		).rejects.toThrow("Recovery capture failed; assessment was not attempted.");
		expect(calls).toBe(0);
	} finally {
		spy.mockRestore();
	}
});
