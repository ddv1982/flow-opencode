import { createHash } from "node:crypto";
import {
	describeSupportedAttachmentFormats,
	FLOW_ATTACHMENT_ALLOWED_MIME_TYPES,
	FLOW_ATTACHMENT_MAX_BYTES,
	type FlowAttachmentMimeType,
	maxFlowAttachmentDataUrlPayloadLength,
	normalizeFlowAttachmentMime,
} from "./attachment-policy";
import type { Hooks } from "./sdk";

export type { FlowAttachmentMimeType };
export {
	describeSupportedAttachmentFormats,
	FLOW_ATTACHMENT_ALLOWED_MIME_TYPES,
	normalizeFlowAttachmentMime,
};

export type FlowAttachmentRecord = {
	id: string;
	sessionId: string;
	messageId?: string;
	batchId: string;
	mime: FlowAttachmentMimeType;
	filename?: string;
	url: string;
	createdAt: number;
};

export type FlowAttachmentSelector = {
	id?: string | undefined;
	filename?: string | undefined;
};

export type FlowAttachmentSkippedMetadata = {
	attachmentId?: string;
	filename?: string;
	reason: string;
};

export type FlowAttachmentCaptureSummary = {
	captured: number;
	skipped: number;
	totalStored: number;
};

export type FlowAttachmentAvailabilityStatus =
	| "unavailable"
	| "none"
	| "available"
	| "mixed"
	| "unsupported_only";

export type FlowAttachmentSelectionSource =
	| "current_message"
	| "latest_batch"
	| "none";

export type FlowAttachmentAvailabilityAttachment = {
	id: string;
	filename?: string;
	mime: FlowAttachmentMimeType;
	batchId: string;
	messageId?: string;
};

export type FlowAttachmentAvailabilitySnapshot = {
	status: FlowAttachmentAvailabilityStatus;
	source: FlowAttachmentSelectionSource;
	sessionId?: string;
	messageId?: string;
	supportedFormats: string;
	materializationRequired: boolean;
	attachments: FlowAttachmentAvailabilityAttachment[];
	skipped: FlowAttachmentSkippedMetadata[];
	reason: string;
};

type OpenCodeChatMessageInput = Parameters<
	NonNullable<Hooks["chat.message"]>
>[0];
type OpenCodeChatMessageOutput = Parameters<
	NonNullable<Hooks["chat.message"]>
>[1];
type OpenCodeCommandBeforeInput = Parameters<
	NonNullable<Hooks["command.execute.before"]>
>[0];
type OpenCodeCommandBeforeOutput = Parameters<
	NonNullable<Hooks["command.execute.before"]>
>[1];

type OpenCodeFilePartLike = {
	id?: unknown;
	sessionID?: unknown;
	messageID?: unknown;
	type?: unknown;
	mime?: unknown;
	filename?: unknown;
	url?: unknown;
};

type FlowAttachmentSkippedRecord = FlowAttachmentSkippedMetadata & {
	sessionId: string;
	messageId?: string;
	batchId: string;
	createdAt: number;
};

type NormalizedAttachment =
	| { record: FlowAttachmentRecord }
	| { skipped: FlowAttachmentSkippedRecord };

export const FLOW_ATTACHMENT_TTL_MS = 30 * 60 * 1000;
const FLOW_ATTACHMENT_MAX_RECORDS_PER_SESSION = 50;

const attachmentsBySession = new Map<
	string,
	Map<string, FlowAttachmentRecord>
>();
const skippedAttachmentsBySession = new Map<
	string,
	Map<string, FlowAttachmentSkippedRecord>
>();
const latestBatchBySession = new Map<string, string>();

export function captureChatMessageAttachments(
	input: OpenCodeChatMessageInput,
	output: OpenCodeChatMessageOutput,
	now = Date.now(),
): FlowAttachmentCaptureSummary {
	return captureOpenCodeAttachments(
		{
			sessionId: input.sessionID,
			...(input.messageID ? { messageId: input.messageID } : {}),
			parts: output.parts,
		},
		now,
	);
}

