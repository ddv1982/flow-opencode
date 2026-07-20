# ADR 0004: Single-Version Runtime-Attested Harness

Date: 2026-07-19

## Status

Accepted. The implementation contracts are present locally. Standard and
assurance same-corpus promotion evidence remains unavailable, so this decision
does not authorize enforcement rollout by itself.

## Context

OpenCode merges plugin configuration from global, project, directory, custom,
inline, remote, and managed sources and can also discover local plugin files.
Installing a newer Flow package did not prove that an older pin, wrapper, or
cache artifact was no longer active. OpenCode can deduplicate an identical npm
specifier, but a local wrapper and npm entry—or two different exact
specifiers—can still load separate Flow runtimes. Choosing a newest copy after
both initialized would leave two independent hooks and tool surfaces acting on
one workspace.

The previous review boundary also accepted caller-assembled validation
observations. Strict schemas protected their shape but could not prove that the
claimed command, time, exit, output, source, and run came from the Bash
execution the host observed. Review repair then repeated broad context because
the runtime did not retain an authoritative predecessor-to-current source
delta.

The qa-scribe case study showed that a full-repository audit could consume 11
sessions, 962 tool calls, and 711 reads while still retaining one contradiction
between findings and remediation and not closing cleanly. These counts establish
a sanitized control, not proof that a smaller orchestration is equally good.
Flow therefore needs bounded observation and an explicit quality oracle before
promoting a new profile; arbitrary token or percentage targets are insufficient.

## Decision

### One activation and one operational runtime

Flow ships `install`, `activation-check`, and `activation-apply` as explicit
distribution commands. `install` immediately converges to the invoked package's
embedded exact version and refuses to replace a detected newer installation.
Check and apply require an absolute project path and exact semantic-version
target; apply also requires one canonical `global` or `project` scope and is
read-only unless `--apply` is present.

Inventory covers readable OpenCode global sources plus the selected project's
project, `.opencode`, custom, inline, and managed JSON/JSONC config; both
`plugin/` and `plugins/` discovery directories; and Flow's package-cache
artifacts. Other project trees are not scanned and must be converged from those
projects. Plugin arrays accept both string entries and `[specifier, options]`
tuples. Within that explicit boundary, a successful end state has exactly one
`opencode-plugin-flow@<target>` npm activation source and no proven inactive
Flow cache artifact.

Apply preserves unrelated config entries, removes recognized Flow activations
outside the chosen scope, writes the canonical target pin last, and removes only
marker-proven wrappers, the byte-exact known legacy wrapper format, and
manifest-proven inactive cache artifacts. It creates config backups and an
owner-restricted `flow-activation-journal-v2`, stages obsolete artifacts outside
discovery until the new activation is verified, then permanently deletes them
before success. Unknown or edited wrappers,
ambiguous cache artifacts, malformed sources, symbolic links, inline or managed
entries, and other sources that cannot be changed safely require manual
remediation. JSONC is inventoried but any JSONC file requiring mutation is
refused rather than rewritten without comments. A post-mutation failure attempts
exact safe rollback before the deletion commit: the journal records
`rolled-back` after successful exact restoration or `rollback-failed` when
concurrent or unsafe state must be preserved for journal-backed manual recovery.
`cleanup-failed` preserves the committed newest activation and identifies only
remaining obsolete staging paths. Authenticated remote and some
managed-preference sources are an explicit offline limitation. A durable
`committed` journal state separates rollback from permanent cleanup. A later
apply reconciles nonterminal journals before planning, while read-only checks
report them as blocking.

Every initialized Flow runtime also registers exact package, version, protocol,
and instance identity in a bounded project scope inside a shared process
registry. OpenCode legitimately initializes one global plugin entry for every
open project, so independent project directories remain operational. Within one
project context exactly one registration is operational. Duplicate,
incompatible, or over-capacity state fails closed only for that project. The
highest semantic version is reported as a deterministic diagnostic leader only;
it receives no operational authority until the conflicting registrations in
that project are gone.

### Runtime-attested validation receipts

Flow adds `flow_validation_start`. It verifies current revision, snapshot,
active feature, native feature run, and source, then arms one exact command for
the next Bash call in that OpenCode session. The caller declares only the
command, `focused|broad|artifact` coverage scope, and environment-key names.

The OpenCode hook verifies the command before and after execution and derives
hook timing, the structured Bash exit, output SHA-256, output completeness, and
canonical command class. It publishes canonical `validation_receipt_v1` bytes
through the existing restricted evidence store and appends a
`validation_receipt_ref_v1` digest-and-length reference to the Bash result.
Idle or compaction cancels pending capture; a bound long-running Bash call may
finish after the original arm TTL.

`flow_review_start` now accepts one to 100 unique `validationRefs`, not inline
validation observations. It verifies canonical bytes and artifact identity,
then rechecks receipt run, feature, current source, exit zero, complete output,
and coverage before materializing Session v4 evidence. Final review requires a
`broad` or `artifact` receipt. Rejection records no mutation and consumes no
operation id. Exact accepted replay is resolved before fresh source or artifact
I/O.

Receipt bytes retain the exact executed command in the restricted store. Raw
output is not published by default. If an exact-output artifact exists, output
must be complete and its digest must equal the observed output digest.

### Evidence-backed correction review

Each review assignment may retain a restricted canonical source manifest with
safe relative paths and content identities. A caller requests correction only
by naming `correctionOfAssignmentId` and may optionally elevate known semantic
scope with `correctionScopeHint: "public-contract" | "cross-layer"`; it cannot
author source digests, paths, delta, mode, or fallback reason. The hint is valid
only with that predecessor, has no correction-mode value, and participates in
exact replay identity. The id must be the immediately preceding durable failed
assignment in the active run's same logical pass and review kind.

