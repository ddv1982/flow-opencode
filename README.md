# Flow Plugin for OpenCode

`opencode-plugin-flow` gives OpenCode a durable workflow for coding work that
benefits from an approved plan and an independent review:

```text
plan → approve → run one feature → validate → review → repeat or close
```

Flow keeps one durable active feature run at a time. Once a session starts it
stays the workflow for that goal until Flow records completed, deferred, or
abandoned closure. It never silently falls back to ordinary coding, and it does
not fold a materially different request into the active goal.

State lives in `.flow/session.json`, so the workflow survives a restart, a
context change, or a lost transcript.

Flow is in preview: an opinionated workflow for consequential multi-step changes,
for people who read the review. It is worth its ceremony when a wrong change is
expensive, and it is overhead when it is not.

## When not to use Flow

- **Small changes.** A one-file fix or a rename pays for a plan, a validation, a
  review, and a close that it did not need.
- **Exploration.** Approval locks the plan, and a materially different request will
  not be folded into the active goal.
- **Speed above all.** A serial lifecycle with an independent review is slower than
  asking directly, deliberately.
- **Trusting the verdict without reading it.** The review is a model judgment, not
  a proof. [What Flow guarantees](docs/guarantees.md) separates the rules the
  runtime enforces from the ones that are judgment.
- **Parallel features, several repositories, or team orchestration.** Flow runs one
  durable feature at a time in one project.

[Positioning](docs/positioning.md) has the longer version.

## Install

Install the exact npm release through OpenCode:

```bash
opencode plugin opencode-plugin-flow@8.1.3 --global --force
```

Omit `--global` for project scope. Version pins are exact and never update on
their own; to update, rerun the command with the new version.

The equivalent manual project configuration is:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-flow@8.1.3"]
}
```

For an explicit reviewer model, use OpenCode's plugin tuple options:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-plugin-flow@8.1.3",
      { "reviewer": { "model": "provider/model", "steps": 80 } }
    ]
  ]
}
```

The tuple values take precedence over `OPENCODE_FLOW_REVIEWER_MODEL` and
`OPENCODE_FLOW_REVIEWER_STEPS`. `/flow-status` reports the process-local
selection, but only a successful reviewer run confirms model availability.

