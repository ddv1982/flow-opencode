import { describe, expect, test } from "bun:test";
import {
	DEFAULT_EVAL_MODELS,
	defaultEvalMatrixForCi,
	modelsCoveredByEnv,
	parseEvalModelList,
} from "../evals/default-models.js";
import { providers } from "../scripts/qualify-release.js";

describe("default eval matrix", () => {
	test("names Sol, Sonnet 5, and Grok 4.5 on three providers", () => {
		expect([...DEFAULT_EVAL_MODELS]).toEqual([
			"openai/gpt-5.6-sol",
			"opencode/claude-sonnet-5",
			"xai/grok-4.5",
		]);
		expect(providers(DEFAULT_EVAL_MODELS)).toEqual([
			"openai",
			"opencode",
			"xai",
		]);
	});

	test("keeps only models whose provider credential is in the environment", () => {
		expect(
			modelsCoveredByEnv(DEFAULT_EVAL_MODELS, {
				OPENAI_API_KEY: "sk-test",
				XAI_API_KEY: "xai-test",
			}),
		).toEqual(["openai/gpt-5.6-sol", "xai/grok-4.5"]);
	});

	test("withholds the CI default until two providers are covered", () => {
		expect(defaultEvalMatrixForCi({ OPENAI_API_KEY: "sk-test" })).toEqual([]);
		expect(
			defaultEvalMatrixForCi({
				OPENAI_API_KEY: "sk-test",
				OPENCODE_API_KEY: "oc-test",
			}),
		).toEqual(["openai/gpt-5.6-sol", "opencode/claude-sonnet-5"]);
	});

	test("splits a comma-separated override", () => {
		expect(parseEvalModelList(" openai/gpt-5.6-sol, xai/grok-4.5 ")).toEqual([
			"openai/gpt-5.6-sol",
			"xai/grok-4.5",
		]);
	});
});
