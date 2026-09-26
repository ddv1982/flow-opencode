import { expect, test } from "bun:test";
import {
	EvaluationManagers,
	inspectManagerCatalog,
} from "../evals/recovery-decisions/manager-models.js";

const metadata = {
	id: "gpt-5.6-terra",
	providerID: "openai",
	status: "active",
	api: {
		id: "gpt-5.6-terra",
		npm: "@ai-sdk/openai",
		url: "https://private.invalid/secret",
	},
	headers: { authorization: "secret-token" },
	options: { apiKey: "secret-token" },
	cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
	limit: { context: 400000, input: 272000, output: 128000 },
};
const catalog = (value: unknown) =>
	`openai/other\n{}\nopenai/gpt-5.6-terra\n${JSON.stringify(value, null, 2)}\nopenai/gpt-5.6-terra-fast\n{}\n`;

test("selected managers remain exact and zero-cost OAuth metadata never authorizes inference", () => {
	expect(EvaluationManagers.map((row) => row.model)).toEqual([
		"openai/gpt-5.6-terra",
		"xai/grok-4.6",
	]);
	const report = inspectManagerCatalog(
		EvaluationManagers[0],
		catalog(metadata),
		"● OpenAI \u001b[90moauth\u001b[0m\n● xAI oauth",
	);
	expect(report.authType).toBe("oauth");
	expect(report.billing).toBe("unverified");
	expect(report.inferenceAvailability).toBe("unprobed");
	expect(report.arms).toEqual(["manager-only", "manager-plus-jev"]);
	expect(JSON.stringify(report)).not.toContain("secret");
	expect(JSON.stringify(report)).not.toContain("private.invalid");
});

test("missing aliases wrong routes inactive models and malformed metadata are rejected", () => {
	for (const input of [
		catalog(metadata).replace("openai/gpt-5.6-terra\n", "openai/gpt-5.6-sol\n"),
		catalog({ ...metadata, providerID: "other" }),
		catalog({
			...metadata,
			api: { ...metadata.api, id: "gpt-5.6-terra-fast" },
		}),
		catalog({ ...metadata, status: "deprecated" }),
		catalog({ ...metadata, cost: { ...metadata.cost, input: -1 } }),
	])
		expect(() =>
			inspectManagerCatalog(EvaluationManagers[0], input, ""),
		).toThrow();
	expect(
		inspectManagerCatalog(EvaluationManagers[0], catalog(metadata), "")
			.authType,
	).toBe("unconfirmed");
	expect(
		inspectManagerCatalog(
			EvaluationManagers[0],
			catalog(metadata),
			"● OpenAI oauth\n● OpenAI api",
		).authType,
	).toBe("unconfirmed");
});

test("xAI selection records tier presence without treating API catalog prices as OAuth billing", () => {
	const xai = {
		...metadata,
		id: "grok-4.6",
		providerID: "xai",
		api: { id: "grok-4.6", npm: "@ai-sdk/xai" },
		cost: {
			input: 2,
			output: 6,
			cache: { read: 0.5, write: 0 },
			tiers: [{ input: 4, output: 12 }],
		},
	};
	const report = inspectManagerCatalog(
		EvaluationManagers[1],
		`xai/grok-4.6\r\n${JSON.stringify(xai)}\r\n`,
		"● xAI oauth",
	);
	expect(report.catalogHasPricingTiers).toBe(true);
	expect(report.billing).toBe("unverified");
	expect(report.apiModel).toBe("grok-4.6");
});
