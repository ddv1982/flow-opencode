import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
	ObservedValidation,
	PreparedValidation,
} from "../src/application/prepare-validation.js";
import type {
	SourceDigest,
	ValidationObservation,
} from "../src/domain/session.js";
import {
	Agent,
	CallID,
	type NativeToolAfter,
	type NativeToolBefore,
	NativeToolError,
	type OpenCodeEvent,
	Session,
	SessionMessage,
} from "../src/platform/opencode/sdk.js";
import {
	readHostToolOutput,
	ValidationCaptureCoordinator,
} from "../src/platform/opencode/validation-capture.js";

const temporaryRoot = await mkdtemp(join(tmpdir(), "flow-native-validation-"));
const workspace = join(
	temporaryRoot,
	...Array<string>(process.cwd().split(/[\\/]/).length).fill("workspace"),
);
await mkdir(workspace, { recursive: true });
afterAll(() => rm(temporaryRoot, { recursive: true, force: true }));
await mkdir(join(workspace, "workdir-child"));
if (process.platform !== "win32") {
	await symlink(tmpdir(), join(workspace, "workdir-outside"), "dir");
	for (const name of [" ", "\n", "native-alias ", "native-alias\n"])
		await symlink(tmpdir(), join(workspace, name), "dir");
	for (const name of [
		"native-alias",
		"  ",
		"workspace-alias\n",
		"workspace-alias ",
	])
		await symlink(workspace, join(workspace, name), "dir");
}
const SOURCE: SourceDigest = `sha256:${"a".repeat(64)}`;
const prepared: PreparedValidation = {
	featureId: "runtime",
	runId: "run-1",
	command: "bun test",
	scope: "focused",
	sourceDigest: SOURCE,
	hostPlatform: "linux",
	intent: "pass",
	assertions: [],
	resultsPath: undefined,
};
function persisted(input: ObservedValidation): ValidationObservation {
	return {
		id: input.captureId,
		featureId: input.featureId,
		runId: input.runId,
		scope: input.scope,
		command: input.command,
		intent: input.intent,
		sourceDigest: input.sourceDigest,
		exitCode: input.exitCode,
		outputDigest: input.outputDigest,
		outputComplete: input.outputComplete,
		recordedRevision: 4,
		...(input.observedAssertions
			? { observedAssertions: input.observedAssertions }
			: {}),
		...(input.ineligibleReason
			? { ineligibleReason: input.ineligibleReason }
			: {}),
	};
}
function before(overrides: Partial<NativeToolBefore> = {}): NativeToolBefore {
	return {
		tool: "shell",
		sessionID: Session.ID.make("ses_host"),
		messageID: SessionMessage.ID.make("msg_assistant"),
		id: CallID.make("call"),
		agent: Agent.ID.make("build"),
		input: { command: prepared.command },
		...overrides,
	};
}
function after(
	output: unknown = {
		exit: 0,
		truncated: false,
		status: "completed",
		output: "passed",
	},
	metadata: object = {},
	changes: Partial<NativeToolBefore> = {},
): NativeToolAfter {
	return {
		...before(changes),
		status: "completed",
		result: { output, metadata, content: [{ type: "text", text: "passed" }] },
	};
}
function fixture(
	options: Partial<
		ConstructorParameters<typeof ValidationCaptureCoordinator>[0]
	> = {},
) {
	const observations: ObservedValidation[] = [];
	const capture = new ValidationCaptureCoordinator({
		readSession: async (id) => ({
			id,
			agent: "build",
			location: { directory: workspace },
		}),
		persistObservation: async (_workspace, value) => {
			observations.push(value);
			return persisted(value);
		},
		randomId: () => "capture-1",
		...options,
	});
	return { capture, observations };
}
function digest(text: string): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

