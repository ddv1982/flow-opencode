# OpenCode Plugin Rebuild: Plan

> **Superseded (2026-06-12).** This plan is retained as a historical record. The current direction — skills as the primary instruction surface, the plugin reduced to a thin state backend, tools consolidated to ~7, npm distribution — is defined in [`docs/plans/skills-first-overhaul-2026-06-12.md`](skills-first-overhaul-2026-06-12.md). Details below (mode contracts, generated prompt/skill projections, the gate matrix) describe surfaces that have since been removed.

## Goal

Rebuild the OpenCode plugin directly on `main` as a lighter, faster adapter-first vNext: keep the load-bearing runtime/session safety that prevents corrupt sessions and false completion, but remove the current heavy orchestration posture from the default coding path so ordinary work feels closer to RepoPrompt/Codex-style assistance.

## Background

- Current git state was clean on `main` when this plan was drafted. Implementation is allowed to proceed directly on `main`; no feature branch is required for this rebuild.
- The public package entrypoint is already small: `src/index.ts` default-exports the OpenCode plugin, and `src/adapters/opencode/plugin.ts:101` returns `config`, `tool`, and hooks for `tool.definition`, `experimental.chat.system.transform`, and `experimental.session.compacting`.
- The OpenCode SDK boundary is isolated in `src/adapters/opencode/sdk.ts`; tests assert runtime/core do not import the adapter or OpenCode packages (`tests/config/plugin-surface.test.ts:185`).
- Tool names, runtime bindings, mutation classes, mode visibility, host descriptions, and docs metadata are centralized in `src/adapters/opencode/tool-surface/tool-registry.ts:9`; `createTools` validates actual tools against registry names in `src/adapters/opencode/tools.ts:27`.
- The supported simplification contract says the persisted `Session` snapshot remains the state shape, `src/runtime/transitions/**` owns transitions, `src/runtime/application/session-engine.ts` remains the mutation persistence gate, and OpenCode tools should stay thin (`docs/architecture/flow-core-vnext-contract.md:5`).
- That same contract allows descriptor/projection bridge metadata only when it is generated from or checked against the small registry and actively used by tools, docs, prompts, or tests (`docs/architecture/flow-core-vnext-contract.md:36`).
- The mutation path is robust but heavy: `SessionMutationAction` requires transition, session extraction, success/noop/error handling, failure recording, clearing failed attempts, and artifact sync controls (`src/runtime/application/session-engine.ts:40`); `runSessionMutationActionAtRoot` loads the snapshot, records failures, handles noop mutation, and syncs artifacts by default (`src/runtime/application/session-engine.ts:185`).
- Runtime workflow policy owns completion targets and decision gates (`src/runtime/domain/workflow-policy.ts:1`), including detailed final review by default (`src/runtime/domain/workflow-policy.ts:47`) and pause semantics for `recommend_confirm` / `human_required` (`src/runtime/domain/workflow-policy.ts:129`).
- Completion gates are broad and strict today: validation evidence, reviewer decisions, validation scope, feature/final review payloads, review-scope accounting, and review-finding closure are represented in `src/runtime/transitions/completion-gates.ts:3` and locked by `tests/runtime/completion-gate-descriptors.test.ts`.
- Prompt/mode contracts are first-party policy surfaces: `src/prompts/mode-contracts.ts:1` owns mode permissions and required behavior, and `src/prompts/contracts.ts:14` imposes plan shape, decomposition, completion/delivery policy, review scope, and strict-review rationale.
- Prompt, agent, command, and skill surfaces are projections from shared contract data under `src/prompts/generated/**`; tests such as `tests/config/prompt-contracts.test.ts` and prompt capture/eval scripts lock those projections.
- Skills are generated from `src/prompts/skills.ts` through `src/prompts/generated/skill-docs.ts` and bundled into OpenCode under `.config/opencode/skills` by `src/adapters/opencode/skill-bundle.ts:18`.
- Prior art warns against another broad runtime rewrite. `docs/investigations/simplify-flow-opencode-2026-05-07.md` found the durable live path was OpenCode tool → adapter dispatch → runtime application action → runtime transition → snapshot save/artifact sync, while removing replay/projection/duplicated metadata.
- `docs/architecture/role-protocol-projections.md` records source-of-truth order: runtime/domain policy owns enforcement, tool modules own dispatch constants, and prompts are projections.
- `docs/plans/opencode-plugin-upgrade-2026-05-10.md` kept SDK upgrades separate from prompt/runtime simplification and preserved runtime transitions, completion/recovery gates, reviewer decisions, persistence, and `.flow/**` ownership.
- `docs/investigations/newest-opencode-plugin-regression-2026-05-08.md` found no proven reason to loosen the SDK boundary or schema strictness; future SDK work should keep dependency-contract, schema/plugin tests, type inspection, and typecheck together.
- Current OpenCode docs, checked May 31, 2026, describe plugins as JS/TS modules exporting plugin functions that receive `{ project, client, $, directory, worktree }` and return hooks/tools. Project plugins load from `.opencode/plugins/`, global plugins from `~/.config/opencode/plugins/`, and npm plugins are listed in `opencode.json` under `plugin` and installed by Bun into `~/.cache/opencode/node_modules/`.
- Current OpenCode plugin hooks include `tool.execute.before`, `tool.execute.after`, `shell.env`, `event`, and `experimental.session.compacting`; plugin tools are registered under `tool: { name: tool({ description, args, execute }) }` and use `@opencode-ai/plugin` / `tool.schema`.

