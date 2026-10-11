import { readFile } from "node:fs/promises";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import {
	HostArtifactsSchema,
	HostArtifactVerificationSchema,
	validateHostArtifactVerification,
} from "../host-artifacts.js";
import {
	OperatorPolicySchema,
	OperatorReplySchema,
	OperatorRequestSchema,
} from "./episode-operator.js";
import {
	type EpisodeArmEvidence,
	validateEpisodeRegistration,
} from "./episodes.js";
import {
	EpisodeReservationScopeSchema,
	ReservationReconciliationSchema,
} from "./request-budget.js";
import { datasetDigest } from "./schema.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Text = z.string().trim().min(1).max(1000);
const Time = z.number().int().safe().nonnegative().max(1_000_000_000_000);
const Event = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("reservation-reconciliation"),
			atMs: Time,
			reconciliation: ReservationReconciliationSchema,
		})
		.strict(),
	z.object({ kind: z.literal("start"), atMs: z.literal(0) }).strict(),
	z
		.object({
			kind: z.literal("wait-start"),
			atMs: Time,
			request: OperatorRequestSchema.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("wait-end"),
			atMs: Time,
			requestDigest: Hash.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("intervention"),
			atMs: Time,
			reply: OperatorReplySchema.optional(),
		})
		.strict(),
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
		operatorPolicy: OperatorPolicySchema.optional(),
		expectedHostArtifacts: HostArtifactsSchema.optional(),
		artifactVerification: HostArtifactVerificationSchema.optional(),
		reservationCoverage: z.enum(["complete", "unknown"]),
		reservationScope: EpisodeReservationScopeSchema.optional(),
		events: z.array(Event).min(1).max(100000),
	})
	.strict();

type Receipt = z.infer<typeof EpisodeReceiptSchema>;
export type EpisodeWaitState = {
	wait:
		| null
		| { kind: "legacy" }
		| { kind: "bound"; digest: string; accepted: boolean };
	nextIndex: number;
	interventions: number;
};
export function advanceEpisodeWait(
	state: EpisodeWaitState,
	event: Receipt["events"][number],
	header: Omit<Receipt, "events">,
): EpisodeWaitState {
	const { wait } = state;
	switch (event.kind) {
		case "wait-start": {
			if (wait) throw new Error("Operator wait already started.");
			if (!event.request) {
				if (header.operatorPolicy?.kind === "file-mailbox-v1")
					throw new Error("Mailbox waits require source evidence.");
				return { ...state, wait: { kind: "legacy" } };
			}
			if (
				event.request.headerDigest !== datasetDigest(header) ||
				event.request.episodeId !== header.episodeId ||
				event.request.arm !== header.arm ||
				event.request.index !== state.nextIndex
			)
				throw new Error("Operator request binding mismatch.");
			return {
				...state,
				nextIndex: state.nextIndex + 1,
				wait: {
					kind: "bound",
					digest: datasetDigest(event.request),
					accepted: false,
				},
			};
		}
		case "intervention": {
			if (wait?.kind === "bound") {
				if (
					wait.accepted ||
					event.reply?.requestDigest !== wait.digest ||
					header.operatorPolicy?.kind !== "file-mailbox-v1" ||
					state.interventions >= header.operatorPolicy.maxInterventions
				)
					throw new Error("Operator intervention mismatch.");
				return {
					...state,
					interventions: state.interventions + 1,
					wait: { ...wait, accepted: true },
				};
			}
			if (event.reply || header.operatorPolicy?.kind === "file-mailbox-v1")
				throw new Error("Operator reply without bound wait.");
			return { ...state, interventions: state.interventions + 1 };
		}
		case "wait-end":
			if (!wait) throw new Error("Operator wait was not started.");
			if (
				wait.kind === "bound"
					? event.requestDigest !== wait.digest || !wait.accepted
					: event.requestDigest !== undefined
			)
				throw new Error("Operator wait closure mismatch.");
			return { ...state, wait: null };
		case "terminal":
			if (
				wait?.kind === "bound" &&
				(event.outcome === "completed" || event.outcome === "failed")
			)
				throw new Error("Operator wait remains open.");
			return state;
		default:
			return state;
	}
}

export async function reduceEpisodeReceipt(
	registrationInput: unknown,
	input: unknown,
) {
	const registration = await validateEpisodeRegistration(registrationInput);
	const receipt = EpisodeReceiptSchema.parse(input);
	validateHostArtifactVerification(
		receipt.expectedHostArtifacts,
		receipt.artifactVerification,
	);
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
	if (
		receipt.reservationScope &&
		(receipt.reservationCoverage !== "unknown" ||
			receipt.reservationScope.registrationDigest !==
				receipt.registrationDigest ||
			receipt.reservationScope.episodeId !== receipt.episodeId ||
			receipt.reservationScope.arm !== receipt.arm ||
			receipt.reservationScope.harnessDigest !== arm.harnessDigest)
	)
		throw new Error("Receipt reservation scope mismatch.");
	if (receipt.events[0]?.kind !== "start")
		throw new Error("Receipt must start at elapsed time zero.");
	let previous = 0;
	let waitState: EpisodeWaitState = {
		wait: null,
		nextIndex: 0,
		interventions: 0,
	};
	const { events: _events, ...header } = receipt;
	let activeRuntimeMs = 0;
	let humanWaitMs = 0;
	let reservedUsd = 0;
	let reconciliationAt: number | undefined;
	let outcome: "completed" | "failed" | "cancelled" | "timed-out" | undefined;
	const reservationIds = new Set<string>();
	for (const event of receipt.events.slice(1)) {
		if (
			outcome ||
			event.kind === "start" ||
			event.atMs < previous ||
			(reconciliationAt !== undefined &&
				(event.kind !== "terminal" || event.atMs !== reconciliationAt))
		)
			throw new Error("Invalid event order or event after terminal outcome.");
		const elapsed = event.atMs - previous;
		if (waitState.wait) humanWaitMs += elapsed;
		else activeRuntimeMs += elapsed;
		previous = event.atMs;
		waitState = advanceEpisodeWait(waitState, event, header);
		switch (event.kind) {
			case "wait-start":
			case "wait-end":
			case "intervention":
				break;
			case "reservation":
				if (receipt.reservationScope)
					throw new Error("Scoped receipts cannot mix legacy reservations.");
				if (reservationIds.has(event.id))
					throw new Error("Duplicate reservation.");
				reservationIds.add(event.id);
				reservedUsd += event.usd;
				break;
			case "reservation-reconciliation":
				if (
					!receipt.reservationScope ||
					reservationIds.size ||
					datasetDigest(event.reconciliation.scope) !==
						datasetDigest(receipt.reservationScope) ||
					event.reconciliation.authorization.origin !== receipt.declaredOrigin
				)
					throw new Error("Reservation reconciliation binding mismatch.");
				reconciliationAt = event.atMs;
				reservedUsd = event.reconciliation.totalMicroUsd / 1_000_000;
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
		interruptions: outcome ? waitState.interventions : null,
		activeRuntimeMs: outcome ? activeRuntimeMs : null,
		humanWaitMs: outcome ? humanWaitMs : null,
		reservedUsd:
			outcome &&
			(receipt.reservationCoverage === "complete" ||
				reconciliationAt !== undefined)
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