test.each([
	["omitted", undefined, undefined],
	["empty", "", ""],
	["absolute", workspace, workspace],
	["dot before", ".", workspace],
	["dot after", workspace, "."],
	["dot in both hooks", ".", "."],
	["relative before", `../${basename(workspace)}/.`, workspace],
	["relative after", workspace, `../${basename(workspace)}/.`],
	[
		"relative in both hooks",
		`../${basename(workspace)}/.`,
		`../${basename(workspace)}/.`,
	],
	...(process.platform === "win32"
		? []
		: ([
				["spaces alias before", "  ", workspace],
				["spaces alias after", workspace, "  "],
				["newline alias before", "workspace-alias\n", workspace],
				["newline alias after", workspace, "workspace-alias\n"],
				["trailing-space alias before", "workspace-alias ", workspace],
				["trailing-space alias after", workspace, "workspace-alias "],
			] as const)),
] as const)(
	"%s workdir preserves exact source-bound evidence and receipt",
	async (_name, beforeWorkdir, afterWorkdir) => {
		const { capture, observations } = fixture();
		expect(resolve(workspace)).not.toBe(process.cwd());
		capture.arm("ses_host", workspace, prepared);
		await capture.observeToolBefore(
			before({
				input: {
					command: prepared.command,
					...(beforeWorkdir === undefined ? {} : { workdir: beforeWorkdir }),
				},
			}),
		);
		const completed = after(
			undefined,
			{},
			{
				input: {
					command: prepared.command,
					...(afterWorkdir === undefined ? {} : { workdir: afterWorkdir }),
				},
			},
		);
		const result = await capture.observeToolAfter(completed);
		expect(observations).toEqual([
			{
				...prepared,
				captureId: "capture-1",
				exitCode: 0,
				outputComplete: true,
				outputDigest: digest("passed"),
			},
		]);
		const observation = observations[0];
		if (!observation) throw new Error("Observation was not persisted.");
		expect(result).toEqual(persisted(observation));
		expect(
			completed.status === "completed" && completed.result.content,
		).toEqual([
			{
				type: "text",
				text: 'passed\n\n[flow-validation] {"id":"capture-1","scope":"focused","intent":"pass","passed":true,"observed":false,"recordedRevision":4}',
			},
		]);
		expect(capture.pendingCount()).toBe(0);
	},
);
const processCwdWorkdir = relative(process.cwd(), workspace);
for (const phase of ["before", "after"] as const) {
	test.each([
		...(isAbsolute(processCwdWorkdir)
			? []
			: ([["process-cwd-relative", processCwdWorkdir]] as const)),
		["escaping", ".."],
		["subdirectory", "./workdir-child"],
		["absolute outside", tmpdir()],
		...(process.platform === "win32"
			? []
			: ([
					["symlink-outside", "./workdir-outside"],
					["space-only outside", " "],
					["dot-space outside", "./ "],
					["newline-only outside", "\n"],
					["relative trailing-space outside", "./native-alias "],
					["absolute trailing-space outside", join(workspace, "native-alias ")],
					["relative newline outside", "./native-alias\n"],
					["absolute space-only outside", join(workspace, " ")],
					["absolute newline outside", join(workspace, "\n")],
					["padded absolute", ` ${workspace} `],
					["nonexistent whitespace name", "./missing "],
				] as const)),
	] as const)(
		`${phase} rejects %s workdir without a receipt`,
		async (name, workdir) => {
			const { capture, observations } = fixture();
			if (name === "process-cwd-relative") {
				expect(resolve(workdir)).toBe(resolve(workspace));
				expect(resolve(workspace, workdir)).not.toBe(resolve(workspace));
			}
			capture.arm("ses_host", workspace, prepared);
			const input = { command: prepared.command, workdir };
			const completed = after(undefined, {}, { input });
			if (phase === "before") {
				await expect(
					capture.observeToolBefore(before({ input })),
				).rejects.toThrow("capture was cancelled");
				expect(await capture.observeToolAfter(completed)).toBeNull();
			} else {
				await capture.observeToolBefore(
					before({
						input: { command: prepared.command, workdir: workspace },
					}),
				);
				await expect(capture.observeToolAfter(completed)).rejects.toThrow();
			}
			expect(observations).toEqual([]);
			expect(capture.pendingCount()).toBe(0);
			expect(
				completed.status === "completed" && completed.result.content,
			).toEqual([{ type: "text", text: "passed" }]);
		},
	);
}
test.each([
	[
		"nonzero-completed",
		{ exit: 7, truncated: false, status: "completed", output: "failed" },
		{},
		7,
		true,
		undefined,
	],
	[
		"timeout",
		{ truncated: false, status: "completed", output: "timeout" },
		{ timeout: true, truncated: false },
		null,
		false,
		"exit-code-unavailable",
	],
	[
		"unknown-exit",
		{ truncated: false, output: "unknown" },
		{},
		null,
		false,
		"exit-code-unavailable",
	],
	[
		"unknown-completeness",
		{ exit: 0, output: "unknown" },
		{},
		0,
		false,
		"output-completeness-unknown",
	],
	[
		"truncated",
		{ exit: 0, truncated: true, output: "partial" },
		{},
		0,
		false,
		undefined,
	],
	[
		"conflicting-exit",
		{ exit: 0, truncated: false, output: "conflict" },
		{ exit: 7 },
		null,
		false,
		"exit-code-unavailable",
	],
	[
		"conflicting-truncation",
		{ exit: 0, truncated: false, output: "conflict" },
		{ truncated: true },
		null,
		false,
		"exit-code-unavailable",
	],
	[
		"killed",
		{ exit: 0, truncated: false, status: "killed", output: "killed" },
		{},
		null,
		false,
		"exit-code-unavailable",
	],
] as const)(
	"%s keeps truthful exit and completeness evidence",
	async (_name, output, metadata, exitCode, outputComplete, ineligibleReason) => {
		const { capture, observations } = fixture();
		capture.arm("ses_host", workspace, prepared);
		await capture.observeToolBefore(before());
		await capture.observeToolAfter(after(output, metadata));
		expect(observations[0]).toMatchObject({ exitCode, outputComplete });
		expect(observations[0]?.ineligibleReason).toBe(ineligibleReason);
	},
);
test("native tool errors are durable ineligible observations", async () => {
	const { capture, observations } = fixture();
	capture.arm("ses_host", workspace, prepared);
	await capture.observeToolBefore(before());
	await capture.observeToolAfter({
		...before(),
		status: "error",
		error: new NativeToolError({ message: "invalid workdir" }),
	});
	expect(observations[0]).toMatchObject({
		exitCode: null,
		outputComplete: false,
		outputDigest: digest("invalid workdir"),
		ineligibleReason: "exit-code-unavailable",
	});
});
test.each([
	["command", { command: "bun test --changed" }],
	["workdir", { command: prepared.command, workdir: tmpdir() }],
] as const)(
	"mismatching %s cancels before shell execution",
	async (_name, input) => {
		const { capture, observations } = fixture();
		capture.arm("ses_host", workspace, prepared);
		await expect(capture.observeToolBefore(before({ input }))).rejects.toThrow(
			"capture was cancelled",
		);
		expect(observations).toEqual([]);
		expect(capture.pendingCount()).toBe(0);
	},
);
test.each(["flow-reviewer", "flow-worker", "flow-planner"])(
	"%s cannot capture manager validation",
	async (agent) => {
		const { capture, observations } = fixture({
			readSession: async (id) => ({
				id,
				agent,
				location: { directory: workspace },
			}),
		});
		capture.arm("ses_host", workspace, prepared);
		await expect(
			capture.observeToolBefore(before({ agent: Agent.ID.make(agent) })),
		).rejects.toThrow("capture was cancelled");
		expect(observations).toEqual([]);
	},
);
test("wrong session facts and changed locations fail closed", async () => {
	let directory = workspace;
	const { capture, observations } = fixture({
		readSession: async (id) => ({
			id,
			agent: "build",
			location: { directory },
		}),
	});
	capture.arm("ses_host", workspace, prepared);
	await capture.observeToolBefore(before());
	directory = tmpdir();
	await expect(capture.observeToolAfter(after())).rejects.toThrow(
		"workspace changed",
	);
	expect(observations).toEqual([]);
});
test.each([
	["assistant", { messageID: SessionMessage.ID.make("msg_other") }],
	["call", { id: CallID.make("other-call") }],
	["agent", { agent: Agent.ID.make("other-agent") }],
	["session", { sessionID: Session.ID.make("ses_other") }],
] as const)(
	"a repeated call ID cannot cross the %s boundary",
	async (_name, identity) => {
		const { capture, observations } = fixture();
		capture.arm("ses_host", workspace, prepared);
		await capture.observeToolBefore(before());
		expect(
			await capture.observeToolAfter(after(undefined, {}, identity)),
		).toBeNull();
		expect(observations).toEqual([]);
		expect(await capture.observeToolAfter(after())).toMatchObject({
			id: "capture-1",
			exitCode: 0,
		});
	},
);
test("later shell input cannot relabel the frozen command", async () => {
	const { capture, observations } = fixture();
	capture.arm("ses_host", workspace, prepared);
	await capture.observeToolBefore(before());
	await expect(
		capture.observeToolAfter(
			after(undefined, {}, { input: { command: "different" } }),
		),
	).rejects.toThrow("command or workspace changed");
	expect(observations).toEqual([]);
});
test("only the native shell ID binds capture", async () => {
	const { capture, observations } = fixture();
	capture.arm("ses_host", workspace, prepared);
	await capture.observeToolBefore(before({ tool: "bash" }));
	expect(await capture.observeToolAfter(after())).toBeNull();
	expect(observations).toEqual([]);
	await capture.observeToolBefore(before());
	expect(await capture.observeToolAfter(after())).toMatchObject({
		exitCode: 0,
	});
});
test("expiry, cancellation, duplicate arming, and clear release captures", () => {
	let now = 1;
	const { capture } = fixture({ now: () => now });
	capture.arm("ses_host", workspace, prepared);
	expect(() => capture.arm("ses_host", workspace, prepared)).toThrow(
		"already has an armed",
	);
	expect(() => capture.arm("other", workspace, prepared)).toThrow(
		"workspace already has",
	);
	expect(capture.cancel("ses_host")).toBe(true);
	capture.arm("ses_host", workspace, prepared);
	now += 16 * 60 * 1000;
	expect(capture.pendingCount()).toBe(0);
	capture.arm("ses_host", workspace, prepared);
	capture.clear();
	expect(capture.pendingCount()).toBe(0);
});
const report =
	'<testsuites><testcase classname="suite" name="critical"/></testsuites>';
