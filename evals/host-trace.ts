import { createHash } from "node:crypto";
import { z } from "zod";

type TopologyIssue =
	| "unknown-root"
	| "root-is-child"
	| "unknown-session-parent"
	| "session-cycle";
function topologyIssue(
	sessions: readonly { id: string; parentId: string | null }[],
	runnerRoots: readonly string[],
): TopologyIssue | null {
	const roots = new Set(runnerRoots);
	const byId = new Map(sessions.map((session) => [session.id, session]));
	for (const root of roots) {
		const session = byId.get(root);
		if (!session) return "unknown-root";
		if (session.parentId !== null) return "root-is-child";
	}
	for (const session of sessions) {
		const seen = new Set<string>();
		let current = session.id;
		while (!roots.has(current)) {
			if (seen.has(current)) return "session-cycle";
			seen.add(current);
			const parent = byId.get(current)?.parentId;
			if (!parent || !byId.has(parent)) return "unknown-session-parent";
			current = parent;
		}
	}
	return null;
}

const Id = z.string().min(1).max(256).regex(/^\S+$/);
const Order = z.number().int().safe().nonnegative();
export const NativeToolProvenanceSchema = z
	.object({
		sessionId: Id,
		messageId: Id,
		partId: Id,
		partIndex: Order,
		callId: Id.nullable(),
		startedAt: Order.nullable(),
		completedAt: Order.nullable(),
	})
	.strict();
export type NativeToolProvenance = z.infer<typeof NativeToolProvenanceSchema>;

export const HostAbortObservationSchema = z
	.object({
		rootSessionId: Id,
		observedAt: Order,
		abortRequestedAt: Order,
		startedAt: Order,
		excludedMs: Order,
		trigger: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("stall"),
					unchangedMs: Order,
					lastActivityAt: Order,
					thresholdMs: z.literal(180000),
				})
				.strict(),
			z
				.object({
					kind: z.literal("deadline"),
					observedElapsedMs: Order,
					timeoutMs: z.literal(1200000),
				})
				.strict(),
		]),
		pending: z
			.array(
				z
					.object({
						native: NativeToolProvenanceSchema,
						tool: Id,
						status: z.enum(["pending", "running"]),
						input: z.record(z.string(), z.unknown()),
					})
					.strict(),
			)
			.min(1)
			.max(128),
	})
	.strict()
	.refine(
		(value) => Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024,
		"Host abort observation exceeds its byte bound.",
	);
export type HostAbortObservation = z.infer<typeof HostAbortObservationSchema>;

const UserPartSchema = z
	.object({
		id: Id,
		partIndex: Order,
		type: Id,
		synthetic: z.boolean().nullable(),
		textBytes: Order.nullable(),
		flowTokenSha256: z
			.string()
			.regex(/^sha256:[a-f0-9]{64}$/)
			.nullable(),
		compactionContinue: z.boolean().nullable(),
		automaticCompaction: z.boolean().nullable(),
	})
	.strict()
	.superRefine((part, context) => {
		const issue = () =>
			context.addIssue({
				code: "custom",
				message: "Native user part fields conflict with its type.",
			});
		if ((part.type === "text") !== (part.textBytes !== null)) issue();
		if (
			part.type !== "text" &&
			(part.flowTokenSha256 !== null || part.compactionContinue !== null)
		)
			issue();
		if (part.type !== "compaction" && part.automaticCompaction !== null)
			issue();
	});
