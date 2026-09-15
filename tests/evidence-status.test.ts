import { describe, expect, test } from "bun:test";
import type {
	EvidenceEntry,
	Session,
	ValidationObservation,
} from "../src/domain/session.js";
import {
	type EvidenceStatus,
	evidenceRefusal,
	evidenceStatus,
	unsatisfiedEvidence,
} from "../src/domain/validation.js";
import { OUTPUT, SOURCE_A } from "./runtime-test-support.js";

const GATE = "bun test --reporter=junit --reporter-outfile=.flow/results.xml";

const entry: EvidenceEntry = {
	requirement: "Repository suite",
	environment: "linux CI",
	command: GATE,
	scope: "gate",
	platform: "linux",
	assertions: ["suite > passes"],
};

function observation(
	overrides: Partial<ValidationObservation>,
): ValidationObservation {
	return {
		id: "capture-1",
		featureId: "feature",
		runId: "run-1",
		scope: "broad",
		command: GATE,
		sourceDigest: SOURCE_A,
		exitCode: 0,
		outputDigest: OUTPUT,
		outputComplete: true,
		recordedRevision: 3,
		hostPlatform: "linux",
		resultsPath: ".flow/results.xml",
		observedAssertions: [{ name: "suite > passes", status: "passed" }],
		...overrides,
	};
}

function session(observations: ValidationObservation[]): Session {
	return {
		version: 5,
		id: "session",
		revision: 4,
		goal: "goal",
		approval: "approved",
		plan: {
			summary: "s",
			overview: "o",
			requirements: [],
			decisions: [],
			features: [
				{
					id: "feature",
					title: "t",
					summary: "s",
					targets: [],
					validation: [],
					dependsOn: [],
				},
			],
			evidence: [entry],
		},
		runs: [
			{
				id: "run-1",
				featureId: "feature",
				attempt: 1,
				state: "active",
				startedRevision: 2,
				summary: null,
				artifactsChanged: [],
				validations: observations,
				reviews: [],
			},
		],
		operations: [],
		closure: null,
	};
}

describe("evidenceStatus", () => {
	test("is satisfied by a passing observation on the declared host with the declared cases", () => {
		const s = session([observation({})]);
		expect(evidenceStatus(s, entry, SOURCE_A)).toEqual({
			kind: "satisfied",
		} satisfies EvidenceStatus);
		expect(unsatisfiedEvidence(s, SOURCE_A)).toEqual([]);
	});

	test("is missing when nothing ran the command", () => {
		const s = session([]);
		expect(evidenceStatus(s, entry, SOURCE_A)).toEqual({ kind: "missing" });
		expect(unsatisfiedEvidence(s, SOURCE_A)).toEqual([entry]);
		expect(evidenceRefusal(s, entry, SOURCE_A)).toContain(
			"needs linux CI on linux",
		);
	});

	test("names the wrong host when the pass ran elsewhere", () => {
		const s = session([observation({ hostPlatform: "darwin" })]);
		expect(evidenceStatus(s, entry, SOURCE_A)).toEqual({
			kind: "wrong-host",
			hosts: ["darwin"],
		});
		expect(evidenceRefusal(s, entry, SOURCE_A)).toContain("passed on darwin");
	});

	test("names the unmet cases when the report skipped them", () => {
		const s = session([
			observation({
				observedAssertions: [{ name: "suite > passes", status: "skipped" }],
			}),
		]);
		// `unmetAssertions` reports the quoted name plus the status it saw.
		expect(evidenceStatus(s, entry, SOURCE_A)).toEqual({
			kind: "unmet-cases",
			cases: ['"suite > passes" skipped'],
		});
		expect(evidenceRefusal(s, entry, SOURCE_A)).toContain(
			'reported no passing result for "suite > passes" skipped',
		);
	});
});