test.each([
	["fresh", 101, "passed"],
	["equal-arming-time", 100, "absent"],
	["future", 201, "absent"],
	["stale", 99, "absent"],
] as const)(
	"%s JUnit freshness preserves declared assertion evidence",
	async (_name, modifiedMs, status) => {
		let now = 100,
			reads = 0;
		const { capture, observations } = fixture({
			now: () => now,
			readReport: async () =>
				++reads === 1 ? null : { text: report, modifiedMs },
		});
		capture.arm("ses_host", workspace, {
			...prepared,
			assertions: ["suite.critical"],
			resultsPath: "results.xml",
		});
		await capture.observeToolBefore(before());
		now = 200;
		await capture.observeToolAfter(after());
		expect(observations[0]?.observedAssertions).toEqual([
			{ name: "suite.critical", status },
		]);
	},
);
test("unchanged JUnit cannot certify the just-run command", async () => {
	let now = 100;
	const { capture, observations } = fixture({
		now: () => now,
		readReport: async () => ({ text: report, modifiedMs: 101 }),
	});
	capture.arm("ses_host", workspace, {
		...prepared,
		assertions: ["suite.critical"],
		resultsPath: "results.xml",
	});
	await capture.observeToolBefore(before());
	now = 200;
	await capture.observeToolAfter(after());
	expect(observations[0]?.observedAssertions).toEqual([
		{ name: "suite.critical", status: "absent" },
	]);
});
function shellEvent(
	path: string,
	changes: Record<string, unknown> = {},
): OpenCodeEvent {
	return {
		id: "event",
		created: 110,
		type: "shell.created",
		location: { directory: workspace },
		data: {
			info: {
				id: "sh_native",
				command: prepared.command,
				cwd: workspace,
				shell: "/bin/sh",
				status: "running",
				file: path,
				metadata: { sessionID: "ses_host" },
				time: { started: 101 },
				...changes,
			},
		},
	};
}
function exited(): OpenCodeEvent {
	return {
		id: "exit-event",
		created: 120,
		type: "shell.exited",
		data: { id: "sh_native", exit: 0, status: "exited" },
	};
}
const tail = "native output\n".repeat(100);
function spilled(path: string): NativeToolAfter {
	const text = `${tail}\n\n[showing lines 10001-10100 of 10100; full output saved to ${path}]`;
	const value = after({
		exit: 0,
		truncated: true,
		status: "completed",
		output: text,
	});
	if (value.status === "completed")
		value.result = { ...value.result, content: [{ type: "text", text }] };
	return value;
}
test("a verified native shell record permits a secure complete managed-output read", async () => {
	const dataHome = join(workspace, "managed-data");
	const directory = join(dataHome, "opencode", "shell", "abc123");
	await mkdir(directory, { recursive: true });
	const path = join(directory, "sh_native.out"),
		full = "earlier output\n".repeat(1000) + tail;
	await writeFile(path, full);
	let now = 100;
	const { capture, observations } = fixture({
		now: () => now,
		readFullOutput: (path) => readHostToolOutput(path, dataHome),
	});
	capture.arm("ses_host", workspace, prepared);
	await capture.observeToolBefore(before());
	now = 200;
	capture.observeShellEvent(shellEvent(path));
	capture.observeShellEvent(exited());
	await capture.observeToolAfter(spilled(path));
	expect(observations[0]).toMatchObject({
		outputComplete: true,
		outputDigest: digest(full),
		exitCode: 0,
	});
});
test.each([
	["no-record", null],
	["wrong-command", { command: "other" }],
	["wrong-session", { metadata: { sessionID: "other" } }],
	["wrong-workspace", { cwd: tmpdir() }],
	["old-record", { time: { started: 99 } }],
	["running-record", { status: "running" }],
] as const)(
	"%s never trusts a model-visible output path",
	async (name, changes) => {
		let reads = 0,
			now = 100;
		const { capture, observations } = fixture({
			now: () => now,
			readFullOutput: async () => {
				reads++;
				return `prefix${tail}`;
			},
		});
		const path = join(workspace, "sh_native.out");
		capture.arm("ses_host", workspace, prepared);
		await capture.observeToolBefore(before());
		now = 200;
		if (changes) {
			capture.observeShellEvent(shellEvent(path, changes));
			if (name !== "running-record") capture.observeShellEvent(exited());
		}
		await capture.observeToolAfter(spilled(path));
		expect(reads).toBe(0);
		expect(observations[0]?.outputComplete).toBe(false);
	},
);
test("secure output reader rejects symlinks, unrelated files, and oversized output", async () => {
	const dataHome = join(workspace, "reader-data"),
		directory = join(dataHome, "opencode", "shell", "abc123");
	await mkdir(directory, { recursive: true });
	const valid = join(directory, "sh_valid.out");
	await writeFile(valid, "complete");
	expect(await readHostToolOutput(valid, dataHome)).toBe("complete");
	const outside = join(workspace, "outside.out");
	await writeFile(outside, "secret");
	expect(await readHostToolOutput(outside, dataHome)).toBeNull();
	if (process.platform !== "win32") {
		const link = join(directory, "sh_link.out");
		await symlink(outside, link);
		expect(await readHostToolOutput(link, dataHome)).toBeNull();
	}
	const huge = join(directory, "sh_huge.out");
	await writeFile(huge, Buffer.alloc(8 * 1024 * 1024 + 1));
	expect(await readHostToolOutput(huge, dataHome)).toBeNull();
});

