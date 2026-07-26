import { describe, expect, test } from "bun:test";
import { splitModel } from "../evals/harness.js";

// The eval harness itself needs credentials, but model-id parsing is pure and a
// mistake in it silently addresses the wrong model, so it is proven here.
describe("eval model ids", () => {
	test.each([
		["openai/gpt-5.6-sol", "openai", "gpt-5.6-sol"],
		["anthropic/claude-opus-5", "anthropic", "claude-opus-5"],
		["opencode/gpt-5.6-sol", "opencode", "gpt-5.6-sol"],
		// A gateway provider's model id carries slashes of its own. Splitting on the
		// last slash would ask `openrouter` for provider `openrouter/openai`.
		["openrouter/openai/gpt-5.6-sol", "openrouter", "openai/gpt-5.6-sol"],
		[
			"google-vertex/claude-opus-5@default",
			"google-vertex",
			"claude-opus-5@default",
		],
	])("splits %s", (model, providerID, modelID) => {
		expect(splitModel(model)).toEqual({ providerID, modelID });
	});

	test.each(["gpt-5.6-sol", "", "/gpt-5.6-sol", "openai/"])(
		"rejects %p, which is not providerID/modelID",
		(model) => {
			expect(() => splitModel(model)).toThrow(/providerID\/modelID/);
		},
	);
});
