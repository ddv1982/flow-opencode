# Investigation: Ground-Up Rewrite Strategy

## Summary
If rewritten without backwards compatibility, Flow should stop being shaped primarily as an OpenCode plugin with a large runtime behind it and become a deterministic workflow engine with append-only events, schema-first action/event contracts, generated adapters, and OpenCode as one thin host integration. The strongest current assets to preserve are runtime-owned semantics, semantic invariant IDs, strict schema discipline, atomic persistence safety, mode-boundary contracts, prompt evals, release gates, and benchmarks; the main things to delete or replace are snapshot-as-primary-history, hand-maintained tool/command/docs parity, legacy JSON-wrapper compatibility, and prompt prose that restates runtime law.

## Symptoms
- The current plugin has grown many runtime/session/tool/prompt surfaces with compatibility-oriented contracts.
- The desired question is architectural: what drastic redesigns would make the plugin better if legacy compatibility were intentionally discarded?

## Background / Prior Research

### External docs: OpenCode plugin SDK and tool contracts
- Official OpenCode plugin docs describe plugins as TypeScript/JavaScript modules that export plugin functions receiving a context object and returning hooks; plugins load from project/global plugin dirs or npm config, and hooks run in deterministic load order. Sources: https://opencode.ai/docs/plugins, https://opencode.ai/docs/config#plugins
- Official custom tool docs describe tool definitions as schema-first objects using `tool()` with `description`, raw object-shaped `args`, and `execute`; `tool.schema` is Zod, and tool context includes session/workspace identity. Source: https://opencode.ai/docs/custom-tools
- Current published/package typings expose a broader contract than simple docs examples: `Plugin = (input, options?) => Promise<Hooks>`, config `plugin?: Array<string | [string, PluginOptions]>`, hook families for config/chat/tool/permission/shell/provider/experimental transforms, and tool definitions based on `z.ZodRawShape`. Sources reported by explore agent: `@opencode-ai/plugin@1.4.8` package typings and https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts
- Rewrite implication: target the current package typings rather than older examples; preserve raw Zod object-shape compatibility unless intentionally changing host-runtime integration; treat plugin config and hook boundaries as first-class architecture, not incidental adapters.

### External research: plugin architecture best practices
- Mature CLI/plugin patterns favor a thin command/plugin shell over shared services, with lifecycle hooks as explicit boundaries and packaging concerns separated from runtime behavior. Sources reported by explore agent: oclif docs/README and generator hook docs.
- Schema-first contracts should be single-sourced: derive validation, TypeScript types, and serialized tool/API contracts from one strict schema per tool. Sources reported by explore agent: OpenAI structured-output/function-calling docs and Zod JSON Schema docs.
- Dependency injection should happen at the composition root: filesystem, clock, workspace, telemetry, and host-tool transport should be injected into pure services rather than imported throughout the core.
- Observability should be structured and opt-in, using low-overhead event channels or host logging rather than scattered console output.

### External research: durable workflow/state-machine design
- Workflow control should be explicit statecharts/actors or similarly declarative transition models rather than a large ad hoc reducer tree when hierarchy, parallelism, recovery, and lifecycle constraints matter. Sources reported by explore agent: XState v5 statechart, pure transition, persistence, graph/testing docs.
- Durable orchestration should separate deterministic workflow decisions from side effects; Temporal-style architecture treats IO/LLM/filesystem/network operations as activities/effects outside deterministic workflow code.
- Recovery should prefer append-only event history plus periodic snapshots over snapshot-only persistence; event replay supports auditability, crash recovery, and compatibility testing across state-machine evolution.
- Verification should include reachable transition coverage, replay corpus tests, and property-based fuzzing for invariants across random event sequences.


## Investigator Findings
<!-- Pair investigator appends structured findings here with file:line refs, evidence, and conclusions. -->

### Repo-local investigation — workflow-engine rewrite hypothesis (2026-05-03)

