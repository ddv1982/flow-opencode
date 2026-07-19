# Maintainer Contract

Flow v5 has one rule: keep the boundaries explicit and the behavior small.

## Split

- `skills/**` owns authored guidance: planning, decomposition, review depth, validation quality, recovery choices, cleanup, and UI quality.
- `src/guidance/**` owns the typed embedded catalog and stable guidance ids.
- `src/domain/**` owns immutable values and pure hard-gate transitions.
- `src/application/**` owns use cases, direct Zod schemas, typed results, and
  ports.
- `src/infrastructure/**` owns filesystem persistence and system services.
- `src/platform/opencode/**` owns the OpenCode bridge and its private host
  schemas.
- `src/distribution/**` owns the explicit, recoverable v4 cleanup utility only.

Do not move planning or review heuristics into runtime projections. If a rule needs interpretation, it belongs in a skill.

## Hard Gates

Runtime must enforce:

1. A plan cannot be changed after approval.
2. Only one feature can run at a time.
3. Every run has runtime-owned feature-run identity; reset preserves but ends
   applicability of its evidence and review truth.
4. Reviewer assignment requires passing validation bound to current source and
   the active run in trusted chronology. Validation starts no earlier than the
   run and completes no later than assignment start.
5. Feature assignment requires targeted validation. Final assignment requires
   broad validation plus the exact passing feature-assignment prerequisite,
   durably bound as one aggregate containing assignment id, cloned canonical
   result, and result digest. Every same-run, same-source final-review retry
   reuses the first aggregate exactly; detail status exposes the bounded
   recovery value while compact and reviewer status omit it.
6. Review depth is derived from the approved plan and stored on the assignment.
7. Non-final completion requires one passing feature-assignment result.
8. A passing final feature outcome carries one distinct final-assignment result;
   the runtime consumes the exact durable bound feature result and records both
   atomically. Reported result time cannot precede assignment start or postdate
   the one runtime acceptance time captured for the mutation.
9. A passing final feature outcome marks progress `completed` but does not
   create closure.
   Only `flow_session_close` records closure and the `session_close` mutation.
10. A session cannot close as `completed` unless an approved plan has passed final completion.
11. Every closure is quiescent: active-execution feature and run identities are null, an
    active run is terminalized, and pending assignments are invalidated.
12. Once `closure` is recorded, every ordinary mutation fails and
    `flow_session_close` accepts only retry by the durable accepted operation id
    until archive publication succeeds.
13. A close-start operation id is unused in the active causal chain and in
    every mutation in canonical Session v4 workspace history. Quarantine files
    are excluded; corrupt, unsupported, filename-mismatched, or ambiguous
    canonical history fails closed before active bytes change.
14. `flow_plan_save` updates only the active same-goal draft. A different goal
    cannot replace any unclosed session; unfinished work requires explicit
    `deferred` or `abandoned` closure and converged archive publication first.
15. Archive publication requires a non-null explicit closure. A closureless
    Session v4 document may be active state, but it cannot become or validate
    canonical history; canonical lookup fails closed if it encounters one.

## State

`.flow/session.json` is the only active source of truth and the only active-state representation. `.flow/history/<sha256(session-id)>.json` stores explicitly closed sessions; lookup verifies that each lowercase digest filename matches the exact parsed session id. A Session v4 document with `closure: null` is not publishable or valid canonical history. Restricted evidence bytes live separately under `.flow/evidence/v1/sha256/**`; the session ledger stores only typed digest/length references to them. This is ordinary hash-addressed filesystem storage, not a database, index, cache of projected state, or qa-scribe integration. Archive publication is exclusive and no-clobber: persist the closed active snapshot first, let a short-lived helper pinned to the validated history-directory identity write and sync a relative temporary file, publish it with an exclusive hard link, accept an existing target only when its normalized session is identical, and remove active state only through a second helper pinned to the validated `.flow` identity after archive and topology revalidation. A different existing archive is a collision and must leave both its bytes and readable active state intact. Flow writes or safely extends `.flow/.gitignore` so session, history, evidence, and lock state remain ignored even when a maintainer has custom entries. Any archive or versioning of `.flow` artifacts must be explicit, artifact-specific maintainer intent; broad `.flow/**` staging is not part of the default contract. Markdown docs, context views, readiness ledgers, ambient instruction files, and other projection caches are intentionally not runtime state.

