// CI-safe shape check for the golden-transcript eval lane: validates the
// scenario table and fixtures without ever invoking opencode or a model.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GOLDEN_SCENARIOS, SEEDED_SESSION_ID } from "../evals/golden/scenarios";
import { SessionSchema } from "../src/runtime/schema";

const fixturesRoot = join(import.meta.dir, "..", "evals", "golden", "fixtures");

describe("golden eval harness", () => {
	test("defines exactly five uniquely named scenarios", () => {
		expect(GOLDEN_SCENARIOS.length).toBe(5);
		const names = GOLDEN_SCENARIOS.map((scenario) => scenario.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test("every scenario has a name, fixture, prompt, summary, and assert function", () => {
		for (const scenario of GOLDEN_SCENARIOS) {
			expect(scenario.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
			expect(scenario.fixture.length).toBeGreaterThan(0);
			expect(scenario.prompt.length).toBeGreaterThan(0);
			expect(scenario.summary.length).toBeGreaterThan(0);
			expect(typeof scenario.assert).toBe("function");
		}
	});

	test("every referenced fixture exists on disk with a package.json", () => {
		for (const scenario of GOLDEN_SCENARIOS) {
			const fixtureDir = join(fixturesRoot, scenario.fixture);
			expect(existsSync(fixtureDir)).toBe(true);
			expect(statSync(fixtureDir).isDirectory()).toBe(true);
			expect(existsSync(join(fixtureDir, "package.json"))).toBe(true);
		}
	});

	test("pre-seeded .flow sessions in fixtures parse with the runtime schema", () => {
		const seededFixtures = new Set(
			GOLDEN_SCENARIOS.map((scenario) => scenario.fixture),
		);
		let seededSessions = 0;
		for (const fixture of seededFixtures) {
			const activeDir = join(fixturesRoot, fixture, ".flow", "active");
			if (!existsSync(activeDir)) {
				continue;
			}
			for (const entry of readdirSync(activeDir)) {
				const sessionPath = join(activeDir, entry, "session.json");
				expect(existsSync(sessionPath)).toBe(true);
				const session = SessionSchema.parse(
					JSON.parse(readFileSync(sessionPath, "utf8")),
				);
				expect(session.id).toBe(entry);
				seededSessions += 1;
			}
		}
		// The recovery scenario depends on exactly one seeded session.
		expect(seededSessions).toBe(1);
		expect(
			existsSync(
				join(
					fixturesRoot,
					"hello-lib-seeded",
					".flow",
					"active",
					SEEDED_SESSION_ID,
					"session.json",
				),
			),
		).toBe(true);
	});
});
