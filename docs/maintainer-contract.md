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

`.flow/session.json` is the active source of truth. `.flow/history/<session-id>.json` stores archived sessions. Flow writes `.flow/.gitignore` so local session state is ignored by Git unless a repository intentionally opts in. Markdown docs, context views, readiness ledgers, and projection caches are intentionally not runtime state.

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