Before a new close starts, repository lookup checks its operation id against
every mutation in canonical Session v4 workspace history. One match of any
mutation kind is a collision because post-archive retry is keyed only by that
id. Quarantine files never authorize retry. Canonical-history corruption,
unsupported versions, filename mismatch, or ambiguous matches stop the close
without changing the active session. A rejected collision is not a retry
handle; the caller chooses a fresh id.

Canonical session ids remain bounded to 1–128 ASCII letters, digits,
underscores, or hyphens. Persistence maps the exact case-sensitive id to a
fixed lowercase SHA-256 archive component, so case-folding filesystems and deep
workspace paths do not make an accepted id unpublishable. Generic corruption
recovery remains in the disjoint `quarantine-<content-sha256>.json` namespace.

Every committed mutation advances one nonnegative revision and records a stable
operation id, operation kind, canonical request digest, prior/current snapshot,
prior mutation digest, changed entity/fields, blocker delta, and evidence
references. Review assignment, completion, reset, and close bind
their operation identity to the expected revision and snapshot. Replaying the
same operation envelope is idempotent; reusing an id for another kind, payload,
or causal assignment fails closed. The SHA-256 chain is an integrity and replay
boundary, not a secret signature against an actor who can rewrite the entire
workspace.

Pending review assignments are source-applicable. A same-run, same-kind review
start on changed source atomically invalidates the stale assignment with
`source_changed` and creates a replacement; reset invalidation records
`feature_reset`. An unchanged-source pending assignment remains recoverable and
blocks duplicate identity. Closure invalidates pending work for the terminalized
run. Final assignments persist one bound prerequisite result containing the
feature-assignment id, cloned canonical passing result, and canonical digest.
The bound result does not become a recorded review execution until an accepted
feature outcome records it atomically with the final-assignment result.
For same-source final-review recovery, detail projection exposes
`finalReviewRetry` with final-assignment, run, and source identity plus the
bounded prerequisite aggregate. The manager copies
`finalReviewRetry.prerequisite.result` unchanged into the next final review
start's `request.featureReview`. The projection also carries final-assignment,
run, source, prerequisite-assignment, and result-digest identity, and the raw
result stays within the persisted 64 KiB limit. Compact and reviewer projections
intentionally omit the aggregate; it is manager recovery state, not reviewer
scope. A mismatched retry is mutation-free and leaves its operation id reusable.
A source edit starts a new targeted feature-review sequence instead of reusing
the old-source binding.

Reported chronology is inclusive:
`feature-run start <= validation start <= validation completion <= assignment
start <= reported assignment-result time <= runtime acceptance time`. Final broad
validation starts no earlier than the bound feature-assignment result and
completes no later than final-assignment start.

Budget and retry telemetry in the session ledger records review counts, failed
review counts, per-feature-run failed review attempts, and bounded orchestration
pass accounting. Review retry exhaustion uses the ordinary blocked-feature
state and resumes only through `flow_feature_reset` and a fresh run.

Plan and goal admission must preserve reachability of the bounded runtime
views. A goal must leave room for the smallest 12 KiB execution projection; an
accepted plan must fit every feature's final and non-final execution projection
and the smallest feature/final reviewer projections. Plans and each of their
requirements, decisions, targets, validation, and dependency collections are
bounded to 500 entries, with cardinality checked before deep parsing or copying.
Dependency validation must remain iterative. Persisted timestamps are valid ISO
datetimes with an explicit offset, and one feature run may have at most one
pending assignment of each review kind.