## Approach

### Locked decisions

1. **Work directly on `main`.** The rebuild may proceed in-place on `main`; do not require a feature branch or experimental side entrypoint before starting.
2. **Keep package/install stability.** Keep package name `opencode-plugin-flow`, `dist/index.js`, global install path `~/.config/opencode/plugins/flow.js`, generated skills path `~/.config/opencode/skills`, and existing install/uninstall ownership guarantees.
3. **Do not reopen persistence architecture.** The May 3 event-log/checkpoint rewrite remains rejected/deferred for this repo state; the supported product path stays snapshot-first `.flow/**` persistence through the Flow Core facade and `session-engine.ts`.
4. **Make the rebuild adapter-first/default-workflow-first.** The target is a smaller OpenCode composition root, smaller system context, slimmer prompts/skills, registry-owned tool metadata, and lighter ordinary completion semantics.
5. **Preserve strict safety where it is load-bearing.** SDK/zod strictness, schema parsing, mutable workspace/root guards, snapshot persistence, transition-owned state changes, validation evidence, validation scope, final-review policy matching, recovery metadata, and install ownership checks remain always-on.
6. **Quarantine strict review/accounting.** Recorded reviewer decisions, review-scope ledgers, finding-closure ledgers, and detailed review governance should stay required for `review`, `review_and_fix`, or explicit `deliveryPolicy.strictReview`, but should not slow the default implementation path.
7. **Adopt vNext defaults for unannotated implementation sessions.** Do not migrate snapshots. Existing sessions with persisted `goalMode`, `deliveryPolicy.finalReviewPolicy`, or `deliveryPolicy.strictReview` keep those semantics; unannotated implementation sessions resumed under vNext use the new ordinary fallback policy.

### Target architecture

- **OpenCode adapter:** `src/adapters/opencode/plugin.ts` remains the composition root, but heavy runtime/profile/context imports should move behind narrow helpers or lazy boundaries where practical. The plugin still returns `{ config, tool, hooks }` and keeps existing hook names.
- **Context injection:** OpenCode gets an adapter-owned compact context helper, preferably `src/adapters/opencode/system-context.ts`, while `src/prompt-system-context.ts` is reduced to shared/pure rendering only if still needed. Default chat should receive no Flow context when no active session exists. With an active session, inject only a compact marker, goal, phase, active feature summary, blocker/recovery summary when present, and next action hint. Cached stack/standards profile should not be ambient chat context.
- **Tool registry:** `OPENCODE_TOOL_REGISTRY` remains the canonical OpenCode tool metadata source. Before deleting generated projection/guidance files, create a consumer inventory. Files with production consumers become thin registry projections; files consumed only by parity tests or stale docs are removed with those tests rewritten around registry/runtime/schema consistency.
- **Runtime seam:** adapter tools continue to parse args, enforce mutability, call `executeFlowCoreCommand` / `runFlowCoreCommand` / `runFlowCoreQuery`, and let transitions/session-engine own state and persistence.
- **Completion policy:** ordinary implementation completion should require passing validation and review payloads, but not separate recorded reviewer decisions. Strict/review paths keep the current high-assurance gates.
- **Prompt/config:** command and agent names remain stable for continuity, but default prompts shrink to role boundary, allowed/forbidden tools, `.flow/**` ownership warning, compact tool ordering, stop condition, and a pointer to skills for details.
- **Skills:** keep `flow-plan`, `flow-run`, and `flow-review` as generated instruction surfaces. Move detailed review/audit guidance into `flow-review`, not default system context or ordinary command prompts.
- **Validation:** prove the rebuild with cold-start measurements, prompt/context-size checks, OpenCode tool schema size/bloat checks, default command/agent/tool surface counts, ordinary workflow smoke tests, strict workflow preservation tests, package/install lifecycle tests, and representative runtime recovery tests.