Restart OpenCode after changing configuration. OpenCode owns installation and
configuration; see its
[plugin documentation](https://opencode.ai/docs/plugins/). Flow has no installer
or activation CLI, and removing the plugin entry disables it. If two Flow copies
load for one project, both fail closed until the duplicate is removed.

**Changing versions.** Finish or explicitly close any active session first, in
either direction. Flow opens only Session v5 active state, and an older build
cannot be trusted to read state a newer one has already written. Older archives
remain inert history, and there is no migration or rollback layer.

## Quick start

For a clean installation and reviewer-configuration check, follow the
[quickstart](docs/quickstart.md).

```text
/flow-auto add rate limiting to the public API
```

`/flow-auto` is the ordinary end-to-end driver. It inspects the worktree,
proposes a feature plan, and asks for approval unless your request already
authorized implementation. It then runs one feature at a time — implement,
validate against the real workspace, obtain an independent review — and keeps
going through every runnable feature without handing back between them, until it
can close the session.

Continuation between features needs a host that reports assistant message
parentage. Flow says so plainly when it detects a host that does not: the lifecycle
still works, one `/flow-run` at a time.

Send `/flow-auto stop` or `/flow-auto cancel` in the same OpenCode session to
revoke only the in-process continuation. That does not close, defer, abandon, or
otherwise change the durable Flow session.

Before any Flow mutation, Flow compares your request against the active goal. A
continuation or a compatible narrowing proceeds. A materially new or expanded
request does not start or mutate the active session: Flow offers to continue,
defer, or abandon the active work first, and closes work that is already
complete before starting something new.

To plan without implementing:

```text
/flow-plan add rate limiting to the public API
```

Review the plan and approve it conversationally. `/flow-plan` never grants
permission to implement, commit, push, or publish. After approval, `/flow-run`
executes or recovers one approved feature. Repeating the same plan-only request
reports the immutable plan and current progress instead of rewriting it.

`/flow-status` reports durable state and the next action at any point. That next
action is the default workflow direction, not permission to exceed the authority
you granted.

## How Flow works

1. Planning saves a small feature DAG, including the repository's canonical
   validation command. Approval locks both.
2. One feature starts, chosen only from those whose dependencies are complete.
3. Before editing, the manager gathers the evidence the feature needs and works
   through an adversarial risk checklist: failure ordering, repeated and
   interrupted operations, adjacent state transitions, overlapping invariants,
   and file-mode or platform risk.
4. The manager implements the feature, serially or by integrating a bounded
   worker wave.
5. Flow observes the exact armed validation command against the current
   workspace, then opens one independent review assignment. Broad evidence runs
   the plan's declared gate and nothing else. A newer relevant failure or a source
   change invalidates an older pass, and review cannot be requested while evidence
   the outcome depends on is knowingly missing.
6. A passing review advances the plan. A failed feature is never picked up again
   implicitly — Flow reports the blocker and waits for an explicit retry or an
   independent-feature choice. The last passing feature allows closure, and every
   accepted close returns a versioned delivery summary derived from recorded state:
   each feature's attempts, latest outcome, terminal findings, and tiered assurance
   with explicit limitations. Delivery grants no PR, merge, publish, or release
   authority.

Findings keep stable ids across retries, and a failed review must carry every
still-live finding forward — the runtime rejects a submission that drops one. A
reviewer marks a finding as out of scope only when the repair would materially
exceed the approved plan.

## Bounded parallelism

Parallel work is optional and confined to one active feature. The manager may
launch two or three `flow-worker` instances for exact, non-overlapping slices,
then inspect and integrate the result, with at most one follow-up wave for a
concrete gap. Once implementation is authorized, a qualifying wave needs no
separate approval.

Workers cannot delegate, call Flow lifecycle tools, or approve their own work,
and general-purpose agents are never used for active Flow work: implementation
uses `flow-worker`, independent review uses `flow-reviewer`. Flow persists no
wave state, so the manager stays responsible for the combined diff, the
authoritative validation, and the one independent review. Small or
integration-heavy features stay serial.

## Commands

| Command | Purpose |
| --- | --- |
| `/flow-auto <goal>` | Normal end-to-end driver. Stops after planning without implementation authority; otherwise loops through every runnable feature and closure. |
| `/flow-plan <goal>` | Plan-only creation, revision, and approval. |
| `/flow-run` | Advanced/recovery execution of one approved feature. |
| `/flow-review` | Internal/recovery dispatch for a runtime-created reviewer assignment. |
| `/flow-status` | Advanced/recovery inspection of the active session and next action. |

Use `/flow-auto` for ordinary work. The rest expose plan-only, advanced,
internal, or recovery controls.

## Recovery

Start with `/flow-status`. After a failed review, read detail once to see the
findings a retry must fix, then pass the exact retry or independent-feature
choice so that reset and the next run are one operation rather than relying on
default selection.

If an accepted close was interrupted, compact status supplies
`archiveRetry.request`; replay it exactly once, before any other recovery read.
Never close a replacement session, and never hand-edit `.flow/session.json` to
get past a gate. For a validation, review, locking, fingerprinting, or archive
failure, follow [troubleshooting](docs/troubleshooting.md).

## Development

Requirements: Git, Node.js 24 or newer, Bun 1.3.14, and the versions pinned in
`package.json`.

```bash
bun install --frozen-lockfile
bun run check
```

`bun run check` runs typechecking, lint, build verification, tests, and package
smoke. Release CI also exercises the packed plugin in a real OpenCode host.

Maintained documentation starts at [docs/index.md](docs/index.md):
[development](docs/development.md) for repository structure,
[troubleshooting](docs/troubleshooting.md) for recovery,
[the maintainer contract](docs/maintainer-contract.md) for tools and runtime
invariants, and [ADR 0006](docs/adr/0006-bounded-intra-feature-waves.md) for the
bounded-wave rationale.

## License

MIT
