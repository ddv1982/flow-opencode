# Skills-First Overhaul (v3): Plan

Drafted 2026-06-12 against `main` at v2.0.56.

## Goal

Invert the Flow architecture so skills become the primary instruction and orchestration surface, and the plugin shrinks to a thin, safe state backend. Keep what code is uniquely good at — durable, atomic, schema-validated `.flow/**` persistence, a few hard invariants, and the compaction hook — and move all orchestration judgment (what to do next, how to plan, how deep to review, how to recover) into hand-authored skill files. Target roughly 23.5k → ~8k LOC in `src/`, bundle 752KB → under 100KB, 18 gate scripts → ~6, 18 tools → ~7, 6 agents → 1–2, with better output quality because authoring effort shifts from parity plumbing to the skill content that actually drives model behavior.

## Background (verified 2026-06-12)

### Current state of the plugin

- v2.0.56: 23,477 LOC TypeScript in `src/`, 752KB minified bundle, 18 custom tools, 6 agents, 9 slash commands, 3 hash-locked generated skills, 99 test files, 18 cross-area gate scripts. The last ~18 releases (2.0.43–2.0.56) contain no feature work — all internal hardening.
- The `effect` dependency is `4.0.0-beta.59` and is used for exactly one `runPromise` call (`src/adapters/opencode/tool-surface/mutable-workspace-permission.ts:2`). Per the sourcemap, `effect` contributes ~545KB of pre-minify source to the bundle and `zod` ~444KB (including all locale files); `src/` itself is ~664KB.
- Guidance is maintained in three synchronized layers: runtime mode contracts (`src/prompts/mode-contracts.ts`, 381 LOC, 8 modes), generated fallback prompts baked into every command/agent (`src/prompts/generated/command-templates.ts`, `src/prompts/generated/role-prompts.ts`), and generated hash-locked SKILL.md files (`src/prompts/generated/skill-docs.ts`, installed by `src/adapters/opencode/skill-bundle.ts`). Synchronization requires capture scripts (`scripts/cross-area/review-prompt-capture.ts` 631 LOC, `scripts/cross-area/prompt-mode-capture.ts` 599 LOC), parity tests (descriptor-family, docs-semantic, docs-tool, protocol-parity), and a terminology-drift regex scanner (`scripts/cross-area/fresh-surface-terminology.mjs`).
- "What happens next" is encoded three times: the `flow-auto` coordinator agent, the `flow_auto_prepare` classification tool, and the transitions/completion-gates machinery (`src/runtime/transitions/completion-gates.ts` 338 LOC plus `completion-gate-projections.generated.ts` 200 LOC — a 9-gate matrix with governance variants that reduces to 4–5 real checks).
- Review scope/coverage/risk accounting spans ~14 files / ~2,400 LOC under `src/runtime/domain/` (`final-review-*`, `review-scope-*`). Much of it validates the *shape* of model-authored review evidence; the 2.0.x changelog is largely a history of patching ways models confused these validators.
- Stack-standards profiling spans 12 files / 1,344 LOC (`src/runtime/application/stack-standards-*`): deterministic scanners, fingerprinting, and an LRU cache to detect what stack a repo uses — work the model does natively when instructed.
- Session mutation logic is split across three monoliths: `src/runtime/application/session-actions.ts` (325 LOC), `session-workspace-actions.ts` (287 LOC), `session-mutation-finalization.ts` (260 LOC). Rendering spans seven `render-*` files (~800 LOC).
- Distribution is a curl installer + custom `src/installer.ts` (291 LOC) that copies a bundled `flow.js` to `~/.config/opencode/plugins/` and writes skills to `~/.config/opencode/skills/`.

### OpenCode native surfaces this plan relies on (docs checked 2026-06-12)

