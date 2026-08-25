import type { Outcome } from "./harness.js";

export type BenchmarkMode = "flow" | "ordinary";

export type BenchmarkGrade = {
	readonly passed: boolean;
	readonly issues: readonly string[];
};

export type BenchmarkContaminationNotes = {
	readonly schemaVersion: 1;
	readonly public: readonly string[];
	readonly withheld: readonly string[];
};

export type BenchmarkKnownBadMutation = {
	readonly id: string;
	readonly fileOverrides: Readonly<Record<string, string>>;
};

export type BenchmarkOracleMetadata = {
	readonly schemaVersion: 1;
	readonly contamination: BenchmarkContaminationNotes;
	readonly knownBadMutations: readonly BenchmarkKnownBadMutation[];
};

/** One task whose result can be graded without trusting model-written tests. */
export type BenchmarkCase = {
	readonly id: string;
	readonly description: string;
	readonly files: Readonly<Record<string, string>>;
	readonly prompt: string;
	readonly oracle: BenchmarkOracleMetadata;
	readonly grade: (project: string) => Promise<BenchmarkGrade>;
};

export type BenchmarkResult = {
	readonly case: string;
	readonly model: string;
	readonly attempt: number;
	readonly mode: BenchmarkMode;
	readonly passed: boolean;
	readonly claimedComplete: boolean;
	readonly falseCompletion: boolean;
	readonly issues: readonly string[];
	readonly tokens: Outcome["tokens"];
	readonly costUsd: number | null;
	readonly assistantMessages: number;
	readonly durationMs: number;
	readonly finalText: string;
	readonly hostError: string | null;
	readonly environment?: boolean;
	readonly error?: string;
};

export type BenchmarkModeSummary = {
	readonly attempts: number;
	readonly scored: number;
	readonly passed: number;
	readonly correctnessRate: number | null;
	readonly completionClaims: number;
	readonly falseCompletions: number;
	readonly falseCompletionRate: number | null;
	readonly aborted: number;
	readonly environment: number;
	readonly assistantMessages: number;
	readonly durationMs: number;
	readonly tokens: Outcome["tokens"];
	readonly costUsd: number | null;
	readonly pricedAttempts: number;
};

export type BenchmarkSummary = {
	readonly byMode: Readonly<Record<BenchmarkMode, BenchmarkModeSummary>>;
	/** Flow minus ordinary. Positive correctness and negative false completion are improvements. */
	readonly delta: {
		readonly correctnessRate: number | null;
		readonly falseCompletionRate: number | null;
		readonly assistantMessagesPerAttempt: number | null;
		readonly durationMsPerAttempt: number | null;
		readonly outputTokensPerAttempt: number | null;
		readonly costUsdPerAttempt: number | null;
	};
};

/** Stable FNV-1a seed so a named run can reproduce its arm ordering. */
function seedNumber(seed: string): number {
	let value = 0x811c9dc5;
	for (const character of seed) {
		value ^= character.codePointAt(0) ?? 0;
		value = Math.imul(value, 0x01000193);
	}
	return value >>> 0;
}

/** Deterministic Fisher-Yates shuffle; does not mutate the caller's list. */
export function seededShuffle<T>(values: readonly T[], seed: string): T[] {
	const shuffled = [...values];
	let state = seedNumber(seed) || 0x6d2b79f5;
	const random = () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const target = Math.floor(random() * (index + 1));
		[shuffled[index], shuffled[target]] = [
			shuffled[target] as T,
			shuffled[index] as T,
		];
	}
	return shuffled;
}

function summarizeMode(
	results: readonly BenchmarkResult[],
	mode: BenchmarkMode,
): BenchmarkModeSummary {
	const attempts = results.filter((result) => result.mode === mode);
	const scored = attempts.filter(
		(result) => !result.environment && result.error === undefined,
	);
	const claims = scored.filter((result) => result.claimedComplete);
	const costs = scored.flatMap((result) =>
		result.costUsd === null ? [] : [result.costUsd],
	);
	const tokens = scored.reduce(
		(total, result) => ({
			input: total.input + result.tokens.input,
			output: total.output + result.tokens.output,
			reasoning: total.reasoning + result.tokens.reasoning,
			cacheRead: total.cacheRead + result.tokens.cacheRead,
			cacheWrite: total.cacheWrite + result.tokens.cacheWrite,
		}),
		{ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
	);
	const passed = scored.filter((result) => result.passed).length;
	const falseCompletions = claims.filter(
		(result) => result.falseCompletion,
	).length;
	return {
		attempts: attempts.length,
		scored: scored.length,
		passed,
		correctnessRate: scored.length === 0 ? null : passed / scored.length,
		completionClaims: claims.length,
		falseCompletions,
		falseCompletionRate:
			claims.length === 0 ? null : falseCompletions / claims.length,
		aborted: attempts.filter(
			(result) => !result.environment && result.error !== undefined,
		).length,
		environment: attempts.filter((result) => result.environment).length,
		assistantMessages: scored.reduce(
			(total, result) => total + result.assistantMessages,
			0,
		),
		durationMs: scored.reduce((total, result) => total + result.durationMs, 0),
		tokens,
		costUsd:
			costs.length === 0
				? null
				: costs.reduce((total, cost) => total + cost, 0),
		pricedAttempts: costs.length,
	};
}

function subtract(left: number | null, right: number | null): number | null {
	return left === null || right === null ? null : left - right;
}

function perAttempt(total: number, attempts: number): number | null {
	return attempts === 0 ? null : total / attempts;
}

/** Summarizes both arms and reports Flow-minus-control deltas. */
export function summarizeBenchmark(
	results: readonly BenchmarkResult[],
): BenchmarkSummary {
	const flow = summarizeMode(results, "flow");
	const ordinary = summarizeMode(results, "ordinary");
	return {
		byMode: { flow, ordinary },
		delta: {
			correctnessRate: subtract(flow.correctnessRate, ordinary.correctnessRate),
			falseCompletionRate: subtract(
				flow.falseCompletionRate,
				ordinary.falseCompletionRate,
			),
			assistantMessagesPerAttempt: subtract(
				perAttempt(flow.assistantMessages, flow.scored),
				perAttempt(ordinary.assistantMessages, ordinary.scored),
			),
			durationMsPerAttempt: subtract(
				perAttempt(flow.durationMs, flow.scored),
				perAttempt(ordinary.durationMs, ordinary.scored),
			),
			outputTokensPerAttempt: subtract(
				perAttempt(flow.tokens.output, flow.scored),
				perAttempt(ordinary.tokens.output, ordinary.scored),
			),
			costUsdPerAttempt: subtract(
				flow.pricedAttempts === flow.scored
					? perAttempt(flow.costUsd ?? 0, flow.scored)
					: null,
				ordinary.pricedAttempts === ordinary.scored
					? perAttempt(ordinary.costUsd ?? 0, ordinary.scored)
					: null,
			),
		},
	};
}
