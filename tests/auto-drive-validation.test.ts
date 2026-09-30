import { expect, test } from "bun:test";
import type { ValidationObservation } from "../src/domain/session.js";
import { validationContinuationOutcome } from "../src/platform/opencode/auto-drive-validation.js";
import { OUTPUT, SOURCE_A } from "./runtime-test-support.js";

const origin = {
	intent: "pass" as const,
	declaredPlatform: "linux" as const,
	assertions: ["required case"],
};
const observation: ValidationObservation = {
	id: "capture",
	featureId: "feature",
	runId: "run",
	scope: "broad",
	command: "bun test --reporter=junit --reporter-outfile=.flow/results.xml",
	sourceDigest: SOURCE_A,
	intent: "pass",
	hostPlatform: "linux",
	outputDigest: OUTPUT,
	outputComplete: true,
	exitCode: 1,
	recordedRevision: 4,
};

test.each(["failed", "skipped", "absent", "missing"] as const)(
	"a complete nonzero required gate with %s named evidence remains a failed gate",
	(status) => {
		const actual = {
			...observation,
			...(status === "missing"
				? {}
				: { observedAssertions: [{ name: "required case", status }] }),
		};
		expect(validationContinuationOutcome(origin, actual)).toBe("failed");
		expect(
			validationContinuationOutcome(origin, { ...actual, exitCode: 0 }),
		).toBe("ineligible");
	},
);

test.each([
	["source-drift", { ineligibleReason: "source-drift" }],
	["incomplete-output", { outputComplete: false }],
	["missing-exit", { exitCode: null }],
	["wrong-host", { hostPlatform: "darwin" }],
	["missing-host", { hostPlatform: undefined }],
] as const)(
	"a nonzero gate with %s cannot authorize continuation",
	(_name, gap) => {
		expect(
			validationContinuationOutcome(origin, { ...observation, ...gap }),
		).toBe("ineligible");
	},
);

test("eligible supplemental nonzero observations remain observations", () => {
	expect(
		validationContinuationOutcome(
			{ ...origin, intent: "observe", assertions: [] },
			observation,
		),
	).toBe("observed");
});
