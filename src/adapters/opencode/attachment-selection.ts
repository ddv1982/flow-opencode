import type { FlowAttachmentMimeType } from "./attachment-policy";

export type FlowAttachmentSelector = {
	id?: string | undefined;
	filename?: string | undefined;
};

export type FlowAttachmentSkippedMetadata = {
	attachmentId?: string;
	filename?: string;
	reason: string;
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

export type FlowAttachmentSkippedRecord = FlowAttachmentSkippedMetadata & {
	sessionId: string;
	messageId?: string;
	batchId: string;
	createdAt: number;
};

type SelectableAttachmentRecord = {
	id: string;
	filename?: string;
	mime: FlowAttachmentMimeType;
	batchId: string;
	messageId?: string;
};

export function selectFlowAttachmentRecords<
	Attachment extends SelectableAttachmentRecord,
	Skipped extends FlowAttachmentSkippedRecord,
>(input: {
	selectors?: readonly FlowAttachmentSelector[] | undefined;
	messageId?: string | undefined;
	latestBatchId?: string | undefined;
	candidates: readonly Attachment[];
	skippedCandidates: readonly Skipped[];
	supportedFormats: string;
}): {
	selected: Attachment[];
	skipped: FlowAttachmentSkippedMetadata[];
} {
	if (!input.selectors || input.selectors.length === 0) {
		const implicitSelection = selectImplicitCurrentOrLatestAttachmentBatch({
			messageId: input.messageId,
			latestBatchId: input.latestBatchId,
			candidates: input.candidates,
			skippedCandidates: input.skippedCandidates,
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
							reason: `No current or latest supported image attachment batch is available; select older supported attachments explicitly. Supported formats: ${input.supportedFormats}. SVG is not supported.`,
						},
					],
				};
	}

	const selected: Attachment[] = [];
	const skipped: FlowAttachmentSkippedMetadata[] = [];
	const seen = new Set<string>();

	for (const selector of input.selectors) {
		const matches = input.candidates.filter((candidate) => {
			if (selector.id && candidate.id !== selector.id) {
				return false;
			}
			if (selector.filename && candidate.filename !== selector.filename) {
				return false;
			}
			return true;
		});

		if (matches.length === 0) {
			const skippedMatches = input.skippedCandidates.filter((candidate) => {
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
				reason: `No captured supported image attachment matched the selector. Supported formats: ${input.supportedFormats}. SVG is not supported.`,
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

export function describeFlowAttachmentAvailabilityFromRecords<
	Attachment extends SelectableAttachmentRecord,
	Skipped extends FlowAttachmentSkippedRecord,
>(input: {
	sessionId?: string | undefined;
	messageId?: string | undefined;
	latestBatchId?: string | undefined;
	candidates: readonly Attachment[];
	skippedCandidates: readonly Skipped[];
	supportedFormats: string;
}): FlowAttachmentAvailabilitySnapshot {
	if (!input.sessionId) {
		return {
			status: "unavailable",
			source: "none",
			supportedFormats: input.supportedFormats,
			materializationRequired: false,
			attachments: [],
			skipped: [],
			reason:
				"OpenCode sessionID is unavailable, so attachment availability could not be evaluated.",
		};
	}

	const implicitSelection = selectImplicitCurrentOrLatestAttachmentBatch({
		messageId: input.messageId,
		latestBatchId: input.latestBatchId,
		candidates: input.candidates,
		skippedCandidates: input.skippedCandidates,
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
		supportedFormats: input.supportedFormats,
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

function selectImplicitCurrentOrLatestAttachmentBatch<
	Attachment extends SelectableAttachmentRecord,
	Skipped extends FlowAttachmentSkippedRecord,
>(input: {
	messageId?: string | undefined;
	latestBatchId?: string | undefined;
	candidates: readonly Attachment[];
	skippedCandidates: readonly Skipped[];
}): {
	source: FlowAttachmentSelectionSource;
	selected: Attachment[];
	skipped: Skipped[];
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

	const latestBatch = input.latestBatchId
		? input.candidates.filter(
				(candidate) => candidate.batchId === input.latestBatchId,
			)
		: [];
	const latestBatchSkipped = input.latestBatchId
		? input.skippedCandidates.filter(
				(candidate) => candidate.batchId === input.latestBatchId,
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

function skippedMetadata(
	records: readonly FlowAttachmentSkippedRecord[],
): FlowAttachmentSkippedMetadata[] {
	return records.map((record) => ({
		...(record.attachmentId ? { attachmentId: record.attachmentId } : {}),
		...(record.filename ? { filename: record.filename } : {}),
		reason: record.reason,
	}));
}
