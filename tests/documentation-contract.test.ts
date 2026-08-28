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
//   - CHANGELOG release structure: top entry matches package.json version/date
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
 *
 * Raised from 120,000, which had 1,342 bytes left, for the ADR 0011 amendment that
 * records why a declared environment had to become a value the runtime compares, two
 * guarantee-map entries, and the ~700 bytes the contract split spent on a second
 * document's front matter and cross-links. The tightening this comment asks for went
 * first and is in the diff: the amendment was cut by a third, and the contract came
 * out of this change smaller than it went in. The 1,800 left is again less than one
 * record, for the same reason.
 *
 * Raised from 124,000, which had 181 bytes left, for ADR 0012 and the two normative
 * paragraphs it changed. The comment above asked the next record to be the prompt to
 * tighten the contract rather than raise this again, and that is now overdue rather
 * than done: the tightening this change made was inside the new record and in the
 * guarantee it moved from Unenforced to Host-attested, which is real but is not the
 * contract split that was asked for.
 *
 * That raise was taken on credit against collapsing the declared gate, the declared
 * environment, and the declared results into one evidence record that would return the
 * bytes. The credit is not good, and recording that here is more useful than leaving
 * the promise standing:
 *
 * The collapse needs `plan.gate` and `plan.externalEvidence` to become one field, which
 * is a removal and a rename on a surface `docs/release-qualification.md` freezes —
 * additive optional fields only, deprecate in one release and remove no earlier than
 * the next major. Doing it inside the runtime alone does not help either: the two
 * satisfaction rules share exactly one primitive (`isValidationEligible`) and differ in
 * every other part, so a shared abstraction over them adds a layer without removing a
 * rule, and adds bytes here rather than returning them.
 *
 * So the collapse is a two-release change, and this budget should not be raised again
 * before it lands. If the next evidence rule needs bytes here, that is the signal the
 * consequences section of ADR 0012 already names: stop adding declarations.
 *
 * Split, at 132,000 with 58 bytes left, into this ceiling and
 * `MAX_DECISION_RECORD_BYTES`. Read the five raises above in order: 0010, 0011, the
 * 0011 amendment, 0012 — every one of them was forced by a decision record, and a
 * third of the 132,000 had become ten append-only files. That is the defect. This
 * budget's whole instruction is to pay for growth "by deleting prose that stopped
 * earning its place", and a record cannot be paid for that way: nobody trims a
 * decision after the fact, so each new one permanently taxed the normative prose it
 * shared a ceiling with, and the last two raises spent their tightening on the record
 * that caused them rather than on the contract.
 *
 * The split is mostly not headroom, and the part of it that is should be named: the
 * two ceilings sum to 134,000, which is 2,000 more than the one they replace. That is
 * deliberate and it is small — 590 bytes of prose slack is under one document's front
 * matter, and 1,468 of record slack is well under a third of a record, so the next ADR
 * still raises a number and writes down why. It buys back exactly what the second
 * paragraph of this comment says a ceiling needs to keep measuring sprawl instead of
 * dictating edits, which 58 bytes had stopped doing.
 *
 * The trims that funded the scenarios landing beside this split stay trimmed — they
 * were reasoning `scripts/qualify-release.ts` already carries in full, and duplication
 * is what this budget exists to find.
 *
 * 8.0.0 landed the collapse as ADR 0014. This prose ceiling was not raised for
 * it. Do not raise it for another evidence field.
 *
 * Raised from 89,000, which had 17 bytes left, for the threat-model section in
 * `guarantees.md`. The section names the three adversaries and what each is up
 * against, and the file had nothing left to delete that still earned its place.
 * The 466 left is under a third of the section it bought, so the next growth
 * deletes prose first.
 */
const MAX_MAINTAINED_DOC_BYTES = 91_000;