#### Evidence

- **Current entrypoint is still OpenCode-plugin-shaped.** `src/index.ts:101-148` constructs the plugin return value directly as `{ config, tool, hooks }`, including OpenCode-specific `tool.definition`, `experimental.chat.system.transform`, and `experimental.session.compacting` hooks. `src/config.ts:50-143` hard-codes OpenCode agent/command injection, permissions, and command templates. `src/tools.ts:28-42` builds the public tool surface through OpenCode tool registration rather than an engine-owned action manifest.
- **There is already a partial workflow-core seam.** `src/runtime/application/session-engine.ts:16-33` defines runtime ports for session load/save/sync/read/workspace actions, and `src/runtime/application/session-engine.ts:166-243` centralizes transition persistence after a `TransitionResult`. `src/runtime/application/session-actions.ts:24-82` defines named mutation actions and payload/value maps; `src/runtime/application/session-actions.ts:112-388` dispatches those names to transition functions and response shaping. This is close to an engine action layer but is still coupled to current session snapshots and tool response JSON.
- **State is mutable snapshot-first, with history embedded inside snapshots.** `src/runtime/paths.ts:49-60` defines `.flow/active`, `.flow/stored`, and `.flow/completed`; `src/runtime/paths.ts:106-133` defines `session.json` plus derived docs paths. `src/runtime/session-persistence.ts:65-87` parks/activates sessions by renaming active/stored directories, then overwrites the active `session.json`; `src/runtime/session-persistence.ts:112-127` saves normalized open/completed sessions under a lock. `src/runtime/session-workspace.ts:42-74` implements atomic replacement via temp file + fsync + rename, and `src/runtime/session-workspace.ts:106-158` layers in-process and filesystem lock queues. `src/runtime/schema.ts:432-470` stores execution history as `execution.history` inside the session document, and `src/runtime/transitions/execution-completion-normalization.ts:174-217` appends the worker result to that in-memory array before the whole snapshot is rewritten.
- **Docs and tests confirm snapshot state is the source of truth, with rendered docs derived.** `docs/development.md:62-68` documents plugin config, runtime tools, snapshot paths, runtime-owned transitions, and derived markdown docs. `docs/maintainer-contract.md:77-98` lists current `.flow/**/session.json` state paths and says rendered docs are derived artifacts. `tests/atomic-writes.test.ts:31-105` verifies atomic snapshot replacement and 16 concurrent saves without corruption; `tests/atomic-writes.test.ts:107-150` verifies rendered docs match the final saved snapshot.
- **Tool schemas are centralized but not single-source enough.** `src/tools/schemas.ts:1-138` centralizes OpenCode-facing raw arg shapes and re-exports runtime schemas, while `src/tools/runtime-tools/planning-tools.ts:39-200`, `src/tools/runtime-tools/execution-tools.ts:13-84`, and `src/tools/runtime-tools/review-tools.ts:25-138` separately register tool descriptions, metadata, transport parsing, and action dispatch. `src/tools/parsed-tool.ts:37-73` parses JSON-string transport wrappers and optional legacy schemas before runtime parsing; `src/tools/parsed-tool.ts:78-99` wraps ordinary parsed args. `src/tool-definition-guidance.ts:7-74` maintains a separate manual guidance map for tool descriptions.
- **The repo has strong drift guards around that schema/tool/config surface.** `tests/config/tool-schemas.test.ts:8-56` verifies raw SDK-compatible arg shapes and schema-size budgets, and `tests/config/tool-schemas.test.ts:57-76` pins `zod` to the plugin SDK's effective zod version. `tests/config/tool-schemas.test.ts:296-461` proves JSON-wrapper acceptance, runtime-vs-raw strictness split, invalid feature-id rejection at runtime schema, and no `_from_raw` public shims. `tests/config/plugin-surface.test.ts:13-46` verifies plugin entrypoint hooks/tools/config, and `tests/config/plugin-surface.test.ts:69-93` freezes ordered tool names. `tests/docs-tool-parity.test.ts:55-88` verifies docs/development tool names match registered tools. `docs/architecture/strictness-contract.md:1-63` records the bridge contract and required checks.
- **Runtime/domain/transitions already own core semantics.** `src/runtime/domain/semantic-invariants.ts:5-22` defines stable invariant IDs; `src/runtime/domain/semantic-invariants.ts:24-143` maps each invariant to runtime owners. `docs/architecture/invariant-matrix.md:14-17` explicitly says prompts/docs may mirror invariant IDs but do not own policy. `src/runtime/domain/workflow-policy.ts:5-58` owns final-review policy, completion targets, and completion thresholds; `src/runtime/domain/workflow-policy.ts:60-106` owns decision-gate pause semantics. `src/runtime/transitions/execution-selection.ts:148-189`, `src/runtime/transitions/execution-completion-finalization.ts:148-232`, `src/runtime/transitions/execution-completion-validation.ts:152-284`, and `src/runtime/transitions/review.ts:177-384` enforce run selection, completion finalization, completion gates, recovery prerequisites, and review payload validation.
- **Prompts are intended to be views, but currently duplicate policy heavily.** `src/prompts/fragments.ts:1-15` says runtime policy/schema/transitions are normative and prompt fragments must not redefine runtime behavior, yet `src/prompts/fragments.ts:21-48` and `src/prompts/fragments.ts:60-87` restate runtime-tool authority, review loops, final completion path, recovery, stack standards, package-manager, and quality/release rules. `src/prompts/contracts.ts:12-31`, `src/prompts/contracts.ts:65-88`, and `src/prompts/contracts.ts:112-138` repeat plan/worker/reviewer payload and final-review constraints. `src/prompts/agents.ts:93-300` and `src/prompts/commands.ts:75-170` embed long workflow procedures for planner/worker/auto/reviewer/control modes.
- **Mode contracts are a strong prompt-view preservation candidate.** `src/prompts/mode-contracts.ts:1-28` defines mode surfaces, mutation permissions, allowed/forbidden tools, required behavior, and stop conditions as data. `src/prompts/mode-contracts.ts:59-300` enumerates each mode's contract. `docs/development.md:96-123` identifies `mode-contracts.ts` and providerless evals as the canonical prompt-mode contract surface. `tests/mode-contracts.test.ts:122-160` checks contract tool names and command/agent bindings against registered tools/config.
- **Verification is semantic-example-heavy, not replay/property-heavy.** `tests/runtime/semantic-invariants.test.ts:146-236` checks invariant catalog coverage and owner references; `tests/runtime/semantic-invariants.test.ts:260-536` checks completion-gate order, completion threshold semantics, decision-gate surfacing, review-scope rejection, recovery next actions, and canonical tool surface. `package.json:38-40` runs randomized test order, but not generated workflow event sequences. `package.json:62-70` lists dev dependencies and does not include a property-testing dependency. `bench/BASELINE.md:7-17` tracks transition reducer, save round-trip, render, and zod parse performance, but the repo evidence I inspected does not show an append-only replay corpus.

