# Development

Flow is an ESM TypeScript package built and tested with Git and versions
pinned in `package.json`.

## Local setup

```bash
bun install --frozen-lockfile
bun run check
```

`bun run check` is the canonical deterministic gate. Use focused commands while
iterating:

```bash
bun run typecheck
bun run lint
bun test tests/domain-transitions.test.ts
bun test tests/runtime-gates.test.ts tests/validation-capture.test.ts
bun test tests/workspace-persistence.test.ts
bun run build
bun run package:smoke
```

The opt-in real-host check launches the pinned `opencode-ai` package through
`bunx`. It requires registry access or a populated Bun cache rather than a
separately installed OpenCode binary:

```bash
bun run smoke:live
```

### Bumping the pinned host

`@opencode-ai/plugin` and `zod` are on `.github/dependabot.yml`'s ignore list,
so they are raised by hand. The plugin pin is also the host version
`smoke:live` launches, so bumping it puts a new host under test:

1. Move the `devDependencies` pin, and `peerDependencies` too if the new version
   falls outside the declared range.
2. Run `bun run check`, then `bun run smoke:live` for the real host.

Widen the peer range only for a smoke-tested host; a wider range makes a
compatibility claim no check has run.

## Source layout

- `src/domain/` owns Session v5 values, invariants, and transitions that use
  only JavaScript/Node standard-library primitives.
- `src/application/` owns use cases and repository ports.
- `src/infrastructure/` owns filesystem persistence and source fingerprinting:
  `fs/workspace-paths.ts` (workspace root validation, `.flow` layout),
  `fs/managed-fs.ts` (managed filesystem primitives), `fs/session-lock.ts`
  (cross-process session lock), `fs/workspace.ts` (session file protocol).
- `src/platform/opencode/` owns OpenCode hooks, host schemas, commands, tools,
  validation capture, and the duplicate-runtime guard: `command-hook.ts`
  (slash-command hook), `tool-guard.ts` (leadership and auto-drive guard
  around the tools), `plugin.ts` (wiring only).
- `src/guidance/`, `skills/`, and prompt surfaces own concise workflow judgment.
- `tests/` prove state-machine, persistence, platform, package, and host
  contracts.

Dependencies point inward. Domain code does not import filesystem or host APIs;
application code depends on domain; infrastructure implements application
ports; the OpenCode platform composes the outer layers.

There is no distribution/activation subsystem, cache inventory, repair
journal, or Flow-owned installer: OpenCode installs and loads the npm package
from its native plugin command and normal configuration.

## Change discipline

- Keep Session v5 as one canonical run aggregate: derive status and progress
  instead of parallel ledgers or cached counters.
- Every mutation needs a revision guard and stable operation ID. Exact replay is
  safe; conflicting reuse fails.
- Only the reserved reviewer may create a new completion; while the Session v5
  workflow remains active, every other caller gets an exact accepted-completion
  replay through a read-only path that neither cancels validation nor writes
  session state.
- Keep validation host-observed and session-native: no caller-authored
  success, detached receipt stores, or clock requirements.
- Treat validation scope as a coverage claim: `broad` means the canonical
  repository gate, byte for byte, not a narrow command relabeled.
- Validation commands are persisted, never with inline secrets. Raw output is
  reduced to completeness and a digest rather than stored or projected.
- Keep one review per run. A final review requires broad validation and is not a
  second pass. The reviewer submits through `flow_feature_complete`; the
  manager never proxies its verdict.
- Prefer deletion when a test or document exists only for a removed concept,
  not a dual stack for pre-v6 active state.
- Use table-driven lifecycle and persistence tests, not registries that test
  the presence of other tests.

## Documentation

Update the README, maintainer contract, ADR, and changelog when a public
lifecycle or installation contract changes; documentation describes only the
current product, and Git history owns superseded plans and experiments.

## Model-driven wave evidence

Deterministic CI validates schemas, permissions, prompts, and host integration
without provider credentials. It does not claim a model overlaps workers, so
changes to wave behavior should be exercised manually with a real provider
when available, with sanitized evidence of:

- worker start/end times with a positive common overlap;
- assigned versus changed paths and any scope drift;
- permission prompts or denials and worker Bash calls; and
- reviewer-owned `flow_feature_complete` submission.

Every wave-behavior change needs this evidence when marked verified, but it is
not a deterministic release gate. Without a provider, mark the behavior
unverified, record the review risk, and avoid performance or
reliability claims. Do not persist prompts, secrets, raw provider payloads, or a
wave ledger, and do not add provider credentials, a scheduler, or telemetry to
CI.

## Model-driven auto-continuation evidence

Deterministic tests exercise the coordinator through the real plugin hooks and
the `promptAsync` client boundary, but do not prove how a configured model
behaves after delivery. When auto-continuation behavior changes and a provider
is available, run one packed-plugin canary recording sanitized evidence of:

- idle `ready` delivery with the Flow token and compact revision;
- recommendation or clarification at a checkpoint remaining waiting, followed
  by a same-host accepted approval resuming exactly once while an other-host
  revision advance does not;
- compaction retaining the manager kernel and reserved Flow roles;
- one automatic fresh retry only at `failedReviewCount === 1` without a
  `scopeBlocker` finding, with every higher count awaiting user direction;
- one reviewed retry preserving prior `findingId` values, refreshed baseline
  facts, prior dispositions, and its applicable transition matrix; and
- confirmed completed closure with the final conversational disposition map
  reconstructed from the existing concise `workflowData.delivery`.

Use the existing host transcript and Flow detail projection; add no telemetry or
persisted continuation state. Keep credentials, raw provider payloads, and user
content out of evidence. This is an opt-in provider canary, not a CI model
evaluation. If unavailable, mark model behavior unverified while retaining the
deterministic hook and lifecycle gates.

## Release

Follow the [frozen-candidate sequence](release-qualification.md#running-it):
finish fixes and dependency updates, pass deterministic checks, approve paid
evals.
`bun run qualify -- --campaign-dir <dir> --canary <record>` seals the
two-provider campaign, exact-artifact canary and grader evidence. Commit that
bundle before tagging; never substitute interrupted results for qualification.

Release tags use `v<package-version>`. Blocking release checks: the normal
repository gate, package smoke, packed live OpenCode smoke, package integrity
generation, npm publication, and GitHub release assets. There is no
cross-version active-session gate; v6 is an explicit hard cutover.

Publication accepts both annotated and lightweight tags, but the freshly fetched
tag, workflow event, checkout, and current remote `main` tip must identify the
same commit before npm publication. Network calls have explicit deadlines. npm
publication reconciles the immutable package integrity after every result,
including timeouts. GitHub publication first builds an exact draft under the
same ref proof. That draft recovers if npm succeeds and `main` then advances.
Finalization rechecks the remote tag, refuses conflicting metadata
or assets, and publishes only after every asset digest matches. Reruns converge
after partial success without replacing published bytes.

Preparing an already-published release is read-only and requires exact assets.
Missing or pending assets fail preparation; use the `github-publish` recovery
path with the original inputs and tag proof to restore a missing asset.