Flow verifies the predecessor manifest and current transaction-owned manifest,
then derives a sorted changed-path set and source-delta digest. It uses narrow
`correction` review only for complete, bounded feature context. Final/broad
review, source-metadata change, security- or persistence-sensitive context,
missing/unavailable manifests, oversized manifests/deltas, or an oversized
reviewer projection selects explicit `full` fallback. A known public-contract or
cross-layer hint also selects full review, after the more specific runtime
classifiers. Same-source correction is valid only for an `evidence_gap` with
genuinely distinct validation evidence.
The existing two accepted failures per feature run remains the terminal cap.

### Typed audit, profiles, and admission

Flow adds `AuditLedgerV1` and `flow_audit_render`. Each bounded finding records
portable source locators, proof state, reachability, deployment exposure,
trigger, guards/recovery, disposition, impact, severity, action priority,
confidence, falsifier, and conditional remediation. Policy rules prevent
critical/fix-now claims without strong reachable evidence, prohibit refuted
remediation, and derive rather than accept summary counts. Canonical Markdown
is deterministic and independently bounded. The contract caps a ledger at 200
findings, 16 locators per finding, and 256 KiB for both serialized input and
rendered Markdown.

The trusted command-preflight footer selects
`OPENCODE_FLOW_HARNESS_PROFILE=control|standard|assurance` and
`OPENCODE_FLOW_ROLLOUT_MODE=control|observe|enforce`. Defaults are `standard`
and `observe`; invalid values fall back to `control` with a warning.

- Control preserves discretionary optional passes without admission ceremony.
- Standard permits at most two concurrent read-only workers and reserves its
  broad first wave for discovery.
- Assurance permits at most five first-wave broad read-only workers and two
  targeted follow-up workers.
- Follow-up audit/verification must be targeted and justified; post-synthesis
  verification uses one verifier; writable candidate implementation is
  authorized, targeted, and serial with an explicit isolation scope.

`flow_orchestration_admit` evaluates and arms one typed proposal for the exact
optional hidden-worker class and count. Observe reports would-deny decisions but
does not block; enforce rejects denied, missing, mismatched, or expired
admission. This is an orchestration invariant, not proof of usefulness or an
authorization boundary. OpenCode permissions and root-manager ownership remain
authoritative. Lifecycle-required reviewer and validation workers are not
optional admission passes.

Worker model and `steps` routing may be configured by read-only, review, and
candidate class with one fallback. These host settings do not enter domain
state or the promotion oracle's model-independent contracts.

### Bounded observation and promotion

Flow observes only bounded host facts. It salts and hashes session, route, read,
guidance, and result signatures; caps roots, calls, messages, distinct values,
serialization nodes, and string input; saturates counters; records overflow;
and distinguishes unavailable from numeric zero. It does not retain raw prompts,
tool arguments, tool output, paths, credentials, or reasoning.

Default in-memory limits are 64 roots and 4,096 calls, messages, and distinct
values per root. Signature input is bounded to 64 KiB, 1,024 serialization
nodes, and 16,384 string characters; truncation and saturation increment
explicit overflow counters instead of becoming complete observations.

The `full-repo-audit-v1` fixture carries opaque quality decisions and privacy
assertions for control, standard, and assurance. A candidate promotion gate is
available only when control and candidate are observed on the same source
revision and model configuration. Candidate finding-decision and refutation
digests must match control, remediation contradictions must be zero, workflow
closure must be clean, no comparable observed-work signal may increase, and at
least one must be lower. Missing candidate evidence is `unavailable`, not zero
or pass.
Ordinary CI records this report without requiring a candidate. Promotion is a
manual, read-only workflow with an explicit standard or assurance input; release
and ordinary CI cannot silently enable enforcement.

## Consequences

- Installing the latest Flow release is a convergence operation, not an
  adjacent installation. Ambiguous sources need human ownership decisions.
- Project-scoped runtime leadership makes hidden duplicate sources safe by
  disabling Flow only in the affected project, at the cost of an explicit repair
  before work can continue there.
- The public tool surface grows from nine to 12 tools. Lifecycle schema remains
  Session v4; there is no dual validation input or compatibility alias.
- Validation correctness is grounded in host-observed execution, while coverage
  scope and environment-key selection remain declared inputs whose adequacy is
  reviewed separately.
- Correction review can be materially smaller without silently narrowing risky
  or incomplete context.
- Profiles bound optional work but cannot claim efficiency until the sanitized
  same-corpus gate passes. The current standard and assurance candidates remain
  unavailable; observe is appropriate, enforce is not promoted.
- No new runtime dependency, database, trace reader, raw QA fixture, session
  version, or broad rewrite is introduced.

## Verification and rollback

Verification covers activation inventory/dry-run/apply/refusal/recovery,
same-project duplicate leadership, simultaneous independent project contexts,
host/application schema parity for all 12 tools, exact
Bash capture and receipt-integrity failures, review applicability and replay,
correction delta/fallback/two-failure behavior, audit policy/render parity,
admission class/count enforcement, observation bounds/privacy, oracle fixture
validation, prompt contracts, package smoke, and the pinned OpenCode live host.

Operational rollback sets profile and rollout to `control`, preserving receipt,
review, and lifecycle hard gates. Activation rollback restores only
identity-matching paths recorded in the journal; it never clears OpenCode config
or cache roots and never overwrites a concurrent edit to manufacture
convergence. Code rollback must retain single-runtime fail-closed behavior and
reject the retired inline validation contract unless a new ADR explicitly
replaces this hard cutover.
