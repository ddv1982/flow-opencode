#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type AlignmentLabelVerdict,
	type AlignmentMappedOutcome,
	type AlignmentVetoDecision,
	type AlignmentVetoVerdict,
	JEV_ENDPOINT,
	JEV_MODEL,
	mapSameGoalResponse,
	SAME_GOAL_CONFIDENCE_MIN,
	SAME_GOAL_SCORE_MIN,
	sameGoalSystemOneBody,
	scoreAlignmentLabel,
	scoreVetoShadow,
	shadowNewScopeVeto,
} from "./jev.js";
import { parseAlignmentCorpus } from "./schema.js";
import v1 from "./v1.json" with { type: "json" };

export const DEFAULT_JEV_RESULTS_PATH = join(
	"evals",
	"results",
	"jev-alignment-v1.json",
);

export type JevFetch = (
	url: string,
	init: {
		readonly method: string;
		readonly headers: Readonly<Record<string, string>>;
		readonly body: string;
	},
) => Promise<{
	readonly ok: boolean;
	readonly status: number;
	json(): Promise<unknown>;
}>;

export type JevAlignmentCaseResult = {
	readonly id: string;
	readonly version: number;
	readonly category: string;
	readonly expectedChoice: "continue" | "new-scope";
	readonly mapped: AlignmentMappedOutcome;
	readonly verdict: AlignmentLabelVerdict;
	readonly veto: AlignmentVetoDecision;
	readonly vetoVerdict: AlignmentVetoVerdict;
	readonly score?: number;
	readonly confidence?: number;
	readonly reason?: string;
};

export type JevAlignmentReport = {
	readonly schemaVersion: 1;
	readonly corpusId: string;
	readonly corpusSchemaVersion: number;
	readonly model: typeof JEV_MODEL;
	readonly endpoint: typeof JEV_ENDPOINT;
	readonly thresholds: {
		readonly scoreMin: typeof SAME_GOAL_SCORE_MIN;
		readonly confidenceMin: typeof SAME_GOAL_CONFIDENCE_MIN;
	};
	readonly cases: readonly JevAlignmentCaseResult[];
	readonly counts: {
		readonly match: number;
		readonly mismatch: number;
		readonly unscored: number;
		readonly continue: number;
		readonly "new-scope": number;
		readonly abstain: number;
		readonly error: number;
	};
	readonly veto: {
		readonly fired: number;
		readonly correctVeto: number;
		readonly falseVeto: number;
		readonly missedVeto: number;
		readonly correctPass: number;
	};
	readonly mixedScope: JevAlignmentCaseResult | null;
};

export type RunJevAlignmentOptions = {
	readonly apiKey?: string;
	readonly fetch?: JevFetch;
	readonly resultsPath?: string;
	readonly corpus?: unknown;
};

function withVeto<
	T extends {
		readonly expectedChoice: "continue" | "new-scope";
		readonly mapped: AlignmentMappedOutcome;
	},
>(
	entry: T,
): T & {
	readonly veto: AlignmentVetoDecision;
	readonly vetoVerdict: AlignmentVetoVerdict;
} {
	const veto = shadowNewScopeVeto(entry.mapped);
	return {
		...entry,
		veto,
		vetoVerdict: scoreVetoShadow(entry.expectedChoice, veto),
	};
}

function countVeto(
	cases: readonly JevAlignmentCaseResult[],
	key: keyof JevAlignmentReport["veto"],
): number {
	if (key === "fired")
		return cases.filter((entry) => entry.veto === "veto").length;
	const verdict =
		key === "correctVeto"
			? "correct-veto"
			: key === "falseVeto"
				? "false-veto"
				: key === "missedVeto"
					? "missed-veto"
					: "correct-pass";
	return cases.filter((entry) => entry.vetoVerdict === verdict).length;
}

function count(
	cases: readonly JevAlignmentCaseResult[],
	key: keyof JevAlignmentReport["counts"],
): number {
	if (key === "match" || key === "mismatch" || key === "unscored")
		return cases.filter((entry) => entry.verdict === key).length;
	return cases.filter((entry) => entry.mapped === key).length;
}

function reportContainsSecret(
	report: JevAlignmentReport,
	apiKey: string,
): boolean {
	const serialized = JSON.stringify(report);
	return (
		serialized.includes("Bearer ") ||
		(apiKey.length > 0 && serialized.includes(apiKey))
	);
}

type JevAlignmentCaseScored = Omit<
	JevAlignmentCaseResult,
	"veto" | "vetoVerdict"
>;

