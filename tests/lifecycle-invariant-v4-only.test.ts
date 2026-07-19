import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditSessionV4OnlyState } from "./support/lifecycle-v4-absence.js";

describe("S4-V4-ONLY-01 repository absence gate", () => {
	test("rejects Session-version-specific active code, tests, fixtures, and guidance", async () => {
		const violations = await auditSessionV4OnlyState();
		expect(violations).toEqual([]);
	});

	test("detects representative code, symbol, path, and root-guidance regressions", async () => {
		const repository = await mkdtemp(join(tmpdir(), "flow-version-absence-"));
		try {
			const lifecycleToolNames = [
				["flow", "status"].join("_"),
				["flow", "review", "start"].join("_"),
				["flow", "feature", "complete"].join("_"),
				["flow", "session", "close"].join("_"),
			] as const;
			const flatLifecycleExamples = lifecycleToolNames.flatMap(
				(tool, index) => {
					const field = ["view", "reviewKind", "expectedSnapshotId", "mode"][
						index
					];
					if (!field) throw new Error(`Missing field for ${tool}.`);
					return [
						`${tool} { ${field}: "legacy" }`,
						`${tool}({ "${field}": "legacy" })`,
					];
				},
			);
			const multilineFlatLifecycleExamples = lifecycleToolNames.flatMap(
				(tool, index) => {
					const field = ["view", "reviewKind", "expectedSnapshotId", "mode"][
						index
					];
					if (!field) throw new Error(`Missing field for ${tool}.`);
					return [
						`${tool} {\n  ${field}: "legacy"\n}`,
						`${tool}(\n{\n  "${field}": "legacy"\n})`,
					];
				},
			);
			const nestedLifecycleExamples = lifecycleToolNames.flatMap((tool) => [
				`${tool} { request: { mode: "nested" } }`,
				`${tool}(\n{\n  "request": { "mode": "nested" }\n})`,
			]);
			await mkdir(join(repository, "src"), { recursive: true });
			await mkdir(join(repository, "docs", "plan"), { recursive: true });
			const fixtureDirectory = join(
				repository,
				"tests",
				"fixtures",
				`session-v${3}`,
			);
			await mkdir(fixtureDirectory, { recursive: true });
			await writeFile(
				join(repository, "README.md"),
				`Active guidance preserves Session v${3}.\n`,
			);
			await writeFile(
				join(repository, "src", "reader.ts"),
				[
					`if (raw.version === ${3}) return migrateSessionV${3}(raw);`,
					`const schema = SessionV${3}Schema;`,
				].join("\n"),
			);
			await writeFile(
				join(repository, "src", "recovery-message.ts"),
				`${[...flatLifecycleExamples, ...multilineFlatLifecycleExamples].join(
					"\n",
				)}\n`,
			);
			await writeFile(
				join(repository, "src", "nested-guidance.ts"),
				`${nestedLifecycleExamples.join("\n")}\n`,
			);
			await writeFile(
				join(repository, "src", "switch-reader.ts"),
				[
					"switch (raw.version) {",
					`\tcase ${3}: return migrateLegacySession(raw);`,
					"\tdefault: return parseCurrentSession(raw);",
					"}",
				].join("\n"),
			);
			const supportedVersionsIdentifier = [
				"SUPPORTED",
				"SESSION",
				"VERSIONS",
			].join("_");
			await writeFile(
				join(repository, "src", "supported-versions.ts"),
				`export const ${supportedVersionsIdentifier} = [${3}, 4];\n`,
			);
			await writeFile(
				join(fixtureDirectory, "session.json"),
				JSON.stringify({ version: 4 }),
			);
			await writeFile(
				join(repository, "docs", "plan", "active.md"),
				`Active plan preserves Session v${3}.\n`,
			);
			await writeFile(
				join(
					repository,
					"docs",
					"plan",
					"session-v4-lifecycle-hardening-plan.md",
				),
				[
					`Remove Session v${3}-specific runtime branches.`,
					`if (raw.version === ${3}) return preserveLegacySession(raw);`,
				].join("\n"),
			);

			const violations = await auditSessionV4OnlyState(repository);
			expect(new Set(violations.map(({ path }) => path))).toEqual(
				new Set([
					"README.md",
					"docs/plan/active.md",
					"docs/plan/session-v4-lifecycle-hardening-plan.md",
					"src/reader.ts",
					"src/recovery-message.ts",
					"src/supported-versions.ts",
					"src/switch-reader.ts",
					`tests/fixtures/session-v${3}/session.json`,
				]),
			);
			expect(
				violations.some(({ text }) => text.includes(`raw.version === ${3}`)),
			).toBe(true);
			expect(
				violations.some(({ text }) => text.includes(`SessionV${3}Schema`)),
			).toBe(true);
			expect(
				violations.some(({ path }) => path === "src/supported-versions.ts"),
			).toBe(true);
			expect(
				violations.some(({ path }) => path === "src/switch-reader.ts"),
			).toBe(true);
			for (const example of flatLifecycleExamples) {
				expect(
					violations.some(
						({ path, text }) =>
							path === "src/recovery-message.ts" && text.includes(example),
					),
				).toBe(true);
			}
			const recoveryViolations = violations.filter(
				({ path }) => path === "src/recovery-message.ts",
			);
			expect(recoveryViolations).toHaveLength(
				flatLifecycleExamples.length + multilineFlatLifecycleExamples.length,
			);
			for (const tool of lifecycleToolNames) {
				expect(
					recoveryViolations.filter(({ text }) => text.includes(tool)),
				).toHaveLength(4);
			}
			expect(
				violations.some(({ path }) => path === "src/nested-guidance.ts"),
			).toBe(false);
			expect(
				violations.some(
					({ path, text }) =>
						path === "docs/plan/session-v4-lifecycle-hardening-plan.md" &&
						text.includes(`raw.version === ${3}`),
				),
			).toBe(true);
			expect(
				violations.some(({ text }) =>
					text.includes(`Remove Session v${3}-specific runtime branches`),
				),
			).toBe(false);
		} finally {
			await rm(repository, { force: true, recursive: true });
		}
	});
});
