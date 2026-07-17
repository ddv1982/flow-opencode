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
6. Feature completion requires `featureReviewDepth` to meet or exceed the
   feature's planned `reviewDepth`.
7. Feature completion requires a passing `featureReview`.
8. Final completion requires a passing `finalReview` whose `reviewDepth` matches the approved plan.
9. A session cannot close as `completed` unless an approved plan has passed final completion.
10. A phase boundary blocks `flow_run_start` until the caller explicitly
    acknowledges that continuation is happening in a fresh phase.

## State

`.flow/session.json` is the active source of truth. `.flow/opencode-instructions.md` is an ignored generated projection for OpenCode's stable `config.instructions` path; it must always be rebuildable from the active session and never becomes authoritative state. `.flow/history/<session-id>.json` stores archived sessions. Flow writes `.flow/.gitignore` so local session state and generated projections are ignored by Git unless a repository intentionally opts in. Any archive or versioning of `.flow` artifacts must be explicit, artifact-specific maintainer intent; broad `.flow/**` staging is not part of the default contract. Markdown docs, context views, readiness ledgers, and other projection caches are intentionally not runtime state.

Budget and retry telemetry in the session ledger records completed feature
counts, review counts, failed review counts, per-feature failed review attempts,
bounded orchestration pass accounting, and host token telemetry status. Feature
count and pass accounting are telemetry only and must not stop an approved plan
by themselves. OpenCode does not currently expose per-turn token usage through
the plugin surface Flow uses, so token fields stay `host_unavailable` until a
supported host API exists. Do not invent token counts inside runtime state.

Runtime pass accounting is deliberately bounded: counts, recent pass ids,
worker counts, candidate/verifier usage, skipped candidate decisions, handoff
references, verification status, outcome, and synthesis references. Full worker
handoffs, command logs, transcripts, scratch tables, and standalone manager
synthesis artifacts stay outside `.flow/**`. Distilled conclusions may enter
plan prose or completion summaries when they are the Flow artifact being
recorded.

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
Parallel workers produce candidate evidence only. Flow remains a serial state
machine: the manager checks handoffs, verifies important claims, synthesizes one
artifact, and owns every state-changing tool call.

Empty or unstructured worker output is a failed handoff, not success. The
manager must re-task, cover the slice directly, or carry it as not-covered.
`validateFlowWorkerHandoff` provides offline structural checking, but OpenCode
does not currently apply it as a runtime output hook; it does not establish the
truth or adequacy of worker evidence.

Hidden Flow workers may be routed to installation-specific OpenCode models with
environment variables. Use `OPENCODE_FLOW_READONLY_WORKER_MODEL` for evidence,
validation, and audit workers; `OPENCODE_FLOW_REVIEW_WORKER_MODEL` for reviewer
and verifier workers; `OPENCODE_FLOW_CANDIDATE_WORKER_MODEL` for candidate
implementation workers; and `OPENCODE_FLOW_WORKER_MODEL` as a fallback for all
hidden Flow workers. Leave them unset when the provider/model ID is unknown.

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
require user action and must not be overwritten silently. A folder with no Flow
marker is user-owned even when files sit at managed paths, so sync must skip it
rather than overwrite it without a backup.

Flow-created `.backup` residue — a file whose name and content checksum both
match Flow's backup format — is reported by doctor as action-required and is
removed by uninstall (naming each removed backup) when the folder is otherwise
pristine. A file that merely resembles a backup name but whose content does not
match the embedded checksum is the user's own file: it is never deleted and it
keeps the folder.

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
instructions instead of depending on native-loaded public skills. The OpenCode
command preflight hook is authoritative for public Flow commands: it must
replace resolved command parts with the current bundled template so stale
command files or command registry cache cannot ask for old skill-loading
behavior. `/flow-auto`, `/flow-plan`, `/flow-run`, and `/flow-review` must stay
self-contained as configured surfaces: manager commands compile selected core
sections, while `/flow-review` supplies the task to the reserved
`flow-reviewer`, whose agent prompt owns the review contract. They must not
depend on native-loading `flow`, `flow-plan`, `flow-run`, or `flow-review`;
references to loading those core skills inside selected source sections mean
using the matching compiled section, not making a native skill call. Synced
skills remain useful for discoverability, manual loading, and detailed
references, not as a public-command availability dependency. `/flow-status`
remains tool-only. Missing optional helpers such as `flow-test`, `flow-deslop`,
`flow-ui-quality`, or user-triggered `flow-commit` are coverage gaps, not
bundled fallbacks. `flow-commit` must not be loaded by the autonomous Flow loop
and must not replace `flow_feature_complete`.

