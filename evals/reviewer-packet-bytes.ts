import { createHash } from "node:crypto";
import { z } from "zod";
import { scrubSecrets } from "./cassette.js";

export const MAX_PACKET_BYTES = 4 * 1024 * 1024;
export const MAX_PACKET_CAPTURE_BASE64_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_BYTES = Math.ceil(MAX_PACKET_BYTES / 3) * 4;
const Id = z.string().min(1).max(256);
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Reference = z.object({ version: z.literal(1), sha256: Digest }).strict();
const FileState = z
	.object({
		kind: z.enum(["missing", "file", "symlink"]),
		mode: z.number().int().safe().nonnegative(),
		digest: Digest.nullable(),
	})
	.strict();
export const ReviewerPacketSchema = z
	.object({
		version: z.literal(1),
		sessionId: Id,
		featureId: Id,
		runId: Id,
		baseline: Reference,
		sourceDigest: Digest,
		provenance: z.enum(["captured-before-run", "declared-existing-work"]),
		complete: z.literal(true),
		preservedPreexisting: z
			.object({
				count: z.number().int().safe().nonnegative(),
				digest: Digest,
				entries: z
					.array(
						z
							.object({ path: z.string().min(1).max(4096), state: FileState })
							.strict(),
					)
					.max(4096),
			})
			.strict(),
		changes: z
			.array(
				z
					.object({
						path: z.string().min(1).max(4096),
						before: FileState,
						after: FileState,
						binary: z.boolean(),
						preexistingDirty: z.boolean(),
						diff: z.string().max(MAX_PACKET_BYTES),
						acceptedBefore: FileState.optional(),
						acceptedDiff: z.string().max(MAX_PACKET_BYTES).optional(),
						newDiff: z.string().max(MAX_PACKET_BYTES).optional(),
					})
					.strict(),
			)
			.max(4096),
	})
	.strict();
const Envelope = z
	.object({
		owner: z.literal("flow-review-evidence"),
		version: z.literal(1),
		kind: z.literal("packet"),
		packet: ReviewerPacketSchema,
	})
	.strict();

export type DecodedReviewerPacket = Readonly<{
	packet: z.infer<typeof ReviewerPacketSchema>;
	packetText: string;
	sha256: string;
}>;
export function decodeReviewerPacket(
	envelopeBase64: string,
): DecodedReviewerPacket {
	if (
		!envelopeBase64 ||
		envelopeBase64.length > MAX_BASE64_BYTES ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			envelopeBase64,
		)
	)
		throw new Error("Invalid bounded canonical packet base64.");
	const bytes = Buffer.from(envelopeBase64, "base64");
	if (
		bytes.length > MAX_PACKET_BYTES ||
		bytes.toString("base64") !== envelopeBase64
	)
		throw new Error("Invalid canonical packet bytes.");
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	if (scrubSecrets(text) !== text)
		throw new Error("Original packet contains secret-shaped evidence.");
	const parsed: unknown = JSON.parse(text);
	const envelope = Envelope.parse(parsed);
	if (JSON.stringify(parsed) !== text)
		throw new Error("Packet envelope is not canonical JSON.stringify bytes.");
	if (typeof parsed !== "object" || parsed === null || !("packet" in parsed))
		throw new Error("Missing packet envelope.");
	return {
		packet: envelope.packet,
		packetText: JSON.stringify(parsed.packet),
		sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
	};
}

export const ReviewerPacketBytesSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("observed"),
			assignmentId: Id,
			sourceDigest: Digest,
			envelopeBase64: z.string().max(MAX_BASE64_BYTES),
		})
		.strict()
		.superRefine((value, context) => {
			try {
				const decoded = decodeReviewerPacket(value.envelopeBase64);
				if (decoded.packet.sourceDigest !== value.sourceDigest)
					throw new Error("Packet source binding differs.");
			} catch {
				context.addIssue({
					code: "custom",
					message: "Unsafe or invalid original packet observation.",
				});
			}
		}),
	z
		.object({
			kind: z.literal("unavailable"),
			assignmentId: Id,
			sourceDigest: Digest,
			reason: z.enum([
				"missing-pages",
				"conflicting-pages",
				"invalid-packet",
				"unsafe-packet",
				"binding-mismatch",
				"limits-exceeded",
			]),
		})
		.strict(),
]);
export const ReviewerPacketBytesListSchema = z
	.array(z.unknown())
	.max(128)
	.superRefine((values, context) => {
		let bytes = 0;
		const assignmentIds = new Set<string>();
		for (const value of values) {
			if (
				typeof value === "object" &&
				value !== null &&
				"assignmentId" in value &&
				typeof value.assignmentId === "string"
			) {
				if (assignmentIds.has(value.assignmentId))
					context.addIssue({
						code: "custom",
						message: "Duplicate assignment packet observation.",
					});
				assignmentIds.add(value.assignmentId);
			}
			if (
				typeof value === "object" &&
				value !== null &&
				"envelopeBase64" in value &&
				typeof value.envelopeBase64 === "string"
			)
				bytes += value.envelopeBase64.length;
		}
		if (bytes > MAX_PACKET_CAPTURE_BASE64_BYTES)
			context.addIssue({
				code: "custom",
				message: "Original packet observations exceed aggregate byte budget.",
			});
	})
	.pipe(z.array(ReviewerPacketBytesSchema).max(128));