- **Skills** (https://opencode.ai/docs/skills): SKILL.md files discovered from `~/.config/opencode/skills/<name>/` and project `.opencode/skills/<name>/`, loaded on demand via the native `skill` tool. Frontmatter needs only `name` + `description`. Skill directories can carry supporting files for progressive disclosure. Pattern-based `permission.skill` config controls access per agent.
- **Agents** (https://opencode.ai/docs/agents): definable as markdown or config-injected JSON; per-agent `permission` supports glob patterns against tool names (e.g. `"flow_plan_*": "deny"`), which platform-enforces what mode contracts currently enforce by prompt + eval test. `reasoningEffort` passes through as a provider option.
- **Commands** (https://opencode.ai/docs/commands): markdown or config-injected, with `agent`, `subtask`, `$ARGUMENTS`, shell injection, and file references.
- **Plugins** (https://opencode.ai/docs/plugins): npm distribution via `"plugin": ["opencode-plugin-flow"]` in `opencode.json`; OpenCode installs with Bun and caches dependencies in `~/.cache/opencode/node_modules/`, so npm-distributed plugins do not need to bundle dependencies. Hooks used today (`config`, `tool`, `tool.definition` guidance, `experimental.chat.system.transform`, `experimental.session.compacting`) remain available.
- **Ecosystem precedent for startup skill-sync** (checked 2026-06-12): npm-distributed plugins that ship skills copy them to `~/.config/opencode/skills/` on first startup — `opencode-skill-creator` and `opencode-skills-collection` both do this, using a plugin-owned version-marker file in the skill folder, leaving folders without the marker untouched (they may belong to the user or another plugin), and backing up user-edited files instead of overwriting. Known caveat from that ecosystem: skills written during plugin init may only be discovered on the next OpenCode start; the established mitigation is documenting "restart after first install/update."

### Design judgment

The maintainer contract's "three-tier resilience" doctrine (runtime contracts → fallback prompts → skills) predates OpenCode's mature native skills and per-agent permissions. Skills ship with the plugin and load on demand; the "skills might be denied" fallback case does not justify a permanently maintained second projection of every prompt. Likewise, the gate matrix defends against model failure modes that are better handled by rubrics (models follow rubrics better than they satisfy adversarial schema validation) plus a small set of binary, code-enforced invariants.

## Target architecture

### Plugin: dumb-but-safe state backend (~3–4k LOC)

Keeps only what a skill can never guarantee:

- Atomic, locked, path-safe persistence of `.flow/**` session state (`session-workspace-io`, locks, workspace-root guards — unchanged).
- Zod schema validation of tool payloads at the SDK boundary.
- Hard invariants instead of a gate matrix:
  - A feature cannot be completed without recorded validation evidence.
  - A session cannot close as `completed` with unfinished features.
  - An approved plan cannot be mutated without an explicit reset.
  - If the session's review policy is strict, a reviewer decision must be recorded before completion.
- The compaction hook (`experimental.session.compacting`) — Flow state surviving compaction is the differentiator; keep and polish.
- `flow_status` returns state **plus a computed "suggested next step"** derived from session data — one place, replacing `flow_auto_prepare` and the coordinator's routing logic (grow from `session-tools/next-command-policy.ts`).

### Tool surface: 18 → ~7

| New tool | Replaces |
| --- | --- |
| `flow_status` (detail levels, includes next-step hint and doctor-style readiness) | `flow_status`, `flow_doctor`, `flow_auto_prepare` |
| `flow_plan_save` | `flow_plan_start`, `flow_plan_context_record`, `flow_plan_apply` |
| `flow_plan_approve` (optional feature subset param) | `flow_plan_approve`, `flow_plan_select_features` |
| `flow_run_start` | `flow_run_start` |
| `flow_feature_complete` (reset via param) | `flow_run_complete_feature`, `flow_reset_feature` |
| `flow_review_record` (`scope: feature\|final`) | `flow_review_record_feature`, `flow_review_record_final`, `flow_review_render` (render folds into record/status output) |
| `flow_session` (`activate\|close\|history\|show`) | `flow_session_activate`, `flow_session_close`, `flow_history`, `flow_history_show` |

### Skills: the brain (hand-authored, checked into repo, no generation, no hash locking)

```
skills/
  flow/SKILL.md            # the driving loop: check status → plan/run/review → repeat;
                           # stop conditions, when to ask the user, recovery playbook
  flow-plan/SKILL.md       # decomposition heuristics, feature sizing, auto-approve criteria
    references/planning-examples.md    # worked good/bad plans
  flow-run/SKILL.md        # one-feature discipline, validation evidence standards
    references/validation-rubric.md
  flow-review/SKILL.md     # review depth criteria, finding taxonomy, report format
    references/review-rubric.md
```

SKILL.md stays tight (~1–2KB each); deep methodology lives in `references/` loaded only when needed (progressive disclosure). This is where quality investment goes — today's skills are projections of mode contracts; hand-authored rubrics with worked examples improve plan/review quality more than gate code ever did.

Skill sync semantics (replacing the hash-lock model): each installed skill folder carries a plugin-owned version-marker file (e.g. `.flow-skill-version`). On startup the plugin installs or updates only folders carrying the marker; a user-edited SKILL.md is backed up (`SKILL.md.backup`) rather than refused or silently overwritten; folders without the marker are never touched. This makes skills user-editable and **per-project overridable** — a project can place `.opencode/skills/flow-plan/SKILL.md` to override the global skill, which becomes a documented feature (e.g. team-specific planning or review rubrics) instead of a violation.

### Agents: 6 → 1–2

- Keep `flow-reviewer` as a read-only subagent (fresh context for independent review is genuinely valuable). Enforce read-only via native per-agent permissions, not prompt contracts.
- Optionally keep a worker subagent for context isolation on large features; the `flow` skill makes delegation optional ("for large features, delegate; otherwise do it directly").
- Delete: `flow-auto` coordinator, `flow-planner`, `flow-planning-researcher`, `flow-control`, `flow-auditor` as separate agents. Built-in Build/Plan/Explore plus skills cover them.

### Commands: thin pointers

Each command becomes ~1–2 lines ("Load the `flow-plan` skill and plan: $ARGUMENTS"). Keep config-hook injection so the npm artifact stays self-contained, but there is nothing left to drift. Command names stay stable.

### What gets deleted entirely

- The `flow-auto` coordination lane: coordinator agent, `flow_auto_prepare`, handoff-evidence semantics (source of the 2.0.50–2.0.51 churn).
- `src/prompts/mode-contracts.ts` as a policy surface (native per-agent permissions replace `allowedFlowTools`/`forbiddenFlowTools`; the runtime still validates which mutations are legal per session state).
- All prompt generation and parity apparatus: `src/prompts/generated/**`, skill hash locking, both capture scripts, descriptor-family/docs-semantic/docs-tool/protocol-parity tests, fresh-surface-terminology gate. Replaced by one cheap test: every registered tool name appears in at least one skill.
- Stack-standards profiling (all 12 files; keep only package-manager detection ~100 LOC if doctor output needs it). The `flow-plan` skill instructs the agent to profile the repo itself and record findings in the plan payload.
- `completion-gate-projections.generated.ts` and the 9-gate matrix (replaced by the hard invariants above plus a plain decision tree for recovery hints, ~150 LOC).
- Most of `src/runtime/domain/final-review-*` and `review-scope-*` (~2,400 LOC → 3 modules: targets, coverage, risk; structural validation only — quality moves to the review rubric).
- The curl installer and `src/installer.ts` (npm distribution; a slim idempotent skill-sync at plugin startup replaces `skill-bundle.ts`).
- `prompt-exports/` (session artifacts, not source).

### What stays untouched

Atomic writes, locking, path-traversal guards, workspace-root safety, snapshot-primary persistence (`.flow/**/session.json` at schema v1), zod validation at the SDK boundary, the compaction hook.

## Phases

Release mapping: Phase 1 ships as **v2.1.0** (additive, no behavior change). Phases 2+3 ship together as **v3.0.0** (the skill inversion and runtime simplification are coupled — commands/agents point at skills that describe the new tool surface). Phase 4 lands as **v3.0.x** cleanup. Phase 5 is ongoing from **v3.1**.

### Phase 1 — Free wins, no behavior change (v2.1.0)

1. Drop `effect`: replace the single `runPromise` call in `mutable-workspace-permission.ts` with a plain `await`. Removes a beta dependency and roughly a third of the bundle.
2. Switch distribution to npm: publish so users add `"plugin": ["opencode-plugin-flow"]` to `opencode.json`; `zod` becomes a regular resolved dependency instead of bundled source. Recommend users pin the major (`opencode-plugin-flow@2`, later `@3`) since OpenCode resolves the package at startup. Retire the curl installer; keep a slim startup skill-sync (marker-file semantics above). Keep the legacy `~/.config/opencode/plugins/flow.js` path working for one minor cycle; the startup sync detects and warns about a stale legacy copy (double-load risk: a local plugin file and the npm plugin load separately).
3. Document the uninstall path for npm distribution: remove the entry from `opencode.json`; remove `~/.config/opencode/skills/flow-*` folders carrying the Flow marker (provide `bunx opencode-plugin-flow uninstall` doing exactly that, replacing `src/uninstall-opencode.ts`).
4. Delete `prompt-exports/` from the repo.

Acceptance: existing `bun run check` passes; install smoke runs against the published npm tarball (not source-generated artifacts); bundle ≤ 300KB; `effect` absent from the lockfile; fresh-install → `/flow-status` works after one OpenCode restart.

### Phase 2 — Skills-first inversion (v3.0.0)

1. Author the four skill files (plus references) by hand; check into `skills/` in the repo; ship via startup sync.
2. Shrink commands and agents to pointers; enforce tool boundaries via native per-agent permissions.
3. Delete the generation/parity/capture apparatus and `mode-contracts.ts`.
4. Add the tool-name-coverage test.
5. Rewrite the affected docs in the same release: `README.md`, `docs/development.md`, `docs/maintainer-contract.md` (retires the three-tier doctrine), `docs/contributor-map.md`. Add a "superseded by this plan" note to `docs/plans/opencode-plugin-rebuild-2026-05-31.md`.

Acceptance: no files under `src/prompts/generated/`; command/agent prompt payload ≤ ~200 chars each; the four skills are the only guidance artifacts; tool-name-coverage test green; a fresh session can complete a single-feature flow end-to-end driven only by the `flow` skill (manual transcript check).

### Phase 3 — Runtime simplification (v3.0.0, same release as Phase 2)

1. Collapse completion gates to hard invariants + recovery decision tree.
2. Consolidate review domain to 3 modules with structural validation only.
3. Delete stack-standards profiling.
4. Replace the three session-action monoliths with an action registry (one handler per action).
5. Consolidate tools 18 → ~7 with a one-minor-cycle compat shim mapping old tool names.
6. Merge the seven `render-*` files into one rendering module; generate fewer derived markdown views.

Acceptance: `src/` ≤ ~9k LOC; tool count ≤ 8 (excluding the compat shim); a v2-created `.flow/**` session activates and resumes under v3 (fixture test); hard invariants covered by direct unit tests (complete-without-evidence rejected, close-completed-with-pending-features rejected, mutate-approved-plan rejected, strict-review-without-decision rejected).

### Phase 4 — Gate pipeline cull (v3.0.x)

Keep: typecheck, lint, build, tests, install smoke, bundle sanity. Drop or demote to manual: bench gate and the `bench/` suite (keep runnable, out of `check`), cold-start budget, deadcode budgets, completion-lane gate (becomes a unit test), boundary-violations report, runtime-simplification-metrics, all generated-drift checks. Tests land around ~40 files focused on transitions, persistence, recovery, and install.

Acceptance: `bun run check` is ≤ 6 steps and completes in well under half the current wall time; no gate script reads generated artifacts.

### Phase 5 — Reinvest in quality (v3.1+)

- Richer skill content: worked examples of good plans/reviews, failure-mode guidance.
- Better `/flow-status` output and recovery UX.
- Compaction context tuning.
- ~5 golden-transcript evals on the driving loop, replacing providerless capture parity. Mechanism: `opencode run` headless against a small fixture repo, asserting observable outcomes from the `.flow/**` state (e.g. validation evidence recorded before `flow_feature_complete`; reviewer decision present under strict policy; session closes cleanly). These need a model key, so they run as a manual/scheduled lane, not in default CI — they test effectiveness, not synchronization.

## Open questions — verify before Phase 1/2 implementation

1. **Same-session skill discovery.** Ecosystem precedent suggests skills written during plugin init are only discovered on the next OpenCode start. Spike: write a skill from a test plugin's init and check whether the `skill` tool lists it in the same session. If not discoverable, the install docs say "restart OpenCode once after install/update" (this is what `opencode-skill-creator` does) — acceptable, but it must be stated, and `flow_status` should detect a missing/stale skill set and say so.
2. **npm plugin dependency resolution.** Confirm OpenCode's Bun-based install resolves `zod` and treats `@opencode-ai/plugin` correctly when it is a peer dependency of a published plugin (current `package.json` pins the SDK as a peer at `1.14.48`). Spike: publish a release-candidate under an `@next` dist-tag and install it through `opencode.json` on a clean machine.
3. **Version pinning behavior.** Verify how OpenCode treats `opencode-plugin-flow` vs `opencode-plugin-flow@2` vs `@latest` across restarts (when it re-resolves, whether updates are picked up automatically). The README install section must give one recommended form.
4. **Compat shim ergonomics.** Confirm a plugin can register two tool names dispatching to the same handler without confusing hosts or models (old names hidden from `tool.definition` guidance but still executable), so v2 sessions/transcripts referencing old tool names degrade gracefully during the one-cycle shim window.
5. **Subtask routing for review.** Decide whether `/flow-review` keeps `subtask: true` (fresh context per review) once the auditor agent collapses into the `flow-review` skill + `flow-reviewer` subagent. Default position: yes — independent context is part of the review's value.

## Trade-offs and mitigations

1. **Less determinism.** Today the gate matrix forces the review lane; a model could rationalize skipping a review. Mitigation: the binary, cheap gates stay code-enforced as hard invariants (strict review policy ⇒ reviewer decision recorded). Judgment-heavy gates (scope proportionality, ledger shape) move to rubrics, which models follow better than they satisfy adversarial validators.
2. **Skill adherence varies by model.** Mitigation: the golden-transcript evals in Phase 5; skills are also now trivially editable by users per-project (project `.opencode/skills/` overrides).
3. **Drift between skills and tools without parity tests.** Mitigation: the surface is small enough (4 skills, ~7 tools) that drift is code-review-visible; the tool-name-coverage test catches the mechanical case.
4. **Migration.** Session schema stays v1 so existing `.flow/**` sessions resume across the upgrade. Command names stay stable. Old tool names get a compat shim for one minor cycle. Ship as 3.0 over ~4 releases (Phase 1 as 2.0.x, then Phases 2–5).
5. **Maintainer contract supersession.** This plan deliberately retires the frozen three-tier doctrine in `docs/maintainer-contract.md`; that document must be rewritten as part of Phase 2, not left contradicting the new architecture.

## End state

Plugin ≈ 3–4k LOC (persistence, schemas, invariants, status rendering, compaction); 4 hand-editable skill files; 1–2 agents; ~7 tools; no generated code; no parity tests; npm-distributed; bundle well under 100KB. The instruction surface becomes a first-class authored artifact instead of a build output.

| Metric | v2.0.56 | Target |
| --- | --- | --- |
| `src/` LOC | 23,477 | ~8k (≤9k gate at Phase 3) |
| Bundle size | 752KB | <100KB (≤300KB gate at Phase 1) |
| Custom tools | 18 | ~7 |
| Agents | 6 | 1–2 |
| Skills | 3 generated, hash-locked | 4 hand-authored, user-overridable |
| Gate scripts in `check` | ~20 steps | ≤6 steps |
| Test files | 99 | ~40 |
| Generated source files | 6 | 0 |
| Dependencies | `effect` (beta) + `zod` bundled | `zod` only, npm-resolved |
| Distribution | curl installer + bundled `flow.js` | npm via `opencode.json` `plugin` array |
