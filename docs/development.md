# Development

Flow v5 uses TypeScript 7 and an inward-only layered architecture. The
canonical local gate is:

```bash
bun install
bun run check
```

`bun run check` runs typecheck (including repository scripts), Biome (including
its own configuration), exact release-metadata validation, the deterministic
offline prompt-quality report, build, and the focused test suite. `bun run
build` first removes the generated `dist/` tree and then prunes declaration emit
to the three-file public root import chain, so renamed, deleted, or unsupported
internal declarations cannot survive into a packed release. Package smoke
asserts the complete tarball allowlist rather than accepting arbitrary `dist/`
contents.

Network-backed advisory data is intentionally outside the reproducible local
gate. Blocking CI runs `bun audit --audit-level=high` in a separate job; local
contributors may run the same command when network access is available.

Harness resource evidence is also separate from `bun run check` because a
candidate observation is real-run evidence, not a deterministic unit-test
fixture to manufacture during every build:

```bash
bun run harness:report
bun run harness:gate
```

`harness:report` validates and summarizes the sanitized full-repository audit
fixture. `harness:gate` requires both standard and assurance promotion gates to
pass. It exits nonzero while either same-corpus candidate is unavailable or
fails; that is the current expected result and must not be relabeled as success.
CI runs the report without `--require` as observation only. The separate
`Harness Promotion Gate` workflow is manual, read-only, and requires an explicit
standard or assurance candidate; release and ordinary CI do not silently
promote a profile.

## TypeScript 7 posture

The checked-in compiler is exactly TypeScript 7.0.2. `tsconfig.json` targets
ES2024 with NodeNext ESM resolution and enables `moduleDetection: "force"`,
`verbatimModuleSyntax`, `erasableSyntaxOnly`, `isolatedModules`,
`noUncheckedSideEffectImports`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes`. Production code should stay compatible with
these checks instead of using compiler suppressions or declaration skips.
Relative TypeScript imports use their emitted `.js` specifier so source,
declarations, Bun bundles, and Node consumers share one resolvable module graph.

The application boundary publishes explicit `FlowService` and `FlowResponse`
types. `FlowResponse.status` describes the operation; state-machine status and
all repository- or caller-controlled prose stay under `workflowData`. The
OpenCode transport also has an explicit `Hooks["tool"]` return type;
this keeps TypeScript declaration emit from naming the host SDK's nested Zod
installation. `tests/package-smoke.test.ts` compiles a packed strict NodeNext
consumer at ES2024 without `skipLibCheck`, imports the result with Node, and
rejects declarations containing package-manager or nested-validator paths.

`@types/node` intentionally remains on the latest Node 24 line because Node 24
is the minimum published runtime. CI still executes the package on both Node 24
and 26; moving the type surface to Node 26 would allow accidental use of APIs
that violate the stated Node 24 floor. `package.json` also overrides the
wildcard Node dependency inside Bun's declarations to the same version.

## Architecture

```text
OpenCode command / guidance-driven agent
  -> nine lifecycle tools plus three harness tools
  -> platform transport
  -> application services, receipt/oracle contracts, and domain transitions
  -> filesystem repository
  -> locked atomic .flow/session.json writes