Runtime pass accounting is deliberately bounded: counts, recent pass ids,
worker counts, candidate/verifier usage, skipped candidate decisions, handoff
references, verification status, outcome, and synthesis references. Full worker
handoffs, transcripts, scratch tables, and standalone manager synthesis
artifacts stay outside `.flow/**`. Exact validation output may enter only the
restricted, size-bounded `.flow/evidence/**` store when explicitly published;
ordinary status and mutation responses expose its digest/length reference, not
its bytes, absolute path, or low-level filesystem errors. Distilled conclusions
may enter plan prose or completion summaries when they are the Flow artifact
being recorded. The raw optional telemetry boundary rejects non-JSON values and
payloads above 65,536 serialized UTF-8 bytes. Structurally malformed input and
otherwise valid collections above 50 pass records remain warning-and-drop
telemetry failures, not feature-outcome failures. `latestPasses` retains the
newest records fitting both 50 records and 65,536 bytes. Aggregate counters
saturate at the largest safe JavaScript integer so optional telemetry cannot
invalidate a core feature outcome. Pass ids deduplicate within a payload and
while they remain in that window; an evicted id may be counted again because
this is telemetry, not a permanent idempotency ledger.

Writes must stay locked, atomic, duplicate-key-safe on read, and guarded against
filesystem roots, `$HOME`, and symbolic links at every Flow-managed path. Root
aliases are canonicalized before lock identity or containment decisions.
Lock owner metadata is trusted only after semantic validation: tokens are
non-empty, pids are positive safe integers, hostnames are non-empty, and
timestamps parse to finite values. Locks are never stolen based on age or an
owner-liveness guess; only the matching unique owner token may release a lock.

Domain transitions may structurally share existing session state, but must copy
every caller-owned collection and nested evidence object before recording it.
Completion outcome discriminators are always explicit; union-branch defaults
must not decide persisted state.

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

- `flow_guidance`
- `flow_status`
- `flow_plan_save`
- `flow_plan_approve`
- `flow_run_start`
- `flow_review_start`
- `flow_feature_complete`
- `flow_feature_reset`
- `flow_session_close`

Tool responses keep plugin-authored operation metadata at the top level. All
session, feature, closure, failure-detail, and other repository- or
caller-controlled prose belongs under `workflowData`. Active `flow_status`
returns top-level `status: "ok"`; callers explicitly select the compact
state-machine view through `{ request: { view: "compact" } }`. Compact is
routing-only and includes causal guards plus `closure.kind` and the complete
`closure.retryOperationId` needed for archive recovery. Explicit
`execution`, `detail`, `reviewer`, and `sinceRevision` requests select full
active-feature working scope, bounded diagnostics, narrow review assignment
context, or deltas. Ordinary mutations return `workflowData.receipt`, not a
full session; receipts acknowledge mutations and never become feature scope or
continuation state. Rejections also carry a consequence receipt with both
acceptance booleans false; accepted blockers carry both true. Top-level response
strings must never interpolate untrusted workflow prose.

No runtime compatibility aliases, session migrations, or readers are allowed
for any other session contract or retired tool. Session v4 is the only active
runtime schema and the only version permitted in canonical history. A different
version is generic unsupported input and receives no version-specific recovery
path. The standalone global-folder cleanup utility is distribution hygiene, not
session-runtime compatibility.

## Embedded Guidance

The authored guidance topics are:

- `flow`
- `flow-plan`
- `flow-run`
- `flow-test`
- `flow-review`
- `flow-deslop`
- `flow-ui-quality`
- `flow-commit`

Every runtime-loadable document has one stable id in
`src/guidance/ids.ts` and one text entry in `src/guidance/catalog.ts`. Main documents use ids such as `flow-test`;
references use ids such as `flow-ui-quality/references/ui-rubric.md`. The
catalog imports Markdown as text so Bun embeds it into `dist/index.js`.
`flow_guidance` returns that exact text and never reads the filesystem or
changes Flow state.