const MessageIdentity = { id: Id, sessionId: Id, order: Order, created: Order };
const MessageSchema = z.discriminatedUnion("role", [
	z
		.object({
			...MessageIdentity,
			role: z.literal("user"),
			parts: z.array(UserPartSchema).max(256),
		})
		.strict(),
	z
		.object({
			...MessageIdentity,
			role: z.literal("assistant"),
			parentId: Id,
			agent: Id,
			summary: z.boolean(),
			tools: z
				.array(
					NativeToolProvenanceSchema.extend({
						tool: Id,
						status: z.enum(["pending", "running", "completed", "error"]),
					}).strict(),
				)
				.max(256),
		})
		.strict(),
]);
export const HostTraceSchema = z
	.discriminatedUnion("kind", [
		z
			.object({
				version: z.literal(1),
				kind: z.literal("observed"),
				runnerRootSessionIds: z.array(Id).min(1).max(16),
				sessions: z
					.array(
						z
							.object({
								id: Id,
								parentId: Id.nullable(),
								agent: Id.nullable(),
								projectMatched: z.literal(true),
							})
							.strict(),
					)
					.min(1)
					.max(128),
				messages: z.array(MessageSchema).max(4096),
				compactionDelivery: z.literal("unavailable-from-message-export"),
			})
			.strict(),
		z
			.object({
				version: z.literal(1),
				kind: z.literal("unavailable"),
				reason: z.enum([
					"endpoint-failure",
					"malformed-native-session",
					"directory-mismatch",
					"duplicate-native-id",
					"unknown-root",
					"root-is-child",
					"unknown-session-parent",
					"session-cycle",
					"incomplete-transcript",
					"malformed-native-message",
					"message-session-mismatch",
					"unknown-assistant-parent",
					"chronology-conflict",
					"malformed-native-part",
					"part-binding-mismatch",
					"limits-exceeded",
				]),
			})
			.strict(),
	])
	.superRefine((trace, context) => {
		if (trace.kind !== "observed") return;
		const issue = (message: string) =>
			context.addIssue({ code: "custom", message });
		const ids = new Set<string>();
		let partCount = 0;
		let toolCount = 0;
		for (const session of trace.sessions) {
			if (ids.has(session.id)) issue("Duplicate native identity.");
			ids.add(session.id);
		}
		const sessions = new Map(
			trace.sessions.map((session) => [session.id, session]),
		);
		const ancestryIssue = topologyIssue(
			trace.sessions,
			trace.runnerRootSessionIds,
		);
		if (ancestryIssue) issue(ancestryIssue);
		const roots = new Set(trace.runnerRootSessionIds);
		if (roots.size !== trace.runnerRootSessionIds.length)
			issue("Duplicate runner root.");
		const messages = new Map(
			trace.messages.map((message) => [message.id, message]),
		);
		const orders = new Map<string, { order: number; created: number }>();
		for (const message of trace.messages) {
			if (ids.has(message.id)) issue("Duplicate native identity.");
			ids.add(message.id);
			if (!sessions.has(message.sessionId))
				issue("Unknown native message session.");
			const previous = orders.get(message.sessionId);
			if (
				message.order !== (previous ? previous.order + 1 : 0) ||
				(previous && message.created < previous.created)
			)
				issue("Native chronology conflicts.");
			orders.set(message.sessionId, {
				order: message.order,
				created: message.created,
			});
			if (message.role === "assistant") {
				const parent = messages.get(message.parentId);
				if (
					parent?.role !== "user" ||
					parent.sessionId !== message.sessionId ||
					parent.order >= message.order
				)
					issue("Assistant parent is not an earlier same-session user.");
			}
			const parts = message.role === "user" ? message.parts : message.tools;
			partCount += parts.length;
			if (message.role === "assistant") toolCount += parts.length;
			let previousPart = -1;
			for (const [partOrder, part] of parts.entries()) {
				if (message.role === "user" && part.partIndex !== partOrder)
					issue("Native user parts must be contiguous.");
				const id = "partId" in part ? part.partId : part.id;
				if (ids.has(id)) issue("Duplicate native identity.");
				ids.add(id);
				if (part.partIndex <= previousPart || part.partIndex >= 256)
					issue("Native part order conflicts.");
				previousPart = part.partIndex;
				if (
					"partId" in part &&
					(part.sessionId !== message.sessionId ||
						part.messageId !== message.id ||
						(part.startedAt !== null &&
							part.completedAt !== null &&
							part.completedAt < part.startedAt))
				)
					issue("Native tool binding conflicts.");
			}
		}
		if (partCount > 16384 || toolCount > 4096)
			issue("Host trace exceeds aggregate limits.");
	});
export type HostTrace = z.infer<typeof HostTraceSchema>;
export type HostTraceCollection = Readonly<{
	runnerRootSessionIds: readonly string[];
	directory: string;
	sessionMetadata: readonly unknown[];
	sessionMessages: readonly Readonly<{
		sessionId: string;
		messages: unknown;
	}>[];
	childrenComplete: boolean;
}>;