#### Inference

- **Main hypothesis is strongly supported with qualifications.** The current code already separates domain transitions, application/session ports, tool adapters, prompt contracts, and OpenCode plugin hooks enough that a no-backwards-compat rewrite should invert ownership: deterministic workflow engine first; OpenCode plugin/config/tool hooks as thin adapters second.
- **The clearest rewrite target is not “more plugin cleanup”; it is an engine action model.** `SESSION_MUTATION_ACTION_NAMES` and `SESSION_MUTATION_PAYLOAD_MAP` are the closest current core. A rewrite should promote actions/events to the first-class API, then generate OpenCode tools, command docs, prompt affordances, and tests from that engine manifest.
- **Append-only event log + replay would directly address current persistence limits.** Current atomic snapshot writes are well engineered and should be preserved as snapshot checkpoints, but history is currently embedded in `session.json` and rewritten with each state change. That makes audit/replay/versioned evolution harder than an event stream with deterministic reducers and periodic snapshots.
- **Schema-first registry is supported, but should be action/event-first rather than tool-first.** The current registry protects OpenCode raw arg compatibility, but descriptions, metadata, transport wrapper names, runtime payload schemas, and docs live across several files. A rewrite can delete this split by making each engine action declare input schema, event(s), effects, tool projection, docs, examples, and invariant tags in one schema-first registry.
- **Prompts should become thin role protocol views.** Current docs and comments already say prompts mirror runtime policy, but the actual prompt files contain many duplicated policy paragraphs. In a rewrite, prompts should mainly expose role boundaries, allowed actions, current state view, and short references to invariant IDs; completion/review/recovery law should be generated from or checked against the runtime registry, not hand-written in prompt prose.
- **Effect ports are already partially proven.** The existing session-engine runtime ports and workspace-root/mutable-permission boundary show the right direction. A rewrite should push filesystem, clock, host task/subagent, logging, OpenCode metadata, and permission prompts behind explicit effect ports so reducers remain deterministic and replayable.