export function captureCommandAttachments(
	input: OpenCodeCommandBeforeInput,
	output: OpenCodeCommandBeforeOutput,
	now = Date.now(),
): FlowAttachmentCaptureSummary {
	return captureOpenCodeAttachments(
		{
			sessionId: input.sessionID,
			parts: output.parts,
		},
		now,
	);
}

export function captureOpenCodeAttachments(
	input: {
		sessionId: string;
		messageId?: string;
		parts: readonly unknown[];
	},
	now = Date.now(),
): FlowAttachmentCaptureSummary {
	cleanupExpiredFlowAttachments(now);
	let captured = 0;
	let skipped = 0;
	let skippedFilePartIndex = 0;
	let sawFilePart = false;
	const sessionRecords = ensureSessionRecords(input.sessionId);
	const skippedRecords = ensureSessionSkippedRecords(input.sessionId);
	const batchId = stableAttachmentId({
		sessionId: input.sessionId,
		...(input.messageId ? { messageId: input.messageId } : {}),
		mime: "batch",
		url: `${now}:${sessionRecords.size}:${input.parts.length}`,
	});

	for (const part of input.parts) {
		if (isFilePartLike(part)) {
			sawFilePart = true;
		}
		const normalized = normalizeOpenCodeFilePart(
			input.sessionId,
			input.messageId,
			batchId,
			part,
			now,
		);
		if (!normalized) {
			skipped += 1;
			continue;
		}
		if ("record" in normalized) {
			sessionRecords.set(normalized.record.id, normalized.record);
			captured += 1;
			continue;
		}
		const key = `${batchId}:skipped:${skippedFilePartIndex}`;
		skippedFilePartIndex += 1;
		skippedRecords.set(key, normalized.skipped);
		skipped += 1;
	}

	if (sawFilePart) {
		latestBatchBySession.set(input.sessionId, batchId);
	}
	trimSessionRecords(sessionRecords);
	trimSessionRecords(skippedRecords);
	return { captured, skipped, totalStored: sessionRecords.size };
}

export function listFlowAttachments(
	sessionId?: string,
	now = Date.now(),
): FlowAttachmentRecord[] {
	cleanupExpiredFlowAttachments(now);
	if (sessionId) {
		return [...(attachmentsBySession.get(sessionId)?.values() ?? [])];
	}
	return [...attachmentsBySession.values()].flatMap((records) => [
		...records.values(),
	]);
}

export function selectFlowAttachments(
	input: {
		sessionId?: string | undefined;
		messageId?: string | undefined;
		selectors?: readonly FlowAttachmentSelector[] | undefined;
	},
	now = Date.now(),
): {
	selected: FlowAttachmentRecord[];
	skipped: FlowAttachmentSkippedMetadata[];
} {
	const supportedFormats = describeSupportedAttachmentFormats();
	const candidates = listFlowAttachments(input.sessionId, now);
	const skippedCandidates = listSkippedFlowAttachments(input.sessionId, now);
	if (!input.selectors || input.selectors.length === 0) {
		const implicitSelection = selectImplicitCurrentOrLatestAttachmentBatch({
			sessionId: input.sessionId,
			messageId: input.messageId,
			candidates,
			skippedCandidates,
		});
		return implicitSelection.source !== "none"
			? {
					selected: implicitSelection.selected,
					skipped: skippedMetadata(implicitSelection.skipped),
				}
			: {
					selected: [],
					skipped: [
						{
							reason: `No current or latest supported image attachment batch is available; select older supported attachments explicitly. Supported formats: ${supportedFormats}. SVG is not supported.`,
						},
					],
				};
	}

	const selected: FlowAttachmentRecord[] = [];
	const skipped: FlowAttachmentSkippedMetadata[] = [];
	const seen = new Set<string>();

	for (const selector of input.selectors) {
		const matches = candidates.filter((candidate) => {
			if (selector.id && candidate.id !== selector.id) {
				return false;
			}
			if (selector.filename && candidate.filename !== selector.filename) {
				return false;
			}
			return true;
		});

		if (matches.length === 0) {
			const skippedMatches = skippedCandidates.filter((candidate) => {
				if (selector.id && candidate.attachmentId !== selector.id) {
					return false;
				}
				if (selector.filename && candidate.filename !== selector.filename) {
					return false;
				}
				return true;
			});
			if (skippedMatches.length > 0) {
				skipped.push(...skippedMetadata(skippedMatches));
				continue;
			}
			skipped.push({
				...(selector.id ? { attachmentId: selector.id } : {}),
				...(selector.filename ? { filename: selector.filename } : {}),
				reason: `No captured supported image attachment matched the selector. Supported formats: ${supportedFormats}. SVG is not supported.`,
			});
			continue;
		}
		if (!selector.id && selector.filename && matches.length > 1) {
			skipped.push({
				filename: selector.filename,
				reason:
					"Filename selector matched multiple captured attachments; select by id instead.",
			});
			continue;
		}
		for (const match of matches) {
			if (!seen.has(match.id)) {
				selected.push(match);
				seen.add(match.id);
			}
		}
	}

	return { selected, skipped };
}

