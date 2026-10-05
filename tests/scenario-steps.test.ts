import { expect, test } from "bun:test";
import { instructionDelivery } from "../evals/provenance.js";
import {
	releaseCaseCatalogSha256,
	releaseScenarioCatalog,
} from "../evals/release-policy.js";
import {
	runScenarioStep,
	type ScenarioStep,
	scenarioStepCatalog,
	scenarioStepInstruction,
} from "../evals/scenario-steps.js";
import { SCENARIOS } from "../evals/scenarios.js";

test("ordinary user followups use prompt endpoint and preserve exact whitespace and Unicode", async () => {
	const requests: unknown[] = [];
	const host = {
		async runCommand(...args: [string, string, string, string]) {
			requests.push({ kind: "command", args });
			return "quiet" as const;
		},
		async runPrompt(...args: [string, string, string]) {
			requests.push({ kind: "prompt", args });
			return "quiet" as const;
		},
	};
	const steps: ScenarioStep[] = [
		{ command: "flow-auto", arguments: "--recovery=off Fix parser" },
		{ kind: "prompt", prompt: "  Please show the full report. 漢\n" },
	];
	for (const step of steps)
		expect(
			await runScenarioStep(host, "native-session", step, "route/model"),
		).toBe("quiet");
	expect(requests).toEqual([
		{
			kind: "command",
			args: [
				"native-session",
				"flow-auto",
				"--recovery=off Fix parser",
				"route/model",
			],
		},
		{
			kind: "prompt",
			args: [
				"native-session",
				"  Please show the full report. 漢\n",
				"route/model",
			],
		},
	]);
	const prompt = scenarioStepInstruction(
		steps[1] ?? { kind: "prompt", prompt: "missing" },
		1,
	);
	expect(prompt).toMatchObject({
		source: "user-prompt",
		text: "  Please show the full report. 漢\n",
		sequence: 1,
	});
	expect(prompt.bytes).toBe(
		Buffer.byteLength("  Please show the full report. 漢\n"),
	);
	expect(
		scenarioStepCatalog(steps[1] ?? { kind: "prompt", prompt: "missing" }),
	).toEqual({
		kind: "prompt",
		prompt: "  Please show the full report. 漢\n",
		freshSession: false,
	});
});

test("legacy command encoding and instruction delivery remain byte identical", () => {
	const command = {
		command: "flow-plan",
		arguments: "  Fix parser  ",
		freshSession: true,
	};
	expect(scenarioStepCatalog(command)).toEqual({
		command: "flow-plan",
		arguments: "  Fix parser  ",
		freshSession: true,
	});
	expect(scenarioStepInstruction(command, 0)).toEqual(
		instructionDelivery({
			source: "command",
			name: "flow-plan",
			sequence: 0,
			text: "/flow-plan   Fix parser",
		}),
	);
	expect(scenarioStepInstruction(command, 0)).not.toHaveProperty("text");
});

const baseline = {
	"9.1.0":
		"sha256:134581f969e030f4194ff48f94e6df4d2fac5ebbd3af57f66cf430a32f7f7b6c",
	"9.2.0":
		"sha256:134581f969e030f4194ff48f94e6df4d2fac5ebbd3af57f66cf430a32f7f7b6c",
	"9.3.0":
		"sha256:b0bfc9d312ced4ec67b520b8fcaa3a71f9dd653e3bbb5dbb0edeb500716a9f03",
	"9.4.0":
		"sha256:cdec46ab03ac3ba08e4434f6162fbd452665c4d13af66af523d8a991e78e66ae",
	"9.5.0":
		"sha256:cdec46ab03ac3ba08e4434f6162fbd452665c4d13af66af523d8a991e78e66ae",
	standard:
		"sha256:b0bfc9d312ced4ec67b520b8fcaa3a71f9dd653e3bbb5dbb0edeb500716a9f03",
};
for (const [version, sha256] of Object.entries(baseline))
	test(`required ${version} catalog remains frozen`, () => {
		expect(releaseCaseCatalogSha256(SCENARIOS, version)).toBe(sha256);
		expect(
			releaseScenarioCatalog(SCENARIOS, version).every((scenario) =>
				scenario.steps.every((step) => "command" in step),
			),
		).toBe(true);
	});