#### Unknowns

- The current repo evidence does not prove which event-store format should be chosen, how much snapshot compatibility to retain for migration, or what compaction/snapshot cadence is needed for large sessions.
- I did not find property-based workflow generation or event-replay tests in the inspected surfaces; absence is inferred from package/test evidence, not an exhaustive proof over every file.
- OpenCode host requirements still constrain the adapter: raw Zod shape compatibility and hook names may remain necessary even if the engine core drops compatibility with Flow's current command/tool/state names.
- Performance implications of event append + replay are unknown. Existing baselines show snapshot save/render/parse hot paths are measured, but not event-log replay.

#### Rewrite recommendations

1. **Preserve the semantic core, not the plugin shape.** Keep the domain concepts encoded by `SessionSchema`, `PlanSchema`, reviewer decisions, completion policy, decision gates, recovery metadata, and semantic invariant IDs, but re-express them as engine state/events/actions rather than OpenCode tool procedures.
2. **Replace mutable snapshot persistence with event log + checkpoints.** Use append-only events for `plan_started`, `planning_context_recorded`, `plan_applied`, `plan_approved`, `run_started`, `review_recorded`, `run_completed`, `feature_reset`, `session_closed`, etc. Keep atomic JSON snapshots only as derived checkpoints and render markdown docs from replayed state.
3. **Create one action/event registry.** For every engine action, single-source the input schema, output/event schema, reducer, allowed effects, invariant tags, OpenCode tool projection, prompt-view affordance, docs row, and tests. Generate adapter tool definitions and docs from it.
4. **Make OpenCode a thin adapter.** Move `src/index.ts`, `src/config.ts`, `src/tools/**`, `src/tool-definition-guidance.ts`, and OpenCode-specific prompt injection into an adapter package/layer that translates host hooks into engine commands/effects. The core should be runnable in tests without `@opencode-ai/plugin`.
5. **Turn prompts into generated/protocol views.** Preserve `mode-contracts.ts`-style role boundaries, but replace long policy prose in `fragments.ts`, `contracts.ts`, `agents.ts`, and `commands.ts` with short generated state/action protocols plus invariant references.
6. **Add replay/property verification as a release gate.** Build a corpus of event logs for golden workflows and recovery paths; replay them across reducer versions. Add generated/random event-sequence tests that assert semantic invariants after every event, supplementing the current example-based invariant tests.
7. **Preserve current strengths deliberately.** Carry forward strict runtime schemas, raw-host compatibility tests at the adapter boundary, atomic write discipline, path traversal guards, semantic invariant IDs, mode boundary contracts, providerless prompt evals, and performance baselines.
8. **Delete or replace outright when dropping backwards compatibility.** Delete legacy JSON-wrapper/legacy-schema transport compatibility, current command/tool name freeze as a core constraint, prompt-owned policy prose, snapshot-as-primary-history, and any requirement that engine internals mirror OpenCode agent/command/tool registration order.