export function describeFlowAttachmentAvailability(
	input: {
		sessionId?: string | undefined;
		messageId?: string | undefined;
	},
	now = Date.now(),
): FlowAttachmentAvailabilitySnapshot {
	const supportedFormats = describeSupportedAttachmentFormats();
	if (!input.sessionId) {
		return {
			status: "unavailable",
			source: "none",
			supportedFormats,
			materializationRequired: false,
			attachments: [],
			skipped: [],
			reason:
				"OpenCode sessionID is unavailable, so attachment availability could not be evaluated.",
		};
	}

	const candidates = listFlowAttachments(input.sessionId, now);
	const skippedCandidates = listSkippedFlowAttachments(input.sessionId, now);
	const implicitSelection = selectImplicitCurrentOrLatestAttachmentBatch({
		sessionId: input.sessionId,
		messageId: input.messageId,
		candidates,
		skippedCandidates,
	});
	const selectedCount = implicitSelection.selected.length;
	const skippedCount = implicitSelection.skipped.length;
	const status: FlowAttachmentAvailabilityStatus =
		selectedCount > 0 && skippedCount > 0
			? "mixed"
			: selectedCount > 0
				? "available"
				: skippedCount > 0
					? "unsupported_only"
					: "none";
	const materializationRequired =
		status === "available" ||
		status === "mixed" ||
		status === "unsupported_only";
	return {
		status,
		source: implicitSelection.source,
		sessionId: input.sessionId,
		...(input.messageId ? { messageId: input.messageId } : {}),
		supportedFormats,
		materializationRequired,
		attachments: implicitSelection.selected.map((attachment) => ({
			id: attachment.id,
			...(attachment.filename ? { filename: attachment.filename } : {}),
			mime: attachment.mime,
			batchId: attachment.batchId,
			...(attachment.messageId ? { messageId: attachment.messageId } : {}),
		})),
		skipped: skippedMetadata(implicitSelection.skipped),
		reason: attachmentAvailabilityReason(status, implicitSelection.source),
	};
}

export function clearFlowAttachments(): void {
	attachmentsBySession.clear();
	skippedAttachmentsBySession.clear();
	latestBatchBySession.clear();
}

export function cleanupExpiredFlowAttachments(now = Date.now()): number {
	let removed = cleanupExpiredRecords(attachmentsBySession, now);
	removed += cleanupExpiredRecords(skippedAttachmentsBySession, now);
	for (const [sessionId, batchId] of latestBatchBySession) {
		if (!sessionHasBatch(sessionId, batchId)) {
			latestBatchBySession.delete(sessionId);
		}
	}
	return removed;
}

function cleanupExpiredRecords<T extends { createdAt: number }>(
	recordsBySession: Map<string, Map<string, T>>,
	now: number,
): number {
	let removed = 0;
	for (const [sessionId, records] of recordsBySession) {
		for (const [id, record] of records) {
			if (now - record.createdAt > FLOW_ATTACHMENT_TTL_MS) {
				records.delete(id);
				removed += 1;
			}
		}
		if (records.size === 0) {
			recordsBySession.delete(sessionId);
		}
	}
	return removed;
}

function sessionHasBatch(sessionId: string, batchId: string): boolean {
	return [
		...(attachmentsBySession.get(sessionId)?.values() ?? []),
		...(skippedAttachmentsBySession.get(sessionId)?.values() ?? []),
	].some((record) => record.batchId === batchId);
}

