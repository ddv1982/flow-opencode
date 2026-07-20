# Flow Plugin for OpenCode

`opencode-plugin-flow` gives OpenCode a small, durable workflow for coding work
that benefits from an approved plan and an independent review. Flow v6 keeps
its durable lifecycle serial while allowing bounded parallel implementation
inside one active feature:

```text
plan → approve → one active feature → optional worker wave → integrate → validate → independent review → next or close
```

For multi-feature plans, the run/validate/review step repeats one feature at a
time. Only the implementation work inside that run may fan out. State lives in
`.flow/session.json`, so the workflow can resume after a restart or context
change without turning Flow into a general orchestration framework.

## Install

Install the exact npm release through OpenCode:

```bash
opencode plugin opencode-plugin-flow@6.1.0 --global --force
```

Omit `--global` for project scope. To update, replace `6.1.0` with the new exact
release and rerun the command. OpenCode owns package installation and config
mutation; Flow does not scan projects, delete caches, elect versions, or repair
configuration.

The equivalent manual project configuration is:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-flow@6.1.0"]
}
```

Then restart OpenCode. OpenCode resolves npm plugins from this configuration;
see the official [OpenCode plugin documentation](https://opencode.ai/docs/plugins/).

Flow has no installer or activation CLI. Removing the configuration entry
disables Flow. If two Flow copies load for the same project, both fail closed
until the duplicate is removed.

## Quick start

Start a complete workflow:

```text
/flow-auto add rate limiting to the public API
```

Flow inspects the Git worktree, saves a feature DAG, and asks for approval unless
the request already grants that authority. It then starts one runnable feature,
arms the exact validation command, creates one independent review assignment,
and records the result. `/flow-status` reports the durable next action at any
time.

Use a narrower command when you want to control the phase:

```text
/flow-plan add rate limiting to the public API
/flow-run
/flow-status
```

Asking for a plan only stops after planning. Flow does not infer permission to
implement, commit, push, or publish from a planning request.

## Lifecycle

An approved plan is immutable and contains a directed acyclic graph of
features. The runtime starts only a feature whose dependencies are complete,
and only one run may be active.

For each run:

1. The manager implements the feature serially by default. Flow guidance permits
   an ephemeral worker cohort only when it can name two or three genuinely
   independent slices with exact, non-overlapping ownership.
2. Each `flow-worker` instance returns its bounded contribution and evidence to
   the manager. Workers cannot delegate, operate outside the project, call Flow
   tools, or approve their own work. One targeted follow-up cohort may address a
   concrete gap, retry, or consequential verification; automatic further waves
   are not allowed.
3. The manager inspects and integrates the combined work, accepts or rejects
   worker evidence, and remains the only owner of lifecycle mutations. Shared
   contracts and integration files stay manager-owned.
4. `flow_validation_start` binds the current run and workspace-content digest
   to the exact next Bash command.
5. OpenCode observes that command's structured exit status and output
   completeness, then records the observation directly in Session v5.
6. `flow_review_start` records the changed artifact paths, selects applicable
   passing validation, and creates one durable assignment for the hidden
   `flow-reviewer`.
7. `flow_feature_complete` records the review result and marks the run complete
   or blocked.

The worker wave is an execution convenience, not another lifecycle. Flow writes
no wave ledger, manifest, or sidecar file. If execution is interrupted, the
manager recovers from ordinary Flow status and worktree inspection, then reruns
or finishes uncovered work. The manager always performs combined authoritative
validation before the one independent review. The cohort limit is a guidance
contract, not a scheduler or admission gate; the runtime enforces worker
permissions and the existing one-run validation/review boundary.

The final runnable feature derives a `final` review instead of adding a second
review pass. It requires broad passing validation for current workspace
content. Every other run derives a feature review. A failed review blocks the
feature; `flow_feature_reset` supersedes the failed run and creates a fresh full
attempt with no carried validation or review.

After every feature passes, `flow_session_close` records the terminal
disposition and archives the session. A session may also be closed explicitly
as deferred or abandoned.

## Commands

| Command | Purpose |
| --- | --- |
| `/flow-auto <goal>` | Drive the authorized lifecycle, stopping after planning when requested. |
| `/flow-plan <goal>` | Create or approve a plan. |
| `/flow-run` | Run or resume one approved feature. |
| `/flow-review` | Dispatch the independent read-only reviewer. |
| `/flow-status` | Inspect the active session and next action. |

Flow registers exactly two hidden subagents: `flow-worker` and
`flow-reviewer`. The implementation worker is reusable across a bounded wave;
edits and Bash require host approval, while external-directory access, skill
loading, delegation, and every Flow tool are denied. The reviewer remains
read-only and can read reviewer status, but cannot edit files, run Bash, load
skills, delegate work, or call state-changing Flow tools. The root manager owns
the lifecycle, integration, and evidence acceptance.

## Tools

The plugin exposes ten tools:

| Tool | Purpose |
| --- | --- |
| `flow_guidance` | Load one concise package-owned guide. |
| `flow_status` | Read compact, execution, detail, or reviewer state. |
| `flow_plan_save` | Create or replace the active draft plan. |
| `flow_plan_approve` | Approve and lock the current plan. |
| `flow_run_start` | Start one runnable approved feature. |
| `flow_validation_start` | Arm observation for the exact next Bash command. |
| `flow_review_start` | Create the run's one independent review assignment. |
| `flow_feature_complete` | Record the review result and feature outcome atomically. |
| `flow_feature_reset` | Reset a feature and its dependents for a fresh full retry. |
| `flow_session_close` | Close and archive a session in one operation. |

The nine lifecycle tools use a strict nested `request` object and return state
under `workflowData`. Mutations require the current session revision and a
stable operation ID. Repeating the exact accepted operation is idempotent;
reusing its ID for different input fails. `flow_guidance` is the one exception:
it accepts `{ "id": "..." }` and returns the guide as Markdown.

## Guides

Flow exposes exactly four concise guides through `flow_guidance`:

| Guide | Purpose |
| --- | --- |
| `flow` | Orient the manager to the complete lifecycle and authority boundary. |
| `flow-plan` | Create a small approved feature DAG. |
| `flow-run` | Execute one feature, optionally using a bounded worker wave. |
| `flow-review` | Perform the run's independent review assignment. |

## What the runtime enforces

- Session v5 is the only active document format supported by Flow v6. Finish or
  close older active sessions before upgrading; old archives are inert history.
- Lifecycle order is carried by revisions and durable record order, not UTC
  timestamps or caller clocks.
- Plans are immutable after approval, dependencies must be acyclic, and only one
  durable run can be active. An ephemeral worker wave does not create additional
  runs or concurrent Flow state.
- Validation must be observed from the exact armed Bash command. Failed,
  incomplete, stale-source, or mismatched observations cannot authorize review.
- Each run has one review. Final-feature review requires broad validation;
  there is no targeted-then-broad dual pass.
- Completion fails if workspace content changed after review started.
- Failed review retries are full resets, not correction modes or delta-scoped
  review protocols.
- Every blocking review finding carries concrete artifact, missing-evidence, or
  unmet-requirement evidence.
- `.flow/session.json` is written under a project lock with schema validation,
  atomic replacement, quarantine for unreadable state, and no-follow path
  checks. Closed state is archived beneath `.flow/history/`.
- Source binding requires a readable Git worktree. Git submodules are rejected
  explicitly; Flow does not claim to fingerprint work split across repositories.
- Duplicate runtime copies for one project fail closed. This is a safety guard,
  not version election or automatic configuration repair.

Flow deliberately does not include orchestration profiles, worker admission,
wave telemetry or ledgers, audit-ledger rendering, replay reports, detached
validation receipts, or automatic activation and cache repair. Bounded waves
restore useful host-native parallel contribution without reviving that
machinery. They are a capability boundary, not a claim of measured performance
improvement.

## Development

Requirements: Git, Node.js 24 or newer, Bun 1.3.14, and the versions pinned in
`package.json`.

```bash
bun install --frozen-lockfile
bun run check
```

The normal check runs typechecking, formatting/lint checks, build verification,
tests, and package smoke. Release CI also exercises the packed plugin in a real
OpenCode host.

Maintained documentation starts at [docs/index.md](docs/index.md). See
[development](docs/development.md) for repository structure and focused checks,
[troubleshooting](docs/troubleshooting.md) for recovery, and
[ADR 0005](docs/adr/0005-flow-v6-session-v5-simplicity-first.md) for the v6
tradeoffs. [ADR 0006](docs/adr/0006-bounded-intra-feature-waves.md) defines the
bounded intra-feature wave amendment.

## License

MIT