### Preserve / delete / quarantine

| Category | Preserve | Delete or demote | Quarantine to strict/review paths |
| --- | --- | --- | --- |
| SDK boundary | `src/adapters/opencode/sdk.ts`, zod/OpenCode alignment, raw arg parsing | Dependency changes without SDK-boundary review | n/a |
| Runtime state | `Session` snapshot, `.flow/**`, `session-engine.ts`, transitions | Event log, checkpoints, replay-first engine, projection stores | n/a |
| Tool surface | Existing tool names, registry ordering, Flow Core dispatch | Generated host guidance that restates registry/runtime law | Review tools as explicit strict/review tools |
| Completion | Validation evidence, validation pass, scope checks, feature/final review payloads, recovery metadata | Default mandatory reviewer-decision ceremony | Recorded reviewer decisions, review ledgers/accounting |
| Prompts | Mode contracts as data, stable command/agent names | Long workflow-law prose in default prompts | Detailed review/audit instructions in `flow-review` skill |
| Install | Package name/export/install path, skill ownership safety | Experimental vNext package/entrypoint for first rebuild | n/a |

## Work Items

### Item 1 — Confirm the `main` baseline and freeze stability decisions

**Goal:** Start the rebuild from the current `main` worktree while explicitly locking the decisions that keep scope focused.

**Done when:**
- The implementer confirms the `main` worktree state before starting substantial edits.
- The implementation notes document that package/install path, snapshot persistence, Flow Core facade, and SDK strictness are preserved.
- No runtime rewrite, package rename, feature-branch prerequisite, or experimental install path is introduced in this item.

**Key files:**
- `package.json`
- `src/index.ts`
- `docs/architecture/flow-core-vnext-contract.md:5`
- `docs/architecture/strictness-contract.md`
- `docs/plans/opencode-plugin-rebuild-2026-05-31.md`

**Dependencies:** None.

**Size:** Small.

### Item 2 — Add compact-context contract tests before changing hooks

**Goal:** Pin the desired ambient-context behavior so the plugin no longer injects heavy Flow/profile context into ordinary chats.

**Done when:**
- Tests specify the stable compact-context contract: no active session injects zero Flow lines; active session injects only compact session facts; cached profile is not injected into every no-session chat; persisted session text remains quoted/untrusted.
- Existing plugin shape expectations still assert `config`, `tool`, `tool.definition`, `experimental.chat.system.transform`, and `experimental.session.compacting`.

**Key files:**
- `src/adapters/opencode/plugin.ts:38`
- `src/prompt-system-context.ts`
- `tests/config/plugin-surface.test.ts`

**Dependencies:** Item 1.

**Size:** Medium.

### Item 3 — Slim the plugin composition root and context hooks

**Goal:** Keep the OpenCode plugin shape stable while removing ambient profile bloat and reducing heavy module-scope runtime coupling.

**Done when:**
- `src/adapters/opencode/plugin.ts` still returns the same public hook/tool/config shape.
- No-session chats receive no Flow runtime/profile context.
- Active-session context contains only compact session state and action hints.
- Runtime/profile reads are routed through an adapter-owned compact context helper (prefer `src/adapters/opencode/system-context.ts`) or lazy helper boundaries, without breaking hook registration.
- `ctx.client.app.log` initialization behavior remains covered.

**Key files:**
- `src/adapters/opencode/plugin.ts:101`
- `src/adapters/opencode/sdk.ts`
- `src/adapters/opencode/system-context.ts` (new or renamed helper)
- `src/prompt-system-context.ts`
- `src/runtime/application/index.ts`
- `tests/config/plugin-surface.test.ts`

**Dependencies:** Item 2.

**Size:** Medium.

### Item 4 — Split ordinary completion from strict review governance

**Goal:** Make ordinary coding completion lighter without weakening validation, recovery, or explicit review-mode safety.

