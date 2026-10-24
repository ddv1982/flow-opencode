import { createHash } from "node:crypto";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { Schema } from "effect";
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
const NativeToolProvenanceV1Schema = z
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
const NativeToolProvenanceV2Schema = z
	.object({
		version: z.literal(2),
		sessionId: Id,
		messageId: Id,
		partIndex: Order.max(255),
		callId: Id,
		startedAt: Order,
		completedAt: Order.nullable(),
	})
	.strict();
export const NativeToolProvenanceSchema = z.union([
	NativeToolProvenanceV1Schema,
	NativeToolProvenanceV2Schema,
]);
export type NativeToolProvenance = z.infer<typeof NativeToolProvenanceSchema>;
export function nativeToolKey(native: NativeToolProvenance): string {
	return JSON.stringify(
		"version" in native
			? [2, native.sessionId, native.messageId, native.partIndex, native.callId]
			: [
					1,
					native.sessionId,
					native.messageId,
					native.partId,
					native.partIndex,
					native.callId,
				],
	);
}

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
					NativeToolProvenanceV1Schema.extend({
						tool: Id,
						status: z.enum(["pending", "running", "completed", "error"]),
					}).strict(),
				)
				.max(256),
		})
		.strict(),
]);
const HostTraceV1Schema = z
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
type HostTraceV1 = z.infer<typeof HostTraceV1Schema>;
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
type ObservedTrace = Extract<HostTraceV1, { kind: "observed" }>;
type UnavailableReason = Extract<
	HostTraceV1,
	{ kind: "unavailable" }
>["reason"];
const unavailable = (reason: UnavailableReason): HostTraceV1 => ({
	version: 1,
	kind: "unavailable",
	reason,
});

