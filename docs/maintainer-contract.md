# Maintainer Contract

Flow v4 has one rule: keep the code boring and small.

## Split

- `skills/**` owns judgment: planning, decomposition, review depth, validation quality, recovery choices, cleanup, and UI quality.
- `src/**` owns safety: durable session state, atomic writes, tool schemas, hard completion gates, skill sync, and the OpenCode bridge.

Do not move planning or review heuristics into runtime projections. If a rule needs interpretation, it belongs in a skill.

## Hard Gates

Runtime must enforce:

1. A plan cannot be changed after approval.
2. Only one feature can run at a time.
3. Feature completion requires recorded validation evidence.
4. Non-final completion requires `validationScope: "targeted"`.
5. Final completion requires `validationScope: "broad"`.
6. Feature completion requires a passing `featureReview`.
7. Final completion requires a passing `finalReview` whose `reviewDepth` matches the approved plan.
8. A session cannot close as `completed` unless an approved plan has passed final completion.

## State

`.flow/session.json` is the active source of truth. `.flow/history/<session-id>.json` stores archived sessions. Flow writes `.flow/.gitignore` so local session state is ignored by Git unless a repository intentionally opts in. Any archive or versioning of `.flow` artifacts must be explicit, artifact-specific maintainer intent; broad `.flow/**` staging is not part of the default contract. Markdown docs, context views, readiness ledgers, and projection caches are intentionally not runtime state.

Writes must stay locked, atomic, duplicate-key-safe on read, and guarded against filesystem roots and `$HOME`.

## Public Surface

Commands:

- `flow-auto`
- `flow-plan`
- `flow-run`
- `flow-review`
- `flow-status`

Tools:

- `flow_status`
- `flow_plan_save`
- `flow_plan_approve`
- `flow_run_start`
- `flow_feature_complete`
- `flow_feature_reset`
- `flow_session_close`

No compatibility aliases are required for v3 sessions or retired tools.

## Managed Skills And Setup Health

The managed skill set is:

- `flow`
- `flow-plan`
- `flow-run`
- `flow-test`
- `flow-review`
- `flow-deslop`
- `flow-ui-quality`
- `flow-commit`

Startup sync, `opencode-plugin-flow doctor`, `opencode-plugin-flow sync`, and
uninstall must treat the managed set uniformly. Missing, incomplete, or outdated
Flow-owned folders are sync-repairable. Foreign or edited managed folders
require user action and must not be overwritten silently.

Install and update guidance should use OpenCode's native plugin installer as the
primary config mutation path when available, with one pinned install-or-update
command:
`opencode plugin opencode-plugin-flow@<version> --global --force`. OpenCode
keeps an existing same-package plugin entry unless replacement is requested, so
published Flow docs should include `--force` by default. Flow's own CLI should
remain a skill sync, doctor, and uninstall helper; it must not silently mutate
OpenCode plugin config. The manual `opencode.json` fallback for older OpenCode
versions should tell users to replace older pinned Flow entries instead of
adding duplicates.

Runtime setup health is surfaced through `flow_status`:

- `restart_required`: startup sync changed skills and OpenCode should restart
  before Flow skills are loaded.
- `action_required`: at least one managed skill folder is foreign or edited and
  needs a user decision.
- `sync_failed`: skill sync raised an error and the runtime should not assume
  skill instructions are current.

Public Flow commands must call `flow_status` before loading Flow skills. If
`setup.skills` is present, report that setup state and stop skill loading in the
current startup. `/flow-status` remains tool-only. Missing optional helpers such
as `flow-test`, `flow-deslop`, `flow-ui-quality`, or user-triggered
`flow-commit` are coverage gaps, not bundled fallbacks. `flow-commit` must not
be loaded by the autonomous Flow loop and must not replace `flow_feature_complete`.

## Source Ownership

- `runtime`: schema, transitions, persistence, and tool-facing runtime API.
- `adapters`: OpenCode config, hooks, and tool registration.
- `distribution`: syncing bundled skills and uninstalling Flow-owned skill folders.
- `config-shared`: command and agent config constants.

Keep adapter/distribution concerns out of runtime.

## Checks

Use focused tests for changed behavior, then run:

```bash
bun run check
```
