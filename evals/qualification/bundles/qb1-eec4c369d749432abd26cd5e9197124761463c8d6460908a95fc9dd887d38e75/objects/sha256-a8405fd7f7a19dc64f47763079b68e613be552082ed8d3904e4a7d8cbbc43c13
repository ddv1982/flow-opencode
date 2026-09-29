import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { datasetDigest } from "./schema.js";

const Text = z.string().min(1).max(16000);
const Id = z.string().min(1).max(500);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const OperatorPolicySchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("disabled") }).strict(),
	z
		.object({
			kind: z.literal("file-mailbox-v1"),
			maxInterventions: z.number().int().min(1).max(100),
		})
		.strict(),
]);
export type OperatorPolicy = z.infer<typeof OperatorPolicySchema>;
export const EpisodeQuestionSchema = z
	.object({
		sessionId: Id,
		calls: z
			.array(
				z
					.object({
						messageId: Id,
						callId: Id,
						input: z
							.object({
								questions: z
									.array(
										z
											.object({
												question: Text,
												header: z.string().max(500),
												options: z
													.array(
														z
															.object({ label: Text, description: Text })
															.strict(),
													)
													.max(100),
												multiple: z.boolean().optional(),
												custom: z.boolean().optional(),
											})
											.strict(),
									)
									.min(1)
									.max(20),
							})
							.strict(),
					})
					.strict(),
			)
			.min(1)
			.max(20),
	})
	.strict()
	.refine(
		(value) => Buffer.byteLength(JSON.stringify(value)) <= 64000,
		"Question exceeds byte limit.",
	);
export type EpisodeQuestion = z.infer<typeof EpisodeQuestionSchema>;
export const OperatorRequestSchema = z
	.object({
		headerDigest: Hash,
		episodeId: Id,
		arm: z.enum(["manager-only", "manager-plus-jev"]),
		index: z.number().int().nonnegative().max(100000),
		nonce: z.string().uuid(),
		question: EpisodeQuestionSchema,
	})
	.strict();
export const OperatorReplySchema = z
	.object({
		requestDigest: Hash,
		text: Text.refine((text) => text.trim().length > 0, "Empty reply."),
		recordedBy: z.string().trim().min(1).max(500),
		attribution: z.literal("unverified"),
	})
	.strict();
export type OperatorRequest = z.infer<typeof OperatorRequestSchema>;
export type OperatorReply = z.infer<typeof OperatorReplySchema>;

export async function readOperatorJson(path: string): Promise<unknown> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > 1000000)
			throw new Error("Invalid operator input file.");
		const bytes = Buffer.alloc(1000001);
		const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
		if (bytesRead > 1000000)
			throw new Error("Operator input exceeds byte limit.");
		return JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
	} finally {
		await handle.close();
	}
}
export async function waitForOperatorReply(
	directory: string,
	request: OperatorRequest,
	signal: AbortSignal,
): Promise<OperatorReply> {
	const digest = datasetDigest(request);
	for (;;) {
		signal.throwIfAborted();
		let input: unknown;
		try {
			input = await readOperatorJson(
				join(directory, "operator", "replies", `${digest}.json`),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			await setTimeout(100, undefined, { signal });
			continue;
		}
		const reply = OperatorReplySchema.parse(input);
		if (reply.requestDigest !== digest)
			throw new Error("Reply addresses another wait.");
		signal.throwIfAborted();
		return reply;
	}
}
export async function readEpisodeQuestion(directory: string) {
	const { recoverEpisodeJournal } = await import("./episode-runner.js");
	const registration = JSON.parse(
		await readFile(join(directory, "registration.json"), "utf8"),
	);
	const draft = await recoverEpisodeJournal(registration, directory);
	const last = draft.receipt.events.at(-1);
	if (last?.kind !== "wait-start" || !last.request)
		throw new Error("No current operator request.");
	const digest = datasetDigest(last.request);
	const request = OperatorRequestSchema.parse(
		await readOperatorJson(
			join(directory, "operator", "requests", `${digest}.json`),
		),
	);
	if (datasetDigest(request) !== digest)
		throw new Error("Operator request differs from journal.");
	return { digest, request };
}
export async function submitEpisodeReply(directory: string, input: unknown) {
	const reply = OperatorReplySchema.parse(input);
	const current = await readEpisodeQuestion(directory);
	if (reply.requestDigest !== current.digest)
		throw new Error("Reply addresses another wait.");
	await writeExclusive(
		join(directory, "operator", "replies", `${current.digest}.json`),
		reply,
	);
}
export async function runEpisodeOperatorCommand(args: readonly string[]) {
	const [command, directory, path, ...extra] = args;
	if (!directory || !path || extra.length)
		throw new Error("Expected operator command, run directory and JSON file.");
	if (command === "episode-read-question")
		await writeExclusive(path, await readEpisodeQuestion(directory));
	else if (command === "episode-submit-reply")
		await submitEpisodeReply(directory, await readOperatorJson(path));
	else throw new Error("Unknown operator command.");
	return 0;
}