const NativeSessionSchema = z.object({
	id: Id,
	directory: z.string().min(1).max(4096),
	parentID: Id.nullable().optional(),
	agent: Id.nullable().optional(),
});
const NativePartSchema = z.object({
	id: Id,
	messageID: Id,
	sessionID: Id,
	type: Id,
	text: z
		.string()
		.max(4 * 1024 * 1024)
		.optional(),
	synthetic: z.boolean().optional(),
	auto: z.boolean().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	callID: Id.optional(),
	tool: Id.optional(),
	state: z
		.object({
			status: z.enum(["pending", "running", "completed", "error"]),
			time: z
				.object({ start: Order.optional(), end: Order.optional() })
				.optional(),
		})
		.optional(),
});
const NativeMessageSchema = z.object({
	info: z.object({
		id: Id,
		sessionID: Id,
		role: z.enum(["user", "assistant"]),
		parentID: Id.optional(),
		agent: Id.optional(),
		summary: z.unknown().optional(),
		time: z.object({ created: Order }),
	}),
	parts: z.array(NativePartSchema).max(256),
});
type NativeMessage = z.infer<typeof NativeMessageSchema>;
type NativePart = z.infer<typeof NativePartSchema>;
type ObservedTrace = Extract<HostTrace, { kind: "observed" }>;
type UnavailableReason = Extract<HostTrace, { kind: "unavailable" }>["reason"];
const unavailable = (reason: UnavailableReason): HostTrace => ({
	version: 1,
	kind: "unavailable",
	reason,
});

export function nativeToolProvenance(
	sessionId: string,
	message: unknown,
	part: unknown,
	partIndex: number,
): NativeToolProvenance | undefined {
	const candidate = NativeMessageSchema.shape.info.safeParse(message);
	const item = NativePartSchema.safeParse(part);
	if (
		!candidate.success ||
		!item.success ||
		item.data.type !== "tool" ||
		candidate.data.role !== "assistant" ||
		candidate.data.sessionID !== sessionId ||
		item.data.sessionID !== sessionId ||
		item.data.messageID !== candidate.data.id
	)
		return undefined;
	return provenance(sessionId, candidate.data.id, item.data, partIndex);
}

function provenance(
	sessionId: string,
	messageId: string,
	part: NativePart,
	partIndex: number,
): NativeToolProvenance {
	return {
		sessionId,
		messageId,
		partId: part.id,
		partIndex,
		callId: part.callID ?? null,
		startedAt: part.state?.time?.start ?? null,
		completedAt: part.state?.time?.end ?? null,
	};
}

