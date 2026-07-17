# Codebase Review — July 2026 Improvement Plan

Status: implemented (July 2026, all four phases; Phase 3 item 6 — review-depth
enum unification — deliberately skipped as a breaking change, and the
ecosystem-listing PRs are drafted in `ecosystem-listing.md` but not submitted)
Source: full-codebase review (runtime source, skills/docs, tests/CI/packaging) plus
ecosystem research against opencode.ai docs and competing workflow plugins.

## Verdict

Flow v4 is top-decile solo-plugin engineering: pure transitions separated from
persistence, strict schemas, atomic locked writes, ~90–95% runtime test coverage
with genuine behavior tests, test-enforced doc/runtime consistency, and a
trusted-publishing release pipeline that machine-enforces version sync. The
weaknesses are not in the state machine — they cluster in operational recovery,
the host boundary, prompt bloat, and the human-facing story.

## Phase 1 — Safety and recovery (before next release)

1. **Uninstall data loss.** `sync.ts` `uninstallFlowSkills` deletes the whole
   managed folder after checking only marker-listed files. Unknown files in the
   folder (user notes) are silently destroyed; a corrupt marker with zero
   `file=` entries makes any folder "pristine". Fix: treat unknown files or an
   empty marker as user-edited; add `--dry-run`.
2. **Stale lock bricks the workspace.** A crash between `acquireLock` and
   release leaves `.flow/session.lock/` forever; every future tool call times
   out after 30s with no remedy. Fix: write pid/timestamp metadata, expire
   stale locks, and name the manual remedy in the timeout error.
3. **Session schema migration/quarantine.** `version: z.literal(2)` +
   hard-parse means any pre-v2 or drifted `session.json` turns every tool
   (including `flow_status`) into a raw ZodError dump. Fix: quarantine the
   unreadable file into `.flow/history/` and return a curated recovery message.
4. **Small correctness fixes** (all verified):
   - `plugin.ts:34` `replaceAll("$ARGUMENTS", args)` mangles `$$`/`` $` `` in
     user goals — use a replacer function.
   - `logging.ts` `void log.call(...)` leaks unhandled promise rejections —
     `Promise.resolve(...).catch(() => {})`.
   - `api.ts:114-116` completed session is archived+cleared before the new plan
     validates — validate first.
   - `api.ts:117-131` a rephrased goal silently discards an unapproved draft
     with no archive — archive or warn.
   - `transitions.ts:381-409` `needs_input` keeps a stale `lastError` that then
     shadows the blocker in `flow_status` — clear it like the success path.
   - `sync.ts:75-77` `homeDir()` falls back to `""` (cwd-relative skill
     writes) — use `os.homedir()` like workspace.ts.
   - `sync.ts:341-357` version fallback `0.0.0` prints a broken
     `npx ...@0.0.0` remedy — fall back to `@latest` or omit the pin.
   - `plugin.ts:78-95` command-part replacement drops non-text parts (user
     attachments to `/flow-plan`).

## Phase 2 — Host boundary and compatibility

1. **Relax the peer pin.** `@opencode-ai/plugin: 1.17.3` exact forces friction
   on every other OpenCode version while CI never boots a real host. Move to a
   tested range (e.g. `>=1.17.3 <2`), keep the exact pin in devDependencies.
2. **Automated live OpenCode smoke.** Nothing loads the plugin into a real
   OpenCode process; the manual checklist is stale at v3.3.22 and references a
   removed `flow_session` tool. Spawn headless OpenCode against the packed
   tarball in CI (or, minimally, refresh and enforce the checklist per release).
3. **CI matrix.** Add macOS + Windows and Node 20/22/24. `sync.ts` has a
   `USERPROFILE` branch and `workspace.ts:112-117` does POSIX-only directory
   fsync that will fail on Windows after the rename already succeeded — decide
   Windows support and test it, or drop it consistently.
4. **Debuggable artifacts.** Stop minifying (server-side bundle gains nothing),
   or at least ship a `cli.js` sourcemap; drop the redundant `--drop=console`;
   add an `engines` field.

## Phase 3 — Skills and prompt architecture

1. **Remove repo-specific content from distributed skills.**
   `skills/flow-plan/references/parallel-discovery.md` ships flow-opencode's
   own file slices into every user's planning prompt; `flow-commit/SKILL.md`
   hardcodes a repo-local preflight script path.
2. **Deduplicate the orchestration references.** `/flow-auto` bundles ~9,250
   words (~15k tokens); the coverage gate is defined three times, the synthesis
   barrier four times, and the helper-degradation boilerplate ~10 times with
   drifting trigger lists. Target a single canonical statement of each rule.
3. **Fix the reviewer permission/instruction mismatch.** The hidden
   `flow-reviewer` agent denies `skill`/`bash`/`task`, yet `flow-review`
   instructions tell it to load `flow-test`/`flow-deslop`/`flow-ui-quality` and
   spawn workers. Split manager-context from subagent-context instructions.
4. **Close the handoff-template gap.** Workers can't read
   `handoff-format.md`; instruct the manager to paste the matching template
   into each worker prompt.
5. **Derive, don't duplicate.** `config-shared.ts` and
   `flow-skill-definitions.ts` hand-maintain parallel catalogs of the same
   markdown assets; derive bundled-command doc lists from
   `FLOW_SKILL_DEFINITIONS`. Also: warn (don't silently clobber) on user
   agent/command name collisions in `applyFlowConfig`.
6. (Consider, breaking) unify the quick/standard/detailed vs broad/detailed
   review-depth naming that three docs each burn a paragraph disambiguating.

## Phase 4 — Adoption and user experience

1. **README front-half rewrite.** Quick start (install → restart →
   `/flow-auto <goal>`), an example session transcript, what `flow_status`
   returns, a demo gif. Move install-troubleshooting depth to `docs/`.
2. **Get listed.** Flow is absent from opencode.ai/docs/ecosystem while
   micode, opencode-conductor, subtask2, opencode-tasks et al. are listed.
   Submit the ecosystem PR and awesome-opencode entry.
3. **Human-readable CHANGELOG.** The "lore" one-liners are inscrutable to an
   evaluating user; say what changed in user terms.
4. **Durable restart survival.** Flow's stable generated instruction projection
   and runtime-issued phase boundaries carry session state across restarts.
   Experimental host compaction hooks are outside the supported architecture.
5. Polish: Dependabot/Renovate, SHA-pinned actions, coverage threshold,
   protected release environment.