```

The package-owned guidance is the product experience. The runtime is only the ledger and hard gate layer.

The OpenCode config hook registers only package-owned commands and agents. It
does no workspace filesystem work and does not append Flow state to
`config.instructions`. Public Flow command guidance explicitly calls
`flow_status` before acting, which keeps `.flow/session.json` as the sole state
representation without startup refresh or lock coupling.

Do not rely on OpenCode's advertised tool schema as the only validator. Each
registered handler must parse that same host schema at entry before invoking
the application execution wrapper. Contract tests must cover advertised,
registered, emitted, handler-entered, and application behavior; an invalid host
call is a tool error and performs no Flow state I/O.

## Editing Guidance

Guidance source files live under `skills/<name>/`. Every runtime-loadable file
must be imported in `src/guidance/catalog.ts` and assigned a stable id in
`src/guidance/ids.ts`. Main
documents use their topic name; references use the topic-relative path. Bun
embeds the text into the plugin bundle, and `flow_guidance` returns it without
filesystem discovery or installation.

Public install docs must use the package activation CLI and an exact release:

```bash
npx -y opencode-plugin-flow@<version> activation-apply --project "$PWD" --scope global
npx -y opencode-plugin-flow@<version> activation-apply --project "$PWD" --scope global --apply
npx -y opencode-plugin-flow@<version> activation-check --project "$PWD"
```

The dry-run is the review boundary. The check must finish with one exact npm
activation source and no proven inactive Flow cache artifact. A project-scoped
install changes only `--scope project`; do not document adding another pin next
to a global one. `activation-apply` preserves unrelated plugin entries, supports
OpenCode string and `[specifier, options]` plugin entries, rewrites only strict
JSON, and moves only proven Flow-owned wrappers and proven inactive cache
artifacts. JSONC is inventoried, but any JSONC file requiring mutation is
refused for precise manual remediation rather than rewritten without its
comments. Unknown wrappers, ambiguous cache state, inline config, managed
config, and other non-mutable sources likewise require explicit manual
remediation. A post-mutation failure attempts exact safe rollback; the journal
distinguishes complete `rolled-back` recovery from `rollback-failed` state that
preserves concurrent changes for manual repair.

Plugin initialization must not touch OpenCode's global skill directory. The
package CLI exposes activation inventory/convergence plus the explicit
`legacy-cleanup` migration for old v4 folders. Legacy cleanup defaults to no
action unless `--dry-run` or `--apply` is selected; apply archives only
marker-proven pristine folders and refuses symlinks, edits, extra files, and
foreign content.

Flow commands must call `flow_status { request: { view: "compact" } }` first.
Public manager commands compile
only the applicable core skill sections plus bounded conditional rules;
`/flow-review` delegates its small task prompt to the reserved reviewer whose
agent prompt owns review judgment. Public commands do not depend on native
loading of `flow`, `flow-plan`, `flow-run`, or `flow-review`. Optional helpers
load through `flow_guidance`; references name exact ids rather than relying on
relative filesystem reads.

Run `bun run prompt:quality` to inspect rendered surfaces and compare the four
maintained variants with offline static-contract checks. Use the opt-in
`prompt:model-eval` runner for structured model decisions; it is intentionally
outside `bun run check` because it uses external providers and is
nondeterministic. The deterministic `prompt:quality` report is part of the
canonical gate. The model runner defaults to a five-minute timeout per prompt
variant. Prompt changes must preserve the 31 static scenarios and 100 criteria.
Update the accepted growth baseline in
`tests/fixtures/prompt-quality-baseline.json` only for material growth (more
than the larger of eight words or 2%) and include a specific justification.
See [Prompt quality](prompt-quality.md).

Guidance changes should preserve the v5 tool surface:

- `flow_guidance`
- `flow_status`
- `flow_plan_save`
- `flow_plan_approve`
- `flow_run_start`
- `flow_review_start`
- `flow_feature_complete`
- `flow_feature_reset`
- `flow_session_close`
- `flow_orchestration_admit`
- `flow_validation_start`
- `flow_audit_render`

Do not teach direct `.flow/**` edits.

## Harness runtime development

`OPENCODE_FLOW_HARNESS_PROFILE` accepts `control`, `standard`, or `assurance`
and defaults to `standard`. `OPENCODE_FLOW_ROLLOUT_MODE` accepts `control`,
`observe`, or `enforce` and defaults to `observe`. Invalid values deliberately
fall back to `control` with a warning. The command preflight footer is the
trusted active policy and must override static prompt defaults.

Control keeps optional-worker dispatch discretionary without adding an
admission ceremony. Standard and assurance call `flow_orchestration_admit`
before optional evidence, audit, verification, or candidate passes. Observe
records would-deny decisions without blocking; enforce requires the exact
admitted worker class and count. The lifecycle-required `flow-reviewer` and
`flow-validation-worker` are not optional admission passes.

Worker routing uses the role-specific `OPENCODE_FLOW_READONLY_WORKER_MODEL`,
`OPENCODE_FLOW_REVIEW_WORKER_MODEL`, and
`OPENCODE_FLOW_CANDIDATE_WORKER_MODEL`, then
`OPENCODE_FLOW_WORKER_MODEL` as fallback. The corresponding
`OPENCODE_FLOW_*_WORKER_STEPS` variables and
`OPENCODE_FLOW_WORKER_STEPS` fallback set OpenCode's current `steps` field;
accepted values are integers from 1 through 1000. Do not reintroduce deprecated
`maxSteps`.

Runtime-attested validation is a four-step contract: load fresh guards, call
`flow_validation_start`, run its exact command as the next Bash call, then copy
the emitted immutable reference into
`flow_review_start.request.validationRefs`. The host hook supplies timing,
structured exit status, output digest/completeness, command class, run, source,
and feature identity. Tests must prove mismatch, mutation, missing structured
exit, truncation, stale source/run, altered artifacts, duplicate refs, and exact
replay behavior.

`AuditLedgerV1` is the only typed harness audit ledger. Keep the domain and host
schemas in parity, preserve the 200-finding, 16-locator-per-finding, 256 KiB
aggregate UTF-8 and rendered-Markdown bounds, derive all summaries, and ensure
refuted findings never leak into remediation.
Host observation must remain bounded and privacy-safe: hash identities and
signatures with an ephemeral salt, record overflow explicitly, and preserve
`unavailable` separately from numeric zero. Promotion uses only independently
labeled, sanitized, same-corpus candidate observations through
`canEnableHarnessEnforcement`; the static fixture does not itself authorize
enforcement.