**Done when:**
- `strictReviewGovernanceRequiredForPlan(plan)` remains the central policy question for recorded reviewer decisions and review accounting.
- Existing sessions with explicit review/strict policy keep strict behavior; unannotated implementation sessions use vNext ordinary fallback policy when resumed.
- Ordinary feature completion can succeed with passing targeted validation and passing `featureReview` payload, without `flow_review_record_feature`.
- Ordinary final completion can succeed with broad validation and passing `finalReview` matching policy, without `flow_review_record_final`.
- `review`, `review_and_fix`, and explicit `deliveryPolicy.strictReview` still require reviewer decisions and review accounting as applicable.
- Recovery metadata remains structured and accurate when validation/review requirements fail.

**Key files:**
- `src/runtime/domain/workflow-policy.ts:47`
- `src/runtime/transitions/completion-gates.ts:3`
- `src/runtime/transitions/execution-completion-validation.ts`
- `src/runtime/transitions/execution-completion-review-gates.ts`
- `src/runtime/transitions/execution-completion-finalization.ts`
- `src/runtime/transitions/plan.ts`
- `tests/runtime/final-completion-gates.test.ts`
- `tests/runtime/completion-gate-descriptors.test.ts`
- `tests/runtime/semantic-invariants.test.ts`

**Dependencies:** Item 1.

**Size:** Large.

### Item 5 — Rebuild the prompt/config fallback surfaces around settled mode policy

**Goal:** Keep command/agent stability while removing prompt-law verbosity from default coding workflows.

**Done when:**
- `src/adapters/opencode/config.ts` still injects stable Flow command and agent names.
- `src/prompts/mode-contracts.ts` keeps durable mode boundaries, mutation permissions, allowed/forbidden tools, and stop conditions, but reflects the settled ordinary-vs-strict completion policy from Item 4.
- Generated command/agent prompts include only compact role boundary, tool visibility, `.flow/**` ownership warning, stop condition, and skill pointer.
- Prompt capture/eval fixtures are rebaselined around boundaries and tool use rather than old prose volume.

**Key files:**
- `src/adapters/opencode/config.ts:47`
- `src/prompts/mode-contracts.ts:1`
- `src/prompts/generated/command-templates.ts`
- `src/prompts/generated/role-prompts.ts`
- `tests/config/prompt-contracts.test.ts`
- `tests/prompt-mode-capture.test.ts`
- `tests/prompt-mode-behavior-eval.test.ts`

**Dependencies:** Items 3 and 4.

**Size:** Large.

### Item 6 — Regenerate skills as detailed opt-in guidance, not default prompt load

**Goal:** Preserve generated skill install behavior while moving detailed workflow/review instructions out of ordinary command/system prompts.

**Done when:**
- The generated skill set remains `flow-plan`, `flow-run`, and `flow-review`.
- `flow-review` owns detailed review/audit guidance; default command/agent prompts only point to skills when extra guidance is needed.
- Skill docs remain generated, hash-marked, idempotent, and protected against overwriting user-managed files.
- Install/uninstall and release skill bundle behavior remains unchanged.

**Key files:**
- `src/prompts/skills.ts:14`
- `src/prompts/generated/skill-docs.ts:34`
- `src/adapters/opencode/skill-bundle.ts:18`
- `scripts/cross-area/write-release-skill-bundle.ts`
- `tests/config/skill-bundle.test.ts`
- `tests/cross-area/install-lifecycle.test.ts`

**Dependencies:** Item 5.

**Size:** Medium.

### Item 7 — Clean generated projection/guidance duplication behind registry authority

**Goal:** Keep the small registry as the adapter/tool source of truth and remove projection metadata that exists only to enforce the old heavy surface.

**Done when:**
- `OPENCODE_TOOL_REGISTRY` remains the canonical owner of OpenCode tool names, descriptions, runtime bindings, mutation class, and mode visibility.
- A consumer inventory identifies which generated files are imported by production/runtime/docs generation versus parity tests only.
- Generated files such as tool projections, guidance, docs rows, and descriptors either become thin registry views with production consumers or are removed when only stale tests/docs consume them.
- Parity tests assert registry/runtime/schema consistency instead of preserving duplicated generated prose.
- Public tool names remain stable in the first vNext.