test("receipts become available only after source-bound observation persistence", async () => {
	const receipts: unknown[] = [];
	let accept: ((value: ValidationObservation) => void) | undefined;
	let pending: ObservedValidation | undefined;
	const origin = {
		hostSessionId: "ses_host",
		sessionId: "flow",
		authority: "user",
		assistantId: "msg_assistant",
		featureId: prepared.featureId,
		runId: prepared.runId,
		sourceDigest: prepared.sourceDigest,
		command: prepared.command,
		scope: prepared.scope,
		hostPlatform: prepared.hostPlatform,
		intent: prepared.intent,
		assertions: prepared.assertions,
	};
	const { capture } = fixture({
		persistObservation: async (_workspace, observation) => {
			pending = observation;
			return new Promise((resolve) => {
				accept = resolve;
			});
		},
		onRecorded: (receipt) => {
			receipts.push(receipt);
		},
	});
	capture.arm("ses_host", workspace, prepared, origin);
	await capture.observeToolBefore(before());
	const completion = capture.observeToolAfter(after());
	for (let step = 0; step < 10 && !pending; step++) await Promise.resolve();
	expect(receipts).toEqual([]);
	if (!pending || !accept)
		throw new Error("Observation persistence did not start.");
	const observation = persisted(pending);
	accept(observation);
	await completion;
	expect(receipts).toEqual([{ origin, captureId: "capture-1", observation }]);
	expect(pending).not.toHaveProperty("origin");
});