#### Weaker ideas down-ranked

- **“Let prompts own the workflow.”** Down-ranked: comments, docs, semantic invariant registry, and transition tests consistently assign ownership to runtime/domain/transitions, not prompts.
- **“Keep snapshot-only persistence and just improve locking.”** Down-ranked: locking/atomic writes are already strong; the rewrite opportunity is auditability/replay/versioned semantics, which snapshot-only persistence does not provide.
- **“Make the tool registry the semantic source of truth.”** Down-ranked: tools are host adapters and compatibility surfaces; runtime schemas/transitions own semantic validity. The new registry should be action/event-centered, with tools generated as one projection.
- **“Rewrite everything into prompts plus docs.”** Down-ranked: existing semantic-invariant tests and strictness contracts show the valuable assets are executable runtime checks and typed schemas, not prose contracts alone.


## Investigation Log


### Phase 1.5 - External Fact-Gathering
**Hypothesis:** Current OpenCode SDK contracts and modern state-machine/plugin architecture practices should constrain any greenfield rewrite.
**Findings:** External research supports a schema-first plugin/tool surface, composition-root dependency injection, explicit state-machine orchestration, event-log durability, and opt-in observability. OpenCode-specific evidence emphasizes plugin lifecycle hooks, tuple plugin options, Zod raw-shape tool arguments, and current package typings as the compatibility floor if still targeting the host SDK.
**Evidence:** https://opencode.ai/docs/plugins; https://opencode.ai/docs/custom-tools; https://opencode.ai/docs/config#plugins; explore sessions `EDF6FFBF-6B98-4A79-83C4-F7D3370C2359`, `65E80A85-748E-4B46-8139-7CC1987EA794`, `75C4A0D4-B4C1-47F3-AA9B-E71EC7AAEC64`.
**Conclusion:** Confirmed as rewrite constraints and evaluation criteria; repo-local investigation still needed.

### Phase 1 - Initial Assessment
**Hypothesis:** A no-backwards-compat rewrite should be guided by external plugin/SDK best practices plus evidence from current repo seams, not by incremental cleanup instincts.
**Findings:** Report scaffold created; external research and repo context gathering pending.
**Evidence:** `/Users/vriesd/projects/flow-opencode/docs/investigations/ground-up-rewrite-2026-05-03.md`
**Conclusion:** Needs more investigation.


### Phase 4 - Oracle Synthesis
**Hypothesis:** Pair findings plus curated file selection are sufficient to produce a final grounded no-compat rewrite architecture.
**Findings:** Oracle synthesis ranked the highest-impact moves as event-log persistence, an engine action/event registry, deterministic effect-free reducers, generated tool/command adapters, generated role protocol prompts, model/replay/property tests, and OpenCode SDK isolation.
**Evidence:** `src/index.ts:101-148`; `src/runtime/session-persistence.ts:76-127`; `src/tools/schemas.ts:1-138`; `src/tools/parsed-tool.ts:40-79`; `src/runtime/domain/semantic-invariants.ts:4-143`; `src/prompts/fragments.ts:1-87`; Oracle chat `rewrite-architecture-map-612699`.
**Conclusion:** Confirmed. The rewrite should preserve the semantic discipline and verification culture, but not the current plugin-shaped/manual-parity architecture.

## Root Cause
The current design's root architectural issue is not a single defect; it is ownership inversion. Flow has grown into a workflow engine, but many public and internal surfaces are still organized around the OpenCode plugin host: plugin hooks/config in `src/index.ts` and `src/config.ts`, OpenCode tool registration in `src/tools.ts` and `src/tools/**`, snapshot-first session files in `src/runtime/session-*.ts`, and prompt/config/docs parity around those host-facing names. Runtime/domain/transitions already own core semantics and semantic invariant IDs, but those semantics are mirrored manually across schemas, tools, prompts, docs, tests, and release checks.