Ambient Flow session context must use stable OpenCode configuration:
the adapter registers `.flow/opencode-instructions.md` through
`config.instructions`, and the runtime keeps that file synchronized with
`.flow/session.json`. Flow does not register OpenCode experimental chat-system,
message-transform, or session-compaction hooks. Skills react only to durable
runtime state and runtime-issued phase boundaries; they do not estimate context
pressure or initiate host compaction.

## Prompt Contracts

Skill-attributed prompt fragments must be extracted from their bundled skill
source. Use section selection for ordinary Markdown or a unique
`flow-prompt` marker pair for a prompt-only block. Compiler-owned routing and
bookends must identify `src/prompt-surfaces.ts` as their source; do not maintain
manual copies of skill judgment in TypeScript.

The canonical hidden-reviewer judgment lives in
`skills/flow-review/references/hidden-reviewer-contract.md`. The manager owns
only public routing to that reviewer. Worker integrity and handoff schemas live
in `skills/flow/references/handoff-format.md`; every worker receives exactly one
role-applicable schema.

Parallel manager guidance uses one-level progressive disclosure. Keep
`parallel-orchestration.md` as the routing index, manager selection rules in
`parallel-decision.md`, coverage accounting in `parallel-manifest.md`, worker
roles and permissions in `parallel-execution.md`, and handoff acceptance plus
synthesis in `parallel-synthesis.md`. Serial paths must not require the later
runbooks.

Prompt changes must preserve all 18 static scenarios and 52 criteria. A surface
may grow by the larger of eight words or 2% before the growth guard requires an
accepted baseline update and a specific justification. The opt-in model runner
has a five-minute default timeout per variant and remains outside the broad
local gate because provider output is nondeterministic.

`src/prompt-baseline-fixtures.ts` is the sole manual-text exception. It is a
frozen historical evaluation comparator, never a production prompt source.
Changes to current skill judgment belong in marked skill blocks, not that
fixture.

## Source Ownership

- `runtime`: schema, transitions, persistence, and tool-facing runtime API.
- `adapters`: OpenCode config, hooks, and tool registration.
- `distribution`: syncing bundled skills and uninstalling Flow-owned skill folders.
- `prompt-surfaces`: role/phase-specific prompt compilation and offline handoff shape validation.
- `prompt-quality`: reproducible prompt metrics, repetition classifications, and static contracts.
- `prompt-model-evaluation`: opt-in model-decision packets, schemas, and deterministic grading.
- `config-shared`: command and agent configuration consuming compiled prompts.

Keep adapter/distribution concerns out of runtime.

## Dependencies

- `@opencode-ai/plugin` is a peer range (`>=1.17.3 <2`) so users on newer
  OpenCode versions install without resolution friction; the exact version CI
  verifies against stays pinned in `devDependencies`. Widen the lower bound
  only after testing, and cap at the next major.
- `zod` is exact-pinned and externalized on purpose: Zod schema objects cross
  the plugin/host boundary (they are handed to the host's `tool()` runner), so
  the pin prevents instanceof/shape drift between the plugin's schemas and the
  host's Zod copy. Bump it deliberately alongside the tested
  `@opencode-ai/plugin` version, not automatically.

## Release Publishing

Release tags drive `.github/workflows/release.yml`. Before tagging, make sure
`package.json`, README install pins, `CHANGELOG.md`, and the tag name all use
the same version.

npm publishing uses trusted publishing through GitHub Actions OIDC. Do not add
`NPM_TOKEN` back to the workflow for normal releases. The npm package settings
must trust provider `GitHub Actions`, owner `ddv1982`, repository
`flow-opencode`, and workflow `release.yml`; leave the npm trusted-publisher
environment blank unless the GitHub workflow starts using an environment.

The normal release path is: commit the versioned release changes, push `main`,
then create and push a fresh `vX.Y.Z` tag. Avoid moving existing release tags
unless a maintainer explicitly chooses that rollback or repair path.

After pushing the tag, monitor both the tag-triggered Release workflow and the
branch-triggered CI workflow for the release commit before declaring the release
healthy:

```bash
bun run release:monitor -- --commit <main-sha> --tag vX.Y.Z
```

## Checks

Use focused tests for changed behavior, then run:

```bash
bun run check
```