Install and update guidance should use OpenCode's native plugin installer as the
primary config mutation path when available, with one pinned install-or-update
command:
`opencode plugin opencode-plugin-flow@<version> --global --force`. OpenCode
keeps an existing same-package plugin entry unless replacement is requested, so
published Flow docs should include `--force` by default. Flow's CLI exists only
for explicit v4 legacy cleanup; it must not silently mutate OpenCode plugin
config. The manual `opencode.json` fallback for older OpenCode
versions should tell users to replace older pinned Flow entries instead of
adding duplicates.

Plugin initialization must never read or write OpenCode's global skills root.
There is no sync health, `setup.skills`, marker update, backup, doctor, sync, or
second-restart workflow. Package smoke must prove guidance is embedded, and
surface tests must prove concurrent initialization leaves hostile global links
untouched.

Public Flow commands must call `flow_status` with
`{ request: { view: "compact" } }` first and
read workflow state only from `workflowData.projection`. A stored
`projection.closure.retryOperationId` routes only to
`flow_session_close { request: { mode: "retry", operationId } }`. Ready
work calls `flow_run_start`, treats its receipt as acknowledgement, then loads
`{ request: { view: "execution" } }`; already running or resumed work loads
execution directly.
Execution scope and causal guards govern implementation and validation. The
manager creates review identity with `flow_review_start`, reviewers recover
only by assignment id, and `flow_feature_complete` records one atomic nested
result. Immediately after completion the manager refreshes compact
status: a completed projection with null closure calls a new guarded
`flow_session_close { request: { mode: "start", kind: "completed", ...guards } }`;
a stored closure is archive-only and retries only by its durable operation id.
`flow-auto` otherwise continues,
while `flow-run` reports after its one feature.
An explicit plan-only or “do not implement” request is an execution boundary
even on `flow-auto`: save and summarize the plan, then stop before
`flow_run_start`.

Model-visible scope references use a host-independent lexical privacy boundary.
Flow normalizes with NFKC and trims first, then replaces POSIX roots, leading
backslashes, drive-qualified paths, UNC/device paths, URI schemes, home roots,
and exact `..` path segments with deterministic digests. Safe relative values
such as `src\feature.ts` and `foo..bar` remain readable. Classification happens
before bounded-view truncation, and execution retains every transformed target
rather than paginating or silently dropping scope.

OpenCode 1.18 tool registration accepts one `ZodRawShape`. Every lifecycle tool
therefore registers one required `request` field whose value is a strict union
of the conditionally valid branches. The actual registered schema is the host
contract: application, registered, emitted, executed, and documented contracts
must accept and reject the same semantic request set. OpenCode may still invoke
a handler after advertising a request as invalid, so every handler parses the
same registered schema again before entering the application execution wrapper.
That handler-entry rejection is a host tool error and cannot read or mutate Flow
state. Do not retain a flat adapter or a refined test-only shadow schema.

The OpenCode command preflight hook is authoritative for public Flow commands:
it must replace resolved command parts with the current bundled template so stale
command files or command registry cache cannot ask for native skill-loading
behavior. `/flow-auto`, `/flow-plan`, `/flow-run`, and `/flow-review` must stay
self-contained as configured surfaces: manager commands compile selected core
sections, while `/flow-review` supplies the task to the reserved
`flow-reviewer`, whose agent prompt owns the review contract. They must not
depend on native-loading `flow`, `flow-plan`, `flow-run`, or `flow-review`;
references to loading those core skills inside selected source sections mean
using the matching compiled section, not making a native skill call.
`/flow-status` remains tool-only. Optional helpers such as `flow-test`,
`flow-deslop`, `flow-ui-quality`, and user-triggered `flow-commit` are loaded
through `flow_guidance`. Hidden workers deny them through `flow_*`, while the
later `flow_status` allow rule keeps status readable. `flow-commit` must not be
loaded by the autonomous Flow loop and must not replace
`flow_feature_complete`.

Manager commands must reject any unexpected subtask part. `/flow-review` must
receive exactly one OpenCode subtask whose normalized command identity is
`flow-review` and whose agent is `flow-reviewer`; preflight rewrites only that
part's prompt. Missing, duplicate, or mismatched subtask parts fail closed
instead of falling through to parent-session execution.

