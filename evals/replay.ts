import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
	dirname,
	isAbsolute,
	join,
	relative as relativePath,
	resolve,
} from "node:path";
import {
	persistObservedValidation,
	prepareValidation,
} from "../src/application/prepare-validation.js";
import type { ValidationStartRequest } from "../src/application/schema.js";
import { isArtifactPath } from "../src/domain/artifact.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import { readWorkspaceTestReport } from "../src/infrastructure/fs/workspace-validation.js";
import {
	Agent,
	CallID,
	type NativeToolAfter,
	Session,
	SessionMessage,
} from "../src/platform/opencode/sdk.js";
import { createTools } from "../src/platform/opencode/tools.js";
import { ValidationCaptureCoordinator } from "../src/platform/opencode/validation-capture.js";
import {
	bindWorkspace,
	type Cassette,
	type CassetteEvent,
	capturedValidationIdentity,
} from "./cassette.js";
import type { ObservedToolCall, Outcome } from "./harness.js";

/** One replayed call, beside the recorded observation it is compared against. */
export type ReplayedCall = ObservedToolCall &
	Readonly<{ recordedStatus: "ok" | "error" | "n/a" }>;

export type ReplayResult = Readonly<{
	cassette: Cassette;
	evidenceKind: "historical-decision-replay";
	outcome: Outcome;
	/** Divergences between the recorded and replayed Flow responses. */
	divergences: readonly string[];
}>;

function toolContext(workspace: string, sessionIndex: number, agent: string) {
	return {
		sessionID: `ses_replay-${sessionIndex}`,
		messageID: `msg_replay-${sessionIndex}`,
		callID: `replay-call-${sessionIndex}`,
		agent,
		directory: workspace,
		abort: new AbortController().signal,
	};
}

/**
 * Seeds a git fixture exactly as the live harness does, because Flow derives
 * source identity from git and refuses to run without it.
 */
async function seedWorkspace(
	files: Readonly<Record<string, string>>,
): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), "flow-replay-"));
	for (const [relative, contents] of Object.entries(files)) {
		// The paths come from the cassette, and `--from` points at any directory, so a
		// recording this repository did not produce could write outside the workspace
		// through a `..` segment. Committed cassettes are trusted; the flag is not.
		const target = resolve(workspace, relative);
		const inside = relativePath(workspace, target);
		if (
			inside === "" ||
			isAbsolute(inside) ||
			inside.split(/[\\/]/)[0] === ".."
		) {
			throw new Error(`Cassette file escapes the workspace: ${relative}`);
		}
		await mkdir(join(target, ".."), { recursive: true });
		await writeFile(target, contents, "utf8");
	}
	for (const argv of [
		["init", "--initial-branch=main"],
		["config", "user.email", "replay@example.com"],
		["config", "user.name", "Flow Replay"],
		["add", "-A"],
		["commit", "-m", "fixture"],
	]) {
		const git = spawnSync(
			"git",
			["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", ...argv],
			{
				cwd: workspace,
				encoding: "utf8",
				env: {
					PATH: process.env.PATH,
					HOME: workspace,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
				},
			},
		);
		if (git.status !== 0) {
			throw new Error(`git ${argv[0]} failed:\n${git.stderr}`);
		}
	}
	return workspace;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

async function readArchives(
	workspace: string,
): Promise<Record<string, unknown>[]> {
	const history = join(workspace, ".flow", "history");
	let names: string[];
	try {
		names = await readdir(history);
	} catch {
		return [];
	}
	const documents: Record<string, unknown>[] = [];
	for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
		const document = await readJson(join(history, name));
		if (document) documents.push(document);
	}
	return documents;
}

/**
 * Recorded identifier to replayed identifier, plus recorded revision to replayed
 * revision.
 *
 * Kept as two maps rather than one because a revision is a number that means
 * "the state I expected" and an id is a string that means "the thing I am naming".
 * Translating a revision by string substitution would rewrite unrelated numbers.
 */
class Rebinding {
	private readonly ids = new Map<string, string>();
	private readonly revisions = new Map<number, number>();