function ensureSessionRecords(
	sessionId: string,
): Map<string, FlowAttachmentRecord> {
	const existing = attachmentsBySession.get(sessionId);
	if (existing) {
		return existing;
	}
	const records = new Map<string, FlowAttachmentRecord>();
	attachmentsBySession.set(sessionId, records);
	return records;
}

function ensureSessionSkippedRecords(
	sessionId: string,
): Map<string, FlowAttachmentSkippedRecord> {
	const existing = skippedAttachmentsBySession.get(sessionId);
	if (existing) {
		return existing;
	}
	const records = new Map<string, FlowAttachmentSkippedRecord>();
	skippedAttachmentsBySession.set(sessionId, records);
	return records;
}

function listSkippedFlowAttachments(
	sessionId?: string,
	now = Date.now(),
): FlowAttachmentSkippedRecord[] {
	cleanupExpiredFlowAttachments(now);
	if (sessionId) {
		return [...(skippedAttachmentsBySession.get(sessionId)?.values() ?? [])];
	}
	return [...skippedAttachmentsBySession.values()].flatMap((records) => [
		...records.values(),
	]);
}

function selectImplicitCurrentOrLatestAttachmentBatch(input: {
	sessionId?: string | undefined;
	messageId?: string | undefined;
	candidates: readonly FlowAttachmentRecord[];
	skippedCandidates: readonly FlowAttachmentSkippedRecord[];
}): {
	source: FlowAttachmentSelectionSource;
	selected: FlowAttachmentRecord[];
	skipped: FlowAttachmentSkippedRecord[];
} {
	const messageScoped = input.messageId
		? input.candidates.filter(
				(candidate) => candidate.messageId === input.messageId,
			)
		: [];
	const messageScopedSkipped = input.messageId
		? input.skippedCandidates.filter(
				(candidate) => candidate.messageId === input.messageId,
			)
		: [];
	if (messageScoped.length > 0 || messageScopedSkipped.length > 0) {
		return {
			source: "current_message",
			selected: messageScoped,
			skipped: messageScopedSkipped,
		};
	}

	const latestBatchId = input.sessionId
		? latestBatchBySession.get(input.sessionId)
		: null;
	const latestBatch = latestBatchId
		? input.candidates.filter(
				(candidate) => candidate.batchId === latestBatchId,
			)
		: [];
	const latestBatchSkipped = latestBatchId
		? input.skippedCandidates.filter(
				(candidate) => candidate.batchId === latestBatchId,
			)
		: [];
	return latestBatch.length > 0 || latestBatchSkipped.length > 0
		? {
				source: "latest_batch",
				selected: latestBatch,
				skipped: latestBatchSkipped,
			}
		: { source: "none", selected: [], skipped: [] };
}

function attachmentAvailabilityReason(
	status: FlowAttachmentAvailabilityStatus,
	source: FlowAttachmentSelectionSource,
): string {
	if (status === "none") {
		return "No current or latest OpenCode attachment batch is available.";
	}
	const sourceLabel =
		source === "current_message"
			? "current message"
			: "latest attachment batch";
	if (status === "available") {
		return `Supported image attachments are available from the ${sourceLabel}; materialize them before planning or implementation inspection.`;
	}
	if (status === "mixed") {
		return `Supported and unsupported attachments are present in the ${sourceLabel}; materialize the implicit batch so supported files import and skipped reasons are surfaced.`;
	}
	if (status === "unsupported_only") {
		return `Only unsupported or invalid attachments are present in the ${sourceLabel}; call materialization to surface skipped reasons and stop instead of planning with nonexistent files.`;
	}
	return "OpenCode sessionID is unavailable, so attachment availability could not be evaluated.";
}

