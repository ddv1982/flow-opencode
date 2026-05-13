import { describe, expect, test } from "bun:test";
import type { FlowAttachmentMimeType } from "../src/adapters/opencode/attachment-policy";
import {
	describeFlowAttachmentAvailabilityFromRecords,
	type FlowAttachmentSkippedRecord,
	selectFlowAttachmentRecords,
} from "../src/adapters/opencode/attachment-selection";

type AttachmentRecord = {
	id: string;
	filename?: string;
	mime: FlowAttachmentMimeType;
	batchId: string;
	messageId?: string;
};

const supportedFormats = "PNG, JPEG, WebP, GIF, AVIF";

function imageAttachment(
	overrides: Partial<AttachmentRecord> & Pick<AttachmentRecord, "id">,
): AttachmentRecord {
	return {
		batchId: "batch-1",
		filename: `${overrides.id}.png`,
		mime: "image/png",
		...overrides,
	};
}

function skippedAttachment(
	overrides: Partial<FlowAttachmentSkippedRecord>,
): FlowAttachmentSkippedRecord {
	return {
		sessionId: "session-1",
		batchId: "batch-1",
		createdAt: 1_000,
		reason: "Unsupported attachment MIME image/svg+xml. SVG is not supported.",
		...overrides,
	};
}

describe("OpenCode attachment selection", () => {
	test("implicit selection prefers the current message over the latest batch", () => {
		const current = imageAttachment({
			id: "current-png",
			batchId: "batch-current",
			messageId: "current-message",
		});
		const latest = imageAttachment({
			id: "latest-png",
			batchId: "batch-latest",
			messageId: "latest-message",
		});
		const skippedCurrent = skippedAttachment({
			attachmentId: "current-svg",
			filename: "current.svg",
			batchId: "batch-current",
			messageId: "current-message",
		});
		const skippedLatest = skippedAttachment({
			attachmentId: "latest-svg",
			filename: "latest.svg",
			batchId: "batch-latest",
			messageId: "latest-message",
		});

		const selection = selectFlowAttachmentRecords({
			messageId: "current-message",
			latestBatchId: "batch-latest",
			candidates: [latest, current],
			skippedCandidates: [skippedLatest, skippedCurrent],
			supportedFormats,
		});

		expect(selection.selected.map((attachment) => attachment.id)).toEqual([
			"current-png",
		]);
		expect(selection.skipped).toEqual([
			{
				attachmentId: "current-svg",
				filename: "current.svg",
				reason: skippedCurrent.reason,
			},
		]);
	});

	test("implicit selection falls back to the latest batch when the current message has no records", () => {
		const old = imageAttachment({ id: "old-png", batchId: "batch-old" });
		const latest = imageAttachment({
			id: "latest-png",
			batchId: "batch-latest",
		});

		const selection = selectFlowAttachmentRecords({
			messageId: "current-message",
			latestBatchId: "batch-latest",
			candidates: [old, latest],
			skippedCandidates: [],
			supportedFormats,
		});

		expect(selection.selected.map((attachment) => attachment.id)).toEqual([
			"latest-png",
		]);
		expect(selection.skipped).toEqual([]);
	});

	test("availability reports skipped-only latest batches as materialization-required unsupported_only", () => {
		const skippedLatest = skippedAttachment({
			attachmentId: "unsafe-svg",
			filename: "unsafe.svg",
			batchId: "batch-latest",
		});

		const snapshot = describeFlowAttachmentAvailabilityFromRecords({
			sessionId: "session-1",
			messageId: "current-message",
			latestBatchId: "batch-latest",
			candidates: [],
			skippedCandidates: [skippedLatest],
			supportedFormats,
		});

		expect(snapshot.status).toBe("unsupported_only");
		expect(snapshot.source).toBe("latest_batch");
		expect(snapshot.materializationRequired).toBe(true);
		expect(snapshot.attachments).toEqual([]);
		expect(snapshot.skipped).toEqual([
			{
				attachmentId: "unsafe-svg",
				filename: "unsafe.svg",
				reason: skippedLatest.reason,
			},
		]);
	});

	test("filename selectors reject ambiguous duplicate matches and require id selection", () => {
		const first = imageAttachment({
			id: "hero-1",
			filename: "hero.png",
			batchId: "batch-1",
		});
		const second = imageAttachment({
			id: "hero-2",
			filename: "hero.png",
			batchId: "batch-2",
		});

		const ambiguous = selectFlowAttachmentRecords({
			selectors: [{ filename: "hero.png" }],
			candidates: [first, second],
			skippedCandidates: [],
			supportedFormats,
		});
		expect(ambiguous.selected).toEqual([]);
		expect(ambiguous.skipped).toEqual([
			{
				filename: "hero.png",
				reason:
					"Filename selector matched multiple captured attachments; select by id instead.",
			},
		]);

		const explicit = selectFlowAttachmentRecords({
			selectors: [{ id: "hero-2", filename: "hero.png" }],
			candidates: [first, second],
			skippedCandidates: [],
			supportedFormats,
		});
		expect(explicit.selected.map((attachment) => attachment.id)).toEqual([
			"hero-2",
		]);
		expect(explicit.skipped).toEqual([]);
	});
});
