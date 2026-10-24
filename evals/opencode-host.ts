import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type ModelRef,
	OpenCode,
	type OpenCodeClient,
	type SessionInfo,
	type SessionMessageInfo,
} from "@opencode/client";
import { isRecord } from "./host-observation.js";

export const OPENCODE_HOST_VERSION = "2.1.4";

export function validateOpenCodeVersion(version: string): void {
	const match = /^2\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
	if (
		!match ||
		!Number.isSafeInteger(Number(match[1])) ||
		!Number.isSafeInteger(Number(match[2])) ||
		Number(match[1]) < 1 ||
		(Number(match[1]) === 1 && Number(match[2]) < 4)
	)
		throw new Error(
			"OpenCode host requires an exact tested 2.x version at least 2.1.4.",
		);
}

export function openCodeInvocation(
	args: readonly string[],
	version = OPENCODE_HOST_VERSION,
): { command: string; args: string[] } {
	validateOpenCodeVersion(version);
	return {
		command: "npm",
		args: [
			"exec",
			"--yes",
			`--package=@opencode/cli@${version}`,
			"--",
			"opencode",
			...args,
		],
	};
}

export class OpenCodeStartup {
	private readonly pending = new Map<string, string>();
	private password: string | undefined;
	private output = "";
	consume(chunk: string, stream = "stdout"): void {
		let pending = (this.pending.get(stream) ?? "") + chunk;
		for (;;) {
			const end = pending.indexOf("\n");
			if (end < 0) break;
			const line = pending.slice(0, end).replace(/\r$/, "");
			pending = pending.slice(end + 1);
			const match = /server password (\S+)/.exec(line);
			if (match) this.password = match[1];
			else this.output += `${line}\n`;
		}
		this.pending.set(stream, pending);
	}
	get log(): string {
		return this.output;
	}
	client(baseUrl: string, directory: string): OpenCodeClient | null {
		if (!this.password) return null;
		return OpenCode.make({
			baseUrl,
			headers: {
				authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString("base64")}`,
				"x-opencode-directory": directory,
			},
		});
	}
	clear(): void {
		this.pending.clear();
		this.password = undefined;
	}
}

export function nativeModel(model: string, variant?: string): ModelRef {
	const slash = model.indexOf("/");
	if (slash <= 0 || slash === model.length - 1)
		throw new Error("Model must have provider/id form.");
	return {
		providerID: model.slice(0, slash),
		id: model.slice(slash + 1),
		...(variant === undefined ? {} : { variant }),
	};
}

export async function listNativeMessages(
	client: OpenCodeClient,
	sessionID: string,
	signal?: AbortSignal,
): Promise<SessionMessageInfo[]> {
	const messages: SessionMessageInfo[] = [];
	const cursors = new Set<string>();
	let cursor: string | undefined;
	for (;;) {
		const page = await client.message.list(
			{ sessionID, limit: 100, ...(cursor ? { cursor } : { order: "asc" }) },
			{ ...(signal ? { signal } : {}) },
		);
		messages.push(...page.data);
		cursor = page.cursor.next ?? undefined;
		if (messages.length > 4096)
			throw new Error("Native message limit exceeded.");
		if (!cursor) return messages;
		if (cursors.has(cursor))
			throw new Error("Native message pagination did not converge.");
		cursors.add(cursor);
	}
}

export async function listNativeSessions(
	client: OpenCodeClient,
	directory: string,
	signal?: AbortSignal,
): Promise<SessionInfo[]> {
	const sessions: SessionInfo[] = [];
	const cursors = new Set<string>();
	let cursor: string | undefined;
	for (;;) {
		const page = await client.session.list(
			{ limit: 100, ...(cursor ? { cursor } : { directory, order: "asc" }) },
			{ ...(signal ? { signal } : {}) },
		);
		if (
			!isRecord(page) ||
			!Array.isArray(page.data) ||
			!isRecord(page.cursor) ||
			(page.cursor.next !== undefined &&
				page.cursor.next !== null &&
				(typeof page.cursor.next !== "string" ||
					page.cursor.next.length === 0 ||
					page.cursor.next.length > 4096))
		)
			throw new Error("Owned progress children response is malformed.");
		sessions.push(...page.data);
		cursor = page.cursor.next ?? undefined;
		if (sessions.length > 4096)
			throw new Error("Native session limit exceeded.");
		if (!cursor) return sessions;
		if (cursors.has(cursor))
			throw new Error("Native session pagination did not converge.");
		cursors.add(cursor);
	}
}
export type EvalMessage = {
	native: SessionMessageInfo;
	info: {
		id?: string;
		sessionID?: string;
		parentID?: string;
		summary?: unknown;
		role: string;
		agent?: string;
		model?: { providerID?: unknown; modelID?: unknown };
		providerID?: unknown;
		modelID?: unknown;
		time?: { created: number; completed?: number };
		error?: unknown;
		cost?: number;
		tokens?: {
			input: number;
			output: number;
			reasoning: number;
			cache?: { read: number; write: number };
		};
	};
	parts: {
		id?: string;
		sessionID?: string;
		callID?: string;
		messageID?: string;
		type: string;
		tool?: string;
		text?: string;
		time?: { start?: number; end?: number };
		synthetic?: boolean;
		auto?: boolean;
		metadata?: Record<string, unknown>;
		state?: {
			raw?: string;
			time?: { start?: number; end?: number };
			status: "pending" | "running" | "completed" | "error";
			input?: Record<string, unknown>;
			output?: string;
			error?: string;
			metadata?: Record<string, unknown>;
		};
	}[];
};

export function projectEvalMessage(
	native: SessionMessageInfo,
	sessionID: string,
): EvalMessage {
	const info: EvalMessage["info"] = {
		id: native.id,
		sessionID,
		role: native.type,
		time: { ...native.time },
	};
	const parts: EvalMessage["parts"] = [];
	if (native.type === "assistant") {
		info.agent = native.agent;
		info.model = {
			providerID: native.model.providerID,
			modelID: native.model.id,
		};
		if (native.cost !== undefined) info.cost = native.cost;
		if (native.tokens !== undefined) info.tokens = native.tokens;
		if (native.error !== undefined) info.error = native.error;
		for (const content of native.content) {
			if (content.type !== "tool") {
				parts.push({
					type: content.type,
					text: content.text,
					sessionID,
					messageID: native.id,
				});
				continue;
			}
			const state = content.state;
			const output =
				state.status === "completed" || state.status === "error"
					? (state.content ?? [])
							.flatMap((item) => (item.type === "text" ? [item.text] : []))
							.join("\n")
					: undefined;
			parts.push({
				type: "tool",
				tool: content.name,
				callID: content.id,
				sessionID,
				messageID: native.id,
				time: {
					start: content.time.created,
					...(content.time.completed === undefined
						? {}
						: { end: content.time.completed }),
				},
				state: {
					status: state.status === "streaming" ? "pending" : state.status,
					input: state.status === "streaming" ? {} : state.input,
					...(state.status === "streaming" ? { raw: state.input } : {}),
					...(output === undefined ? {} : { output }),
					...(state.status === "error" ? { error: state.error.message } : {}),
					...(state.status === "streaming" || state.metadata === undefined
						? {}
						: { metadata: state.metadata }),
				},
			});
		}
	} else if (native.type === "compaction") {
		info.summary = true;
		if (native.status !== "running") {
			if (native.status === "failed") info.error = native.error;
			if (native.cost !== undefined) info.cost = native.cost;
			if (native.tokens !== undefined) info.tokens = native.tokens;
			if (native.status === "completed" && native.model)
				info.model = {
					providerID: native.model.providerID,
					modelID: native.model.id,
				};
		}
		parts.push({
			type: "compaction",
			auto: native.reason === "auto",
			text: native.status === "failed" ? native.error.message : native.summary,
			sessionID,
			messageID: native.id,
		});
	} else if (
		native.type === "user" ||
		native.type === "synthetic" ||
		native.type === "system"
	) {
		parts.push({
			type: "text",
			text: native.text,
			synthetic: native.type === "synthetic",
			sessionID,
			messageID: native.id,
		});
	}
	return { native, info, parts };
}

export async function installedOpenCodePluginEntry(
	installed: string,
	entryDirectory: string,
): Promise<string> {
	const manifest: unknown = JSON.parse(
		await readFile(join(installed, "package.json"), "utf8"),
	);
	if (!isRecord(manifest) || !isRecord(manifest.exports))
		throw new Error("Installed plugin has no public exports.");
	const root = await realpath(installed);
	const entries: { file: string; target: string }[] = [];
	for (const [key, file] of [
		[".", "index.js"],
		["./tui", "tui.js"],
	] as const) {
		const entry = manifest.exports[key];
		const specifier =
			typeof entry === "string"
				? entry
				: isRecord(entry)
					? entry.import
					: undefined;
		if (typeof specifier !== "string" || !specifier.startsWith("./"))
			throw new Error(
				`Installed plugin export ${key} has no relative import entry.`,
			);
		const target = await realpath(resolve(root, specifier));
		const inside = relative(root, target);
		if (!inside || isAbsolute(inside) || inside.split(/[\\/]/)[0] === "..")
			throw new Error("Installed plugin export escapes its package.");
		entries.push({ file, target });
	}
	await mkdir(entryDirectory, { recursive: true });
	await writeFile(
		join(entryDirectory, "package.json"),
		JSON.stringify({
			type: "module",
			exports: { ".": "./index.js", "./tui": "./tui.js" },
		}),
	);
	for (const entry of entries)
		await writeFile(
			join(entryDirectory, entry.file),
			`export { default } from ${JSON.stringify(pathToFileURL(entry.target).href)};\n`,
		);
	return entryDirectory;
}