	learn(recorded: Cassette["events"][number], replayedOutput: unknown): void {
		if (recorded.kind === "bash") {
			const before = recorded.validation;
			const after =
				typeof replayedOutput === "string"
					? capturedValidationIdentity(replayedOutput)
					: null;
			if (before && after) {
				this.ids.set(before.id, after.id);
				this.revisions.set(before.revision, after.revision);
			}
			return;
		}
		if (recorded.kind !== "flow") return;
		const observed = recorded.observed;
		const replayed = observedIdentifiers(replayedOutput);
		if (
			typeof observed.revision === "number" &&
			typeof replayed.revision === "number"
		) {
			this.revisions.set(observed.revision, replayed.revision);
		}
		for (const [before, after] of [
			[observed.sessionId, replayed.sessionId],
			[observed.assignmentId, replayed.assignmentId],
		] as const) {
			if (before && after && before !== after) this.ids.set(before, after);
		}
		const recordedFindings = observed.findingIds ?? [];
		const replayedFindings = replayed.findingIds ?? [];
		for (const [index, before] of recordedFindings.entries()) {
			const after = replayedFindings[index];
			if (after && before !== after) this.ids.set(before, after);
		}
	}

	apply(input: Record<string, unknown>): Record<string, unknown> {
		const substitute = (value: unknown): unknown => {
			if (typeof value === "string") return this.ids.get(value) ?? value;
			if (Array.isArray(value)) return value.map(substitute);
			if (value && typeof value === "object") {
				return Object.fromEntries(
					Object.entries(value as Record<string, unknown>).map(
						([key, item]) => [
							key,
							key === "expectedRevision" && typeof item === "number"
								? (this.revisions.get(item) ?? item)
								: substitute(item),
						],
					),
				);
			}
			return value;
		};
		return substitute(input) as Record<string, unknown>;
	}
}

