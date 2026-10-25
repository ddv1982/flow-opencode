import { afterEach, expect, spyOn, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@opencode/plugin/promise/tool";
import type { PreparedValidation } from "../src/application/prepare-validation.js";
import FlowPlugin from "../src/index.js";
import {
	CallID,
	type NativeToolAfter,
	type NativeToolBefore,
	NativeToolError,
} from "../src/platform/opencode/sdk.js";
import { ValidationCaptureCoordinator } from "../src/platform/opencode/validation-capture.js";
import { createNativeFlowHost } from "./fixtures/native-flow-host.js";

const marker =
	"\n\n[flow-validation-error] Flow validation capture failed. No validation receipt was produced.";
const raw = "literal raw shell output\n0 failed\n";
const prepared: PreparedValidation = {
	featureId: "capture-research",
	runId: "run-research",
	command: "printf 'literal raw shell output\\n0 failed\\n'",
	scope: "focused",
	sourceDigest: `sha256:${"a".repeat(64)}`,
	hostPlatform: "other",
	intent: "pass",
	assertions: [],
	resultsPath: undefined,
};
const file = {
	type: "file",
	uri: "file:///fixture/report.txt",
	mime: "text/plain",
	name: "report.txt",
} satisfies NonNullable<Exclude<Result["content"], string>>[number];
const cases: ReadonlyArray<{
	name: string;
	content?: Result["content"];
	expected: Result["content"];
}> = [
	{ name: "string", content: raw, expected: raw + marker },
	{
		name: "text and file array",
		content: [{ type: "text", text: raw }, file],
		expected: [
			{ type: "text", text: raw },
			file,
			{ type: "text", text: marker },
		],
	},
	{
		name: "file only",
		content: [file],
		expected: [file, { type: "text", text: marker }],
	},
	{ name: "absent content", expected: [{ type: "text", text: marker }] },
];

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
	const workspace = await realpath(await mkdtemp(join(tmpdir(), "component-")));
	const host = await createNativeFlowHost(workspace);
	let receiver: ValidationCaptureCoordinator | undefined;
	const rejections: unknown[] = [];
	const original = ValidationCaptureCoordinator.prototype.observeToolAfter;
	const probe = spyOn(
		ValidationCaptureCoordinator.prototype,
		"observeToolAfter",
	).mockImplementation(async function (
		this: ValidationCaptureCoordinator,
		input,
	) {
		receiver = this;
		try {
			return await original.call(this, input);
		} catch (error) {
			rejections.push(error);
			throw error;
		}
	});
	cleanups.push(async () => {
		probe.mockRestore();
		try {
			await host.dispose();
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
	await host.load(FlowPlugin);
	const native = await host.toolContext("shell", { command: prepared.command });
	const before: NativeToolBefore = {
		tool: "shell",
		sessionID: native.sessionID,
		messageID: native.messageID,
		id: native.id,
		agent: native.agent,
		input: { command: prepared.command },
	};
	await host.toolHooks.emit("execute.after", {
		...before,
		status: "completed",
		result: { content: "unarmed literal" },
	});
	function coordinator(): ValidationCaptureCoordinator {
		if (!receiver)
			throw new Error("Composition did not invoke the real coordinator.");
		return receiver;
	}
	const capture = coordinator();
	async function arm() {
		capture.arm(native.sessionID, workspace, prepared);
		await host.toolHooks.emit("execute.before", before);
		expect(capture.pendingCount()).toBe(1);
	}
	async function failPersistence() {
		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(
			join(workspace, ".flow/session.json"),
			"unchanged durable bytes\n",
		);
		await writeFile(
			join(workspace, ".flow/session.lock"),
			"deliberate regular-file lock failure\n",
		);
	}
	async function assertFailed() {
		expect(rejections.map(String)).toEqual([
			`Error: Flow requires the Flow session lock to be a directory: ${join(workspace, ".flow/session.lock")}.`,
		]);
		expect(capture.pendingCount()).toBe(0);
		expect(await readFile(join(workspace, ".flow/session.json"), "utf8")).toBe(
			"unchanged durable bytes\n",
		);
		expect((await readdir(join(workspace, ".flow"))).sort()).toEqual([
			".gitignore",
			"session.json",
			"session.lock",
		]);
	}
	return {
		workspace,
		host,
		capture,
		before,
		arm,
		failPersistence,
		assertFailed,
		rejections,
		async dispose() {
			const cleanup = cleanups.pop();
			if (!cleanup) throw new Error("Missing capture fixture cleanup.");
			await cleanup();
		},
	};
}

for (const item of cases)
	test(`current armed filesystem failure is visible in ${item.name}`, async () => {
		const f = await fixture();
		try {
			await f.arm();
			await f.failPersistence();
			const result: Result = {
				...(item.content === undefined ? {} : { content: item.content }),
				metadata: {
					exit: 0,
					truncated: false,
					privateKey: "preserved-metadata",
				},
				output: { exit: 0, truncated: false, output: raw },
			};
			const after: NativeToolAfter = {
				...f.before,
				status: "completed",
				result,
			};
			await f.host.toolHooks.emit("execute.after", after);
			await f.assertFailed();
			expect(after.result.metadata).toBe(result.metadata);
			expect(after.result.output).toBe(result.output);
			expect(JSON.stringify(after)).not.toContain("[flow-validation]");
			expect(JSON.stringify(after.result.content ?? null)).not.toContain(
				f.workspace,
			);
			expect(JSON.stringify(after.result.content ?? null)).not.toContain(
				"Flow requires the Flow session lock",
			);
			expect(after.result.content).toEqual(item.expected);
			if (Array.isArray(item.content) && Array.isArray(after.result.content))
				for (const [index, part] of item.content.entries())
					expect(after.result.content[index]).toBe(part);
		} finally {
			await f.dispose();
		}
	});

test("current armed capture failure preserves the existing native error channel", async () => {
	const f = await fixture();
	try {
		await f.arm();
		await f.failPersistence();
		const originalCause = { diagnostic: "existing-private-cause" };
		const error = new NativeToolError({
			message: "literal native shell failure",
			metadata: { existing: "metadata" },
			error: originalCause,
		});
		const after: NativeToolAfter = { ...f.before, status: "error", error };
		await f.host.toolHooks.emit("execute.after", after);
		await f.assertFailed();
		expect(after.status).toBe("error");
		expect(after.error._tag).toBe("Tool.Error");
		expect(after.error.metadata).toBe(error.metadata);
		expect(after.error.error).toBe(originalCause);
		expect(after.error.message).toBe("literal native shell failure");
		expect(after.error).toBe(error);
	} finally {
		await f.dispose();
	}
});

test("unarmed, nonshell, unmatched and stale completions keep literal content", async () => {
	const f = await fixture();
	try {
		const after: NativeToolAfter = {
			...f.before,
			status: "completed",
			result: { content: raw, metadata: { exit: 0, truncated: false } },
		};
		await f.host.toolHooks.emit("execute.after", after);
		expect(after.result.content).toBe(raw);
		await f.arm();
		const nonshell: NativeToolAfter = { ...after, tool: "read" };
		await f.host.toolHooks.emit("execute.after", nonshell);
		expect(nonshell.result.content).toBe(raw);
		expect(f.capture.pendingCount()).toBe(1);
		const unmatched: NativeToolAfter = {
			...after,
			id: CallID.make("unmatched-call"),
		};
		await f.host.toolHooks.emit("execute.after", unmatched);
		expect(unmatched.result).toBe(after.result);
		expect(unmatched.result.content).toBe(raw);
		expect(f.capture.pendingCount()).toBe(1);
		f.capture.cancel(f.before.sessionID);
		f.capture.arm(f.before.sessionID, f.workspace, prepared);
		await f.host.toolHooks.emit("execute.after", after);
		expect(after.result.content).toBe(raw);
		expect(f.capture.pendingCount()).toBe(1);
		expect(f.rejections).toEqual([]);
		expect(await readdir(f.workspace)).not.toContain(".flow");
	} finally {
		await f.dispose();
	}
});

test("an ordinary session read failure for a current capture is visible", async () => {
	const f = await fixture();
	try {
		await f.arm();
		const get = spyOn(f.host.context.session, "get").mockRejectedValue(
			new Error("private read diagnostic"),
		);
		const after: NativeToolAfter = {
			...f.before,
			status: "completed",
			result: { content: raw },
		};
		try {
			await f.host.toolHooks.emit("execute.after", after);
		} finally {
			get.mockRestore();
		}
		expect(f.rejections.map(String)).toEqual([
			"Error: private read diagnostic",
		]);
		expect(f.capture.pendingCount()).toBe(0);
		expect(after.result.content).toBe(raw + marker);
	} finally {
		await f.dispose();
	}
});

test("stale rejection during an after read cannot annotate an old call or remove the next capture", async () => {
	const f = await fixture();
	try {
		await f.arm();
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const get = spyOn(f.host.context.session, "get").mockImplementation(
			async () => {
				entered.resolve();
				await release.promise;
				throw new Error("stale private read diagnostic");
			},
		);
		const after: NativeToolAfter = {
			...f.before,
			status: "completed",
			result: { content: raw, metadata: { exit: 0, truncated: false } },
		};
		try {
			const pending = f.host.toolHooks.emit("execute.after", after);
			await entered.promise;
			f.capture.cancel(f.before.sessionID);
			f.capture.arm(f.before.sessionID, f.workspace, prepared);
			release.resolve();
			await pending;
		} finally {
			get.mockRestore();
		}
		expect(after.result.content).toBe(raw);
		expect(f.capture.pendingCount()).toBe(1);
		expect(f.rejections).toEqual([]);
		expect(await readdir(f.workspace)).not.toContain(".flow");
	} finally {
		await f.dispose();
	}
});
