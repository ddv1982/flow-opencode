import { describe, expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { FLOW_CORE_AGENTS, FLOW_CORE_COMMANDS } from "../src/config-shared.js";
import { FLOW_GUIDANCE_IDS } from "../src/guidance/ids.js";
import FlowPlugin from "../src/index.js";

// This file asserts that the documentation matches the *runtime surface*, and
// that the maintained set stays navigable. It deliberately does not pin prose.
//
// It used to assert ~66 ordered phrase chains against README, CONTEXT, the ADRs
// and the maintainer contract. That inverted the cost of editing documentation:
// the only way to satisfy a chain was to write those exact phrases in that exact
// order, so docs could only ever grow, and they grew into legalistic prose that
// is hard for a human or a model to read. Prose ordering is not a contract.
//
// What IS a contract, and is still asserted here:
//   - the install block pins the exact published version
//   - command, tool, guide and agent inventories are derived from source
//   - the maintained document set and its section structure
//   - CHANGELOG release structure and the version/date invariants
//   - every relative link resolves
//
// The byte ceilings are sprawl alarms, reviewed as a trend at release. They are
// not a per-commit tax: a ceiling with no headroom stops being a budget and
// becomes a puzzle, where the only way to document a change is byte-neutral
// surgery on unrelated prose. Prefer paying for growth by deleting prose that has
// stopped earning its place, and raise a ceiling deliberately when there is none
// left to delete.

const packageVersion = packageJson.version;

/**
 * Maintained prose, excluding the append-only CHANGELOG.
 *
 * It was lowered to 95,000 and then to 87,130 by real tightening: the README had
 * accumulated the runtime's finest detail -- reply-authority lineage, compaction
 * transfer, revision credit, finding disposition vocabulary -- which
 * `docs/maintainer-contract.md` already owns, and `CONTEXT.md` is a glossary whose
 * entries had grown into second copies of the delivery, archive, retry, and
 * planned-command rules. Both cuts were correct and are kept.
 *
 * Raised once, from 87,130, because the total had reached it exactly. At zero
 * headroom the ceiling stopped measuring sprawl and started dictating edits:
 * admitting ADR 0009 cost an unrelated round of prose golf, and recording a fix in
 * that ADR meant landing the file on its previous byte count to the byte. Neither
 * made the documentation better. The 4,870 bytes here are roughly one decision
 * record plus slack -- enough that describing a change is a normal act.
 *
 * Unlike `MAX_TOTAL_PROMPT_BYTES` in `tests/prompt-quality.test.ts`, this budget
 * buys nothing at runtime: documentation bytes are never sent to a model. That is
 * why this one has slack and the prompt ceiling does not.
 *
 * Raised from 92,000 for four documents that did not exist: the guarantee map, the
 * positioning and "when not to use" statement, the published release-qualification
 * thresholds, and ADR 0010. The first is the reason for the rest — the same
 * confident prose used to describe a rule the runtime refuses to break and a rule
 * that lived only in a prompt, and no amount of tightening existing text fixes
 * that. This is the one increase where the bytes *are* the deliverable; ordinary
 * growth still has to be paid for by deleting prose that stopped earning its place.
 *
 * Raised from 114,000, which had 2,919 bytes left, for ADR 0011. A decision record
 * costs about five thousand, so that was the zero-headroom state this comment
 * already describes: the alternative was to compress the reasoning for a schema
 * change into whatever space an unrelated round of prose golf could find. The 2,500
 * here is deliberately less than one more record — the next ADR is the prompt to
 * tighten the contract, not to raise this again.
 */
const MAX_MAINTAINED_DOC_BYTES = 120_000;

/**
 * No single maintained document should outgrow the operator-facing README.
 *
 * The README is now 7.6 KiB, so this no longer describes what it says it does; it
 * is kept as a blunt ceiling on any one document. Lower it when the largest doc
 * (`maintainer-contract.md`) is tightened.
 *
 * Raised from 30,000 for the declared gate, the auto-continuation capability
 * report, and the eval policy. All three are normative runtime and release rules,
 * and this document is where those live: the cheaper way to fit them was to delete
 * normative text and leave the rationale in an ADR, which inverts what each
 * document is for. The real fix is to split the contract — validation and review is
 * over a third of it — and that is the next move if it grows again, not another
 * raise.
 */
const MAX_SINGLE_DOC_BYTES = 33_000;

function section(markdown: string, heading: string, level = 2): string {
	const marker = `${"#".repeat(level)} ${heading}`;
	const start = markdown.indexOf(marker);
	if (start === -1) throw new Error(`Missing Markdown section '${marker}'.`);
	const remainder = markdown.slice(start + marker.length);
	const next = remainder.search(new RegExp(`^#{1,${level}}\\s`, "m"));
	return next === -1 ? remainder : remainder.slice(0, next);
}

function firstColumnCodeValues(markdown: string): string[] {
	return [...markdown.matchAll(/^\| `([^`]+)` \|/gm)].map(
		(match) => match[1] ?? "",
	);
}

function headings(markdown: string): string[] {
	return [...markdown.matchAll(/^#{2,3} (.+)$/gm)].map(
		(match) => match[1] ?? "",
	);
}

async function markdownFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	return (
		await Promise.all(
			entries.map((entry) => {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) return markdownFiles(path);
				return Promise.resolve(entry.name.endsWith(".md") ? [path] : []);
			}),
		)
	).flat();
}

async function registeredToolNames(): Promise<string[]> {
	const hooks = await FlowPlugin({
		client: { app: { log() {} } },
		project: {},
		directory: process.cwd(),
		worktree: process.cwd(),
		experimental_workspace: { register() {} },
		serverUrl: new URL("http://localhost"),
		$: {},
	} as unknown as Parameters<typeof FlowPlugin>[0]);
	try {
		return Object.keys(hooks.tool ?? {}).sort();
	} finally {
		await hooks.dispose?.();
	}
}

describe("Flow v6 documentation contract", () => {
	test("pins the exact published version in the install instructions", async () => {
		const readme = await readFile("README.md", "utf8");
		const install = section(readme, "Install");
		const block = install.match(/```json\n([\s\S]*?)\n```/)?.[1];
		const exactPackage = `opencode-plugin-flow@${packageVersion}`;

		expect(JSON.parse(block ?? "null")).toEqual({
			$schema: "https://opencode.ai/config.json",
			plugin: [exactPackage],
		});
		expect(install).toContain(
			`opencode plugin ${exactPackage} --global --force`,
		);
		// Every version mentioned in Install must be the shipped one, so a release
		// cannot leave a stale pin behind.
		expect(
			[...install.matchAll(/opencode-plugin-flow@([^\s"\]]+)/g)].map(
				(match) => match[1],
			),
		).toEqual([packageVersion, packageVersion]);
		expect(install).toContain("https://opencode.ai/docs/plugins/");
		expect(install).not.toMatch(/\bnpx\b|activation-check/);
	});

	test("derives the README command table from source", async () => {
		const readme = await readFile("README.md", "utf8");
		const commandsSection = section(readme, "Commands");
		const commands = firstColumnCodeValues(commandsSection)
			.map((value) => value.split(/\s+/, 1)[0]?.replace(/^\//, "") ?? "")
			.sort();

		expect(commands).toEqual(Object.keys(FLOW_CORE_COMMANDS).sort());
		// /flow-review is not an entry point; the table must not invite direct use.
		expect(commandsSection).toMatch(
			/\| `\/flow-review` \| [^\n|]*(?:internal|recovery)/i,
		);
		// The README is operator-facing: maintainer inventories live in docs/.
		expect(headings(readme)).not.toContain("Tools");
		expect(headings(readme)).not.toContain("Guides");
		expect(headings(readme)).not.toContain("What the runtime enforces");
		const quickStart = section(readme, "Quick start");
		for (const command of [
			"/flow-auto",
			"/flow-plan",
			"/flow-run",
			"/flow-status",
		]) {
			expect(quickStart).toContain(command);
		}
	});

	test("keeps maintainer inventories aligned with the runtime surface", async () => {
		const maintainer = await readFile("docs/maintainer-contract.md", "utf8");
		const surface = section(maintainer, "OpenCode surface");

		expect(
			firstColumnCodeValues(section(surface, "Commands", 3)).sort(),
		).toEqual(Object.keys(FLOW_CORE_COMMANDS).sort());
		expect(firstColumnCodeValues(section(surface, "Tools", 3)).sort()).toEqual(
			await registeredToolNames(),
		);
		expect(firstColumnCodeValues(section(surface, "Guides", 3)).sort()).toEqual(
			[...FLOW_GUIDANCE_IDS].sort(),
		);
		expect(
			firstColumnCodeValues(section(surface, "Hidden agents", 3)).sort(),
		).toEqual(Object.keys(FLOW_CORE_AGENTS).sort());
		for (const agent of Object.values(FLOW_CORE_AGENTS)) {
			expect(agent.hidden).toBe(true);
		}
		// A retired tool must not linger in the inventory.
		expect(section(surface, "Tools", 3)).not.toContain("flow_feature_hold");
		expect(headings(maintainer)).toEqual(
			expect.arrayContaining([
				"Causality and idempotency",
				"Validation and review",
				"Bounded worker waves",
				"Commands",
				"Tools",
				"Guides",
				"Hidden agents",
			]),
		);
	});

	test("keeps one maintained documentation set with clear ownership", async () => {
		const files = (await markdownFiles("docs"))
			.map((path) => relative(".", path))
			.sort();

		expect(files).toEqual(
			expect.arrayContaining([
				"docs/adr/0005-flow-v6-session-v5-simplicity-first.md",
				"docs/adr/0006-bounded-intra-feature-waves.md",
				"docs/adr/0007-reviewer-owned-submission.md",
				"docs/adr/0008-bounded-auto-continuation.md",
				"docs/index.md",
				"docs/maintainer-contract.md",
				"docs/troubleshooting.md",
			]),
		);
		for (const removed of [
			"docs/causal-state.md",
			"docs/prompt-quality.md",
			"docs/review-lifecycle.md",
		]) {
			expect(files).not.toContain(removed);
		}
		await expect(access("droid-wiki/README.md")).rejects.toMatchObject({
			code: "ENOENT",
		});

		expect(headings(await readFile("CONTEXT.md", "utf8"))).toEqual(
			expect.arrayContaining(["Versions", "Core terms", "Ownership"]),
		);
		for (const [path, required] of [
			[
				"docs/adr/0006-bounded-intra-feature-waves.md",
				[
					"Status",
					"Context",
					"Decision",
					"Consequences",
					"Guardrail fit",
					"Rejected alternatives",
				],
			],
			[
				"docs/adr/0007-reviewer-owned-submission.md",
				[
					"Status",
					"Context",
					"Decision",
					"Consequences",
					"Rejected alternatives",
				],
			],
			[
				"docs/adr/0008-bounded-auto-continuation.md",
				[
					"Status",
					"Context",
					"Decision",
					"Simplicity boundary",
					"Consequences",
					"Rejected alternatives",
				],
			],
		] as const) {
			expect(headings(await readFile(path, "utf8"))).toEqual(
				expect.arrayContaining([...required]),
			);
		}
	});

	test("keeps maintained documentation within its byte budget", async () => {
		const documents = [
			"README.md",
			"CONTEXT.md",
			...(await markdownFiles("docs")),
		];
		const encoder = new TextEncoder();
		let total = 0;
		const oversized: string[] = [];
		for (const document of documents) {
			const bytes = encoder.encode(await readFile(document, "utf8")).byteLength;
			total += bytes;
			if (bytes > MAX_SINGLE_DOC_BYTES) {
				oversized.push(`${document}: ${bytes} bytes`);
			}
		}
		// Reported for the same reason the source budget reports itself: a ceiling
		// that only speaks up once it is exceeded blocks the change that discovered
		// the problem rather than the one that caused it.
		console.info(
			`maintained docs: ${total} bytes, ${MAX_MAINTAINED_DOC_BYTES - total} of ${MAX_MAINTAINED_DOC_BYTES} remaining.`,
		);
		expect(oversized, oversized.join("\n")).toEqual([]);
		expect(total).toBeLessThanOrEqual(MAX_MAINTAINED_DOC_BYTES);
	});

	test("keeps the CHANGELOG release structure valid", async () => {
		const changelog = await readFile("CHANGELOG.md", "utf8");
		expect(changelog).toMatch(/^## \[Unreleased\]$/m);

		const releaseHeadings = [
			...changelog.matchAll(/^## \[([^\]]+)\](?: - ([^\n]+))?$/gm),
		];
		expect(releaseHeadings[0]?.[1]).toBe("Unreleased");
		const currentRelease = releaseHeadings[1];
		expect(currentRelease?.[1]).toBe(packageVersion);

		const releaseDate = currentRelease?.[2] ?? "";
		expect(releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(
			new Date(`${releaseDate}T00:00:00.000Z`).toISOString().slice(0, 10),
		).toBe(releaseDate);

		const currentReleaseNotes = section(
			changelog,
			`[${packageVersion}] - ${releaseDate}`,
		);
		expect(currentReleaseNotes).toContain(
			`opencode plugin opencode-plugin-flow@${packageVersion} --global --force`,
		);
		// Release notes must state the schema impact explicitly rather than the
		// uninformative "public surface is unchanged".
		const unreleased = section(changelog, "[Unreleased]");
		const currentChangeNotes = /No changes yet\./i.test(unreleased)
			? currentReleaseNotes
			: unreleased;
		expect(currentChangeNotes).toMatch(/Session v5 schema/i);
		expect(currentChangeNotes).not.toMatch(
			/public surface (?:is|are) unchanged/i,
		);
	});

	test("keeps CI focused on normal checks, platforms, live smoke, and release", async () => {
		const workflowNames = (await readdir(".github/workflows"))
			.filter((name) => name.endsWith(".yml"))
			.sort();
		const combined = (
			await Promise.all(
				workflowNames.map((name) =>
					readFile(join(".github/workflows", name), "utf8"),
				),
			)
		).join("\n");

		expect(workflowNames).toEqual([
			"ci.yml",
			"evals.yml",
			"opencode-compatibility.yml",
			"release.yml",
		]);
		expect(combined).toContain("bun run check");
		expect(combined).toContain("bun run smoke:live");
		expect(combined).toContain("tests/workspace-persistence.test.ts");
		expect(combined).toContain("npm publish");

		// Model-driven evals need credentials and cost real money, so they run on a
		// schedule and never on a pull request. `evals.yml` is the one workflow allowed
		// to invoke them, and the property worth pinning is that no gate a contributor
		// waits on can: the previous rule banned the word outright, which also banned
		// the scheduled multi-model matrix that made "works with Flow" mean anything
		// beyond one provider (docs/adr/0010-declared-canonical-gate.md).
		const evals = await readFile(".github/workflows/evals.yml", "utf8");
		expect(evals).toContain("bun run eval");
		expect(evals).toContain("schedule:");
		expect(evals).not.toMatch(/^on:[\s\S]*?^\s{2}(?:pull_request|push):/m);
		for (const gate of [
			"ci.yml",
			"release.yml",
			"opencode-compatibility.yml",
		]) {
			expect(
				await readFile(join(".github/workflows", gate), "utf8"),
				gate,
			).not.toMatch(
				/harness|lifecycle-soak|cross-version|replay-report|prompt:model-eval|bun run eval/i,
			);
		}
	});

	test("keeps maintained relative Markdown links resolvable", async () => {
		const documents = [
			"README.md",
			"CHANGELOG.md",
			"CONTEXT.md",
			...(await markdownFiles("docs")),
		];
		const broken: string[] = [];
		for (const document of documents) {
			const markdown = await readFile(document, "utf8");
			for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
				const rawTarget = match[1]?.trim();
				if (!rawTarget || /^(?:[a-z]+:|#|\/)/i.test(rawTarget)) continue;
				const path = decodeURIComponent(
					rawTarget.replace(/^<|>$/g, "").split("#", 1)[0] ?? "",
				);
				if (!path) continue;
				try {
					await access(resolve(dirname(document), path));
				} catch {
					broken.push(`${document} -> ${rawTarget}`);
				}
			}
		}
		expect(broken).toEqual([]);
	});
});
