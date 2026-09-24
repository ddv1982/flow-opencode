import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeExclusive } from "../../scripts/lib/exclusive-json.js";
import { JEV_ATTEMPT_RESERVATION_USD } from "../../src/infrastructure/jev-transport.js";
import {
	Hash,
	registerCampaign,
	selectedCorpus,
	validateRegistration,
} from "./campaign.js";
import {
	type DecisionQualitySelection,
	summarizeDecisionQuality,
} from "./decision-quality.js";
import { evaluateRecoveryCorpus } from "./evaluate.js";
import { datasetDigest, digest } from "./schema.js";

const NumberMetric = z.number().finite().nonnegative();
const Probability = NumberMetric.max(1);
export const AdviceSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("unavailable"), reason: z.string().min(1) })
		.strict(),
	z
		.object({
			kind: z.literal("answered"),
			model: z.literal("jev-1.13.0"),
			choice: z.string(),
			probabilities: z.record(z.string(), Probability),
			confidence: Probability,
			assessments: z.record(
				z.string(),
				z.object({ goal: Probability, suitability: Probability }).strict(),
			),
			inputTokens: NumberMetric.int().safe(),
			outputTokens: NumberMetric.int().safe(),
			latencyMs: NumberMetric,
		})
		.strict(),
]);
const Binding = {
	caseId: z.string(),
	caseDigest: Hash,
	packetDigest: Hash.nullable(),
	latencyMs: NumberMetric.nullable(),
	reservedUsd: NumberMetric.nullable(),
};
const ManagerResult = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("selection"), candidateId: z.string().min(1) })
		.strict(),
	z.object({ kind: z.literal("abstain") }).strict(),
	z
		.object({ kind: z.literal("unavailable"), reason: z.string().min(1) })
		.strict(),
	z.object({ kind: z.literal("filtered") }).strict(),
]);
export const ImportReceiptSchema = z
	.object({
		kind: z.literal("imported-attestation"),
		declaredOrigin: z.literal("live"),
		reviewedBy: z.string().trim().min(1),
		reviewedAt: z.iso.datetime(),
		evidenceDigest: Hash,
		sourceEvidenceDigest: Hash.optional(),
		notes: z.string().trim().min(1),
	})
	.strict();
const Origin = z.union([
	z.object({ kind: z.literal("simulation") }).strict(),
	ImportReceiptSchema,
]);
export const ArmEvidenceSchema = z.discriminatedUnion("arm", [
	z
		.object({
			schemaVersion: z.literal(1),
			qualification: z.literal("inconclusive"),
			registrationDigest: Hash,
			arm: z.literal("manager-only"),
			origin: Origin,
			model: z.string(),
			promptDigest: Hash,
			observations: z.array(
				z.object({ ...Binding, result: ManagerResult }).strict(),
			),
		})
		.strict(),
	z
		.object({
			schemaVersion: z.literal(1),
			qualification: z.literal("inconclusive"),
			registrationDigest: Hash,
			arm: z.literal("manager-plus-jev"),
			origin: Origin,
			model: z.literal("jev-1.13.0"),
			observations: z.array(
				z.object({ ...Binding, advice: AdviceSchema.nullable() }).strict(),
			),
		})
		.strict(),
]);
export type ArmEvidence = z.infer<typeof ArmEvidenceSchema>;
export type Observation = ArmEvidence["observations"][number];
type Result = DecisionQualitySelection & {
	selectedCandidateId: string | null;
	kind:
		| "missing"
		| "unavailable"
		| "filtered"
		| "selected"
		| "abstained"
		| "forbidden";
	acceptableSelection: boolean;
	labelMatch: boolean | null;
	latencyMs: number | null;
	reservedUsd: number | null;
};

