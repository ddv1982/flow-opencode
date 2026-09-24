import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import {
	type HostArtifacts,
	HostArtifactsSchema,
	type HostArtifactVerification,
	validateHostArtifactVerification,
} from "../host-artifacts.js";
import {
	type EpisodeQuestion,
	EpisodeQuestionSchema,
	type OperatorPolicy,
	OperatorPolicySchema,
	type OperatorRequest,
	waitForOperatorReply,
} from "./episode-operator.js";
import {
	advanceEpisodeWait,
	EpisodeReceiptSchema,
	type EpisodeWaitState,
	reduceEpisodeReceipt,
} from "./episode-receipts.js";
import { validateEpisodeRegistration } from "./episodes.js";
import {
	type EpisodeReservationScope,
	EpisodeReservationScopeSchema,
	type ReservationReconciliation,
	ReservationReconciliationSchema,
} from "./request-budget.js";
import { datasetDigest } from "./schema.js";

type Receipt = z.infer<typeof EpisodeReceiptSchema>;
type Event = Receipt["events"][number];
type Transition = { kind: "wait-start" | "wait-end" | "intervention" };
export type EpisodeDriver = {
	harnessDigest: string;
	origin: "simulation" | "live";
	operatorPolicy?: OperatorPolicy;
	expectedHostArtifacts?: HostArtifacts;
	admitLive?(
		input: {
			scope: EpisodeReservationScope;
			manager: { model: string; prompt: string };
			taskDigest: string;
			initialStateDigest: string;
			completionCriteria: string;
		},
		signal?: AbortSignal,
	): Promise<void>;
	prepare(
		signal: AbortSignal,
		scope?: EpisodeReservationScope,
	): Promise<{
		task: unknown;
		initialState: unknown;
		artifactVerification?: HostArtifactVerification;
	}>;
	run(context: {
		signal: AbortSignal;
		record(event: Transition): Promise<void>;
		waitForOperator(question: EpisodeQuestion): Promise<string>;
	}): Promise<void>;
	evaluate(
		criteria: string,
		signal: AbortSignal,
	): Promise<{ met: boolean; evidence: unknown }>;
	stop(): Promise<void>;
	reconciliationTimeoutMs?(): Promise<number> | number;
	reconcileReservations?(
		signal?: AbortSignal,
	): Promise<ReservationReconciliation>;
};

const Header = EpisodeReceiptSchema.omit({ events: true });
const Record = z
	.object({
		sequence: z.number().int().nonnegative(),
		previous: z.string().regex(/^[a-f0-9]{64}$/),
		event: EpisodeReceiptSchema.shape.events.element,
	})
	.strict();

export async function recoverEpisodeJournal(
	registration: unknown,
	directory: string,
) {
	const header = Header.parse(
		JSON.parse(await readFile(join(directory, "header.json"), "utf8")),
	);
	const names = (await readdir(join(directory, "events")))
		.filter((name) => !name.startsWith(".pending-"))
		.sort();
	let previous = datasetDigest(header);
	const events: Event[] = [];
	for (const [sequence, name] of names.entries()) {
		if (name !== `${String(sequence).padStart(6, "0")}.json`)
			throw new Error("Journal sequence gap or unknown file.");
		const record = Record.parse(
			JSON.parse(await readFile(join(directory, "events", name), "utf8")),
		);
		if (record.sequence !== sequence || record.previous !== previous)
			throw new Error("Journal chain mismatch.");
		events.push(record.event);
		previous = datasetDigest(record);
	}
	return reduceEpisodeReceipt(registration, { ...header, events });
}