async function scoreCase(input: {
	readonly id: string;
	readonly version: number;
	readonly category: string;
	readonly expectedChoice: "continue" | "new-scope";
	readonly activeGoal: string;
	readonly userRequest: string;
	readonly apiKey: string | undefined;
	readonly fetchImpl: JevFetch | undefined;
}): Promise<JevAlignmentCaseScored> {
	const base = {
		id: input.id,
		version: input.version,
		category: input.category,
		expectedChoice: input.expectedChoice,
	};
	if (!input.apiKey) {
		return {
			...base,
			mapped: "error",
			verdict: "unscored",
			reason: "missing-key",
		};
	}
	if (!input.fetchImpl) {
		return {
			...base,
			mapped: "error",
			verdict: "unscored",
			reason: "missing-fetch",
		};
	}
	try {
		const response = await input.fetchImpl(JEV_ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${input.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(
				sameGoalSystemOneBody(input.activeGoal, input.userRequest),
			),
		});
		if (!response.ok) {
			return {
				...base,
				mapped: "error",
				verdict: "unscored",
				reason: `http-${response.status}`,
			};
		}
		const payload = await response.json();
		const mapped = mapSameGoalResponse(payload);
		const answers =
			payload &&
			typeof payload === "object" &&
			"answers" in payload &&
			payload.answers &&
			typeof payload.answers === "object" &&
			"same_goal" in payload.answers &&
			payload.answers.same_goal &&
			typeof payload.answers.same_goal === "object"
				? payload.answers.same_goal
				: {};
		const score =
			"score" in answers && typeof answers.score === "number"
				? answers.score
				: undefined;
		const confidence =
			"confidence" in answers && typeof answers.confidence === "number"
				? answers.confidence
				: undefined;
		return {
			...base,
			mapped,
			verdict: scoreAlignmentLabel(input.expectedChoice, mapped),
			...(score === undefined ? {} : { score }),
			...(confidence === undefined ? {} : { confidence }),
			...(mapped === "abstain"
				? { reason: "low-confidence" }
				: mapped === "error"
					? { reason: "malformed-response" }
					: {}),
		};
	} catch {
		return {
			...base,
			mapped: "error",
			verdict: "unscored",
			reason: "transport",
		};
	}
}

export async function runJevAlignment(
	options: RunJevAlignmentOptions = {},
): Promise<{
	readonly report: JevAlignmentReport;
	readonly resultsPath: string;
}> {
	const parsed = parseAlignmentCorpus(options.corpus ?? v1);
	if (!parsed.ok) {
		throw new Error(
			`Invalid alignment corpus: ${JSON.stringify(parsed.issues)}`,
		);
	}
	const apiKey = options.apiKey;
	const fetchImpl = apiKey ? (options.fetch ?? defaultFetch) : undefined;
	const cases: JevAlignmentCaseResult[] = [];
	for (const entry of parsed.value.cases) {
		cases.push(
			withVeto(
				await scoreCase({
					id: entry.id,
					version: entry.version,
					category: entry.category,
					expectedChoice: entry.expectedChoice,
					activeGoal: entry.activeGoal,
					userRequest: entry.userRequest,
					apiKey,
					fetchImpl,
				}),
			),
		);
	}
	const report: JevAlignmentReport = {
		schemaVersion: 1,
		corpusId: parsed.value.corpusId,
		corpusSchemaVersion: parsed.value.schemaVersion,
		model: JEV_MODEL,
		endpoint: JEV_ENDPOINT,
		thresholds: {
			scoreMin: SAME_GOAL_SCORE_MIN,
			confidenceMin: SAME_GOAL_CONFIDENCE_MIN,
		},
		cases,
		counts: {
			match: count(cases, "match"),
			mismatch: count(cases, "mismatch"),
			unscored: count(cases, "unscored"),
			continue: count(cases, "continue"),
			"new-scope": count(cases, "new-scope"),
			abstain: count(cases, "abstain"),
			error: count(cases, "error"),
		},
		veto: {
			fired: countVeto(cases, "fired"),
			correctVeto: countVeto(cases, "correctVeto"),
			falseVeto: countVeto(cases, "falseVeto"),
			missedVeto: countVeto(cases, "missedVeto"),
			correctPass: countVeto(cases, "correctPass"),
		},
		mixedScope: cases.find((entry) => entry.category === "mixed-scope") ?? null,
	};
	if (apiKey && reportContainsSecret(report, apiKey)) {
		throw new Error("Jev alignment report would persist a credential.");
	}
	const resultsPath = options.resultsPath ?? DEFAULT_JEV_RESULTS_PATH;
	await mkdir(dirname(resultsPath), { recursive: true });
	await writeFile(resultsPath, `${JSON.stringify(report, null, "\t")}\n`);
	return { report, resultsPath };
}

async function defaultFetch(
	url: string,
	init: {
		readonly method: string;
		readonly headers: Readonly<Record<string, string>>;
		readonly body: string;
	},
): Promise<{
	readonly ok: boolean;
	readonly status: number;
	json(): Promise<unknown>;
}> {
	const response = await fetch(url, {
		method: init.method,
		headers: init.headers,
		body: init.body,
	});
	return {
		ok: response.ok,
		status: response.status,
		json: () => response.json() as Promise<unknown>,
	};
}

if (import.meta.main) {
	const apiKey = process.env.TYPESAFE_API_KEY;
	const { report, resultsPath } = await runJevAlignment(
		apiKey ? { apiKey } : {},
	);
	process.stdout.write(
		`${JSON.stringify(
			{
				resultsPath,
				counts: report.counts,
				veto: report.veto,
				mixedScope: report.mixedScope && {
					id: report.mixedScope.id,
					mapped: report.mixedScope.mapped,
					verdict: report.mixedScope.verdict,
				},
			},
			null,
			"\t",
		)}\n`,
	);
	if (!apiKey) process.exit(2);
}
