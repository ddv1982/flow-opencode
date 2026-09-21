import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type JevFetch,
	runJevAlignment,
} from "../evals/alignment-corpus/jev-run.js";
import v1 from "../evals/alignment-corpus/v1.json" with { type: "json" };

const SECRET = "test-typesafe-key";

function scorePayload(score: number, confidence: number) {
	return {
		answers: {
			same_goal: {
				type: "score",
				score,
				confidence,
			},
		},
	};
}

async function withResults(
	run: (resultsPath: string) => Promise<void>,
): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "jev-alignment-"));
	try {
		await run(join(directory, "report.json"));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

describe("jev alignment runner", () => {
	test("missing key does not fetch and records error, not continue", async () => {
		let calls = 0;
		const fakeFetch: JevFetch = async () => {
			calls += 1;
			throw new Error("should not fetch");
		};
		await withResults(async (resultsPath) => {
			const { report } = await runJevAlignment({
				fetch: fakeFetch,
				resultsPath,
			});
			expect(calls).toBe(0);
			expect(report.counts.error).toBe(v1.cases.length);
			expect(report.veto.fired).toBe(0);
			expect(report.veto.falseVeto).toBe(0);
			expect(report.veto.missedVeto).toBe(
				v1.cases.filter((entry) => entry.expectedChoice === "new-scope").length,
			);
			expect(report.counts.continue).toBe(0);
			expect(
				report.cases.every((entry) => entry.reason === "missing-key"),
			).toBe(true);
			expect(report.mixedScope?.verdict).toBe("unscored");
		});
	});

	test("sends authorization to fetch but omits it from the report", async () => {
		const headers: string[] = [];
		const fakeFetch: JevFetch = async (_url, init) => {
			headers.push(init.headers.Authorization ?? "");
			expect(init.method).toBe("POST");
			return {
				ok: true,
				status: 200,
				json: async () => scorePayload(1, 0.9),
			};
		};
		await withResults(async (resultsPath) => {
			const { report } = await runJevAlignment({
				apiKey: SECRET,
				fetch: fakeFetch,
				resultsPath,
			});
			expect(headers).toEqual(
				Array.from({ length: v1.cases.length }, () => `Bearer ${SECRET}`),
			);
			const written = await readFile(resultsPath, "utf8");
			expect(written).not.toContain(SECRET);
			expect(written).not.toContain("Bearer ");
			expect(JSON.stringify(report)).not.toContain(SECRET);
			expect(report.counts["new-scope"]).toBe(v1.cases.length);
			expect(report.veto.fired).toBe(v1.cases.length);
			expect(report.veto.correctVeto).toBe(
				v1.cases.filter((entry) => entry.expectedChoice === "new-scope").length,
			);
			expect(report.veto.falseVeto).toBe(
				v1.cases.filter((entry) => entry.expectedChoice === "continue").length,
			);
			expect(report.mixedScope?.mapped).toBe("new-scope");
			expect(report.mixedScope?.veto).toBe("veto");
			expect(report.mixedScope?.vetoVerdict).toBe("correct-veto");
			expect(report.mixedScope?.verdict).toBe("match");
		});
	});

	test("retains http, transport, and abstain outcomes", async () => {
		const fakeFetch: JevFetch = async (_url, init) => {
			const body = JSON.parse(init.body) as { state: string };
			if (body.state.includes("dark mode")) {
				return { ok: false, status: 503, json: async () => ({}) };
			}
			if (body.state.includes("Implement the Jev SDK")) {
				throw new Error("socket");
			}
			if (body.state.includes("Looks good, approve")) {
				return {
					ok: true,
					status: 200,
					json: async () => scorePayload(2, 0.5),
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({ answers: { same_goal: { type: "noul" } } }),
			};
		};
		await withResults(async (resultsPath) => {
			const { report } = await runJevAlignment({
				apiKey: SECRET,
				fetch: fakeFetch,
				resultsPath,
			});
			const byId = Object.fromEntries(
				report.cases.map((entry) => [entry.id, entry]),
			);
			expect(byId["keep-plan-and-add-tui"]?.reason).toBe("http-503");
			expect(byId["keep-plan-and-add-tui"]?.mapped).toBe("error");
			expect(byId["inspect-vs-implement"]?.reason).toBe("transport");
			expect(byId["approve-same-plan"]?.mapped).toBe("abstain");
			expect(byId["approve-same-plan"]?.reason).toBe("low-confidence");
			expect(byId["compatible-narrowing"]?.mapped).toBe("error");
			expect(report.counts.continue).toBe(0);
			expect(report.veto.fired).toBe(0);
			expect(report.counts.unscored).toBe(v1.cases.length);
		});
	});
});

test("v2 alignment report preserves v1 scoring with complete pinned metadata", async () => {
	await withResults(async (resultsPath) => {
		const { report } = await runJevAlignment({
			apiKey: SECRET,
			resultsPath,
			fetch: async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					model: "jev-1.13.0",
					usage: { input_tokens: 100, output_tokens: 20 },
					answers: {
						same_goal: {
							type: "score",
							score: 2,
							confidence: 0.9,
							probabilities: { "0": 0.01, "1": 0.04, "2": 0.95 },
						},
					},
				}),
			}),
		});
		expect(report.schemaVersion).toBe(2);
		expect(report.rubricVersion).toBe("same-goal-v1");
		expect(report.counts.continue).toBe(8);
		expect(report.cases[0]).toMatchObject({
			requestedModel: "jev-1.13.0",
			resolvedModel: "jev-1.13.0",
			metadataStatus: "validated",
			origin: "simulation",
			inputTokens: 100,
			outputTokens: 20,
			probabilities: { "0": 0.01, "1": 0.04, "2": 0.95 },
		});
	});
});

test("legacy score-only responses never fabricate resolved-model metadata", async () => {
	await withResults(async (resultsPath) => {
		const { report } = await runJevAlignment({
			apiKey: SECRET,
			resultsPath,
			fetch: async () => ({
				ok: true,
				status: 200,
				json: async () => scorePayload(2, 0.9),
			}),
		});
		expect(report.cases[0]).toMatchObject({
			mapped: "continue",
			metadataStatus: "unavailable",
			resolvedModel: null,
			probabilities: null,
			inputTokens: null,
			outputTokens: null,
		});
	});
});