function nativeToolProvenanceV1(
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
): z.infer<typeof NativeToolProvenanceV1Schema> {
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

function collectHostTraceV1(input: HostTraceCollection): HostTraceV1 {
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

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const V2MessageIdentity = MessageIdentity;
const V2MessageSchema = z.discriminatedUnion("role", [
	z
		.object({
			...V2MessageIdentity,
			role: z.literal("user"),
			type: z.enum(["user", "synthetic"]),
			textBytes: Order,
			attachments: Order.max(255),
			flowTokenSha256: Digest.nullable(),
			compactionContinue: z.boolean().nullable(),
		})
		.strict(),
	z
		.object({
			...V2MessageIdentity,
			role: z.literal("assistant"),
			type: z.literal("assistant"),
			agent: Id,
			contentCount: Order.max(256),
			tools: z
				.array(
					NativeToolProvenanceV2Schema.extend({
						tool: Id,
						status: z.enum(["pending", "running", "completed", "error"]),
					}).strict(),
				)
				.max(256),
		})
		.strict(),
	z
		.object({
			...V2MessageIdentity,
			role: z.literal("event"),
			type: z.enum([
				"agent-switched",
				"model-switched",
				"location-switched",
				"system",
				"skill",
				"shell",
				"compaction",
				"idle",
			]),
		})
		.strict(),
]);
const HostTraceV2Schema = z
	.discriminatedUnion("kind", [
		z
			.object({
				version: z.literal(2),
				kind: z.literal("observed"),
				runnerRootSessionIds: z.array(Id).min(1).max(16),
				sessions: HostTraceV1Schema.options[0].shape.sessions,
				messages: z.array(V2MessageSchema).max(4096),
				compactionDelivery: z.literal("unavailable-from-message-export"),
			})
			.strict(),
		HostTraceV1Schema.options[1].extend({ version: z.literal(2) }).strict(),
	])
	.superRefine((trace, context) => {
		if (trace.kind !== "observed") return;
		const issue = (message: string) =>
			context.addIssue({ code: "custom", message });
		const ids = new Set<string>();
		const sessions = new Set<string>();
		for (const session of trace.sessions) {
			if (ids.has(session.id)) issue("Duplicate native identity.");
			ids.add(session.id);
			sessions.add(session.id);
		}
		const ancestry = topologyIssue(trace.sessions, trace.runnerRootSessionIds);
		if (ancestry) issue(ancestry);
		if (
			new Set(trace.runnerRootSessionIds).size !==
			trace.runnerRootSessionIds.length
		)
			issue("Duplicate runner root.");
		const orders = new Map<string, { order: number; created: number }>();
		const keys = new Set<string>();
		let toolCount = 0;
		let contentCount = 0;
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
			orders.set(message.sessionId, message);
			if (message.role === "user") contentCount += 1 + message.attachments;
			if (message.role !== "assistant") continue;
			contentCount += message.contentCount;
			let previousIndex = -1;
			for (const tool of message.tools) {
				const key = nativeToolKey(tool);
				if (keys.has(key)) issue("Duplicate native tool identity.");
				keys.add(key);
				if (
					tool.partIndex <= previousIndex ||
					tool.partIndex >= message.contentCount
				)
					issue("Native content order conflicts.");
				previousIndex = tool.partIndex;
				if (
					tool.sessionId !== message.sessionId ||
					tool.messageId !== message.id
				)
					issue("Native tool binding conflicts.");
				if (
					tool.startedAt < message.created ||
					(tool.completedAt !== null && tool.completedAt < tool.startedAt)
				)
					issue("Native tool chronology conflicts.");
				toolCount++;
			}
		}
		if (toolCount > 4096 || contentCount > 16384)
			issue("Host trace exceeds aggregate limits.");
	});
export const HostTraceSchema = z.union([HostTraceV1Schema, HostTraceV2Schema]);
export type HostTrace = z.infer<typeof HostTraceSchema>;
type ObservedTraceV2 = Extract<
	z.infer<typeof HostTraceV2Schema>,
	{ kind: "observed" }
>;
const isNativeSessionV2 = Schema.is(Schema.toEncoded(Session.Info));
const isNativeMessageV2 = Schema.is(Schema.toEncoded(SessionMessage.Info));
const V2Binding = z.object({
	sessionID: Id.optional(),
	parentID: z.never().optional(),
});
const NativeMetadata = z.object({
	"opencode-plugin-flow/auto": z.string().min(1).max(1024).optional(),
	compaction_continue: z.boolean().optional(),
});
const tokenDigest = (token: string | undefined): string | null =>
	token === undefined
		? null
		: `sha256:${createHash("sha256").update(token).digest("hex")}`;

function nativeToolProvenanceV2(
	sessionId: string,
	message: unknown,
	partIndex: number,
): z.infer<typeof NativeToolProvenanceV2Schema> | undefined {
	const binding = V2Binding.safeParse(message);
	if (
		!Id.safeParse(sessionId).success ||
		!Order.safeParse(partIndex).success ||
		partIndex >= 256 ||
		!binding.success ||
		(binding.data.sessionID !== undefined &&
			binding.data.sessionID !== sessionId) ||
		!isNativeMessageV2(message) ||
		message.type !== "assistant"
	)
		return undefined;
	const content = message.content[partIndex];
	if (content?.type !== "tool") return undefined;
	if (
		!Order.safeParse(message.time.created).success ||
		!Order.safeParse(content.time.created).success ||
		(content.time.ran !== undefined &&
			(!Order.safeParse(content.time.ran).success ||
				content.time.ran < content.time.created ||
				(content.time.completed !== undefined &&
					content.time.ran > content.time.completed)))
	)
		return undefined;
	const ref = NativeToolProvenanceV2Schema.safeParse({
		version: 2,
		sessionId,
		messageId: message.id,
		partIndex,
		callId: content.id,
		startedAt: content.time.created,
		completedAt: content.time.completed ?? null,
	});
	return ref.success &&
		ref.data.startedAt >= message.time.created &&
		(ref.data.completedAt === null ||
			ref.data.completedAt >= ref.data.startedAt)
		? ref.data
		: undefined;
}

export function nativeToolProvenance(
	sessionId: string,
	message: unknown,
	contentIndex: number,
): NativeToolProvenance | undefined;
export function nativeToolProvenance(
	sessionId: string,
	message: unknown,
	part: unknown,
	partIndex: number,
	rawNativeMessage?: unknown,
): NativeToolProvenance | undefined;
export function nativeToolProvenance(
	sessionId: string,
	message: unknown,
	part: unknown,
	partIndex?: number,
	rawNativeMessage?: unknown,
): NativeToolProvenance | undefined {
	if (typeof part === "number" && partIndex === undefined)
		return nativeToolProvenanceV2(sessionId, message, part);
	if (partIndex === undefined) return undefined;
	if (rawNativeMessage !== undefined) {
		const ref = nativeToolProvenanceV2(sessionId, rawNativeMessage, partIndex);
		const projectedMessage = z
			.object({ id: Id, sessionID: Id, role: z.literal("assistant") })
			.safeParse(message);
		const projectedPart = z
			.object({
				type: z.literal("tool"),
				sessionID: Id,
				messageID: Id,
				callID: Id,
				tool: Id,
				state: z.object({
					status: z.enum(["pending", "running", "completed", "error"]),
				}),
			})
			.safeParse(part);
		if (
			!ref ||
			!projectedMessage.success ||
			!projectedPart.success ||
			!isNativeMessageV2(rawNativeMessage) ||
			rawNativeMessage.type !== "assistant"
		)
			return undefined;
		const content = rawNativeMessage.content[partIndex];
		if (
			content?.type !== "tool" ||
			projectedMessage.data.id !== ref.messageId ||
			projectedMessage.data.sessionID !== sessionId ||
			projectedPart.data.sessionID !== sessionId ||
			projectedPart.data.messageID !== ref.messageId ||
			projectedPart.data.callID !== ref.callId ||
			projectedPart.data.tool !== content.name ||
			projectedPart.data.state.status !==
				(content.state.status === "streaming"
					? "pending"
					: content.state.status)
		)
			return undefined;
		return ref;
	}
	return nativeToolProvenanceV1(sessionId, message, part, partIndex);
}

function collectHostTraceV2(input: HostTraceCollection): HostTrace {
	const fail = (reason: UnavailableReason): HostTrace => ({
		version: 2,
		kind: "unavailable",
		reason,
	});
	if (!input.childrenComplete) return fail("endpoint-failure");
	if (
		!input.runnerRootSessionIds.length ||
		input.runnerRootSessionIds.length > 16 ||
		input.sessionMetadata.length > 128 ||
		input.sessionMessages.length > 128
	)
		return fail("limits-exceeded");
	if (
		new Set(input.runnerRootSessionIds).size !==
		input.runnerRootSessionIds.length
	)
		return fail("duplicate-native-id");
	const sessions: ObservedTraceV2["sessions"] = [];
	const ids = new Set<string>();
	for (const raw of input.sessionMetadata) {
		if (!isNativeSessionV2(raw) || !Id.safeParse(raw.id).success)
			return fail("malformed-native-session");
		if (ids.has(raw.id)) return fail("duplicate-native-id");
		if (raw.location.directory !== input.directory)
			return fail("directory-mismatch");
		ids.add(raw.id);
		sessions.push({
			id: raw.id,
			parentId: raw.parentID ?? null,
			agent: raw.agent ?? null,
			projectMatched: true,
		});
	}
	const ancestry = topologyIssue(sessions, input.runnerRootSessionIds);
	if (ancestry) return fail(ancestry);
	const sessionIds = new Set(ids);
	const transcripts = new Set<string>();
	const messages: ObservedTraceV2["messages"] = [];
	let contentCount = 0;
	let toolCount = 0;
	for (const transcript of input.sessionMessages) {
		if (transcripts.has(transcript.sessionId))
			return fail("duplicate-native-id");
		if (!sessionIds.has(transcript.sessionId))
			return fail("message-session-mismatch");
		transcripts.add(transcript.sessionId);
		if (!Array.isArray(transcript.messages))
			return fail("incomplete-transcript");
		if (messages.length + transcript.messages.length > 4096)
			return fail("limits-exceeded");
		let created = -1;
		for (const [order, raw] of transcript.messages.entries()) {
			const binding = V2Binding.safeParse(raw);
			if (
				!binding.success ||
				!isNativeMessageV2(raw) ||
				!Id.safeParse(raw.id).success ||
				!Order.safeParse(raw.time.created).success
			)
				return fail("malformed-native-message");
			if (
				binding.data.sessionID !== undefined &&
				binding.data.sessionID !== transcript.sessionId
			)
				return fail("message-session-mismatch");
			if (ids.has(raw.id)) return fail("duplicate-native-id");
			ids.add(raw.id);
			if (raw.time.created < created) return fail("chronology-conflict");
			created = raw.time.created;
			if (
				"completed" in raw.time &&
				raw.time.completed !== undefined &&
				(!Order.safeParse(raw.time.completed).success ||
					raw.time.completed < created)
			)
				return fail("chronology-conflict");
			if ("text" in raw && Buffer.byteLength(raw.text) > 4 * 1024 * 1024)
				return fail("limits-exceeded");
			const identity = {
				id: raw.id,
				sessionId: transcript.sessionId,
				order,
				created,
			};
			if (raw.type === "assistant") {
				contentCount += raw.content.length;
				if (raw.content.length > 256 || contentCount > 16384)
					return fail("limits-exceeded");
				const tools: Extract<
					ObservedTraceV2["messages"][number],
					{ role: "assistant" }
				>["tools"] = [];
				for (const [partIndex, content] of raw.content.entries()) {
					if (
						(content.type === "text" || content.type === "reasoning") &&
						Buffer.byteLength(content.text) > 4 * 1024 * 1024
					)
						return fail("limits-exceeded");
					if (content.type !== "tool") continue;
					const ref = nativeToolProvenanceV2(
						transcript.sessionId,
						raw,
						partIndex,
					);
					if (!ref) return fail("chronology-conflict");
					tools.push({
						...ref,
						tool: content.name,
						status:
							content.state.status === "streaming"
								? "pending"
								: content.state.status,
					});
					if (++toolCount > 4096) return fail("limits-exceeded");
				}
				messages.push({
					...identity,
					role: "assistant",
					type: "assistant",
					agent: raw.agent,
					contentCount: raw.content.length,
					tools,
				});
			} else if (raw.type === "user" || raw.type === "synthetic") {
				if (Buffer.byteLength(raw.text) > 4 * 1024 * 1024)
					return fail("limits-exceeded");
				const attachments =
					raw.type === "user"
						? (raw.files?.length ?? 0) +
							(raw.agents?.length ?? 0) +
							(raw.skills?.length ?? 0)
						: 0;
				contentCount += 1 + attachments;
				if (attachments > 255 || contentCount > 16384)
					return fail("limits-exceeded");
				const metadata = NativeMetadata.safeParse(raw.metadata ?? {});
				if (!metadata.success) return fail("malformed-native-message");
				messages.push({
					...identity,
					role: "user",
					type: raw.type,
					textBytes: Buffer.byteLength(raw.text),
					attachments,
					flowTokenSha256: tokenDigest(
						metadata.data["opencode-plugin-flow/auto"],
					),
					compactionContinue: metadata.data.compaction_continue ?? null,
				});
			} else {
				if (
					raw.type === "location-switched" &&
					raw.location.directory !== input.directory
				)
					return fail("directory-mismatch");
				messages.push({ ...identity, role: "event", type: raw.type });
			}
		}
	}
	if (transcripts.size !== sessions.length)
		return fail("incomplete-transcript");
	const trace = {
		version: 2 as const,
		kind: "observed" as const,
		runnerRootSessionIds: [...input.runnerRootSessionIds],
		sessions,
		messages,
		compactionDelivery: "unavailable-from-message-export" as const,
	};
	const parsed = HostTraceV2Schema.safeParse(trace);
	return parsed.success ? parsed.data : fail("malformed-native-part");
}
export function collectHostTrace(input: HostTraceCollection): HostTrace {
	const v2 =
		input.sessionMetadata.some(
			(raw) => z.object({ location: z.unknown() }).safeParse(raw).success,
		) ||
		input.sessionMessages.some(
			(transcript) =>
				Array.isArray(transcript.messages) &&
				transcript.messages.some(
					(raw) => z.object({ type: z.string() }).safeParse(raw).success,
				),
		);
	return v2 ? collectHostTraceV2(input) : collectHostTraceV1(input);
}