export async function runEpisode(options: {
	registration: unknown;
	episodeId: string;
	arm: Receipt["arm"];
	outputDirectory: string;
	recordedBy: string;
	origin: "simulation" | "live";
	driver: EpisodeDriver;
	signal?: AbortSignal;
}) {
	const admitLive = options.driver.admitLive?.bind(options.driver);
	if (options.origin !== options.driver.origin)
		throw new Error("Driver origin mismatch.");
	if (
		options.origin === "live" &&
		(!admitLive ||
			!options.driver.expectedHostArtifacts ||
			!options.driver.reconcileReservations)
	)
		throw new Error(
			"Live episodes require admission for reviewed route cost bounds, isolated treatment, frozen artifacts, and reservation reconciliation.",
		);
	const expectedHostArtifacts =
		options.driver.expectedHostArtifacts === undefined
			? undefined
			: HostArtifactsSchema.parse(options.driver.expectedHostArtifacts);
	const operatorPolicy = OperatorPolicySchema.parse(
		options.driver.operatorPolicy ?? { kind: "disabled" },
	);
	const registration = await validateEpisodeRegistration(options.registration);
	const episode = registration.protocol.episodes.find(
		(entry) => entry.id === options.episodeId,
	);
	const arm =
		options.arm === "manager-only"
			? registration.protocol.arms.managerOnly
			: registration.protocol.arms.managerPlusJev;
	if (!episode || options.driver.harnessDigest !== arm.harnessDigest)
		throw new Error("Unknown episode or changed driver.");
	if (registration.protocol.execution.timeoutMs > 2_147_483_647)
		throw new Error("Episode timeout exceeds runner timer range.");
	const reservationScope = Object.freeze(
		EpisodeReservationScopeSchema.parse({
			executionId: randomUUID(),
			registrationDigest: datasetDigest(registration),
			episodeId: episode.id,
			arm: options.arm,
			harnessDigest: arm.harnessDigest,
		}),
	);
	options.signal?.throwIfAborted();
	if (options.origin === "live" && admitLive) {
		await admitLive(
			{
				scope: reservationScope,
				manager: { model: arm.model, prompt: arm.prompt },
				taskDigest: episode.taskDigest,
				initialStateDigest: episode.initialStateDigest,
				completionCriteria: episode.completionCriteria,
			},
			options.signal,
		);
		options.signal?.throwIfAborted();
	}
	await mkdir(options.outputDirectory, { mode: 0o700 });
	if (process.platform !== "win32") {
		const parent = await open(dirname(options.outputDirectory), "r");
		try {
			await parent.sync();
		} finally {
			await parent.close();
		}
	}
	await mkdir(join(options.outputDirectory, "events"), { mode: 0o700 });
	await writeExclusive(
		join(options.outputDirectory, "registration.json"),
		registration,
	);
	const controller = new AbortController();
	let reason: "cancelled" | "timed-out" | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const cancel = () => {
		reason ??= "cancelled";
		controller.abort();
	};
	options.signal?.addEventListener("abort", cancel, { once: true });
	if (options.signal?.aborted) cancel();
	const armDeadline = () => {
		timer = setTimeout(
			() => {
				reason ??= "timed-out";
				controller.abort();
			},
			Math.min(registration.protocol.execution.timeoutMs, 2_147_483_647),
		);
	};
	const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
		controller.signal.throwIfAborted();
		let abort = () => {};
		const interrupted = new Promise<never>((_, reject) => {
			abort = () => reject(new Error("Episode interrupted."));
			controller.signal.addEventListener("abort", abort, { once: true });
		});
		try {
			return await Promise.race([
				Promise.resolve().then(operation),
				interrupted,
			]);
		} finally {
			controller.signal.removeEventListener("abort", abort);
		}
	};
	let started = false;
	let accepting = false;
	let waitState: EpisodeWaitState = {
		wait: null,
		nextIndex: 0,
		interventions: 0,
	};
	let journalHeader: z.infer<typeof Header>;
	let sequence = 0;
	let previous = "";
	let start = 0;
	let queue = Promise.resolve();
	let persistenceFailed = false;
	let outcome: "completed" | "failed" | null = null;
	const append = (event: Event) => {
		waitState = advanceEpisodeWait(waitState, event, journalHeader);
		const next = queue.then(async () => {
			const record = Record.parse({ sequence, previous, event });
			await writeExclusive(
				join(
					options.outputDirectory,
					"events",
					`${String(sequence).padStart(6, "0")}.json`,
				),
				record,
			);
			sequence++;
			previous = datasetDigest(record);
		});
		queue = next;
		void next.catch(() => {
			persistenceFailed = true;
			controller.abort();
		});
		return next;
	};
	const elapsed = () => Math.max(0, Math.floor(performance.now() - start));
	let stopConfirmed = false;
	let executionFailed = false;
	let terminalAtMs = 0;
	try {
		armDeadline();
		const reset = await bounded(() =>
			options.driver.prepare(controller.signal, reservationScope),
		);
		validateHostArtifactVerification(
			expectedHostArtifacts,
			reset.artifactVerification,
		);
		if (
			datasetDigest(reset.task) !== episode.taskDigest ||
			datasetDigest(reset.initialState) !== episode.initialStateDigest
		)
			throw new Error("Reset or task differs from registration.");
		await writeExclusive(join(options.outputDirectory, "reset.json"), {
			taskDigest: datasetDigest(reset.task),
			initialStateDigest: datasetDigest(reset.initialState),
			resetProtocol: registration.protocol.execution.resetProtocol,
		});
		const header = Header.parse({
			...(expectedHostArtifacts
				? {
						expectedHostArtifacts,
						artifactVerification: reset.artifactVerification,
					}
				: {}),
			schemaVersion: 1,
			registrationDigest: datasetDigest(registration),
			arm: options.arm,
			armDigest: datasetDigest(arm),
			episodeId: episode.id,
			episodeDigest: datasetDigest(episode),
			initialStateDigest: episode.initialStateDigest,
			declaredOrigin: options.origin,
			recordedBy: options.recordedBy,
			startedAt: new Date().toISOString(),
			reservationCoverage: "unknown",
			reservationScope,
			operatorPolicy,
		});
		await writeExclusive(join(options.outputDirectory, "header.json"), header);
		journalHeader = header;
		previous = datasetDigest(header);
		await append({ kind: "start", atMs: 0 });
		controller.signal.throwIfAborted();
		start = performance.now();
		started = true;
		accepting = true;
		clearTimeout(timer);
		armDeadline();
		await bounded(() =>
			options.driver.run({
				signal: controller.signal,
				async waitForOperator(question) {
					controller.signal.throwIfAborted();
					if (!accepting || waitState.wait)
						throw new Error("Episode cannot open operator wait.");
					const request: OperatorRequest = {
						headerDigest: datasetDigest(header),
						episodeId: episode.id,
						arm: options.arm,
						index: waitState.nextIndex,
						nonce: randomUUID(),
						question: EpisodeQuestionSchema.parse(question),
					};
					await append({ kind: "wait-start", atMs: elapsed(), request });
					controller.signal.throwIfAborted();
					if (
						operatorPolicy.kind === "disabled" ||
						waitState.interventions >= operatorPolicy.maxInterventions
					) {
						await new Promise<never>((_resolve, reject) => {
							controller.signal.addEventListener(
								"abort",
								() => reject(new Error("Operator wait cancelled.")),
								{ once: true },
							);
						});
					}
					await mkdir(join(options.outputDirectory, "operator", "requests"), {
						recursive: true,
						mode: 0o700,
					});
					await mkdir(join(options.outputDirectory, "operator", "replies"), {
						recursive: true,
						mode: 0o700,
					});
					controller.signal.throwIfAborted();
					await writeExclusive(
						join(
							options.outputDirectory,
							"operator",
							"requests",
							`${datasetDigest(request)}.json`,
						),
						request,
					);
					const reply = await waitForOperatorReply(
						options.outputDirectory,
						request,
						controller.signal,
					);
					controller.signal.throwIfAborted();
					await append({ kind: "intervention", atMs: elapsed(), reply });
					controller.signal.throwIfAborted();
					await append({
						kind: "wait-end",
						atMs: elapsed(),
						requestDigest: datasetDigest(request),
					});
					controller.signal.throwIfAborted();
					return reply.text;
				},
				record(event) {
					if (
						!accepting ||
						controller.signal.aborted ||
						waitState.wait?.kind === "bound" ||
						operatorPolicy.kind === "file-mailbox-v1"
					)
						return Promise.reject(new Error("Episode is stopping."));
					const parsed = z
						.object({
							kind: z.enum(["wait-start", "wait-end", "intervention"]),
						})
						.strict()
						.safeParse(event);
					if (!parsed.success) {
						controller.abort();
						return Promise.reject(new Error("Invalid transition."));
					}

					try {
						return append({ kind: event.kind, atMs: elapsed() });
					} catch (error) {
						controller.abort();
						return Promise.reject(error);
					}
				},
			}),
		);
		if (waitState.wait)
			throw new Error("Cannot evaluate while waiting for the operator.");
		accepting = false;
		await queue;
		const completion = z
			.object({ met: z.boolean(), evidence: z.unknown() })
			.strict()
			.parse(
				await bounded(() =>
					options.driver.evaluate(
						episode.completionCriteria,
						controller.signal,
					),
				),
			);
		await writeExclusive(join(options.outputDirectory, "completion.json"), {
			criteria: episode.completionCriteria,
			met: completion.met,
			evidenceDigest: datasetDigest(completion.evidence),
		});
		outcome = completion.met ? "completed" : "failed";
	} catch {
		executionFailed = reason === null;
		outcome = null;
	} finally {
		terminalAtMs = elapsed();
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", cancel);
		accepting = false;
		controller.abort();
		let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				Promise.resolve().then(() => options.driver.stop()),
				new Promise<never>((_, reject) => {
					cleanupTimer = setTimeout(
						() => reject(new Error("Stop unconfirmed.")),
						5000,
					);
				}),
			]);
			stopConfirmed = true;
		} catch {
			stopConfirmed = false;
		} finally {
			clearTimeout(cleanupTimer);
		}
		await queue.catch(() => {});
	}
	if (
		started &&
		!executionFailed &&
		stopConfirmed &&
		!persistenceFailed &&
		(reason || outcome)
	) {
		let reconciliation: ReservationReconciliation | undefined;
		let reconciliationTimer: ReturnType<typeof setTimeout> | undefined;
		const reconciliationController = new AbortController();
		try {
			if (options.driver.reconcileReservations) {
				const timeoutMs = options.driver.reconciliationTimeoutMs
					? await Promise.race([
							options.driver.reconciliationTimeoutMs(),
							new Promise<never>((_, reject) => {
								reconciliationTimer = setTimeout(
									() => reject(new Error("Reservation deadline unavailable.")),
									5000,
								);
							}),
						])
					: 5000;
				clearTimeout(reconciliationTimer);
				if (
					!Number.isSafeInteger(timeoutMs) ||
					timeoutMs < 5000 ||
					timeoutMs > 2_005_000
				)
					throw new Error("Invalid reservation reconciliation deadline.");
				const result = ReservationReconciliationSchema.parse(
					await Promise.race([
						options.driver.reconcileReservations(
							reconciliationController.signal,
						),
						new Promise<never>((_, reject) => {
							reconciliationTimer = setTimeout(() => {
								reconciliationController.abort();
								reject(new Error("Reservation reconciliation unavailable."));
							}, timeoutMs);
						}),
					]),
				);
				if (
					datasetDigest(result.scope) !== datasetDigest(reservationScope) ||
					result.authorization.origin !== options.origin
				)
					throw new Error("Reservation scope mismatch.");
				reconciliation = result;
			}
		} catch {
		} finally {
			clearTimeout(reconciliationTimer);
			reconciliationController.abort();
		}
		if (reconciliation)
			await append({
				kind: "reservation-reconciliation",
				atMs: terminalAtMs,
				reconciliation,
			});
		await append({
			kind: "terminal",
			atMs: terminalAtMs,
			outcome: reason ?? outcome ?? "failed",
		});
	}
	await writeExclusive(join(options.outputDirectory, "status.json"), {
		schemaVersion: 1,
		qualification: "inconclusive",
		started,
		stopConfirmed,
		persistenceFailed,
		reason: executionFailed
			? "execution-unavailable"
			: (reason ?? (outcome ? "criteria-evaluated" : "execution-unavailable")),
	});
	if (!started) return null;
	const draft = await recoverEpisodeJournal(
		registration,
		options.outputDirectory,
	);
	await writeExclusive(join(options.outputDirectory, "draft.json"), draft);
	return draft;
}

export async function runEpisodeJournalCommand(args: readonly string[]) {
	const [command, registrationPath, directory, output, ...extra] = args;
	if (
		command !== "episode-recover" ||
		!registrationPath ||
		!directory ||
		!output ||
		extra.length
	)
		throw new Error(
			"Expected episode-recover <registration> <journal-directory> <new-draft>.",
		);
	await writeExclusive(
		output,
		await recoverEpisodeJournal(
			JSON.parse(await readFile(registrationPath, "utf8")),
			directory,
		),
	);
	return 0;
}