The result is a strong but expensive architecture: compatibility guards are extensive because the same concepts exist in many manually synchronized places. A no-backwards-compat rewrite should invert ownership: define a deterministic workflow core first, make commands/events/actions the source of truth, persist append-only event streams, and generate OpenCode tools/config/prompts/docs/tests as projections.

## Recommendations

### Ranked drastic rewrite moves
1. **Replace snapshot-first persistence with append-only events plus checkpoints.** Use `events/<session-id>.jsonl` as source of truth, checkpoints as caches, and markdown/status/history as projections. Preserve current atomic temp-file/fsync/rename and locking discipline, but apply it to event append/checkpoint/projection stores.
2. **Promote session actions into an engine action/event registry.** Turn the current session mutation/action seam into the canonical API: every action declares input schema, emitted events, allowed effects, permissions, invariant tags, examples, docs projection, and host-tool projection.
3. **Centralize deterministic workflow evolution.** Replace distributed orchestration ownership with an effect-free reducer/state machine over `WorkflowState + FlowCommand -> events | rejection`. Filesystem, clock, host metadata, permissions, LLM/task calls, and logging become injected effect ports.
4. **Generate the OpenCode adapter surface.** Keep OpenCode SDK hook names, raw Zod object-shape compatibility, tool definitions, config injection, and compaction/system-context hooks in `adapters/opencode`; do not let them define core schemas or internal state.
5. **Turn prompts into role protocol views.** Preserve planner/worker/reviewer/control concepts as role boundaries, but generate allowed actions, output protocols, examples, and invariant references from the registry. Remove hand-written prompt prose that restates completion/review/recovery law.
6. **Move verification to replay/property/model tests.** Keep existing semantic examples and prompt eval culture, but add replay corpora, generated event-sequence/property tests, checkpoint-vs-replay equivalence tests, and generated contract/docs freshness checks.
7. **Split persisted, command, projection, role-protocol, and host-tool schemas.** Do not reuse one broad runtime schema as public tool payload, persisted state, and prompt protocol simultaneously.

### Concrete target shape
```txt
src/
  core/
    workflow/{state,commands,events,reducer,policies,rejections,projections,invariants}.ts
    registry/{actions,roles,schemas,docs}.ts
    protocols/{planner,worker,reviewer}.ts
  persistence/{event-store,checkpoint-store,projection-store,append-lock,path-guards}.ts
  adapters/opencode/{plugin,config.generated,tools.generated,system-context,tool-guidance.generated,permissions,zod-bridge}.ts
  prompts/generated/{planner,worker,reviewer,auto,control}.md.ts
  docs-generated/{actions,tools,invariants,state-format}.md
```

### Preserve deliberately
- Semantic invariant IDs as legacy aliases, with a cleaner machine-oriented taxonomy layered on top.
- Runtime-owned semantics principle: prompts/docs mirror; runtime decides.
- Atomic write and path/root safety discipline.
- Strict schema culture and adapter-level Zod/plugin compatibility checks.
- Mode boundary contracts and providerless prompt evals.
- Release evidence gates, bundle/pack sanity, and benchmark culture.

### Delete or replace outright
- Snapshot-as-primary-history.
- Legacy JSON-wrapper/legacy-schema transport compatibility as core behavior.
- Hand-maintained tool-definition guidance and docs/tool/config parity tables.
- Prompt-owned policy prose for completion, review, recovery, and package-manager law.
- OpenCode tool registration order or current command/tool names as core semantic constraints.
- Any core import of `@opencode-ai/plugin`.

