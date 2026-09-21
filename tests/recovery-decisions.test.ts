import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CorpusSchema,
	evaluateRecoveryCorpus,
} from "../evals/recovery-decisions/evaluate.js";
import { prepareRecoveryEvaluation } from "../evals/recovery-decisions/run.js";
import type { DecisionProvider } from "../src/application/ports/decision-provider.js";

const path = "evals/recovery-decisions/development.json";
const load = async () =>
	CorpusSchema.parse(JSON.parse(await readFile(path, "utf8")));
const certain: DecisionProvider = {
	async assess(packet, options) {
		if (!options.reserveAttempt())
			return { kind: "unavailable", reason: "budget" };
		const candidate = packet.candidates[0];
		if (!candidate) throw new Error("Missing candidate");
		return {
			kind: "answered",
			model: "jev-1.13.0",
			choice: candidate.id,
			probabilities: Object.fromEntries([
				...packet.candidates.map((c) => [c.id, c.id === candidate.id ? 1 : 0]),
				["abstain", 0],
			]),
			confidence: 1,
			assessments: Object.fromEntries(
				packet.candidates.map((c) => [c.id, { goal: 1, suitability: 1 }]),
			),
			inputTokens: 0,
			outputTokens: 0,
			latencyMs: 0,
		};
	},
};

describe("runtime recovery evaluation", () => {
	test("preparation uses runtime eligibility and does not call the network or mutate corpus", async () => {
		const corpus = await load();
		const before = JSON.stringify(corpus);
		const report = await evaluateRecoveryCorpus(corpus);
		expect(report.rows.every((row) => row.eligibilityMatches)).toBe(true);
		expect(report.rows.every((row) => row.labelMatches === null)).toBe(true);
		expect(
			report.rows.find((row) => row.id === "unmet-dependency")?.packet,
		).toBeNull();
		expect(
			report.rows.find((row) => row.id === "unknown-finding")?.packet,
		).toBeNull();
		expect(
			report.rows
				.find((row) => row.id === "mixed-candidates")
				?.packet?.candidates.map((c) => c.id),
		).toEqual(["repair"]);
		expect(JSON.stringify(corpus)).toBe(before);
	});
	test("real shadow controller applies thresholds and reports dangerous false acceptance", async () => {
		const corpus = await load();
		const high = await evaluateRecoveryCorpus(corpus, certain);
		expect(
			high.rows.find((row) => row.id === "supported-retry")?.labelMatches,
		).toBe(true);
		expect(
			high.rows.find((row) => row.id === "goal-expansion")?.labelMatches,
		).toBe(false);
		expect(high.qualification).toBe("inconclusive");
		const low = await evaluateRecoveryCorpus(corpus, {
			async assess(packet, options) {
				const advice = await certain.assess(packet, options);
				if (advice.kind !== "answered") return advice;
				return {
					...advice,
					assessments: Object.fromEntries(
						packet.candidates.map((c) => [
							c.id,
							{ goal: 1, suitability: 0.94 },
						]),
					),
				};
			},
		});
		expect(
			low.rows.find((row) => row.id === "supported-retry")?.labelMatches,
		).toBe(false);
		expect(
			low.rows.find((row) => row.id === "goal-expansion")?.labelMatches,
		).toBe(true);
	});
	test("rejects mislabeled bindings and duplicate cases", async () => {
		const corpus = await load();
		const first = corpus.cases[0];
		if (!first) throw new Error("fixture");
		expect(() =>
			CorpusSchema.parse({ ...corpus, cases: [first, first] }),
		).toThrow();
		expect(() =>
			CorpusSchema.parse({
				...corpus,
				cases: [
					{
						...first,
						expected: {
							eligibleCandidateIds: ["invented"],
							acceptableSelections: [],
						},
					},
				],
			}),
		).toThrow();
	});
	test("unavailable advice and unrelated controller failures cannot count as successful labels", async () => {
		const corpus = await load();
		const report = await evaluateRecoveryCorpus(corpus, {
			async assess() {
				return { kind: "unavailable", reason: "timeout" };
			},
		});
		expect(report.rows.every((row) => row.labelMatches === null)).toBe(true);
		const rejected = corpus.cases.find((row) => row.id === "unknown-finding");
		if (!rejected) throw new Error("fixture");
		rejected.proposal.expectedRevision++;
		const invalid = await evaluateRecoveryCorpus({
			...corpus,
			cases: [rejected],
		});
		expect(invalid.rows[0]?.eligibilityMatches).toBe(false);
	});
	test("CLI creates immutable offline report", async () => {
		const directory = await mkdtemp(join(tmpdir(), "recovery-eval-"));
		try {
			const out = join(directory, "report.json");
			expect(await prepareRecoveryEvaluation(["prepare", path, out])).toBe(0);
			const original = await readFile(out, "utf8");
			await expect(
				prepareRecoveryEvaluation(["prepare", path, out]),
			).rejects.toThrow();
			expect(await readFile(out, "utf8")).toBe(original);
			await expect(
				prepareRecoveryEvaluation(["collect", path, out]),
			).rejects.toThrow();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