export async function compareCampaign(
	registrationInput: unknown,
	managerInput: unknown,
	jevInput: unknown,
) {
	const registration = await validateRegistration(registrationInput);
	const manager = ArmEvidenceSchema.parse(managerInput),
		jev = ArmEvidenceSchema.parse(jevInput);
	if (manager.arm !== "manager-only" || jev.arm !== "manager-plus-jev")
		throw new Error("Wrong comparison arms.");
	const registrationDigest = datasetDigest(registration);
	for (const evidence of [manager, jev]) {
		const { origin, ...payload } = evidence;
		if (
			origin.kind === "imported-attestation" &&
			origin.evidenceDigest !== datasetDigest(payload)
		)
			throw new Error("Arm import attestation digest mismatch.");
		if (evidence.registrationDigest !== registrationDigest)
			throw new Error("Wrong registration digest.");
		const seen = new Set<string>();
		for (const observation of evidence.observations) {
			const bound = registration.cases.find(
				(row) => row.id === observation.caseId,
			);
			if (
				!bound ||
				seen.has(observation.caseId) ||
				bound.caseDigest !== observation.caseDigest ||
				bound.packetDigest !== observation.packetDigest
			)
				throw new Error("Duplicate, unknown, or stale observation binding.");
			seen.add(observation.caseId);
		}
	}
	if (
		manager.model !== registration.config.manager.model ||
		manager.promptDigest !== registration.managerPromptDigest
	)
		throw new Error("Wrong manager configuration.");
	const corpus = selectedCorpus(registration);
	const rows: {
		caseId: string;
		primary: boolean;
		independenceGroupId: string;
		manager: Result;
		jev: Result;
	}[] = [];
	for (const entry of corpus.cases) {
		const m = manager.observations.find((row) => row.caseId === entry.id),
			j = jev.observations.find((row) => row.caseId === entry.id);
		const base = (observation: Observation | undefined): Result => ({
			kind: "missing",
			selectedCandidateId: null,
			actionClass: null,
			reviewedOutcome: null,
			acceptableSelection: false,
			labelMatch: null,
			latencyMs: observation?.latencyMs ?? null,
			reservedUsd: observation?.reservedUsd ?? null,
		});
		const managerResult = base(m),
			jevResult = base(j);
		const apply = (target: Result, selection: string) => {
			target.selectedCandidateId = selection === "abstain" ? null : selection;
			target.actionClass =
				entry.proposal.candidates.find(
					(candidate) => candidate.id === selection,
				)?.action ?? null;
			target.kind =
				selection === "abstain"
					? "abstained"
					: entry.expected.eligibleCandidateIds.includes(selection)
						? "selected"
						: "forbidden";
			target.labelMatch =
				target.kind !== "forbidden" &&
				entry.expected.acceptableSelections.includes(selection);
			target.acceptableSelection =
				target.kind === "selected" && target.labelMatch;
			target.reviewedOutcome =
				target.kind === "selected"
					? (entry.labels.candidateOutcomes?.[selection] ?? null)
					: null;
		};
		if (m) {
			if (m.result.kind === "selection") {
				if (m.result.candidateId === "abstain")
					managerResult.kind = "forbidden";
				else apply(managerResult, m.result.candidateId);
			} else if (m.result.kind === "abstain") apply(managerResult, "abstain");
			else managerResult.kind = m.result.kind;
			if (m.result.kind === "filtered" && m.packetDigest !== null)
				throw new Error(
					"Filtered manager observation has eligible candidates.",
				);
		}
		if (j) {
			if (j.advice === null) {
				if (j.packetDigest !== null)
					throw new Error("Missing Jev advice for eligible packet.");
				jevResult.kind = "filtered";
			} else {
				if (j.packetDigest === null)
					throw new Error("Advice on filtered case.");
				if (j.advice.kind === "unavailable") jevResult.kind = "unavailable";
				else {
					const advice = j.advice;
					const ids = [...entry.expected.eligibleCandidateIds, "abstain"];
					if (
						!ids.includes(advice.choice) ||
						datasetDigest(Object.keys(advice.probabilities).sort()) !==
							datasetDigest(ids.sort()) ||
						Math.abs(
							Object.values(advice.probabilities).reduce((a, b) => a + b, 0) -
								1,
						) > 1e-6 ||
						advice.probabilities[advice.choice] !==
							Math.max(...Object.values(advice.probabilities)) ||
						datasetDigest(Object.keys(advice.assessments).sort()) !==
							datasetDigest([...entry.expected.eligibleCandidateIds].sort())
					)
						throw new Error("Invalid Jev answer bindings.");
					const replay = await evaluateRecoveryCorpus(
						{ ...corpus, cases: [entry] },
						{
							async assess(_packet, options) {
								if (!options.reserveAttempt())
									throw new Error("Replay decision budget exhausted.");
								return advice;
							},
						},
					);
					const decision = z
						.object({ selectedCandidateId: z.string().nullable() })
						.parse(replay.rows[0]?.decision);
					apply(jevResult, decision.selectedCandidateId ?? "abstain");
				}
			}
		}
		rows.push({
			caseId: entry.id,
			primary: entry.labels.primary,
			independenceGroupId: entry.provenance.independenceGroupId,
			manager: managerResult,
			jev: jevResult,
		});
	}
	const summarize = (arm: "manager" | "jev") => {
		const values = rows.map((row) => row[arm]),
			observed = values.filter((row) => row.kind !== "missing");
		const latencies = values
				.flatMap((row) => (row.latencyMs === null ? [] : [row.latencyMs]))
				.sort((a, b) => a - b),
			reservations = values.flatMap((row) =>
				row.reservedUsd === null ? [] : [row.reservedUsd],
			);
		const count = (kind: Result["kind"]) =>
			values.filter((row) => row.kind === kind).length;
		return {
			scheduled: values.length,
			observed: observed.length,
			missing: count("missing"),
			unavailable: count("unavailable"),
			filtered: count("filtered"),
			selected: count("selected"),
			abstained: count("abstained"),
			forbiddenProposals: count("forbidden"),
			unacceptableSelections: values.filter(
				(row) => row.kind === "selected" && !row.labelMatch,
			).length,
			unsafeAcceptedSelections: values.filter(
				(row) => row.kind === "selected" && row.reviewedOutcome === "unsafe",
			).length,
			ineffectiveAcceptedSelections: values.filter(
				(row) =>
					row.kind === "selected" && row.reviewedOutcome === "safe-ineffective",
			).length,
			unreviewedAcceptedSelections: values.filter(
				(row) => row.kind === "selected" && row.reviewedOutcome === null,
			).length,
			acceptableSelections: values.filter((row) => row.acceptableSelection)
				.length,
			coverageDenominator: values.length,
			selectionCoverage: values.length
				? count("selected") / values.length
				: null,
			answeredCoverage: values.length
				? values.filter((row) =>
						["selected", "abstained", "forbidden"].includes(row.kind),
					).length / values.length
				: null,
			abstentionDenominator: observed.filter(
				(row) => !["unavailable", "filtered"].includes(row.kind),
			).length,
			latency: {
				samples: latencies.length,
				missing: values.length - latencies.length,
				p50: latencies.length
					? latencies[Math.ceil(latencies.length * 0.5) - 1]
					: null,
				p95: latencies.length
					? latencies[Math.ceil(latencies.length * 0.95) - 1]
					: null,
			},
			reservations: {
				samples: reservations.length,
				missing: values.length - reservations.length,
				totalUsd: reservations.reduce((a, b) => a + b, 0),
			},
		};
	};
	const primary = rows.filter((row) => row.primary);
	const paired = primary.filter(
		(row) =>
			![row.manager.kind, row.jev.kind].some((kind) =>
				["missing", "unavailable", "filtered"].includes(kind),
			),
	);
	const pairedMetric = (key: "latencyMs" | "reservedUsd") => {
		const values = paired.flatMap((row) => {
			const manager = row.manager[key],
				jev = row.jev[key];
			return manager === null || jev === null ? [] : [jev - manager];
		});
		return {
			samples: values.length,
			missing: paired.length - values.length,
			meanDelta: values.length
				? values.reduce((a, b) => a + b, 0) / values.length
				: null,
		};
	};
	const deltas = paired.map(
		(row) =>
			Number(row.jev.acceptableSelection) -
			Number(row.manager.acceptableSelection),
	);
	return {
		schemaVersion: 1,
		qualification: "inconclusive",
		registrationDigest,
		split: registration.config.split,
		evidenceDigests: {
			manager: datasetDigest(manager),
			jev: datasetDigest(jev),
		},
		origins: { manager: manager.origin, jev: jev.origin },
		assurance:
			"Imported origin and review are attestations, not authentication or proof of preregistration chronology.",
		arms: { manager: summarize("manager"), jev: summarize("jev") },
		decisionQuality: summarizeDecisionQuality(rows),
		primaryPairs: {
			scheduled: primary.length,
			complete: paired.length,
			latency: pairedMetric("latencyMs"),
			reservations: pairedMetric("reservedUsd"),
			excluded: primary
				.filter((row) => !paired.includes(row))
				.map((row) => ({
					caseId: row.caseId,
					manager: row.manager.kind,
					jev: row.jev.kind,
				})),
			acceptableSelectionDelta: deltas.length
				? deltas.reduce((a, b) => a + b, 0) / deltas.length
				: null,
		},
		rows,
	};
}
export type ComparisonReport = Awaited<ReturnType<typeof compareCampaign>>;

