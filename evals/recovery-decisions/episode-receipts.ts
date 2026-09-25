import { readFile } from "node:fs/promises";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import {
	type EpisodeArmEvidence,
	validateEpisodeRegistration,
} from "./episodes.js";
import { datasetDigest } from "./schema.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Text = z.string().trim().min(1).max(1000);
const Time = z.number().int().safe().nonnegative().max(1_000_000_000_000);
const Event = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("start"), atMs: z.literal(0) }).strict(),
	z.object({ kind: z.literal("wait-start"), atMs: Time }).strict(),
	z.object({ kind: z.literal("wait-end"), atMs: Time }).strict(),
	z.object({ kind: z.literal("intervention"), atMs: Time }).strict(),
	z
		.object({
			kind: z.literal("reservation"),
			atMs: Time,
			id: Text,
			usd: z.number().finite().positive().max(1_000_000),
		})
		.strict(),
	z
		.object({
			kind: z.literal("terminal"),
			atMs: Time,
			outcome: z.enum(["completed", "failed", "cancelled", "timed-out"]),
		})
		.strict(),
]);

export const EpisodeReceiptSchema = z
	.object({
		schemaVersion: z.literal(1),
		registrationDigest: Hash,
		arm: z.enum(["manager-only", "manager-plus-jev"]),
		armDigest: Hash,
		episodeId: Text,
		episodeDigest: Hash,
		initialStateDigest: Hash,
		declaredOrigin: z.enum(["simulation", "live"]),
		recordedBy: Text,
		startedAt: z.iso.datetime(),
		reservationCoverage: z.enum(["complete", "unknown"]),
		events: z.array(Event).min(1).max(100000),
	})
	.strict();

export async function reduceEpisodeReceipt(
	registrationInput: unknown,
	input: unknown,
) {
	const registration = await validateEpisodeRegistration(registrationInput);
	const receipt = EpisodeReceiptSchema.parse(input);
	const episode = registration.protocol.episodes.find(
		(row) => row.id === receipt.episodeId,
	);
	const arm =
		receipt.arm === "manager-only"
			? registration.protocol.arms.managerOnly
			: registration.protocol.arms.managerPlusJev;
	if (
		!episode ||
		receipt.registrationDigest !== datasetDigest(registration) ||
		receipt.armDigest !== datasetDigest(arm) ||
		receipt.episodeDigest !== datasetDigest(episode) ||
		receipt.initialStateDigest !== episode.initialStateDigest
	)
		throw new Error("Receipt does not match the registered episode and arm.");
	if (receipt.events[0]?.kind !== "start")
		throw new Error("Receipt must start at elapsed time zero.");
	let previous = 0;
	let waiting = false;
	let activeRuntimeMs = 0;
	let humanWaitMs = 0;
	let interruptions = 0;
	let reservedUsd = 0;
	let outcome: "completed" | "failed" | "cancelled" | "timed-out" | undefined;
	const reservationIds = new Set<string>();
	for (const event of receipt.events.slice(1)) {
		if (outcome || event.kind === "start" || event.atMs < previous)
			throw new Error("Invalid event order or event after terminal outcome.");
		const elapsed = event.atMs - previous;
		if (waiting) humanWaitMs += elapsed;
		else activeRuntimeMs += elapsed;
		previous = event.atMs;
		switch (event.kind) {
			case "wait-start":
				if (waiting) throw new Error("Operator wait already started.");
				waiting = true;
				break;
			case "wait-end":
				if (!waiting) throw new Error("Operator wait was not started.");
				waiting = false;
				break;
			case "intervention":
				interruptions++;
				break;
			case "reservation":
				if (reservationIds.has(event.id))
					throw new Error("Duplicate reservation.");
				reservationIds.add(event.id);
				reservedUsd += event.usd;
				break;
			case "terminal":
				outcome = event.outcome;
				break;
		}
	}
	const observation: EpisodeArmEvidence["observations"][number] = {
		episodeId: receipt.episodeId,
		episodeDigest: receipt.episodeDigest,
		receiptDigest: datasetDigest(receipt),
		result: outcome
			? { kind: "terminal", outcome }
			: { kind: "unavailable", reason: "Receipt has no terminal event." },
		interruptions: outcome ? interruptions : null,
		activeRuntimeMs: outcome ? activeRuntimeMs : null,
		humanWaitMs: outcome ? humanWaitMs : null,
		reservedUsd:
			outcome && receipt.reservationCoverage === "complete"
				? reservedUsd
				: null,
		unsafeAcceptedActions: null,
		forbiddenMutations: null,
		safetyReview: null,
	};
	return {
		schemaVersion: 1,
		qualification: "inconclusive",
		status: "awaiting-review",
		receipt,
		observation,
	};
}

export async function runEpisodeReceiptCommand(args: readonly string[]) {
	const [command, registrationPath, receiptPath, output, ...extra] = args;
	if (
		command !== "episode-reduce" ||
		!registrationPath ||
		!receiptPath ||
		!output ||
		extra.length
	)
		throw new Error(
			"Expected episode-reduce <registration> <receipt> <new-draft>.",
		);
	const registration = JSON.parse(await readFile(registrationPath, "utf8"));
	const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
	await writeExclusive(
		output,
		await reduceEpisodeReceipt(registration, receipt),
	);
	return 0;
}
