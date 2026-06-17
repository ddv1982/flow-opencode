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

`.flow/session.json` is the active source of truth. `.flow/opencode-instructions.md` is an ignored generated projection for OpenCode's stable `config.instructions` path; it must always be rebuildable from the active session and never becomes authoritative state. `.flow/history/<session-id>.json` stores archived sessions. Flow writes `.flow/.gitignore` so local session state and generated projections are ignored by Git unless a repository intentionally opts in. Any archive or versioning of `.flow` artifacts must be explicit, artifact-specific maintainer intent; broad `.flow/**` staging is not part of the default contract. Markdown docs, context views, readiness ledgers, and other projection caches are intentionally not runtime state.

Writes must stay locked, atomic, duplicate-key-safe on read, and guarded against filesystem roots and `$HOME`.

## Public Surface

Commands:

- `flow-auto`
- `flow-plan`
- `flow-run`
- `flow-review`
- `flow-status`

These command IDs are reserved while the plugin is enabled. Flow injects them
after existing OpenCode config so public command preflight stays authoritative.

Internal worker agents are also reserved:

- `flow-reviewer`
- `flow-evidence-worker`
- `flow-validation-worker`
- `flow-audit-worker`
- `flow-candidate-worker`
- `flow-verifier-worker`

Every hidden Flow worker must explicitly deny native skill loading by default;
future helper-skill access must be an intentional worker-specific allowlist.

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

Public Flow commands must call `flow_status` first. If `setup.skills` is
present, they report that setup state and continue through bundled public Flow
instructions instead of native-loading required public skills. The OpenCode
command preflight hook is authoritative for public Flow commands: it must
replace resolved command parts with the current bundled template so stale
command files or command registry cache cannot ask for old skill-loading
behavior. `/flow-auto`, `/flow-plan`, `/flow-run`, and `/flow-review` must stay
self-contained and must not native-load `flow`, `flow-plan`, `flow-run`, or
`flow-review`; synced skills remain useful for discoverability and manual
loading, not as a public-command availability dependency. `/flow-status` remains
tool-only. Missing optional helpers such as `flow-test`, `flow-deslop`,
`flow-ui-quality`, or user-triggered `flow-commit` are coverage gaps, not
bundled fallbacks. `flow-commit` must not be loaded by the autonomous Flow loop
and must not replace `flow_feature_complete`.

Ambient Flow session context must use stable OpenCode configuration by default:
the adapter registers `.flow/opencode-instructions.md` through
`config.instructions`, and the runtime keeps that file synchronized with
`.flow/session.json`. Default behavior must not depend on OpenCode experimental
chat system, message transform, or session compaction hooks. Experimental hooks
may only return as explicit compatibility code with tests proving the stable
default remains hook-free.

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