## Preventive Measures
- Make every public surface generated or checked from the action/event registry: OpenCode tools, command docs, prompt snippets, examples, invariant docs, and contract tests.
- Require replay tests for any workflow reducer or event schema change, including old event streams that represent real completed sessions.
- Keep adapter compatibility tests for OpenCode/Zod isolated to `adapters/opencode`, honoring the project memory constraint not to move `zod` independently of `@opencode-ai/plugin` without verifying tool-arg compatibility.
- Treat snapshots/checkpoints and rendered markdown as derived artifacts; add CI checks that replayed events regenerate the same checkpoint/projection.
- Keep prompt evals, but evaluate compact generated protocols and role boundaries rather than long manually synchronized policy prose.
- Maintain performance baselines for event append, replay, checkpoint write, projection render, schema parse, and adapter tool generation.

## Verification Evidence
- Fresh status check on 2026-05-03: `git status --short` reported only `?? docs/investigations/`, confirming the investigation produced a report and did not modify source files.
- Report structure check: `docs/investigations/ground-up-rewrite-2026-05-03.md` exists, was 157 lines before this verification addendum, and contained the required `Summary`, `Background / Prior Research`, `Investigator Findings`, `Root Cause`, `Recommendations`, and `Preventive Measures` sections.
- Source spot-check: `src/index.ts:101-148` confirms the current entrypoint returns OpenCode plugin `config`, `tool`, and hook surfaces directly.
- Source spot-check: `src/runtime/session-persistence.ts:76-127` confirms active/stored session directory movement and active `session.json` save under the current snapshot-first model.
- Source spot-check: `src/runtime/domain/semantic-invariants.ts:4-143` confirms stable semantic invariant IDs and runtime owner references.
- Source spot-check: `src/prompts/fragments.ts:1-87` confirms prompts declare runtime semantics as normative while also carrying detailed completion/review/recovery/policy rules that the rewrite should generate or thin.

### Verification Pass 2
- Fresh verification timestamp: `2026-05-03T11:11:35Z`.
- `git status --short` still reported only `?? docs/investigations/`, so no tracked source files were modified.
- `wc -l docs/investigations/ground-up-rewrite-2026-05-03.md` reported 165 lines before this pass-2 addendum.
- Heading scan confirmed the report contains `Summary`, `Symptoms`, `Background / Prior Research`, `Investigator Findings`, `Investigation Log`, `Root Cause`, `Recommendations`, `Preventive Measures`, and `Verification Evidence`.
- Content search confirmed the report includes the core rewrite thesis terms: deterministic workflow engine, append-only events, schema-first action/event contracts, and verification evidence.
- `git diff --stat -- docs/investigations/ground-up-rewrite-2026-05-03.md` was empty because the report is newly untracked rather than a modification to a tracked file.

### Verification Pass 3
- Fresh verification timestamp: `2026-05-03T11:12:06Z`.
- `git status --short` still reported only `?? docs/investigations/`, confirming no tracked source files were modified.
- `wc -l docs/investigations/ground-up-rewrite-2026-05-03.md` reported 173 lines before this pass-3 addendum.
- Tail check confirmed the existing verification evidence and pass-2 evidence remained present before this addendum.

### Verification Pass 3 / Ralph Cleanup
- Fresh verification timestamp: `2026-05-03T11:12:06Z`; `git status --short` still reported only `?? docs/investigations/` before scoped Ralph cleanup.
- The active stop-hook blocker was confirmed at `.omx/state/sessions/019ded72-744d-70e0-839c-f0682788b53d/ralph-state.json` with `active: true` and `current_phase: starting`.
- Following the OMX cancel skill's Ralph postconditions, the session-scoped Ralph state was terminalized only for session `019ded72-744d-70e0-839c-f0682788b53d`: `active=false`, `current_phase=cancelled`, `completed_at=2026-05-03T11:12:34Z`.
- The matching session-scoped `skill-active-state.json` was set to inactive/completing for the same Ralph session.