export async function loadCollection(directory: string) {
	const names = (await readdir(directory)).sort();
	const caseNames = names.filter((name) => /^case-\d+\.json$/.test(name));
	const attemptNames = names.filter((name) => /^attempt-\d+\.json$/.test(name));
	if (
		names.some(
			(name) =>
				(name.startsWith("case-") || name.startsWith("attempt-")) &&
				!caseNames.includes(name) &&
				!attemptNames.includes(name),
		)
	)
		throw new Error("Unknown collection receipt filename.");
	const read = async (name: string) =>
		JSON.parse(await readFile(join(directory, name), "utf8"));
	const manifest = await read("manifest.json"),
		summary = await read("summary.json");
	const cases = await Promise.all(caseNames.map(read)),
		attempts = await Promise.all(attemptNames.map(read));
	return { manifest, summary, cases, attempts, caseNames, attemptNames };
}
export async function collectionDigest(directory: string) {
	const { manifest, cases, attempts, summary } =
		await loadCollection(directory);
	return datasetDigest({ manifest, cases, attempts, summary });
}

export async function importJevEvidence(
	registrationInput: unknown,
	directory: string,
	receiptInput: unknown,
) {
	const registration = await validateRegistration(registrationInput),
		registrationDigest = datasetDigest(registration);
	const { manifest, summary, cases, attempts, caseNames, attemptNames } =
		await loadCollection(directory);
	const corpus = selectedCorpus(registration);
	const preparation = await evaluateRecoveryCorpus(corpus);
	if (
		manifest.registrationDigest !== registrationDigest ||
		summary.registrationDigest !== registrationDigest ||
		manifest.corpusDigest !== digest(corpus) ||
		summary.corpusDigest !== digest(corpus) ||
		datasetDigest(manifest.corpus) !== datasetDigest(corpus) ||
		datasetDigest(manifest.sourceDigests) !==
			datasetDigest(registration.sourceDigests) ||
		datasetDigest(manifest.preparation) !== datasetDigest(preparation) ||
		manifest.model !== registration.jev.model ||
		manifest.rubric !== registration.jev.rubric ||
		manifest.policy !== registration.jev.policy ||
		manifest.controllerMode !== "shadow" ||
		manifest.attemptReservationUsd !== JEV_ATTEMPT_RESERVATION_USD ||
		!["live", "simulation"].includes(manifest.origin) ||
		summary.origin !== manifest.origin ||
		!["complete", "incomplete", "cancelled"].includes(summary.status)
	)
		throw new Error("Collection manifest binding mismatch.");
	for (const [index, name] of caseNames.entries()) {
		if (name !== `case-${String(index + 1).padStart(6, "0")}.json`)
			throw new Error("Noncontiguous case receipts.");
		const row = cases[index];
		const bound = registration.cases[index];
		if (
			!bound ||
			row.id !== bound.id ||
			row.packetDigest !== bound.packetDigest ||
			row.origin !== manifest.origin ||
			datasetDigest(row.packet) !==
				datasetDigest(preparation.rows[index]?.packet)
		)
			throw new Error("Case receipt binding mismatch.");
		NumberMetric.int().safe().parse(row.attempts);
		NumberMetric.parse(row.reservedUsd);
	}
	for (const [index, name] of attemptNames.entries()) {
		if (name !== `attempt-${String(index + 1).padStart(6, "0")}.json`)
			throw new Error("Noncontiguous attempt receipts.");
		const row = attempts[index],
			bound = registration.cases.find((entry) => entry.id === row.caseId);
		if (
			!bound ||
			row.packetDigest !== bound.packetDigest ||
			row.origin !== manifest.origin ||
			row.calls !== index + 1 ||
			Math.abs(row.reservedUsd - (index + 1) * JEV_ATTEMPT_RESERVATION_USD) >
				1e-10 ||
			row.maxCalls !== manifest.maxCalls ||
			row.maxUsd !== manifest.maxUsd
		)
			throw new Error("Attempt receipt mismatch.");
	}
	for (const row of attempts) {
		NumberMetric.int().safe().parse(row.calls);
		NumberMetric.parse(row.reservedUsd);
	}
	for (const count of [
		summary.calls,
		summary.maxCalls,
		summary.plannedCases,
		summary.completedCases,
		summary.inputTokens,
		summary.outputTokens,
	])
		NumberMetric.int().safe().parse(count);
	NumberMetric.parse(summary.reservedUsd);
	NumberMetric.parse(summary.maxUsd);
	const total = attempts.length * JEV_ATTEMPT_RESERVATION_USD;
	if (
		!Number.isSafeInteger(manifest.maxCalls) ||
		manifest.maxCalls < 1 ||
		!Number.isFinite(manifest.maxUsd) ||
		manifest.maxUsd <= 0 ||
		attempts.length > manifest.maxCalls ||
		total > manifest.maxUsd + Number.EPSILON ||
		summary.calls !== attempts.length ||
		Math.abs(summary.reservedUsd - total) > 1e-10 ||
		summary.maxCalls !== manifest.maxCalls ||
		summary.maxUsd !== manifest.maxUsd ||
		summary.plannedCases !== corpus.cases.length ||
		summary.completedCases !== cases.length ||
		datasetDigest(summary.rows) !== datasetDigest(cases) ||
		(summary.status === "complete" && cases.length !== corpus.cases.length)
	)
		throw new Error("Collection totals mismatch.");
	for (const row of cases) {
		NumberMetric.parse(row.latencyMs);
		AdviceSchema.nullable().parse(row.advice);
		const count = attempts.filter(
			(attempt) => attempt.caseId === row.id,
		).length;
		if (
			row.attempts !== count ||
			count > 3 ||
			(row.advice?.kind === "answered" && count === 0) ||
			Math.abs(row.reservedUsd - count * JEV_ATTEMPT_RESERVATION_USD) > 1e-10
		)
			throw new Error("Case reservation mismatch.");
	}
	const evidenceDigest = datasetDigest({ manifest, cases, attempts, summary });
	const origin =
		manifest.origin === "simulation"
			? z
					.object({ kind: z.literal("simulation") })
					.strict()
					.parse(receiptInput)
			: ImportReceiptSchema.parse(receiptInput);
	if (
		origin.kind === "imported-attestation" &&
		origin.evidenceDigest !== evidenceDigest
	)
		throw new Error("Import review digest mismatch.");
	const evidence = ArmEvidenceSchema.parse({
		schemaVersion: 1,
		qualification: "inconclusive",
		registrationDigest,
		arm: "manager-plus-jev",
		origin,
		model: registration.jev.model,
		observations: cases.map((row) => {
			const bound = registration.cases.find((entry) => entry.id === row.id);
			return {
				caseId: row.id,
				caseDigest: bound?.caseDigest,
				packetDigest: row.packetDigest,
				latencyMs: row.latencyMs,
				reservedUsd: row.reservedUsd,
				advice:
					row.advice?.kind === "answered" &&
					(row.decision === null || row.rejection !== null)
						? { kind: "unavailable", reason: "controller-rejected" }
						: row.advice,
			};
		}),
	});
	if (evidence.origin.kind === "imported-attestation") {
		const { origin: _origin, ...payload } = evidence;
		evidence.origin.sourceEvidenceDigest = evidenceDigest;
		evidence.origin.evidenceDigest = datasetDigest(payload);
	}
	return { evidence, evidenceDigest };
}

