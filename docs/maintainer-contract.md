# Maintainer Contract

Flow has two halves:

1. `skills/**` owns judgment: planning, review depth, validation quality, recovery choices, and when to ask the user.
2. `src/**` owns safety: durable `.flow/**` state, hard invariants, tool schemas, install/uninstall ownership, and OpenCode integration.

Keep that split. Code should enforce binary facts a skill cannot guarantee; skills should not invent state transitions, tools, or write paths.

## Hard Runtime Invariants

These are release-critical and need direct tests:

1. A feature cannot complete without recorded passing validation evidence.
2. A non-final completion requires `validationScope: "targeted"`; final completion requires `validationScope: "broad"`.
3. A successful completion requires a passing `featureReview`; final completion also requires a passing `finalReview` whose `reviewDepth` matches the plan policy.
4. A session cannot close as `completed` with unfinished target work.
5. An approved plan cannot be mutated without an explicit reset.
6. `strict` review governance requires a recorded approved reviewer decision before completion.

Judgment-heavy expectations such as evidence quality, proportional review scope, and review depth beyond the declared policy belong in `skills/flow-review`, not runtime validators.

## Derived Signal Authority

Keep Flow's status projections useful without turning them into hidden runtime policy:

- **Hard gate**: runtime refuses the action. Completion payload gates, close-as-completed checks, approved-plan mutation rejection, workspace-root guards, and persistence safety checks live here.
- **Workflow blocker**: derived status says the next workflow phase should not proceed until the issue is resolved or explicitly justified. `workflowReadiness.state` values such as `blocked_by_context`, `blocked_by_validation`, and `blocked_by_review` live here.
- **Advisory diagnostic**: planning/review signal that informs judgment but does not block by itself. `contextQuality` and weak-context diagnostics live here unless they expose concrete scope, validation, or review drift that `workflowReadiness` reports as blocked.

`contextTraceability` is a factual projection over persisted plan targets, changed artifacts, validation commands, and review records. Keep it derivable from the session snapshot; do not persist a separate readiness ledger.

## Persistence And Writes

- `.flow/**/session.json` is the source of truth; markdown under `.flow/**/docs/` is derived.
- Keep atomic writes, file locking, duplicate-key rejection, path traversal guards, and workspace-root guards intact.
- Mutating Flow tools must serialize load -> transition -> source-of-truth save -> artifact sync through the session mutation transaction. Direct `saveSessionState` calls only guarantee atomic replacement, not semantic merge behavior.
- The runtime rejects filesystem roots and `$HOME` as mutable workspace roots.
- Hidden-root edit approval is adapter-owned host permission, separate from runtime workspace-root validation.
- Unsupported persisted session schema versions must fail clearly. Do not carry legacy session compatibility unless there is a current user-backed reason.
- Install, sync, and uninstall code must never write under `.flow/**`.

## Public Surface

The supported user/tool surface is:

- Commands: `flow-auto`, `flow-plan`, `flow-run`, `flow-review`, `flow-status`
- Agent: hidden/internal `flow-reviewer` subagent
- Tools: `flow_status`, `flow_context`, `flow_plan_save`, `flow_plan_approve`, `flow_run_start`, `flow_feature_complete`, `flow_review_record`, `flow_session`

Tool names are public contracts. Rename or add them only with matching skill, docs, registration, and tests.

Commands and agents should stay thin pointers into skills. If a command needs real instruction text, put it in a skill.

## Source Ownership

Current enforced source owners are:

- `shared`: `src/config-shared.ts`, host-neutral config constants only.
- `runtime`: schemas, transitions, persistence, summaries, rendering, and application actions.
- `distribution`: skill/command/agent sync, markers, update notice, and uninstall.
- `adapters`: OpenCode plugin/config/tool integration and host permissions.
- `entrypoints`: `src/index.ts`, `src/config.ts`, `src/cli.ts`.

The seam checker enforces the current layers only. Do not add speculative owners; add a new owner when code exists and the dependency rule is worth enforcing.

## Sync Ownership

- Global skills install under `~/.config/opencode/skills/<name>/` with `.flow-skill-version` markers.
- Commands and `flow-reviewer` install with Flow-owned sidecar markers.
- Folders or files without Flow markers belong to the user or another plugin and must not be touched.
- User-edited Flow-owned files must be backed up beside themselves before replacement.
- Project-local skill overrides under `.opencode/skills/<name>/` are a supported user feature; the plugin never writes there.
- Retired synced commands must stay listed in `RETIRED_FLOW_COMMANDS` until cleanup behavior is intentionally removed.

## Checks

Use focused tests first, then `bun run check` before release or cross-surface merges.

| Area touched | Useful checks |
| --- | --- |
| Completion gates, transitions, schema | `bun run check:completion-lane`, focused runtime tests, `bun run typecheck` |
| Persistence, paths, workspace roots | persistence, locking, cache, path-traversal, and workspace-root tests |
| Tool registration or payload schemas | tool/schema tests, tool-name-coverage test, `bun run typecheck` |
| Skills | tool-name-coverage test plus review against `docs/skill-review-checklist.md` |
| Install, sync, uninstall, packaging | `bun run build`, install/uninstall tests, `bun run smoke:release` |
| Dependency boundaries | `bun run check:architecture-seams:enforce` |

Report scripts such as `bun run report:architecture-metrics` are diagnostics, not product contracts.

## History

`CHANGELOG.md`, `docs/decisions/decision-log.md`, and `docs/releases/README.md` are historical evidence. They may mention retired surfaces. Current behavior is defined by this file, current docs, source, and tests.