**Key files:**
- `src/adapters/opencode/tool-surface/tool-registry.ts:9`
- `src/adapters/opencode/tool-projections.generated.ts`
- `src/adapters/opencode/tool-guidance.generated.ts`
- `src/adapters/opencode/tool-surface/descriptors.ts`
- `src/adapters/opencode/tool-surface/docs-rows.generated.ts`
- `tests/config/tool-schemas.test.ts`
- `tests/descriptor-family-parity.test.ts`

**Dependencies:** Items 5 and 6.

**Size:** Medium.

### Item 8 — Preserve package/install stability and SDK strictness

**Goal:** Prove the rebuild still installs, loads, and uninstalls like the current plugin and does not loosen the OpenCode SDK/schema bridge.

**Done when:**
- Package name, main/export, install target, uninstall behavior, and generated skill paths are unchanged.
- `@opencode-ai/plugin` / `zod` alignment is preserved unless a separate SDK-boundary decision updates both with tests.
- User-managed plugin/skill files are not overwritten silently.
- Tool arg schemas remain strict and runtime-owned payload schemas are not widened to hide adapter issues.

**Key files:**
- `package.json`
- `src/installer.ts`
- `src/install-opencode.ts`
- `src/uninstall-opencode.ts`
- `src/adapters/opencode/sdk.ts`
- `src/adapters/opencode/tool-surface/schemas.ts`
- `tests/install.test.ts`
- `tests/cross-area/install-lifecycle.test.ts`
- `tests/config/tool-schemas.test.ts`

**Dependencies:** Items 3, 6, and 7.

**Size:** Medium.

### Item 9 — Add usability/performance gates for the lighter default workflow

**Goal:** Measure the reason for the rebuild instead of relying on subjective prompt feel.

**Done when:**
- Cold-start budget remains below the existing hard threshold and records whether median import improved from the pre-rebuild `main` baseline.
- Prompt/system-context capture tests show material shrinkage in default command/agent/system context output.
- Tool schema size/bloat checks and default command/agent/tool surface counts are recorded; reductions are preferred but continuity-preserving stability is acceptable when justified.
- Ordinary workflow smoke tests cover a one-feature implementation and final completion without recorded reviewer decisions.
- Strict/review smoke tests prove high-assurance paths still require reviewer decisions/accounting.
- `bench/BASELINE.md` is updated only after measurements are taken.

**Key files:**
- `scripts/cross-area/cold-start-budget.mjs`
- `bench/BASELINE.md`
- `bench/RESULTS.md`
- `tests/config/plugin-surface.test.ts`
- `tests/runtime/final-completion-gates.test.ts`
- `tests/prompt-mode-capture.test.ts`
- `tests/prompt-mode-behavior-eval.test.ts`

**Dependencies:** Items 3, 4, and 5.

**Size:** Medium.

### Item 10 — Final integration gate and release notes

**Goal:** Finish with a verified vNext branch that can be reviewed as a rebuild without surprising install/runtime regressions.

**Done when:**
- Required focused checks pass: plugin surface, tool schemas, skill bundle, install lifecycle, completion gates, semantic invariants, workspace root guard, prompt capture/eval, and cold-start budget.
- Full checks pass or any remaining benchmark variance is documented according to existing bench-gate rules.
- Release notes summarize the user-visible behavior change: same package/install path, lighter default coding flow, strict review still available for review/review-and-fix/explicit strict sessions.

**Key files:**
- `CHANGELOG.md`
- `docs/releases/<next-version>.md`
- `.github/workflows/ci.yml`
- `package.json`
- `tests/cross-area/bench-gate.test.ts`

**Dependencies:** Items 1–9.

**Size:** Medium.

## Implementation Progress