export async function runCampaignCommand(args: readonly string[]) {
	const [command, ...paths] = args;
	const read = async (path: string | undefined) => {
		if (!path) throw new Error("Missing campaign path.");
		return JSON.parse(await readFile(path, "utf8"));
	};
	if (
		command === "campaign-collection-digest" &&
		paths.length === 1 &&
		paths[0]
	) {
		console.log(await collectionDigest(paths[0]));
		return 0;
	}
	const output = paths.at(-1);
	if (!output) throw new Error("Missing campaign output.");
	if (command === "campaign-register" && paths.length === 3) {
		await writeExclusive(
			output,
			await registerCampaign(await read(paths[0]), await read(paths[1])),
		);
		return 0;
	}
	if (command === "campaign-report" && paths.length === 4) {
		await writeExclusive(
			output,
			await compareCampaign(
				await read(paths[0]),
				await read(paths[1]),
				await read(paths[2]),
			),
		);
		return 0;
	}
	if (command === "campaign-import-jev" && paths.length === 4 && paths[1]) {
		const result = await importJevEvidence(
			await read(paths[0]),
			paths[1],
			await read(paths[2]),
		);
		await writeExclusive(output, result.evidence);
		return 0;
	}
	throw new Error(
		"Expected campaign-register <corpus> <config> <new-registration>, campaign-import-jev <registration> <collection-directory> <review-receipt> <new-arm>, or campaign-report <registration> <manager-arm> <jev-arm> <new-report>.",
	);
}