test("a nonzero completed shell vetoes a passing receipt", async () => {
	const { capture } = fixture();
	capture.arm("ses_host", workspace, prepared);
	await capture.observeToolBefore(before());
	const completed = after({
		exit: 7,
		truncated: false,
		status: "completed",
		output: "failed",
	});
	await capture.observeToolAfter(completed);
	const content =
		completed.status === "completed" ? completed.result.content : undefined;
	const text =
		typeof content === "string"
			? content
			: content
					?.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n");
	expect(text).toContain('"passed":false');
});

test("competing shell-before callbacks cannot replace the first native call", async () => {
	let release: (() => void) | undefined;
	const { capture, observations } = fixture({
		readSession: async (id) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return { id, agent: "build", location: { directory: workspace } };
		},
	});
	capture.arm("ses_host", workspace, prepared);
	const first = capture.observeToolBefore(before());
	await capture.observeToolBefore(before({ id: CallID.make("second") }));
	if (!release) throw new Error("First native identity read did not start.");
	release();
	await first;
	expect(
		await capture.observeToolAfter(
			after(undefined, {}, { id: CallID.make("second") }),
		),
	).toBeNull();
	expect(observations).toEqual([]);
	capture.clear();
});

test.each([
	["one final LF omitted from the native display", "\n", true],
	["no final LF", "", true],
	["extra final LF", "\n\n", false],
	["changed trailing whitespace", " \n", false],
	["changed output suffix", "different\n", false],
] as const)(
	"managed output matching preserves exact bytes with %s",
	async (_name, ending, expectedComplete) => {
		const rendered = "native-smoke-output\n".repeat(2000).slice(0, -1);
		const full = `${"native-smoke-output\n".repeat(18000)}${rendered}${ending}`;
		const path = join(workspace, "sh_native.out");
		let now = 100;
		const { capture, observations } = fixture({
			now: () => now,
			readFullOutput: async () => full,
		});
		capture.arm("ses_host", workspace, prepared);
		await capture.observeToolBefore(before());
		now = 200;
		capture.observeShellEvent(shellEvent(path));
		capture.observeShellEvent(exited());
		const output = `${rendered}\n\n[showing lines 18001-20000 of 20000; full output saved to ${path}]`;
		const completed = after({
			exit: 0,
			truncated: true,
			status: "completed",
			output,
		});
		if (completed.status === "completed")
			completed.result = {
				...completed.result,
				content: [{ type: "text", text: output }],
			};
		await capture.observeToolAfter(completed);
		expect(observations[0]).toMatchObject({
			exitCode: 0,
			outputComplete: expectedComplete,
			outputDigest: digest(expectedComplete ? full : output),
		});
	},
);
