---
name: core-worker
description: General-purpose implementation worker for all TypeScript/Bun features in the opencode-plugin-flow mission. Handles code changes, test authoring, benchmarking, and build verification.
---

# Core Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE for implementing a single feature in the opencode-plugin-flow overhaul mission.

## When to Use This Skill

Every feature in this mission uses this skill. Features span: tsconfig/lint tooling, test fixtures and benchmarks, atomic fs writes, input validation, state-machine refactors, schema consolidation, incremental rendering, bundle optimization, OpenCode integration hooks, and release artifacts.

## Required Skills

None. All work is performed with the tools available to this worker (Read, Edit, Create, Grep, Glob, Execute, Task). No browser, no TUI, no external agents.

## Work Procedure

Follow this procedure in order for EVERY feature. Skipping steps is a handoff failure.

### 1. Orient

- Read `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, and `.factory/library/user-testing.md` once per session.
- Read your feature's entry in `features.json` — `description`, `preconditions`, `expectedBehavior`, `verificationSteps`, `fulfills`.
- For each assertion ID in `fulfills`, read the matching entry in `validation-contract.md`. Understand exactly what pass/fail means.
- `git status` and `git log --oneline -5` to understand recent mission work.

### 2. Investigate

- Read the existing source files you'll change (use `Read`, `Grep`, `Glob`).
- If the feature depends on artifacts from earlier milestones (e.g. `bench/BASELINE.md`, `tests/__fixtures__/render/`), verify they exist. If a precondition isn't met, return to orchestrator immediately — do not improvise.
- For refactoring features: list every call site of the symbol/file you're about to change.

### 3. Write failing tests FIRST

- For every behavior in `expectedBehavior` that is observable via code, author a test BEFORE implementing.
- Use `tests/fixtures.ts` canonical fixtures (once introduced in M1). Do not duplicate fixtures inline.
- Run `bun test <new-file>` and confirm the new tests fail for the right reason (red). Do not continue to implementation until you have confirmed red.
- For each added test file, track the list of cases for the handoff's `tests.added`.

### 4. Implement

- Make minimal changes to pass the new tests.
- For TypeScript, maintain the strict-flag cleanliness introduced in M1. Do not add `ts-ignore` / `ts-expect-error`.
- For refactors, preserve public symbol names and signatures unless the feature explicitly permits changes.
- Use the central `runtime/constants.ts` and `runtime/errors.ts` (post-M3) for user-facing strings — do not hard-code.
- Zod schemas stay at module top level. Never construct schemas inside functions.

### 5. Verify (running every command, recording each in the handoff)

Run each of these and record `commandsRun` entries:

1. `bun run typecheck` — must exit 0.
2. `bun test` — must pass with 0 fail. If the feature adds tests, confirm new cases pass.
3. `bun run lint` (after M1) — must exit 0.
4. `bun run deadcode` — must exit 0. No new unused exports.
5. `bun run build` — must produce a valid bundle.
6. For features that touch performance-sensitive code: `bun run bench -- --filter <relevant>` and spot-check no > 5% regression vs `bench/BASELINE.md`.
7. For M5 features: `bun run bench` fully + update `bench/RESULTS.md`.

For each command, the handoff's `verification.commandsRun` entry includes `command`, `exitCode`, and a 1-sentence `observation` (e.g. "131/131 pass in 210 ms"). Exit codes reported without observation are a handoff failure.

### 6. Black-box smoke check

- For features that affect the plugin surface, load the freshly-built `dist/index.js` in a Node VM with a mocked `ctx` and invoke at least one of the affected tools against a temp worktree. Record this under `verification.interactiveChecks` with the sequence of calls and the end-to-end outcome.
- For features that DON'T affect the plugin surface (e.g. tsconfig, Biome, bench infra), write `interactiveChecks: []` — do not fabricate checks.

### 7. Assertion coverage check

- Re-read each assertion in your feature's `fulfills`. Confirm that the evidence you produced (tests, command output, file inspections) would satisfy the assertion's `Evidence` section literally.
- If any assertion is not fully satisfied, either complete it or list it in `whatWasLeftUndone` — never claim the feature done with an unsatisfied `fulfills` entry.

### 8. Commit and hand off

- Commit your implementation and test changes together with a concise message referencing the feature id (e.g. `m2-atomic-writes: ship atomic session writes + in-process lock`).
- Never leave uncommitted implementation changes.
- Never leave orphaned processes (bench runners, watch-mode tests, etc.). If a command you ran spawned a child, kill it by PID.

## Example Handoff

```json
{
  "salientSummary": "Implemented atomic session writes + in-process lock for m2-atomic-writes. Added tests/atomic-writes.test.ts (5 cases); all pass under bun test. Injected rename-failure test confirms original bytes intact; 16-way concurrent saveSession resolves to one deterministic winner. bun run check exits 0.",
  "whatWasImplemented": "Added temp-file + fsync + rename atomic-write helper in src/runtime/session-workspace.ts. Refactored saveSessionState and writeActiveSessionId to use it. Introduced a per-worktree in-process Mutex (src/runtime/util.ts) serializing concurrent saveSession calls with last-writer-wins semantics. Added tests/atomic-writes.test.ts covering successful atomic replacement, mid-rename failure, .flow/active atomic write, and 16-way concurrency.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "bun run typecheck", "exitCode": 0, "observation": "no diagnostics"},
      {"command": "bun test tests/atomic-writes.test.ts", "exitCode": 0, "observation": "5/5 pass in 42 ms"},
      {"command": "bun test", "exitCode": 0, "observation": "146/146 pass in 230 ms (was 131 before feature)"},
      {"command": "bun run lint", "exitCode": 0, "observation": "Checked 42 file(s), 0 warnings, 0 errors"},
      {"command": "bun run deadcode", "exitCode": 0, "observation": "No issues found"},
      {"command": "bun run build", "exitCode": 0, "observation": "Bundled 194 modules in 13ms, 0.99 MB"}
    ],
    "interactiveChecks": [
      {
        "action": "Loaded dist/index.js in Node VM; invoked flow_plan_start then flow_status against a temp worktree.",
        "observed": "Both tools returned the expected JSON envelope; session.json created atomically (no .tmp leftover in readdir)."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "tests/atomic-writes.test.ts",
        "cases": [
          {"name": "saveSession atomically replaces session.json", "verifies": "target file contains new JSON; no sibling .tmp* remains after success"},
          {"name": "saveSession mid-rename failure leaves original intact", "verifies": "original session.json bytes byte-for-byte unchanged after injected rename throw"},
          {"name": "writeActiveSessionId atomic success + failure paths", "verifies": "exactly one file at .flow/active on success; prior contents unchanged on injected failure"},
          {"name": "16-way concurrent saveSession resolves deterministically", "verifies": "final session.json parses through SessionSchema; payload equals one of the 16 caller inputs; no .tmp artifacts"}
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

Return control to the orchestrator — do NOT attempt fixes yourself — when:

- A precondition for your feature is unmet (e.g. `bench/BASELINE.md` missing when M5 requires it).
- Your work would violate a mission boundary (e.g. writing to the real `~/.opencode/`).
- Requirements are ambiguous or contradictory across mission.md, AGENTS.md, the feature description, and the fulfilled assertions.
- An unrelated pre-existing bug is blocking your feature — log it under `discoveredIssues` with severity and suggestedFix.
- A skipped verification step (lint, typecheck, test) cannot be run in the environment (e.g. `bunx biome` unavailable).
- Benchmarks show a > 5% regression you cannot explain or fix within the feature's scope.
- A required dependency or devDependency is missing and adding it would violate the "lean runtime deps" constraint (return to orchestrator to get approval before adding).
