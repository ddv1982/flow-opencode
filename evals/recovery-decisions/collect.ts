import { closeSync, fsyncSync, openSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { consumePaidDispatch } from "../../scripts/paid-budget.js";
import type { DecisionProvider } from "../../src/application/ports/decision-provider.js";
import { createJevDecisionProvider } from "../../src/infrastructure/jev-decision-provider.js";
import {
	createJevBudget,
	JEV_ATTEMPT_RESERVATION_USD,
	JEV_PINNED_MODEL,
} from "../../src/infrastructure/jev-transport.js";
import { CorpusSchema, digest, evaluateRecoveryCorpus } from "./evaluate.js";

export { recoverySourceDigests } from "./sources.js";

import { selectedCorpus, validateRegistration } from "./campaign.js";
import { datasetDigest } from "./schema.js";
import { recoverySourceDigests } from "./sources.js";

type CollectionOptions = {
	corpus: unknown;
	registration?: unknown;
	outputDirectory: string;
	authorizationDirectory: string;
	apiKey: string;
	maxCalls: number;
	maxUsd: number;
	signal?: AbortSignal;
	simulation?: { kind: "simulation"; provider: DecisionProvider };
};

export async function collectRecoveryEvaluation(options: CollectionOptions) {
	const budget = createJevBudget(options.maxCalls, options.maxUsd);
	if (
		!options.apiKey.trim() ||
		!options.authorizationDirectory ||
		!options.outputDirectory
	)
		throw new Error(
			"Collection requires a key, authorization, and new output directory.",
		);
	if (options.signal?.aborted)
		throw new Error("Collection cancelled before start.");
	const sensitive = (value: unknown) => {
		const text = JSON.stringify(value);
		return (
			text.includes(options.apiKey) ||
			/Bearer\s|(?:api[_-]?key|password|secret)[\\"' ]*\s*[:=]\s*\S+/i.test(
				text,
			)
		);
	};
	if (sensitive(options.corpus)) throw new Error("Sensitive corpus refused.");
	const parsed = CorpusSchema.safeParse(options.corpus);
	if (!parsed.success) throw new Error("Invalid recovery corpus.");
	const registration =
		options.registration === undefined
			? null
			: await validateRegistration(options.registration);
	if (registration && datasetDigest(parsed.data) !== registration.corpusDigest)
		throw new Error("Registered corpus changed.");
	const corpus = registration ? selectedCorpus(registration) : parsed.data;
	const registrationDigest = registration ? datasetDigest(registration) : null;
	const preparation = await evaluateRecoveryCorpus(corpus);
	if (!preparation.rows.every((row) => row.eligibilityMatches))
		throw new Error("Corpus eligibility preflight failed.");
	const sourceDigests = await recoverySourceDigests();
	if (
		registration &&
		datasetDigest(sourceDigests) !== datasetDigest(registration.sourceDigests)
	)
		throw new Error("Registered sources changed before dispatch.");
	if (options.signal?.aborted)
		throw new Error("Collection cancelled before start.");
	await mkdir(options.outputDirectory, { mode: 0o700 });
	const origin = options.simulation ? "simulation" : "live";
	await writeExclusive(join(options.outputDirectory, "manifest.json"), {
		schemaVersion: 1,
		registrationDigest,
		origin,
		createdAt: new Date().toISOString(),
		corpusDigest: digest(corpus),
		corpus,
		preparation,
		model: JEV_PINNED_MODEL,
		rubric: "recovery-v1",
		policy: "bounded-recovery-v1",
		controllerMode: "shadow",
		qualification: "inconclusive",
		maxCalls: options.maxCalls,
		maxUsd: options.maxUsd,
		attemptReservationUsd: JEV_ATTEMPT_RESERVATION_USD,
		sourceDigestEncoding: "sha256-of-source-bytes",
		sourceDigestScope: "collection-start",
		sourceDigests,
	});
	if (options.signal?.aborted)
		throw new Error("Collection cancelled before dispatch.");
	try {
		await consumePaidDispatch(
			{ model: `typesafe/${JEV_PINNED_MODEL}`, kind: "command" },
			options.authorizationDirectory,
		);
	} catch {
		throw new Error("Paid dispatch authorization refused.");
	}
	const provider =
		options.simulation?.provider ??
		createJevDecisionProvider(() => options.apiKey);
	const rows = [];
	let fatal = false;
	let status: "complete" | "cancelled" | "incomplete" = "complete";
	try {
		for (const [index, entry] of corpus.cases.entries()) {
			if (options.signal?.aborted) {
				status = "cancelled";
				break;
			}
			const before = budget.snapshot();
			const started = performance.now();
			const report = await evaluateRecoveryCorpus(
				{ ...corpus, cases: [entry] },
				{
					async assess(packet, controllerOptions) {
						if (digest(packet) !== preparation.rows[index]?.packetDigest) {
							fatal = true;
							return { kind: "unavailable", reason: "packet-mismatch" };
						}
						const signal = options.signal
							? AbortSignal.any([options.signal, controllerOptions.signal])
							: controllerOptions.signal;
						try {
							const advice = await provider.assess(packet, {
								signal,
								reserveAttempt() {
									if (
										fatal ||
										signal.aborted ||
										!controllerOptions.reserveAttempt() ||
										!budget.reserve()
									)
										return false;
									const reserved = budget.snapshot();
									try {
										const path = join(
											options.outputDirectory,
											`attempt-${String(reserved.calls).padStart(6, "0")}.json`,
										);
										const fd = openSync(path, "wx", 0o600);
										try {
											writeFileSync(
												fd,
												`${JSON.stringify({ schemaVersion: 1, origin, caseId: entry.id, packetDigest: digest(packet), at: new Date().toISOString(), ...reserved })}\n`,
											);
											fsyncSync(fd);
										} finally {
											closeSync(fd);
										}
										if (process.platform !== "win32") {
											const directory = openSync(options.outputDirectory, "r");
											try {
												fsyncSync(directory);
											} finally {
												closeSync(directory);
											}
										}
										return true;
									} catch {
										fatal = true;
										return false;
									}
								},
							});
							if (sensitive(advice)) {
								fatal = true;
								return { kind: "unavailable", reason: "sensitive-response" };
							}
							return advice;
						} catch {
							fatal = true;
							return { kind: "unavailable", reason: "provider-error" };
						}
					},
				},
			);
			const row = report.rows[0];
			if (!row) throw new Error("Missing collection result.");
			const after = budget.snapshot();
			const receipt = {
				...row,
				schemaVersion: 1,
				origin,
				latencyMs: performance.now() - started,
				attempts: after.calls - before.calls,
				reservedUsd: after.reservedUsd - before.reservedUsd,
			};
			if (sensitive(receipt)) throw new Error("Sensitive result refused.");
			await writeExclusive(
				join(
					options.outputDirectory,
					`case-${String(index + 1).padStart(6, "0")}.json`,
				),
				receipt,
			);
			rows.push(receipt);
			if (fatal) {
				status = "incomplete";
				break;
			}
		}
	} catch {
		status = "incomplete";
	}
	if (options.signal?.aborted) status = "cancelled";
	if (
		status === "complete" &&
		rows.some(
			(row) =>
				!row.eligibilityMatches ||
				(row.packet !== null && row.advice?.kind !== "answered"),
		)
	)
		status = "incomplete";
	const summary = {
		schemaVersion: 1,
		registrationDigest,
		origin,
		status,
		qualification: "inconclusive",
		purpose: corpus.purpose,
		labelStatus: corpus.labelStatus,
		corpusDigest: digest(corpus),
		plannedCases: corpus.cases.length,
		completedCases: rows.length,
		...budget.snapshot(),
		reservationAccounting: "conservative-reservations-not-invoice",
		usageScope: "answered-responses-only",
		inputTokens: rows.reduce(
			(total, row) =>
				total + (row.advice?.kind === "answered" ? row.advice.inputTokens : 0),
			0,
		),
		outputTokens: rows.reduce(
			(total, row) =>
				total + (row.advice?.kind === "answered" ? row.advice.outputTokens : 0),
			0,
		),
		rows,
	};
	await writeExclusive(join(options.outputDirectory, "summary.json"), summary);
	return summary;
}