function normalizeOpenCodeFilePart(
	sessionId: string,
	messageId: string | undefined,
	batchId: string,
	part: unknown,
	now: number,
): NormalizedAttachment | null {
	if (!isObject(part)) {
		return null;
	}
	const filePart = part as OpenCodeFilePartLike;
	if (filePart.type !== "file") {
		return null;
	}

	const recordSessionId =
		typeof filePart.sessionID === "string" && filePart.sessionID.trim()
			? filePart.sessionID
			: sessionId;
	const recordMessageId =
		typeof filePart.messageID === "string" && filePart.messageID.trim()
			? filePart.messageID
			: messageId;
	const filename =
		typeof filePart.filename === "string" && filePart.filename.trim()
			? filePart.filename.trim()
			: undefined;
	const attachmentId =
		typeof filePart.id === "string" && filePart.id.trim()
			? filePart.id.trim()
			: undefined;
	const skippedBase = {
		sessionId: recordSessionId,
		...(recordMessageId ? { messageId: recordMessageId } : {}),
		batchId,
		...(attachmentId ? { attachmentId } : {}),
		...(filename ? { filename } : {}),
		createdAt: now,
	};

	const rawMime = typeof filePart.mime === "string" ? filePart.mime : "";
	const mime = normalizeFlowAttachmentMime(rawMime);
	if (!mime) {
		return {
			skipped: {
				...skippedBase,
				reason: `Unsupported attachment MIME '${rawMime || "unknown"}'. Supported formats: ${describeSupportedAttachmentFormats()}. SVG is not supported.`,
			},
		};
	}
	if (typeof filePart.url !== "string" || filePart.url.trim() === "") {
		return {
			skipped: {
				...skippedBase,
				reason:
					"Captured file attachment did not include a materializable URL.",
			},
		};
	}
	const oversizedReason = oversizedDataUrlReason(filePart.url);
	if (oversizedReason) {
		return {
			skipped: {
				...skippedBase,
				reason: oversizedReason,
			},
		};
	}

	const id =
		attachmentId ??
		stableAttachmentId({
			sessionId: recordSessionId,
			...(recordMessageId ? { messageId: recordMessageId } : {}),
			mime,
			...(filename ? { filename } : {}),
			url: filePart.url,
		});

	return {
		record: {
			id,
			sessionId: recordSessionId,
			...(recordMessageId ? { messageId: recordMessageId } : {}),
			batchId,
			mime,
			...(filename ? { filename } : {}),
			url: filePart.url,
			createdAt: now,
		},
	};
}

function oversizedDataUrlReason(url: string): string | null {
	if (!url.toLowerCase().startsWith("data:")) {
		return null;
	}
	const commaIndex = url.indexOf(",");
	if (commaIndex === -1) {
		return null;
	}
	const flags = url.slice(5, commaIndex).split(";");
	const isBase64 = flags.includes("base64");
	const payloadLength = url.length - commaIndex - 1;
	if (payloadLength > maxFlowAttachmentDataUrlPayloadLength(isBase64)) {
		return `Attachment exceeds ${FLOW_ATTACHMENT_MAX_BYTES} byte limit.`;
	}
	return null;
}

function skippedMetadata(
	records: readonly FlowAttachmentSkippedRecord[],
): FlowAttachmentSkippedMetadata[] {
	return records.map((record) => ({
		...(record.attachmentId ? { attachmentId: record.attachmentId } : {}),
		...(record.filename ? { filename: record.filename } : {}),
		reason: record.reason,
	}));
}

function stableAttachmentId(input: {
	sessionId: string;
	messageId?: string;
	mime: string;
	filename?: string;
	url: string;
}): string {
	const hash = createHash("sha256")
		.update(input.sessionId)
		.update("\0")
		.update(input.messageId ?? "")
		.update("\0")
		.update(input.mime)
		.update("\0")
		.update(input.filename ?? "")
		.update("\0")
		.update(input.url)
		.digest("hex")
		.slice(0, 16);
	return `attachment-${hash}`;
}

function trimSessionRecords<T extends { createdAt: number }>(
	records: Map<string, T>,
): void {
	while (records.size > FLOW_ATTACHMENT_MAX_RECORDS_PER_SESSION) {
		const oldest = [...records.entries()].sort(
			([, left], [, right]) => left.createdAt - right.createdAt,
		)[0];
		if (!oldest) {
			return;
		}
		records.delete(oldest[0]);
	}
}

function isFilePartLike(value: unknown): value is OpenCodeFilePartLike {
	return isObject(value) && value.type === "file";
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
