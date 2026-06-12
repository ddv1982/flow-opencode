# Golden-transcript evals

A manual eval lane for the Flow driving loop. Each scenario runs `opencode run "<prompt>"` headless against a tiny fixture repo that loads the Flow plugin **from this checkout**, then asserts observable outcomes from the persisted `.flow/**` state — parsed with the runtime's own zod schema (`src/runtime/schema.ts`), never from transcript text.

This lane tests **effectiveness** (does a model driving the flow skills actually produce correct `.flow/**` state?), not synchronization. It needs a real model key, so it is **manual/scheduled only** — it is never part of `bun run check` or default CI. The only CI-safe piece is `tests/evals-golden-harness.test.ts`, which shape-checks the scenarios and fixtures without invoking opencode.

## Requirements

- The `opencode` CLI on PATH (developed against 1.17.x).
- A configured model: either a provider key in your environment (e.g. `ANTHROPIC_API_KEY`) or credentials from `opencode auth login`. Pick a specific model with `--model <provider/model>` if you don't want your default.
- `bun run build` first — the runner loads `dist/index.js`, not source.
- Network access (OpenCode bun-installs the local plugin's dependencies, and the model calls are remote).

## Run it

```bash
bun run build
bun run evals:golden                                  # all five scenarios
bun run evals/golden/runner.ts --list                 # scenario names + summaries
bun run evals/golden/runner.ts --scenario session-closes-completed
bun run evals/golden/runner.ts --model anthropic/claude-sonnet-4-5
bun run evals/golden/runner.ts --dry-run              # no model key needed
bun run evals/golden/runner.ts --keep                 # keep passing workspaces too
```

`--dry-run` does everything except invoke opencode: it creates each temp workspace (fixture copy, plugin install, project skills, git baseline, seeded `.flow` validation) and prints the exact command it would run, so the harness itself is testable without a key. Failed scenarios always keep their workspace and print its path for inspection.

Expected runtime: roughly 5–15 minutes per scenario depending on the model, 30–60 minutes for all five. Each scenario has a 10-minute timeout by default.

## How the plugin is loaded from the checkout

Same local-build loading the npm install smoke (`scripts/cross-area/opencode-smoke.mjs`) exercises in-process, adapted to a real `opencode run`:

1. `dist/index.js` is copied to `<workspace>/.opencode/plugins/flow.js` — OpenCode auto-loads project-level plugin files from `.opencode/plugins/`.
2. The build marks `zod` and `@opencode-ai/plugin` as externals, so the runner writes `<workspace>/.opencode/package.json` declaring both (pinned to this repo's versions); OpenCode bun-installs config-directory dependencies at startup, and the runner pre-installs them to fail loudly.
3. The checkout's `skills/` are copied to `<workspace>/.opencode/skills/` so they are discoverable on the first start (the plugin's global skill sync may only be picked up on the *next* OpenCode start).

## Caveats

- Your global OpenCode config still merges in (global MCP servers, default model, etc.). The plugin's startup skill sync also runs against your real `~/.config/opencode/skills/` — it is idempotent and marker-guarded, but be aware the eval writes there.
- A stale pre-npm copy at `~/.config/opencode/plugins/flow.js` would double-load Flow next to the checkout build and corrupt results; the runner warns if it sees one. Remove it with `bunx opencode-plugin-flow uninstall`.
- Model behavior varies — a failure here is a signal about skill/prompt effectiveness, not automatically a code bug. Inspect the kept workspace's `.flow/**` before filing anything.

## Scenarios

| Name | Fixture | Asserts |
| --- | --- | --- |
| `plan-approved-before-run` | `hello-lib` | Plan persisted and approved; every execution history entry recorded after `approvedAt`. |
| `validation-evidence-before-complete` | `hello-lib` | Every completed feature has a history entry with non-empty `validationRun` evidence. |
| `strict-review-decision-recorded` | `hello-lib` | `deliveryPolicy.strictReview` set; reviewer decision (final scope before completion) recorded. |
| `session-closes-completed` | `hello-lib` | No active/stored sessions; one completed session with closure kind `completed` and no unfinished features. |
| `recovery-resumes-seeded-session` | `hello-lib-seeded` | Pre-seeded active session is resumed and advanced — exactly one session, same id, no duplicate. |