export function collectHostTrace(input: HostTraceCollection): HostTrace {
	if (!input.childrenComplete) return unavailable("endpoint-failure");
	if (
		input.runnerRootSessionIds.length === 0 ||
		input.runnerRootSessionIds.length > 16 ||
		input.sessionMetadata.length > 128 ||
		input.sessionMessages.length > 128
	)
		return unavailable("limits-exceeded");
	const roots = new Set(input.runnerRootSessionIds);
	if (roots.size !== input.runnerRootSessionIds.length)
		return unavailable("duplicate-native-id");
	const sessions: ObservedTrace["sessions"] = [];
	const bySession = new Map<string, z.infer<typeof NativeSessionSchema>>();
	for (const raw of input.sessionMetadata) {
		const parsed = NativeSessionSchema.safeParse(raw);
		if (!parsed.success) return unavailable("malformed-native-session");
		const native = parsed.data;
		if (bySession.has(native.id)) return unavailable("duplicate-native-id");
		if (native.directory !== input.directory)
			return unavailable("directory-mismatch");
		bySession.set(native.id, native);
		sessions.push({
			id: native.id,
			parentId: native.parentID ?? null,
			agent: native.agent ?? null,
			projectMatched: true,
		});
	}
	const ancestryIssue = topologyIssue(sessions, [...roots]);
	if (ancestryIssue) return unavailable(ancestryIssue);
	const transcriptIds = new Set<string>();
	const nativeIds = new Set<string>(bySession.keys());
	const messages: ObservedTrace["messages"] = [];
	let partCount = 0;
	let toolCount = 0;
	for (const transcript of input.sessionMessages) {
		if (transcriptIds.has(transcript.sessionId))
			return unavailable("duplicate-native-id");
		if (!bySession.has(transcript.sessionId))
			return unavailable("message-session-mismatch");
		transcriptIds.add(transcript.sessionId);
		if (!Array.isArray(transcript.messages))
			return unavailable("incomplete-transcript");
		if (messages.length + transcript.messages.length > 4096)
			return unavailable("limits-exceeded");
		const users = new Set<string>();
		let created = -1;
		for (const [order, raw] of transcript.messages.entries()) {
			const parsed = NativeMessageSchema.safeParse(raw);
			if (!parsed.success) return unavailable("malformed-native-message");
			const native: NativeMessage = parsed.data;
			if (nativeIds.has(native.info.id))
				return unavailable("duplicate-native-id");
			nativeIds.add(native.info.id);
			if (native.info.sessionID !== transcript.sessionId)
				return unavailable("message-session-mismatch");
			if (native.info.time.created < created)
				return unavailable("chronology-conflict");
			created = native.info.time.created;
			partCount += native.parts.length;
			if (partCount > 16384) return unavailable("limits-exceeded");
			const identity = {
				id: native.info.id,
				sessionId: transcript.sessionId,
				order,
				created,
			};
			const userParts: z.infer<typeof UserPartSchema>[] = [];
			const tools: Extract<
				ObservedTrace["messages"][number],
				{ role: "assistant" }
			>["tools"] = [];
			for (const [partIndex, part] of native.parts.entries()) {
				if (part.type === "text" && part.text === undefined)
					return unavailable("malformed-native-part");
				if (part.auto !== undefined && part.type !== "compaction")
					return unavailable("malformed-native-part");
				if (nativeIds.has(part.id)) return unavailable("duplicate-native-id");
				nativeIds.add(part.id);
				if (
					part.sessionID !== transcript.sessionId ||
					part.messageID !== native.info.id
				)
					return unavailable("part-binding-mismatch");
				if (native.info.role === "user") {
					if (part.type === "tool") return unavailable("malformed-native-part");
					const token = part.metadata?.["opencode-plugin-flow/auto"];
					const compaction = part.metadata?.compaction_continue;
					if (
						(token !== undefined &&
							(typeof token !== "string" ||
								token.length === 0 ||
								token.length > 1024 ||
								part.type !== "text")) ||
						(compaction !== undefined &&
							(typeof compaction !== "boolean" || part.type !== "text"))
					)
						return unavailable("malformed-native-part");
					userParts.push({
						id: part.id,
						partIndex,
						type: part.type,
						synthetic: part.synthetic ?? null,
						textBytes:
							part.type === "text"
								? Buffer.byteLength(part.text ?? "", "utf8")
								: null,
						flowTokenSha256:
							typeof token === "string"
								? `sha256:${createHash("sha256").update(token).digest("hex")}`
								: null,
						compactionContinue:
							typeof compaction === "boolean" ? compaction : null,
						automaticCompaction:
							part.type === "compaction" ? (part.auto ?? null) : null,
					});
				} else if (part.type === "tool") {
					if (!part.tool || !part.state)
						return unavailable("malformed-native-part");
					const ref = provenance(
						transcript.sessionId,
						native.info.id,
						part,
						partIndex,
					);
					if (
						ref.completedAt !== null &&
						ref.startedAt !== null &&
						ref.completedAt < ref.startedAt
					)
						return unavailable("chronology-conflict");
					tools.push({ ...ref, tool: part.tool, status: part.state.status });
					if (++toolCount > 4096) return unavailable("limits-exceeded");
				}
			}
			if (native.info.role === "user") {
				if (native.info.parentID !== undefined)
					return unavailable("malformed-native-message");
				users.add(native.info.id);
				messages.push({ ...identity, role: "user", parts: userParts });
			} else {
				if (!native.info.parentID || !users.has(native.info.parentID))
					return unavailable("unknown-assistant-parent");
				if (
					!native.info.agent ||
					(native.info.summary !== undefined &&
						typeof native.info.summary !== "boolean")
				)
					return unavailable("malformed-native-message");
				messages.push({
					...identity,
					role: "assistant",
					parentId: native.info.parentID,
					agent: native.info.agent,
					summary: native.info.summary === true,
					tools,
				});
			}
		}
	}
	if (transcriptIds.size !== bySession.size)
		return unavailable("incomplete-transcript");
	return {
		version: 1,
		kind: "observed",
		runnerRootSessionIds: [...roots],
		sessions,
		messages,
		compactionDelivery: "unavailable-from-message-export",
	};
}
