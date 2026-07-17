# Development

Flow v5 uses TypeScript 7 and an inward-only layered architecture. The
canonical local gate is:

```bash
bun install
bun run check
```

`bun run check` runs typecheck (including repository scripts), Biome, the
deterministic offline prompt-quality report, build, and the focused test suite.
`bun run build` first removes the generated `dist/` tree so renamed or deleted
declarations cannot survive into a packed release.

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
  -> flow_guidance plus seven stateful Flow tools
  -> platform transport
  -> application service and domain transitions
  -> filesystem repository
  -> locked atomic .flow/session.json writes
```

The package-owned guidance is the product experience. The runtime is only the ledger and hard gate layer.

The OpenCode config hook registers only package-owned commands and agents. It
does no workspace filesystem work and does not append Flow state to
`config.instructions`. Public Flow command guidance explicitly calls
`flow_status` before acting, which keeps `.flow/session.json` as the sole state
representation without startup refresh or lock coupling.

## Editing Guidance

Guidance source files live under `skills/<name>/`. Every runtime-loadable file
must be imported in `src/guidance/catalog.ts` and assigned a stable id in
`src/guidance/ids.ts`. Main
documents use their topic name; references use the topic-relative path. Bun
embeds the text into the plugin bundle, and `flow_guidance` returns it without
filesystem discovery or installation.

Public install docs should prefer OpenCode's native installer when available and
use one pinned install-or-update command:
`opencode plugin opencode-plugin-flow@<version> --global --force` before the
next OpenCode startup.
Keep a manual `opencode.json` fallback for older OpenCode versions that do not
expose `opencode plugin`; that fallback should tell users to replace older
pinned Flow entries instead of adding duplicates.

Plugin initialization must not touch OpenCode's global skill directory. The
package CLI exposes only an explicit `legacy-cleanup` migration for old v4
folders. It defaults to no action unless `--dry-run` or `--apply` is selected;
apply archives only marker-proven pristine folders and refuses symlinks, edits,
extra files, and foreign content.

Flow commands must call `flow_status` first. Public manager commands compile
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
variant. Prompt changes must preserve the 18 static scenarios and 52 criteria.
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
- `flow_feature_complete`
- `flow_feature_reset`
- `flow_session_close`

Do not teach direct `.flow/**` edits.
