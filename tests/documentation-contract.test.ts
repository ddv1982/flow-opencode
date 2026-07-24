import { describe, expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { FLOW_CORE_AGENTS, FLOW_CORE_COMMANDS } from "../src/config-shared.js";
import { FLOW_GUIDANCE_IDS } from "../src/guidance/ids.js";
import FlowPlugin from "../src/index.js";

const packageVersion = packageJson.version;

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
	test("documents exact-pin installation and the pre-v6 upgrade boundary", async () => {
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
		expect(install).toContain(
			`To update, replace \`${packageVersion}\` with the new release`,
		);
		expect(
			[...install.matchAll(/opencode-plugin-flow@([^\s"\]]+)/g)].map(
				(match) => match[1],
			),
		).toEqual([packageVersion, packageVersion]);
		expect(install).toMatch(
			/Exact version pins do not update\s+automatically\./,
		);
		expect(install).toMatch(/Flow v5 or earlier[\s\S]+Session v5/);
		expect(install).toMatch(
			/do not roll an active session back[\s\S]+newer v6 builds read earlier Session v5[\s\S]+no capability or\s+migration layer/i,
		);
		expect(install).toContain("https://opencode.ai/docs/plugins/");
		expect(install).not.toMatch(/\bnpx\b|activation-check/);
	});

	test("keeps the README operator-focused and commands source-derived", async () => {
		const readme = await readFile("README.md", "utf8");
		const quickStart = section(readme, "Quick start");
		const commandsSection = section(readme, "Commands");
		const commands = firstColumnCodeValues(commandsSection)
			.map((value) => value.split(/\s+/, 1)[0]?.replace(/^\//, "") ?? "")
			.sort();

		expect(commands).toEqual(Object.keys(FLOW_CORE_COMMANDS).sort());
		for (const command of [
			"/flow-auto",
			"/flow-plan",
			"/flow-run",
			"/flow-status",
		]) {
			expect(quickStart).toContain(command);
		}
		expect(quickStart).toMatch(/approve (?:it|the plan) conversationally/i);
		expect(quickStart).toMatch(
			/before every manager-owned Flow mutation[\s\S]+direct `\/flow-plan`[\s\S]+`\/flow-run`[\s\S]+materially\s+new or\s+expanded request[\s\S]+does not start or mutate/i,
		);
		expect(quickStart).toMatch(
			/projected `archiveRetry`[\s\S]+exception[\s\S]+already-accepted[\s\S]+before that comparison[\s\S]+no authority for new work/i,
		);
		expect(quickStart).toMatch(
			/only when `failedReviewCount === 1`[\s\S]+no `\[scope-blocker\]` is present[\s\S]+automatically reset[\s\S]+one fresh full retry/i,
		);
		expect(quickStart).toMatch(
			/latest relevant reviewed outcome remains failed[\s\S]+never selected\s+implicitly/i,
		);
		expect(quickStart).toMatch(
			/untouched, dependency-independent[\s\S]+only retry-required candidates[\s\S]+await-user-direction/i,
		);
		expect(quickStart).toMatch(
			/failed run is still blocked[\s\S]+flow_feature_reset[\s\S]+nextFeatureId[\s\S]+one operation/i,
		);
		expect(quickStart).toMatch(
			/status is ready with[\s\S]+await-user-direction[\s\S]+explicit retry[\s\S]+flow_run_start[\s\S]+exact `featureId`[\s\S]+no blocked run left to reset/i,
		);
		expect(quickStart).toMatch(
			/from idle[\s\S]+same-host accepted non-replayed[\s\S]+flow_plan_save[\s\S]+created Flow session[\s\S]+active baseline[\s\S]+pending reviewer/i,
		);
		expect(quickStart).toMatch(
			/after a user checkpoint[\s\S]+same OpenCode session[\s\S]+accepted non-replayed Flow mutation[\s\S]+another host cannot establish[\s\S]+authority[\s\S]+mechanical projection must match the credited revision exactly[\s\S]+sole successor allowance[\s\S]+one revision after an authenticated[\s\S]+`flow_review_start`[\s\S]+reserved reviewer result/i,
		);
		expect(quickStart).toMatch(
			/tool assistant ID[\s\S]+cached `message\.updated` `parentID`[\s\S]+authoritative user reply[\s\S]+missing or mismatched origin fails closed[\s\S]+trigger[\s\S]+assistant[\s\S]+automatic compaction marker[\s\S]+summary assistant[\s\S]+successor user[\s\S]+authority is unchanged[\s\S]+lineage[\s\S]+fails closed/i,
		);
		expect(quickStart).toMatch(
			/same-goal plan-only request[\s\S]+immutable plan[\s\S]+current progress[\s\S]+stops/i,
		);
		expect(quickStart).toContain(
			"`ready` and `completed` are internal loop\nstates",
		);
		expect(quickStart).toContain("does not hand back");
		expect(quickStart).toContain("ready for the next feature");
		expect(quickStart).toMatch(
			/`\/flow-auto stop`[\s\S]+`\/flow-auto cancel`[\s\S]+process-local continuation lease[\s\S]+does not close[\s\S]+durable Flow session/i,
		);
		expect(quickStart).toMatch(
			/before coding each feature[\s\S]+inventories required evidence[\s\S]+adversarial risk checklist[\s\S]+knowingly skipped[\s\S]+manager policy forbids[\s\S]+requesting review/i,
		);
		expect(quickStart).toMatch(
			/proof required to approve the outcome[\s\S]+blocking[\s\S]+persists no\s+skipped-evidence\s+ledger[\s\S]+asking the user\s+remains the default/i,
		);
		expect(quickStart).toMatch(
			/Flow guidance[\s\S]+concurrency and state-machine[\s\S]+transition matrix[\s\S]+run baseline[\s\S]+feature-relevant[\s\S]+file facts[\s\S]+source IDs[\s\S]+current-source evidence[\s\S]+prior finding dispositions[\s\S]+no new audit[\s\S]+schema/i,
		);
		expect(section(readme, "How Flow works")).toMatch(
			/preflights required evidence[\s\S]+checklist[\s\S]+adjacent and repeated state transitions[\s\S]+base-diff[\s\S]+file-mode inventory[\s\S]+precise blocker[\s\S]+required to approve the outcome/i,
		);
		expect(section(readme, "How Flow works")).toMatch(
			/stable finding IDs survive retries[\s\S]+reviewer guidance[\s\S]+prior dispositions[\s\S]+bounded matrix/i,
		);
		expect(section(readme, "How Flow works")).toMatch(
			/ordinary reviewer summaries[\s\S]+active feature[\s\S]+explicitly supplied[\s\S]+packet[\s\S]+final\s+review[\s\S]+every approved requirement or feature ID[\s\S]+still-live prior finding[\s\S]+latest[\s\S]+`outcomeSummary`[\s\S]+terminal[\s\S]+`fixed` requires a later passing review and current evidence/i,
		);
		expect(section(readme, "How Flow works")).toMatch(
			/failed[\s\S]+retry proves one repair but finds another blocker[\s\S]+carries that ID[\s\S]+evidence reference[\s\S]+terminal fixed pending pass[\s\S]+cannot[\s\S]+drop the ID or call it fixed/i,
		);
		expect(section(readme, "How Flow works")).toMatch(
			/unproven fixes stay unverified[\s\S]+`recurring`[\s\S]+`residual`[\s\S]+only a[\s\S]+passing review may remove fixed history[\s\S]+terminal findings retain unresolved blockers[\s\S]+handoff stays bounded/i,
		);
		expect(section(readme, "Recovery")).toMatch(
			/interrupted accepted close[\s\S]+compact `\/flow-status` supplies[\s\S]+`archiveRetry\.request`[\s\S]+replay that request exactly once[\s\S]+before any additional[\s\S]+detail recovery read[\s\S]+`workflowData\.delivery`[\s\S]+latest\s+`outcomeSummary`[\s\S]+terminal\s+findings/i,
		);
		expect(section(readme, "Recovery")).not.toMatch(
			/before any recovery read/i,
		);
		expect(section(readme, "Recovery")).toMatch(
			/delivery is absent[\s\S]+exact recovery[\s\S]+no\s+map[\s\S]+revision conflict[\s\S]+same session and\s+goal[\s\S]+status still permits the selected[\s\S]+closure kind[\s\S]+never close a replacement/i,
		);
		expect(commandsSection).toMatch(
			/\| `\/flow-review` \| [^\n|]*(?:internal|recovery)/i,
		);
		expect(section(readme, "Bounded parallelism")).toMatch(
			/two or three[\s\S]+generic or general-purpose agents are not used[\s\S]+no wave state/i,
		);
		expect(headings(readme)).not.toContain("Tools");
		expect(headings(readme)).not.toContain("Guides");
		expect(headings(readme)).not.toContain("What the runtime enforces");
	});

	test("keeps maintainer inventories aligned with runtime surfaces", async () => {
		const maintainer = await readFile("docs/maintainer-contract.md", "utf8");
		const surface = section(maintainer, "OpenCode surface");
		const commands = firstColumnCodeValues(
			section(surface, "Commands", 3),
		).sort();
		const tools = firstColumnCodeValues(section(surface, "Tools", 3)).sort();
		const guides = firstColumnCodeValues(section(surface, "Guides", 3)).sort();
		const agents = firstColumnCodeValues(
			section(surface, "Hidden agents", 3),
		).sort();

		expect(commands).toEqual(Object.keys(FLOW_CORE_COMMANDS).sort());
		expect(tools).toEqual(await registeredToolNames());
		expect(section(surface, "Tools", 3)).toMatch(
			/\| `flow_session_close` \| [^\n|]*derived delivery/i,
		);
		expect(maintainer).toMatch(
			/freshness boundary[\s\S]+new\s+review[\s\S]+newer than the latest relevant failed, incomplete, or source-drifted[\s\S]+older source digest[\s\S]+accepted same-schema Session v5[\s\S]+grandfathered[\s\S]+retroactive planned-gate\s+veto/i,
		);
		expect(maintainer).toMatch(
			/`nextAction` is durable default workflow direction[\s\S]+environment-sensitive transition guards remain authoritative/i,
		);
		expect(maintainer).toMatch(
			/`failedReviewCount === 1`[\s\S]+compact `flow_feature_reset`[\s\S]+count-derived[\s\S]+default[\s\S]+detail may refine[\s\S]+checkpoint/i,
		);
		expect(maintainer).toMatch(
			/exact active close replay[\s\S]+does not[\s\S]+rewrite[\s\S]+collision[\s\S]+manualRecoveryRequired[\s\S]+no `archiveRetry`/i,
		);
		expect(maintainer).toMatch(
			/under `\/flow-auto`[\s\S]+`ready`[\s\S]+`completed`[\s\S]+mechanical loop states[\s\S]+never\s+returns[\s\S]+ready for the next feature/i,
		);
		expect(maintainer).toMatch(
			/from idle[\s\S]+same-host accepted non-replayed[\s\S]+flow_plan_save[\s\S]+created Flow session[\s\S]+active provisional baseline[\s\S]+temporal progress[\s\S]+pending reviewer/i,
		);
		expect(maintainer).toMatch(
			/unchanged already-ready baseline or replacement session fails\s+closed[\s\S]+flow_plan_approve[\s\S]+await-user-direction[\s\S]+blocked or ready[\s\S]+conversational\s+checkpoints/i,
		);
		expect(maintainer).toMatch(
			/clarification ending at the same recognized checkpoint revision[\s\S]+re-arms waiting without auto-routing/i,
		);
		expect(maintainer).toMatch(
			/accepted non-replayed manager[\s\S]+mutation observed in that OpenCode host session[\s\S]+another host cannot establish[\s\S]+reply authority[\s\S]+reviewer[\s\S]+child may contribute only the one state-constrained successor revision[\s\S]+authenticated `flow_review_start`[\s\S]+every other mechanical projection must equal[\s\S]+credited mutation revision/i,
		);
		expect(maintainer).toMatch(
			/tool assistant ID[\s\S]+cached `message\.updated`[\s\S]+`parentID`[\s\S]+authoritative user reply[\s\S]+missing mapping or mismatch fails[\s\S]+trigger assistant[\s\S]+automatic compaction[\s\S]+summary assistant[\s\S]+successor user[\s\S]+authority remains unchanged[\s\S]+lineage fails closed/i,
		);
		expect(maintainer).toMatch(
			/provenance remains process-local and adds no Session v5 field/i,
		);
		expect(maintainer).toMatch(
			/share[\s\S]+manager kernel[\s\S]+exact[\s\S]+`failedReviewCount === 1` retry gate[\s\S]+no runtime role registry or durable\s+policy state/i,
		);
		expect(maintainer).toMatch(
			/automatic fresh full[\s\S]+retry is allowed only when `failedReviewCount === 1`[\s\S]+no `\[scope-blocker\]`[\s\S]+scope blocker or count of two or greater checkpoints/i,
		);
		expect(maintainer).toMatch(
			/only `failedReviewCount === 1` without a `\[scope-blocker\]` may retry[\s\S]+automatically[\s\S]+every scope blocker or count of two or greater projects[\s\S]+`await-user-direction`/i,
		);
		expect(maintainer).toMatch(
			/latest relevant reviewed outcome remains failed[\s\S]+never\s+selected implicitly[\s\S]+untouched[\s\S]+dependency-independent[\s\S]+only retry-required candidates[\s\S]+ready[\s\S]+await-user-direction/i,
		);
		expect(maintainer).toMatch(
			/blocked\s+checkpoint[\s\S]+nextFeatureId[\s\S]+flow_feature_reset[\s\S]+one\s+transaction[\s\S]+failed run is already superseded[\s\S]+ready[\s\S]+await-user-direction[\s\S]+flow_run_start\(featureId\)[\s\S]+not another reset/i,
		);
		expect(maintainer).toMatch(
			/reset-only compatibility request never makes the failed[\s\S]+feature eligible for default selection/i,
		);
		expect(maintainer).toMatch(
			/stable finding, issue, and requirement IDs[\s\S]+verbatim[\s\S]+saved feature[\s\S]+traceable/i,
		);
		expect(maintainer).toContain(
			"Before implementation, the manager inventories every exact",
		);
		expect(maintainer).toContain("its required environment");
		expect(maintainer).toContain("adversarial acceptance and risk");
		expect(maintainer).toMatch(
			/required behavior or environment evidence[\s\S]+knowingly skipped[\s\S]+manager workflow policy forbids calling[\s\S]+flow_review_start/i,
		);
		expect(maintainer).toMatch(
			/proof required to approve the outcome[\s\S]+precise blocker[\s\S]+runtime persists no skipped-evidence field[\s\S]+does not[\s\S]+derive this policy as an admission gate/i,
		);
		expect(maintainer).toMatch(
			/before\/during\/after state transitions[\s\S]+repeated\/retried\/interrupted\/concurrent[\s\S]+manager-supplied base-diff[\s\S]+executable modes[\s\S]+does not fail merely[\s\S]+precise\s+missing-evidence/i,
		);
		expect(maintainer).toMatch(
			/state\/interleaving[\s\S]+event[\s\S]+expected outcome[\s\S]+cleanup\/invariant[\s\S]+evidence[\s\S]+conversational baseline inventory[\s\S]+only baseline facts it[\s\S]+changes or depends on[\s\S]+final review receives the full inventory[\s\S]+empty optional[\s\S]+sections are omitted/i,
		);
		expect(maintainer).toMatch(
			/resuming attempt 2 or later[\s\S]+prior findings in conversation[\s\S]+reads detail[\s\S]+once[\s\S]+IDs from superseded runs[\s\S]+before[\s\S]+preflight/i,
		);
		expect(maintainer).toMatch(
			/stable feature-local identity[\s\S]+qualifying pass[\s\S]+\[scope-blocker\][\s\S]+retry reuses the identity[\s\S]+preserves every still-live prior ID[\s\S]+checks each claim against current source and evidence/i,
		);
		expect(maintainer).toMatch(
			/ordinary-review summary[\s\S]+plan\/source IDs mapped to the active\s+feature[\s\S]+explicitly supplied[\s\S]+packet[\s\S]+final-review summary[\s\S]+every approved requirement or feature ID[\s\S]+both preserve[\s\S]+still-live[\s\S]+prior-finding ID[\s\S]+severity[\s\S]+passing verdict with[\s\S]+current evidence[\s\S]+terminal `fixed`/i,
		);
		expect(maintainer).toMatch(
			/failed verdict carries every[\s\S]+prior ID forward[\s\S]+repair F1 is proven[\s\S]+blocker F2 fails[\s\S]+terminal fixed pending pass[\s\S]+evidence[\s\S]+reference/i,
		);
		expect(maintainer).toMatch(
			/unproven fixed claim[\s\S]+unverified[\s\S]+`recurring`[\s\S]+`residual`[\s\S]+latest `outcomeSummary`[\s\S]+terminal findings retain unresolved blockers[\s\S]+only[\s\S]+IDs fixed by a passing review leave the live carry-forward set/i,
		);
		expect(maintainer).toMatch(
			/fresh close[\s\S]+compact-projected session id and[\s\S]+revision[\s\S]+fresh operation id[\s\S]+selected closure kind[\s\S]+optional[\s\S]+summary[\s\S]+`archiveRetry`[\s\S]+replays only[\s\S]+compact-projected request[\s\S]+byte-for-byte[\s\S]+without a prerequisite detail read[\s\S]+`workflowData\.delivery`[\s\S]+plan-bounded[\s\S]+terminal-only/i,
		);
		expect(maintainer).toMatch(
			/delivery is absent[\s\S]+exact recovery[\s\S]+no map[\s\S]+revision conflict[\s\S]+compact refresh[\s\S]+same session[\s\S]+goal[\s\S]+status still permits the selected closure kind[\s\S]+never[\s\S]+closes a replacement/i,
		);
		expect(maintainer).toMatch(
			/no finding field[\s\S]+historical-finding manifest[\s\S]+second ledger/i,
		);
		expect(maintainer).toMatch(
			/`\/flow-auto stop`[\s\S]+`\/flow-auto cancel`[\s\S]+process-local lease[\s\S]+do not mutate or close[\s\S]+durable Flow session/i,
		);
		expect(maintainer).toMatch(
			/\[flow-validation\][\s\S]+`passed`[\s\S]+`recordedRevision`[\s\S]+only a concurrency token[\s\S]+passed: true[\s\S]+flow_review_start[\s\S]+runtime review gates[\s\S]+passed: false[\s\S]+only fresh validation[\s\S]+never review[\s\S]+no compact refresh is needed solely/i,
		);
		expect(maintainer).toMatch(
			/timing for the latest `\/flow-auto`[\s\S]+current plugin process[\s\S]+activeMs[\s\S]+process-local\s+wall time[\s\S]+not CPU time or\s+pure coding time[\s\S]+waitingForUserMs[\s\S]+flow_plan_approve[\s\S]+await-user-direction[\s\S]+paused, inactive,\s+errored, and unprojected waits are excluded[\s\S]+never enters Session v5 or a projection[\s\S]+never authorizes or blocks/i,
		);
		expect(maintainer).toMatch(
			/generic agents may not substitute[\s\S]+`flow-worker`[\s\S]+reserved reviewer/i,
		);
		expect(section(surface, "Tools", 3)).not.toContain("flow_feature_hold");
		expect(guides).toEqual([...FLOW_GUIDANCE_IDS].sort());
		expect(agents).toEqual(Object.keys(FLOW_CORE_AGENTS).sort());
		for (const agent of Object.values(FLOW_CORE_AGENTS)) {
			expect(agent.hidden).toBe(true);
		}
	});

	test("keeps one concise maintained documentation set with clear ownership", async () => {
		const files = (await markdownFiles("docs"))
			.map((path) => relative(".", path))
			.sort();
		const [
			context,
			waveAdr,
			reviewerAdr,
			continuationAdr,
			maintainer,
			troubleshooting,
			changelog,
		] = await Promise.all([
			readFile("CONTEXT.md", "utf8"),
			readFile("docs/adr/0006-bounded-intra-feature-waves.md", "utf8"),
			readFile("docs/adr/0007-reviewer-owned-submission.md", "utf8"),
			readFile("docs/adr/0008-bounded-auto-continuation.md", "utf8"),
			readFile("docs/maintainer-contract.md", "utf8"),
			readFile("docs/troubleshooting.md", "utf8"),
			readFile("CHANGELOG.md", "utf8"),
		]);

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
		expect(headings(context)).toEqual(
			expect.arrayContaining(["Versions", "Core terms", "Ownership"]),
		);
		expect(headings(waveAdr)).toEqual(
			expect.arrayContaining([
				"Status",
				"Context",
				"Decision",
				"Consequences",
				"Guardrail fit",
				"Rejected alternatives",
			]),
		);
		expect(headings(reviewerAdr)).toEqual(
			expect.arrayContaining([
				"Status",
				"Context",
				"Decision",
				"Consequences",
				"Rejected alternatives",
			]),
		);
		expect(reviewerAdr).toMatch(
			/sole lifecycle mutation[\s\S]+quarantine unreadable active state[\s\S]+recovery maintenance/i,
		);
		expect(reviewerAdr).toMatch(
			/source-binding rejection[\s\S]+not redispatched/i,
		);
		expect(headings(continuationAdr)).toEqual(
			expect.arrayContaining([
				"Status",
				"Context",
				"Decision",
				"Simplicity boundary",
				"Consequences",
				"Rejected alternatives",
			]),
		);
		expect(continuationAdr).toMatch(
			/ready[\s\S]+flow_run_start[\s\S]+planning awaiting `flow_plan_approve`[\s\S]+await-user-direction[\s\S]+blocked or ready[\s\S]+conversational\s+checkpoints[\s\S]+same-revision reply[\s\S]+remains\s+waiting[\s\S]+user turns outside[\s\S]+recognized\s+checkpoint[\s\S]+fail closed/i,
		);
		expect(continuationAdr).toMatch(
			/provisional continuation[\s\S]+baseline[\s\S]+from idle[\s\S]+accepted non-replayed[\s\S]+flow_plan_save[\s\S]+OpenCode host[\s\S]+created Flow session/i,
		);
		expect(continuationAdr).toMatch(
			/active baseline[\s\S]+temporal check[\s\S]+pending reviewer[\s\S]+unchanged[\s\S]+already-ready baseline[\s\S]+replacement Flow session fail closed/i,
		);
		expect(continuationAdr).toMatch(
			/accepted[\s\S]+non-replayed manager mutation observed in the same OpenCode host session[\s\S]+another host cannot establish[\s\S]+authority[\s\S]+mechanical projection must equal the credited mutation revision[\s\S]+single state-constrained reviewer-result revision[\s\S]+authenticated `flow_review_start`/i,
		);
		expect(continuationAdr).toMatch(
			/tool invocation's assistant message ID[\s\S]+cached[\s\S]+`message\.updated` `parentID`[\s\S]+authoritative user reply ID[\s\S]+missing[\s\S]+mapping or different parent fails closed[\s\S]+trigger assistant parented by the[\s\S]+current reply[\s\S]+automatic compaction marker[\s\S]+summary assistant parented by[\s\S]+compaction user[\s\S]+successor user[\s\S]+authority[\s\S]+remain unchanged[\s\S]+lineage fails closed/i,
		);
		expect(continuationAdr).toMatch(
			/provenance is process-local and does not[\s\S]+enter Session v5[\s\S]+clarification[\s\S]+same recognized checkpoint revision[\s\S]+re-arms[\s\S]+waiting/i,
		);
		expect(continuationAdr).toMatch(
			/canonical manager\s+kernel[\s\S]+`failedReviewCount === 1` retry gate[\s\S]+without a scope blocker[\s\S]+not a new authority registry or persisted policy model/i,
		);
		expect(continuationAdr).toMatch(
			/34,000-byte manager envelope[\s\S]+4 KiB[\s\S]+29,904 UTF-8 bytes[\s\S]+exactly one compiled auto[\s\S]+one raw plan[\s\S]+one raw run[\s\S]+rewritten command[\s\S]+one 4 KiB argument[\s\S]+included exactly once[\s\S]+visible wrapper[\s\S]+inside[\s\S]+34,000-byte envelope[\s\S]+attachments[\s\S]+repeated[\s\S]+dynamic loads[\s\S]+outside/i,
		);
		expect(continuationAdr).toMatch(
			/`\/flow-auto stop`[\s\S]+`\/flow-auto cancel`[\s\S]+revoke[\s\S]+process-local\s+lease[\s\S]+without mutating[\s\S]+durable Flow session/i,
		);
		expect(continuationAdr).toMatch(
			/autoTiming[\s\S]+activeMs[\s\S]+not CPU time or pure[\s\S]+waitingForUserMs[\s\S]+flow_plan_approve[\s\S]+await-user-direction[\s\S]+paused, inactive,\s+errored, and unprojected[\s\S]+non-authoritative[\s\S]+never enters Session v5[\s\S]+TypeScript implementation[\s\S]+200 KiB UTF-8[\s\S]+1,000-line per-file[\s\S]+formatting cannot hide\s+growth[\s\S]+separate prompt\s+envelopes/i,
		);
		expect(continuationAdr).toMatch(
			/latest relevant reviewed outcome remains failed[\s\S]+never chosen\s+implicitly[\s\S]+untouched[\s\S]+dependency-independent[\s\S]+only retry-required candidates[\s\S]+ready[\s\S]+await-user-direction/i,
		);
		expect(continuationAdr).toMatch(
			/blocked checkpoint[\s\S]+nextFeatureId[\s\S]+atomically[\s\S]+failed run is already superseded[\s\S]+ready checkpoint[\s\S]+flow_run_start\(featureId\)[\s\S]+reset is invalid[\s\S]+no durable\s+hold, retry ledger/i,
		);
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
		expect(
			section(
				await readFile("docs/development.md", "utf8"),
				"Model-driven auto-continuation evidence",
			),
		).toMatch(
			/promptAsync[\s\S]+idle `ready`[\s\S]+clarification[\s\S]+same-host accepted approval[\s\S]+exactly once[\s\S]+other-host[\s\S]+does not[\s\S]+compaction[\s\S]+automatic fresh retry only at `failedReviewCount === 1`[\s\S]+without a[\s\S]+`\[scope-blocker\]`[\s\S]+every higher count awaiting user direction[\s\S]+stable finding IDs[\s\S]+baseline facts[\s\S]+prior dispositions[\s\S]+transition matrix[\s\S]+completed closure[\s\S]+conversational disposition map[\s\S]+`workflowData\.delivery`[\s\S]+opt-in provider canary[\s\S]+not a CI model\s+evaluation/i,
		);
		expect(maintainer).toMatch(
			/workspace digest recomputed at persistence[\s\S]+differs[\s\S]+digest recorded when validation was armed[\s\S]+source-drifted[\s\S]+permanently\s+ineligible[\s\S]+endpoint comparison[\s\S]+does not\s+detect a transient edit[\s\S]+returns to the armed bytes/i,
		);
		expect(maintainer).toMatch(
			/returning to an older source digest does not revive[\s\S]+accepted same-schema Session v5[\s\S]+grandfathered/i,
		);
		expect(
			section(troubleshooting, "Validation capture was cancelled"),
		).toMatch(
			/recordedRevision[\s\S]+only a concurrency token[\s\S]+passed: true[\s\S]+runtime\s+review gate[\s\S]+passed: false[\s\S]+fresh validation[\s\S]+never review[\s\S]+no status refresh[\s\S]+endpoint comparison[\s\S]+transient edit[\s\S]+15\s+minutes[\s\S]+begins[\s\S]+after-hook/i,
		);
		expect(
			section(troubleshooting, "Completion says workspace content changed"),
		).toMatch(/Reset the feature[\s\S]+Do not redispatch/i);
		expect(
			section(
				troubleshooting,
				"Status shows a closed session still awaiting archive publication",
			),
		).toMatch(
			/exactly once[\s\S]+without rewriting[\s\S]+manualRecoveryRequired[\s\S]+no `archiveRetry`[\s\S]+do not overwrite, delete, or loop/i,
		);
		expect(changelog).toMatch(/^## \[Unreleased\]$/m);
		const unreleased = section(changelog, "[Unreleased]");
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
		const currentChangeNotes = /No changes yet\./i.test(unreleased)
			? currentReleaseNotes
			: unreleased;
		expect(currentChangeNotes).toMatch(
			/`\/flow-auto stop`[\s\S]+`\/flow-auto cancel`[\s\S]+process-local[\s\S]+without[\s\S]+mutating the durable Flow session/i,
		);
		expect(currentChangeNotes).toMatch(
			/tool assistant[\s\S]+cached[\s\S]+`message\.updated` parentage[\s\S]+authoritative user reply[\s\S]+provenance fails closed[\s\S]+trigger[\s\S]+automatic compaction marker[\s\S]+summary assistant[\s\S]+successor user[\s\S]+authority remains unchanged[\s\S]+lineage[\s\S]+fails closed/i,
		);
		expect(currentChangeNotes).toContain("The Session v5 schema is unchanged.");
		expect(currentChangeNotes).not.toMatch(
			/public surface (?:is|are) unchanged/i,
		);
		expect(currentReleaseNotes).toContain(
			`opencode plugin opencode-plugin-flow@${packageVersion} --global --force`,
		);
	});

	test("keeps CI focused on normal checks, platforms, live smoke, and release", async () => {
		const workflowNames = (await readdir(".github/workflows"))
			.filter((name) => name.endsWith(".yml"))
			.sort();
		const workflows = await Promise.all(
			workflowNames.map((name) =>
				readFile(join(".github/workflows", name), "utf8"),
			),
		);
		const combined = workflows.join("\n");

		expect(workflowNames).toEqual([
			"ci.yml",
			"opencode-compatibility.yml",
			"release.yml",
		]);
		expect(combined).toContain("bun run check");
		expect(combined).toContain("bun run smoke:live");
		expect(combined).toContain("tests/workspace-persistence.test.ts");
		expect(combined).toContain("npm publish");
		expect(combined).not.toMatch(
			/harness|lifecycle-soak|cross-version|replay-report|prompt:model-eval/i,
		);
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
