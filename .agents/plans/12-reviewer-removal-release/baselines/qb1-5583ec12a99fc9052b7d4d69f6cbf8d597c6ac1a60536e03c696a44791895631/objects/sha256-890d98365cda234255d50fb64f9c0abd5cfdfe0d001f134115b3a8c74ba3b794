import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RetainedBenchmarkEvidence } from "./benchmark-evidence.js";
import { canonicalJson } from "./canonical-json.js";
import {
	assessCompletionDeclaration,
	workflowCompleted,
} from "./completion-claim.js";
import { evidenceSha256, MAX_EVIDENCE_OBJECT_BYTES } from "./evidence-store.js";

export const BenchmarkTranscriptSchema = z
	.object({
		schemaVersion: z.literal(1),
		calls: z.array(z.unknown()).max(4096),
		finalText: z.string().max(4 * 1024 * 1024),
		workflowDocuments: z.array(z.record(z.string(), z.unknown())).max(512),
	})
	.strict();

export async function verifyBenchmarkTranscript(input: {
	directory: string;
	attemptId: string;
	transcript: { readonly artifact: string; readonly sha256: string } | null;
	assessment: RetainedBenchmarkEvidence;
}): Promise<void> {
	const expectedPath = `transcripts/${Buffer.from(input.attemptId).toString("base64url")}.json`;
	if (input.transcript?.artifact !== expectedPath)
		throw new Error(
			"Retained benchmark transcript path is missing or noncanonical.",
		);
	if (!(await lstat(join(input.directory, "transcripts"))).isDirectory())
		throw new Error("Transcript directory is not a regular directory.");
	const handle = await open(
		join(input.directory, expectedPath),
		constants.O_RDONLY |
			(process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
	);
	let bytes: Buffer;
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > MAX_EVIDENCE_OBJECT_BYTES)
			throw new Error("Retained transcript exceeds its file bounds.");
		bytes = await handle.readFile();
	} finally {
		await handle.close();
	}
	if (evidenceSha256(bytes) !== input.transcript.sha256)
		throw new Error("Retained transcript digest differs.");
	const transcript = BenchmarkTranscriptSchema.parse(
		JSON.parse(bytes.toString("utf8")),
	);
	if (
		canonicalJson(assessCompletionDeclaration(transcript.finalText)) !==
			canonicalJson(input.assessment.completion) ||
		workflowCompleted(transcript.workflowDocuments) !==
			input.assessment.workflowCompleted
	)
		throw new Error(
			"Retained completion assessment does not reproduce from its transcript.",
		);
}