The only legacy path is the explicitly invoked
`opencode-plugin-flow legacy-cleanup`. Dry-run is mandatory unless `--apply` is
given. Apply atomically quarantines a marker-proven folder, verifies it again at
the new path, and accepts it as archived only when it remains byte-pristine. It
never deletes legacy content. Foreign, edited, extra, malformed, non-directory,
or symlinked content must be refused before the move; content that changes during
the move stays quarantined at the reported recovery path.

The OpenCode config hook only registers Flow commands and agents. It must not
read workspace state, acquire a session lock, write a projected instruction
file, or append a Flow path to `config.instructions`. Canonical Flow commands
begin with `flow_status`, so durable session state is loaded explicitly at the
point of action. Flow does not register OpenCode experimental chat-system,
message-transform, or session-compaction hooks. Flow guidance reacts only to
durable runtime state; it does not estimate context pressure or initiate host
compaction.

## Prompt Contracts

Guidance-attributed prompt fragments must be extracted from their bundled Markdown
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

Prompt changes must preserve all 19 static scenarios and 54 criteria. A surface
may grow by the larger of eight words or 2% before the growth guard requires an
accepted baseline update and a specific justification. The opt-in model runner
has a five-minute default timeout per variant and remains outside the broad
local gate because provider output is nondeterministic.

`src/prompt-baseline-fixtures.ts` is the sole manual-text exception. It is a
frozen compiler-shape comparator, never a production prompt source. Its assembly
topology is historical, but it must retain the current lifecycle and wire
contract. Changes to current skill judgment belong in marked skill blocks, not
that fixture.

## Source Ownership

- `domain`: branded values, orchestration invariants, and pure transitions.
- `application`: use cases, typed results, direct-Zod schemas, and ports.
- `infrastructure`: filesystem repository, strict JSON, locks, and system services.
- `platform/opencode`: private host schemas, OpenCode config, hooks, and tools.
- `guidance`: stable ids and embedded package-owned Markdown.
- `distribution`: explicit, recoverable legacy-folder cleanup outside plugin startup.
- `prompt-surfaces`: role/phase-specific prompt compilation and offline handoff shape validation.
- `prompt-quality`: reproducible prompt metrics, repetition classifications, and static contracts.
- `prompt-model-evaluation`: opt-in model-decision packets, schemas, and deterministic grading.
- `config-shared`: command and agent configuration consuming compiled prompts.

Keep platform, distribution, filesystem, clock, and UUID concerns outside the
domain and application layers.

## Dependencies

- `@opencode-ai/plugin` is a peer range (`>=1.18.3 <2`) so users on newer
  OpenCode versions install without resolution friction; the exact version CI
  verifies against stays pinned in `devDependencies`. Widen the lower bound
  only after testing, and cap at the next major.
- `zod` is exact-pinned and externalized on purpose for Flow's domain and
  persistence validation. Zod schema objects must not cross the plugin/host
  boundary: OpenCode transport schemas use `tool.schema` from
  `@opencode-ai/plugin`, while Flow core schemas use the direct dependency.
  Shared contract fixtures must pass before either validator is bumped.
- TypeScript, Biome, Bun types, Node types, and the OpenCode development host
  are exact-pinned. Keep Node types on the Node 24 line even when a newer
  non-LTS major is published. The `overrides` entry must match the direct pin
  so `bun-types` cannot resolve its wildcard Node dependency to a newer major.

## Release Publishing

Release tags drive `.github/workflows/release.yml`. Before tagging, make sure
`package.json`, README install pins, `CHANGELOG.md`, and the tag name all use
the same version. `bun run release:metadata` performs exact equality checks and
extracts only the matching changelog section; near matches, prerelease suffixes,
and prefix matches are release failures.

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

The deterministic gate includes exact package/release metadata and tarball
surface checks. CI separately runs the network-dependent high-severity
dependency audit and SHA/digest-pinned workflow linting.