/** The same reduction the recorder applies, over a replayed response. */
function observedIdentifiers(output: unknown): {
	revision?: number;
	sessionId?: string;
	assignmentId?: string;
	findingIds?: string[];
} {
	const response =
		output && typeof output === "object"
			? (output as Record<string, unknown>)
			: null;
	const data = asRecord(response?.workflowData);
	const projection = asRecord(data?.projection);
	const revision = projection?.revision;
	const sessionId = projection?.sessionId;
	const assignmentId = asRecord(projection?.assignment)?.id;
	const findingIds: string[] = [];
	collect(data, "findingId", findingIds);
	return {
		...(typeof revision === "number" ? { revision } : {}),
		...(typeof sessionId === "string" ? { sessionId } : {}),
		...(typeof assignmentId === "string" ? { assignmentId } : {}),
		...(findingIds.length > 0 ? { findingIds } : {}),
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function collect(value: unknown, key: string, into: string[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collect(item, key, into);
		return;
	}
	if (value && typeof value === "object") {
		for (const [name, item] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (name === key && typeof item === "string") into.push(item);
			else collect(item, key, into);
		}
	}
}

function parseOutput(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function statusOf(output: unknown): "ok" | "error" {
	return asRecord(output)?.status === "ok" ? "ok" : "error";
}

export function recordedBashDecisionFixture(
	event: Extract<CassetteEvent, { kind: "bash" }>,
): NativeToolAfter & { status: "completed" } {
	const { exit, truncated } = event.metadata;
	return {
		tool: "shell",
		sessionID: Session.ID.make(`ses_replay-${event.sessionIndex}`),
		messageID: SessionMessage.ID.make(`msg_replay-${event.sessionIndex}`),
		id: CallID.make(
			`replay-call-${event.sessionIndex}-${event.command.length}`,
		),
		agent: Agent.ID.make(event.agent),
		input: { command: event.command },
		status: "completed",
		result: {
			content: event.output,
			output: {
				...(typeof exit === "number" && Number.isSafeInteger(exit)
					? { exit }
					: {}),
				...(typeof truncated === "boolean" ? { truncated } : {}),
				output: event.output,
			},
		},
	};
}

async function replayBash(
	validation: ValidationCaptureCoordinator,
	event: Extract<CassetteEvent, { kind: "bash" }>,
	workspace: string,
): Promise<string> {
	const fixture = recordedBashDecisionFixture(event);
	try {
		await validation.observeToolBefore(fixture, () => {});
	} catch (error) {
		return `[flow-validation-error] ${error instanceof Error ? error.message : String(error)}`;
	}
	try {
		if (event.resultsPath && event.testReport) {
			if (!isArtifactPath(event.resultsPath))
				throw new Error("Cassette results path is unsafe.");
			const target = join(workspace, event.resultsPath);
			await mkdir(dirname(target), { recursive: true });
			await Bun.sleep(2);
			await writeFile(target, event.testReport, "utf8");
			await Bun.sleep(2);
		}
		await validation.observeToolAfter(fixture);
	} catch (error) {
		return `${event.output}\n\n[flow-validation-error] ${error instanceof Error ? error.message : String(error)}`;
	}
	return typeof fixture.result.content === "string"
		? fixture.result.content
		: (fixture.result.content ?? [])
				.flatMap((part) => (part.type === "text" ? [part.text] : []))
				.join("\n");
}

export async function replayCassette(
	cassette: Cassette,
): Promise<ReplayResult> {
	const started = Date.now();
	const workspace = await seedWorkspace(cassette.files);
	try {
		const replayAgents = new Map<string, string>();
		const validation = new ValidationCaptureCoordinator({
			readSession: async (sessionID) => ({
				id: sessionID,
				agent: replayAgents.get(sessionID) ?? "build",
				location: { directory: workspace },
			}),
			readReport: readWorkspaceTestReport,
			persistObservation: (root, observation) =>
				persistObservedValidation(
					createFileSessionRepository(root),
					observation,
				),
		});
		const tools = createTools({
			validation,
			prepareValidation: (root: string, request: ValidationStartRequest) =>
				prepareValidation(
					createFileSessionRepository(root),
					request,
					cassette.hostPlatform,
				),
		});
		const rebinding = new Rebinding();
		const calls: ReplayedCall[] = [];
		const divergences: string[] = [];

		for (const [index, event] of cassette.events.entries()) {
			replayAgents.set(`ses_replay-${event.sessionIndex}`, event.agent);
			if (event.kind === "bash") {
				const output = await replayBash(validation, event, workspace);
				rebinding.learn(event, output);
				calls.push({
					tool: "bash",
					sessionIndex: event.sessionIndex,
					agent: event.agent,
					status: "completed",
					input: { command: event.command },
					output,
					rawOutput: output,
					metadata: event.metadata,
					recordedStatus: "n/a",
				});
				continue;
			}
			if (event.kind === "other") {
				// Not re-executed: an `edit` or a `question` is the model's own work, and
				// the graders that read it read what was recorded. Passing it through
				// keeps the spine a scenario asserts on complete.
				calls.push({
					tool: event.tool,
					sessionIndex: event.sessionIndex,
					agent: event.agent,
					// Carried rather than assumed. Recording keeps errored calls, so
					// hardcoding `completed` handed a grader that distinguishes an attempted
					// write from a landed one the wrong answer for every failed edit.
					// Absent is `completed`, which is what cassettes without the field meant.
					status: event.status ?? "completed",
					input: bindWorkspace(event.input, workspace),
					output: parseOutput(bindWorkspace(event.rawOutput, workspace)),
					rawOutput: bindWorkspace(event.rawOutput, workspace),
					metadata: {},
					recordedStatus: "n/a",
				});
				continue;
			}

			const definition = tools[event.tool];
			if (!definition) {
				divergences.push(
					`event ${index}: this build has no tool named ${event.tool}`,
				);
				continue;
			}
			const context = toolContext(workspace, event.sessionIndex, event.agent);
			const input = rebinding.apply(bindWorkspace(event.input, workspace));
			let raw: string;
			try {
				const result = await definition.execute(input, context);
				raw = typeof result === "string" ? result : JSON.stringify(result);
			} catch (error) {
				raw = JSON.stringify({
					status: "error",
					summary: error instanceof Error ? error.message : String(error),
					workflowData: {
						failure: { summary: "replay rejected the arguments" },
					},
				});
			}
			const output = parseOutput(raw);
			const replayedStatus = statusOf(output);
			if (replayedStatus !== event.observed.status) {
				divergences.push(
					`event ${index} (${event.tool}): recorded ${event.observed.status}, replayed ${replayedStatus}${
						replayedStatus === "error"
							? `: ${String(asRecord(output)?.summary ?? "").split("\n")[0]}`
							: ""
					}`,
				);
			}
			rebinding.learn(event, output);
			calls.push({
				tool: event.tool,
				sessionIndex: event.sessionIndex,
				agent: event.agent,
				status: replayedStatus === "ok" ? "completed" : "error",
				input,
				output,
				rawOutput: raw,
				metadata: {},
				recordedStatus: event.observed.status,
			});
		}

		const outcome: Outcome = {
			allCalls: calls,
			flowCalls: calls.filter((call) => call.tool.startsWith("flow_")),
			...(cassette.scenario === "inspection-failed-audit-completes"
				? {
						workspaceChanges: {
							kind: "unavailable" as const,
							reason: "cassette-does-not-replay-file-effects",
						},
					}
				: {}),
			session: await readJson(join(workspace, ".flow", "session.json")),
			archives: await readArchives(workspace),
			finalText: cassette.finalText,
			tokens: {
				input: 0,
				output: 0,
				reasoning: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			costUsd: null,
			assistantMessages: cassette.assistantMessages,
			durationMs: Date.now() - started,
			providerError: null,
			nativeFailure: null,
		};
		return {
			cassette,
			outcome,
			divergences,
			evidenceKind: "historical-decision-replay",
		};
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
}