export type ReviewerPacketBytes = z.infer<typeof ReviewerPacketBytesSchema>;
export type PacketCall = Readonly<{
	tool: string;
	status: string;
	output: unknown;
}>;

const BindingDocument = z.object({
	id: Id,
	runs: z
		.array(
			z.object({
				id: Id,
				baseline: Reference.optional(),
				reviews: z
					.array(
						z.object({
							id: Id,
							featureId: Id,
							runId: Id,
							sourceDigest: Digest,
							evidence: Reference.optional(),
						}),
					)
					.max(64),
			}),
		)
		.max(2048),
});
const Page = z.object({
	view: z.literal("reviewer-evidence"),
	sessionId: Id,
	assignmentId: Id,
	sourceDigest: Digest,
	part: z.literal("diff"),
	page: z.number().int().min(0).max(4095),
	totalPages: z.number().int().min(1).max(4096),
	complete: z.literal(true),
	assurance: z.literal("host-evidence"),
	text: z.string().max(8192),
});
function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
export function collectReviewerPacketBytes(
	calls: readonly PacketCall[],
	documents: readonly unknown[],
): readonly ReviewerPacketBytes[] {
	if (calls.length > 4096 || documents.length > 512) return [];
	const bindings = new Map<
		string,
		{
			sessionId: string;
			runId: string;
			featureId: string;
			sourceDigest: string;
			evidence: z.infer<typeof Reference>;
			baseline: z.infer<typeof Reference> | undefined;
		}
	>();
	for (const document of documents) {
		const parsed = BindingDocument.safeParse(document);
		if (!parsed.success) continue;
		for (const run of parsed.data.runs)
			for (const assignment of run.reviews) {
				if (!assignment.evidence) continue;
				if (bindings.size >= 128) return [];
				bindings.set(assignment.id, {
					sessionId: parsed.data.id,
					runId: assignment.runId,
					featureId: assignment.featureId,
					sourceDigest: assignment.sourceDigest,
					evidence: assignment.evidence,
					baseline: run.baseline,
				});
			}
	}
	let retainedBase64Bytes = 0;
	return [...bindings.entries()].map(
		([assignmentId, binding]): ReviewerPacketBytes => {
			const unavailable = (
				reason: Extract<ReviewerPacketBytes, { kind: "unavailable" }>["reason"],
			): ReviewerPacketBytes => ({
				kind: "unavailable",
				assignmentId,
				sourceDigest: binding.sourceDigest,
				reason,
			});
			const pages = new Map<number, string>();
			let totalPages: number | null = null;
			for (const call of calls) {
				if (call.tool !== "flow_status" || call.status !== "completed")
					continue;
				const output = record(call.output);
				if (output?.status !== "ok") continue;
				const workflow = record(output.workflowData),
					projection = record(workflow?.projection);
				if (
					projection?.assignmentId !== assignmentId ||
					projection.part !== "diff"
				)
					continue;
				const page = Page.safeParse(projection);
				if (!page.success) return unavailable("invalid-packet");
				if (
					page.data.sourceDigest !== binding.sourceDigest ||
					page.data.sessionId !== binding.sessionId
				)
					return unavailable("binding-mismatch");
				if (
					(totalPages !== null && totalPages !== page.data.totalPages) ||
					(pages.has(page.data.page) &&
						pages.get(page.data.page) !== page.data.text)
				)
					return unavailable("conflicting-pages");
				totalPages = page.data.totalPages;
				pages.set(page.data.page, page.data.text);
			}
			if (
				totalPages === null ||
				pages.size !== totalPages ||
				[...pages.keys()].some((index) => index >= totalPages)
			)
				return unavailable("missing-pages");
			const packetText = Array.from(
				{ length: totalPages },
				(_, page) => pages.get(page) ?? "",
			).join("");
			if (Buffer.byteLength(packetText) > MAX_PACKET_BYTES)
				return unavailable("invalid-packet");
			try {
				const packet: unknown = JSON.parse(packetText);
				if (JSON.stringify(packet) !== packetText)
					return unavailable("invalid-packet");
				const text = JSON.stringify({
					owner: "flow-review-evidence",
					version: 1,
					kind: "packet",
					packet,
				});
				if (scrubSecrets(text) !== text) return unavailable("unsafe-packet");
				const encodedLength = Math.ceil(Buffer.byteLength(text) / 3) * 4;
				if (
					retainedBase64Bytes + encodedLength >
					MAX_PACKET_CAPTURE_BASE64_BYTES
				)
					return unavailable("limits-exceeded");
				const envelopeBase64 = Buffer.from(text).toString("base64");
				const decoded = decodeReviewerPacket(envelopeBase64);
				if (
					decoded.sha256 !== binding.evidence.sha256 ||
					decoded.packet.sessionId !== binding.sessionId ||
					decoded.packet.runId !== binding.runId ||
					decoded.packet.featureId !== binding.featureId ||
					decoded.packet.sourceDigest !== binding.sourceDigest ||
					!binding.baseline ||
					JSON.stringify(decoded.packet.baseline) !==
						JSON.stringify(binding.baseline)
				)
					return unavailable("binding-mismatch");
				retainedBase64Bytes += encodedLength;
				return {
					kind: "observed",
					assignmentId,
					sourceDigest: binding.sourceDigest,
					envelopeBase64,
				};
			} catch {
				return unavailable("invalid-packet");
			}
		},
	);
}