- [x] Items 1–3 — Foundation and compact context hooks. Implemented `src/adapters/opencode/system-context.ts`, slimmed `src/adapters/opencode/plugin.ts`, added compact-context contract coverage in `tests/config/plugin-surface.test.ts`, and recorded stability decisions in `docs/plans/opencode-plugin-rebuild-foundation-notes-2026-05-31.md`. Focused checks reported passing: plugin surface/tool schemas, typecheck, dependency contract, architecture seams, and cold-start budget.
- [x] Item 4 — Ordinary-vs-strict completion policy. Updated completion review gates so default implementation completion relies on validation/review payloads while strict/review paths still require reviewer decisions/accounting; focused runtime checks reported passing.
- [x] Items 5–6 — Prompt/config and generated skill slimming. Slimmed generated command/agent fallback prompts, updated mode-contract wording for ordinary-vs-strict completion, preserved `flow-plan`/`flow-run`/`flow-review`, and moved detailed review/audit guidance into `flow-review`; focused prompt/eval/skill checks reported passing.
- [x] Items 7–8 — Registry/projection cleanup and install/SDK stability proof. Kept `OPENCODE_TOOL_REGISTRY` canonical, retained production guidance as a thin registry projection, removed stale/test-only projection surfaces, rewrote parity checks around registry/runtime/schema/docs consistency, and added package/install stability pins; focused build/smoke/install/schema checks reported passing.
- [x] Item 9 — Performance/usability gates. Added compact prompt/context budget assertions, recorded command/agent/tool surface counts, recorded cold-start comparison against the local pre-rebuild main artifact baseline, added ordinary one-feature completion smoke coverage without recorded reviewer decisions, and verified strict/review gates still require reviewer decisions/accounting. Measurements are recorded in `docs/plans/opencode-plugin-rebuild-performance-notes-2026-06-01.md`; focused prompt, schema, cold-start, bench, install, and architecture checks reported passing.
- [x] Item 10 — Full validation and release notes. Audited the v2.0.53 release notes against the actual final gate, kept release claims scoped to the same package/install path plus lighter default coding flow and preserved strict review paths, and verified `bun run check` end-to-end after Biome formatting fixes. Follow-up release metadata validation passed after `package.json` and the changelog declared `2.0.53`. Final gate included typecheck, prompt/review capture checks, dependency contract, architecture seams, fresh-surface/deadcode checks, build, release hygiene, pack invariants, completion lane, replay tests, cold-start budget, bundle sanity, full test suite, lint, `bench:smoke`, and `bench:gate`.

## Validation Plan

Minimum focused checks before full CI:

- `bun run typecheck`
- `bun run check:dependency-contract`
- `bun run check:architecture-seams:enforce`
- `bun run check:cold-start-budget`
- `bun run test:replay`
- `bun test tests/config/plugin-surface.test.ts tests/config/tool-schemas.test.ts tests/config/skill-bundle.test.ts`
- `bun test tests/runtime/final-completion-gates.test.ts tests/runtime/completion-gate-descriptors.test.ts tests/runtime/semantic-invariants.test.ts`
- `bun test tests/install.test.ts tests/cross-area/install-lifecycle.test.ts tests/workspace-root-guard.test.ts`
- Prompt capture/eval checks from `package.json` after prompt rebaseline.

Final gate before merge:

- `bun run check`
- `bun run bench:smoke`
- `bun run bench:gate`

## Risks and Mitigations

- **Completion gate regression:** ordinary flows dropping recorded reviewer decisions could accidentally weaken strict/review modes. Mitigate with paired tests: ordinary succeeds without reviewer decision; strict/review paths fail without it.
- **Prompt eval churn:** slimming prompts will invalidate old prose assertions. Rebaseline around durable boundaries, tool use, and stop conditions rather than old wording.
- **Cold-start lazy import regressions:** moving imports behind helpers can break hook behavior if done too aggressively. Keep plugin return-shape tests and add context-hook tests before refactor.
- **Install stability drift:** preserving package path means users get vNext in the same install slot. Keep install lifecycle/ownership tests unchanged unless a test encodes old prompt text rather than install behavior.
- **Rollback asymmetry:** sessions completed under lightweight ordinary rules may lack reviewer-decision artifacts older code expected for in-progress completion. Avoid persistence migrations and document that rollback is package reinstall, not session conversion.

## Open Questions

None blocking. The plan chooses the safer defaults: same package/install path, no experimental vNext entrypoint, no event-log rewrite, and strict review quarantined to explicit review paths.

## References

- `docs/architecture/flow-core-vnext-contract.md`
- `docs/architecture/role-protocol-projections.md`
- `docs/architecture/strictness-contract.md`
- `docs/investigations/simplify-flow-opencode-2026-05-07.md`
- `docs/investigations/ground-up-rewrite-2026-05-03.md`
- `docs/investigations/newest-opencode-plugin-regression-2026-05-08.md`
- `docs/plans/opencode-plugin-upgrade-2026-05-10.md`
- OpenCode plugin docs: https://opencode.ai/docs/plugins/
- OpenCode config docs: https://opencode.ai/docs/config/
- OpenCode custom tools docs: https://opencode.ai/docs/custom-tools/
