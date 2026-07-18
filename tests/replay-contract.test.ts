import { describe, expect, test } from "bun:test";
import {
	canonicalReplayJson,
	parseReplayFixture,
	REPLAY_IDENTIFIER_SCHEMAS,
	REPLAY_SCENARIO_IDS,
	type ReplayFixture,
	type ReplayScenario,
	ReplayScenarioSchema,
	UnsignedAvailabilitySchema,
	validateReplayFixturePrivacy,
} from "../src/application/replay/index.js";

const digest = "a".repeat(64);
const terminalDigest = "b".repeat(64);

function scenario(
	id: (typeof REPLAY_SCENARIO_IDS)[number],
	index: number,
): ReplayScenario {
	return {
		id,
		sessionId: `session_${index}`,
		initialStateDigest: digest,
		controlDefects: [],
		events: [
			{
				kind: "session_state",
				seq: 0,
				atMs: 0,
				source: "flow_ledger",
				sessionId: `session_${index}`,
				revision: 1,
				sessionStatus: "running",
				featureStatus: "in_progress",
				stateDigest: digest,
			},
			{
				kind: "terminal_decision",
				seq: 1,
				atMs: 1,
				source: "replay_derived",
				decision: "blocked",
				reason: "review_failed",
				revision: 1,
				stateDigest: terminalDigest,
				evidenceRefs: [],
			},
		],
	};
}

function fixture(): ReplayFixture {
	return {
		version: 1,
		fixtureId: "fixture_1",
		sourceFingerprint: digest,
		sources: [{ category: "host_metadata", fingerprint: digest }],
		hostFacts: [
			{
				metric: "declared_worker_count",
				availability: { status: "available", value: 0 },
			},
		],
		flowLedgerClaims: [],
		suppliedObservations: [],
		replayDerivedFacts: [],
		scenarios: REPLAY_SCENARIO_IDS.map(scenario),
	};
}

describe("sanitized replay contract", () => {
	test("canonicalizes object keys deterministically", () => {
		expect(canonicalReplayJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
			'{"a":{"b":3,"y":2},"z":1}',
		);
		expect(canonicalReplayJson({ a: { b: 3, y: 2 }, z: 1 })).toBe(
			canonicalReplayJson({ z: 1, a: { y: 2, b: 3 } }),
		);
	});

	test("orders distinct Unicode keys by a locale-independent total order", () => {
		// Precomposed é and decomposed e + combining acute compare equal under
		// `localeCompare` in ICU locales, which would leave key order dependent on
		// insertion order. A total code-unit order must place them deterministically.
		const precomposed = "\u00e9";
		const decomposed = "e\u0301";
		expect(precomposed.localeCompare(decomposed)).toBe(0);
		expect(precomposed).not.toBe(decomposed);

		const forward = canonicalReplayJson({
			[precomposed]: 1,
			[decomposed]: 2,
		});
		const reversed = canonicalReplayJson({
			[decomposed]: 2,
			[precomposed]: 1,
		});
		expect(forward).toBe(reversed);
		// Both distinct keys survive; neither is collapsed nor dropped.
		expect(forward).toContain(JSON.stringify(precomposed));
		expect(forward).toContain(JSON.stringify(decomposed));
		// The decomposed sequence begins with U+0065, ordering before U+00E9.
		expect(forward).toBe(
			`{${JSON.stringify(decomposed)}:2,${JSON.stringify(precomposed)}:1}`,
		);

		// Full-width and ASCII digits are distinct and both preserved.
		const wide = canonicalReplayJson({ "\uff10": 1, "0": 2 });
		expect(wide).toBe('{"0":2,"\uff10":1}');
	});

	test("rejects strict extra keys", () => {
		const raw = { ...fixture(), extra: "not_allowed" };
		expect(() => parseReplayFixture(raw)).toThrow();
	});

	test("rejects arbitrary one-token payloads in every identifier class", () => {
		const adversarial = [
			"continue",
			"whoami",
			"makefile",
			"production",
			"hello",
			"hunter2",
			"because",
			"vulnerable",
			"success",
		];
		const canonical = {
			fixture: "fixture_1",
			session: "session_1",
			operation: "operation_1",
			worker: "worker_1",
			attempt: "attempt_1",
			logicalPass: "pass_1",
			snapshot: "snapshot_1",
			evidence: "evidence_1",
			mutation: "mutation_1",
		} as const;
		for (const [kind, schema] of Object.entries(REPLAY_IDENTIFIER_SCHEMAS)) {
			for (const value of adversarial) {
				expect(schema.safeParse(value).success).toBe(false);
			}
			expect(
				schema.safeParse(canonical[kind as keyof typeof canonical]).success,
			).toBe(true);
		}
		expect(() =>
			parseReplayFixture({ ...fixture(), fixtureId: "whoami" }),
		).toThrow();
	});

	test("rejects private payload fields and secret or absolute-path values", () => {
		for (const value of [
			{ prompt: "canary" },
			{ nested: { command: "test" } },
			{ nested: { path: "/workspace/private" } },
			{ nested: { value: "sk-abcdefghijklmnop" } },
			{ nested: { rawOutput: "canary" } },
			{ nested: { transcript: "canary" } },
		]) {
			const validation = validateReplayFixturePrivacy(value);
			expect(validation.safe).toBe(false);
			expect(() => parseReplayFixture(value)).toThrow(/privacy/i);
		}
	});

	test("distinguishes unavailable telemetry from numeric zero", () => {
		expect(
			UnsignedAvailabilitySchema.parse({
				status: "unavailable",
				reason: "provider_unavailable",
			}),
		).toEqual({
			status: "unavailable",
			reason: "provider_unavailable",
		});
		expect(
			UnsignedAvailabilitySchema.parse({ status: "available", value: 0 }),
		).toEqual({ status: "available", value: 0 });
		expect(() =>
			UnsignedAvailabilitySchema.parse({
				status: "unavailable",
				value: 0,
				reason: "not_recorded",
			}),
		).toThrow();
		expect(
			validateReplayFixturePrivacy({
				inputTokenCount: { status: "available", value: 0 },
				cacheReadTokenCount: {
					status: "unavailable",
					reason: "provider_unavailable",
				},
				promptCharacterCount: { status: "available", value: 0 },
			}).safe,
		).toBe(true);
	});

	test("accepts all nine scenarios once and rejects reordered or duplicate seq", () => {
		expect(parseReplayFixture(fixture()).scenarios).toHaveLength(9);
		const valid = scenario(REPLAY_SCENARIO_IDS[0], 0);
		const reversed = { ...valid, events: [...valid.events].reverse() };
		expect(ReplayScenarioSchema.safeParse(reversed).success).toBe(false);
		const duplicate = {
			...valid,
			events: valid.events.map((event) => ({ ...event, seq: 0 })),
		};
		expect(ReplayScenarioSchema.safeParse(duplicate).success).toBe(false);
	});
});