/**
 * Decision records under `docs/adr/`, budgeted apart from maintained prose.
 *
 * A record is history: append-only by convention, never tightened, and worth about
 * five thousand bytes. Its own ceiling makes writing one an explicit act — the slack
 * here is deliberately well under one record, so the next ADR raises this number and
 * records why, exactly as before — without that act reaching into
 * `docs/maintainer-contract.md` for the space.
 *
 * Ten records at 44,532 bytes is the state at the split.
 *
 * Raised from 46,000 for ADR 0014, the evidence collapse the previous raises
 * borrowed against. Slack stays under one record.
 */
const MAX_DECISION_RECORD_BYTES = 48_000;

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
 *
 * It grew again, by one clause about the platform an observation ran on, so the
 * split happened: `validation-and-review.md` now owns those invariants and the
 * contract points at it. Lowered from 33,000 to 21,000, which is the largest
 * remaining document plus slack, and low enough that the next document to outgrow
 * the set is caught rather than absorbed.
 */
const MAX_SINGLE_DOC_BYTES = 21_000;

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

describe("Flow documentation contract", () => {
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
			[
				"docs/adr/0014-one-evidence-record.md",
				[
					"Status",
					"Context",
					"Decision",
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

	test("keeps maintained documentation and decision records within their budgets", async () => {
		const encoder = new TextEncoder();
		const oversized: string[] = [];
		const measure = async (documents: readonly string[]) => {
			let total = 0;
			for (const document of documents) {
				const bytes = encoder.encode(
					await readFile(document, "utf8"),
				).byteLength;
				total += bytes;
				if (bytes > MAX_SINGLE_DOC_BYTES) {
					oversized.push(`${document}: ${bytes} bytes`);
				}
			}
			return total;
		};
		const markdown = await markdownFiles("docs");
		const isRecord = (path: string) => path.startsWith(join("docs", "adr"));
		const prose = await measure([
			"README.md",
			"CONTEXT.md",
			...markdown.filter((path) => !isRecord(path)),
		]);
		const records = await measure(markdown.filter(isRecord));

		// Reported for the same reason the source budget reports itself: a ceiling
		// that only speaks up once it is exceeded blocks the change that discovered
		// the problem rather than the one that caused it. Both numbers print even when
		// only one moved, because which of the two a change spends from is the thing
		// the split exists to make visible.
		console.info(
			`maintained prose: ${prose} bytes, ${MAX_MAINTAINED_DOC_BYTES - prose} of ${MAX_MAINTAINED_DOC_BYTES} remaining.\n` +
				`decision records: ${records} bytes, ${MAX_DECISION_RECORD_BYTES - records} of ${MAX_DECISION_RECORD_BYTES} remaining.`,
		);
		expect(oversized, oversized.join("\n")).toEqual([]);
		expect(prose).toBeLessThanOrEqual(MAX_MAINTAINED_DOC_BYTES);
		expect(records).toBeLessThanOrEqual(MAX_DECISION_RECORD_BYTES);
	});

	test("keeps the CHANGELOG release structure valid", async () => {
		const changelog = await readFile("CHANGELOG.md", "utf8");
		expect(changelog).not.toMatch(/^## \[Unreleased\]$/m);

		const releaseHeadings = [
			...changelog.matchAll(/^## \[([^\]]+)\](?: - ([^\n]+))?$/gm),
		];
		const currentRelease = releaseHeadings[0];
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
		expect(currentReleaseNotes).toMatch(/Session v5 schema/i);
		expect(currentReleaseNotes).not.toMatch(
			/public surface (?:is|are) unchanged/i,
		);
	});

	test("keeps the product generation unnamed outside history", async () => {
		// The numbered label went stale in maintained prose twice already, so the
		// rule lives here instead of in another sentence nobody rereads. History
		// keeps its labels: the CHANGELOG, the ADRs, and the upgrade heading in
		// troubleshooting.md name real past versions. Test fixtures are not scanned.
		const maintained = [
			"README.md",
			"CONTEXT.md",
			...(await markdownFiles("docs")).filter(
				(path) => !path.startsWith(join("docs", "adr")),
			),
		];
		const offenders: string[] = [];
		for (const document of [...maintained, "src/application/errors.ts"]) {
			for (const line of (await readFile(document, "utf8")).split("\n")) {
				if (/^#{1,6} Upgrading from Flow v\d/.test(line)) continue;
				if (/Flow v\d/.test(line))
					offenders.push(`${document}: ${line.trim()}`);
			}
		}
		expect(offenders).toEqual([]);
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
		const release = await readFile(".github/workflows/release.yml", "utf8");
		expect(release).toMatch(/^ {2}push:\n {4}branches:/m);
		expect(release).toContain("tags:");
		expect(release).toMatch(/tag="v\$\{version\}"/);
		expect(release).toMatch(/--target "\$\{GITHUB_SHA\}"/);
		expect(release).toContain(
			"Verify exact VERIFIED V2 artifact decision and fresh canary",
		);
		expect(release).toContain("bun run eval:canary -- verify");
		expect(release).toContain("--mode dry-run");
		expect(release).toMatch(/evals\/canary\/\$\{version\}\.json/);
		expect(release).not.toContain("canary-not-enabled");

		// Model-driven evals need credentials and cost real money, so they run on a
		// schedule and never on a pull request. `evals.yml` is the one workflow allowed
		// to invoke them, and the property worth pinning is that no gate a contributor
		// waits on can: the previous rule banned the word outright, which also banned
		// the scheduled multi-model matrix that made "works with Flow" mean anything
		// beyond one provider (docs/adr/0010-declared-canonical-gate.md).
		const evals = await readFile(".github/workflows/evals.yml", "utf8");
		expect(evals).toContain("bun run eval");
		expect(evals).toContain("V2 report:");
		expect(evals).toContain("sealed qualification requires");
		expect(evals).toContain("eval-v2-qualification-input");
		expect(evals).toContain("if: always()");
		expect(evals).toContain("schedule:");
		expect(evals).not.toMatch(/^on:[\s\S]*?^\s{2}(?:pull_request|push):/m);
		const qualification = await readFile(
			"docs/release-qualification.md",
			"utf8",
		);
		expect(qualification).toContain("eval:canary -- prepare --report");
		expect(qualification).not.toContain("bun pm pack --destination");
		for (const gate of [
			"ci.yml",
			"release.yml",
			"opencode-compatibility.yml",
		]) {
			expect(
				await readFile(join(".github/workflows", gate), "utf8"),
				gate,
			).not.toMatch(
				/harness|lifecycle-soak|cross-version|replay-report|prompt:model-eval|bun run eval(?:\s|$)/i,
			);
		}
	});

	test("pins today's plan evidence declarations until a major", async () => {
		const sessionSource = await readFile("src/domain/session.ts", "utf8");
		const planBlock = sessionSource.slice(
			sessionSource.indexOf("export type Plan ="),
			sessionSource.indexOf("export type ValidationScope"),
		);
		const optionalPlanFields = [...planBlock.matchAll(/^\t(\w+)\?:/gm)].map(
			(match) => match[1],
		);
		expect(optionalPlanFields).toEqual(["evidence"]);

		const featureBlock = sessionSource.slice(
			sessionSource.indexOf("export type PlanFeature ="),
			sessionSource.indexOf("type EvidenceScope"),
		);
		const optionalFeatureFields = [
			...featureBlock.matchAll(/^\t(\w+)\?:/gm),
		].map((match) => match[1]);
		expect(optionalFeatureFields).toEqual(["kind"]);

		const entryBlock = sessionSource.slice(
			sessionSource.indexOf("export type EvidenceEntry ="),
			sessionSource.indexOf("export type ObservedAssertion"),
		);
		const optionalEntryFields = [...entryBlock.matchAll(/^\t(\w+)\?:/gm)].map(
			(match) => match[1],
		);
		expect(optionalEntryFields).toEqual(["platform", "assertions"]);

		const transitions = await readFile("src/domain/transitions.ts", "utf8");
		expect(transitions).toContain("assertDeclaredEvidence");
		expect(transitions).not.toContain("assertDeclaredGate");
		expect(transitions).not.toContain("assertDeclaredExternalEvidence");
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
