# Architecture — opencode-plugin-flow

## Purpose

`opencode-plugin-flow` is an OpenCode plugin that adds a strict planning-and-execution workflow to OpenCode. It turns a goal into a tracked session, decomposes work into features, executes one feature at a time, and requires validation + reviewer approval before advancing.

## Distribution Model

A single TypeScript plugin package. Source in `src/`, bundled by `bun build --target node` into a single file at `dist/index.js`. That file is copied into the user's OpenCode plugin directory (canonical: `~/.config/opencode/plugins/flow.js` as of 2026-04; legacy: `~/.opencode/plugins/flow.js`). OpenCode loads it at startup.

The plugin exports a default factory `(ctx) => ({config, tool, ...hooks})`. Runtime deps: `zod` (bundled). Peer dep: `@opencode-ai/plugin` (must be external in the bundle — provided by the OpenCode host).

## High-Level Structure

```
src/
├─ index.ts                    Plugin factory; wires config + tool hooks (+ compacting after M6)
├─ config.ts                   Injects 5 agents + 7 slash commands
├─ config-shared.ts            Shared read-only tool permissions
├─ tools.ts                    Aggregator for custom tool registrations
├─ tools/                      Tool surfaces (15 total)
│  ├─ schemas.ts               Tool-arg Zod shapes (derived from runtime schemas)
│  ├─ parsed-tool.ts           Tool-boundary parse helper
│  ├─ session-tools.ts         7 inspection / prep tools
│  └─ runtime-tools.ts         8 state-transition tools
├─ prompts/                    Agent + command prompt templates
├─ installer.ts                Shared install/uninstall logic
├─ install-opencode.ts         CLI wrapper
├─ uninstall-opencode.ts       CLI wrapper
└─ runtime/
   ├─ schema.ts                Single source of truth for all Zod schemas (post-M3)
   ├─ constants.ts             Slash-command IDs, domain constants (post-M3/M4)
   ├─ errors.ts                Shared error envelope (post-M3)
   ├─ util.ts                  Time helpers, misc utilities (post-M4)
   ├─ paths.ts                 .flow/* path builders (with hardened traversal checks post-M2)
   ├─ session.ts               Barrel re-export for session-* internals
   ├─ session-workspace.ts     ensureWorkspace, legacy-migration, low-level fs
   ├─ session-persistence.ts   saveSession / loadSession (atomic writes post-M2; read cache post-M5)
   ├─ session-lifecycle.ts     createSession, archiveSession, activateSession
   ├─ session-history.ts       listSessionHistory, loadStoredSession
   ├─ render.ts                renderSessionDocs / syncSessionArtifacts (incremental post-M5)
   ├─ render-index-sections.ts Index doc renderer
   ├─ render-feature-sections.ts Feature doc renderer
   ├─ render-sections-shared.ts Markdown helpers
   ├─ summary.ts               summarizeSession, deriveNextCommand
   ├─ domain/completion.ts     Pure completion math
   ├─ application/tool-runtime.ts  Tool-layer plumbing (withSession, parseToolArgs, ...)
   └─ transitions/             State machine (5 files post-M4)
      ├─ plan.ts               applyPlan, approvePlan, selectPlanFeatures (+ graph validation)
      ├─ execution.ts          startRun, completeRun (+ guards, recording, state)
      ├─ review.ts             recordReviewerDecision, resetFeature (+ dependency propagation)
      ├─ recovery.ts           buildCompletionRecovery (single exhaustive switch)
      └─ shared.ts             TransitionResult, TransitionRecovery, helpers
```

## Data Flow

1. **Plugin load** — OpenCode invokes `src/index.ts` with a `ctx`. The plugin returns `{config, tool, ...}` hooks.
2. **Config hook** — OpenCode calls `config(config)`; we mutate it to inject Flow agents and slash commands.
3. **User invokes a slash command** — e.g. `/flow-plan goal`. OpenCode's agent runs the slash-command template (from `src/prompts/commands.ts`), which instructs the LLM to call specific Flow tools.
4. **Tool call** — OpenCode invokes a Flow tool (e.g. `flow_plan_start`). The tool:
   - Resolves `ctx.worktree` as the session root.
   - Loads the session via `loadSession(worktree)` (with M5 cache).
   - Parses args once via `withParsedArgs` (single-parse boundary, post-M3).
   - Calls a transition function (`applyPlan`, `completeRun`, ...).
   - On success, saves via `saveSession(worktree, nextSession)` — atomically writes `session.json` and renders `docs/index.md` + `docs/features/<id>.md` incrementally (post-M5).
   - Returns a structured `{ title, metadata, output }` result (post-M6) containing the JSON envelope.

## State Machine

Session states: `planning` → `ready` → `running` → `blocked` ⟷ `running` → ... → `completed`.

Transitions own every state change; the tool layer is a thin adapter. Transition functions are pure: take current `Session`, return `TransitionResult<Session>` with `.ok: true` + nextSession or `.ok: false` + error + recovery metadata.

Completion gate (`validateSuccessfulCompletion`) enforces 9 rules before a feature can move to `completed`. The final feature requires broad validation + `finalReview` decision. These rules are parameterized and covered by M2's completion-gate matrix.

## Invariants

- **Exactly one active feature** at a time (`execution.activeFeatureId` is either null or a valid id in `plan.features`).
- **Dependency graph is acyclic** (enforced at plan-apply time; cycles via `dependsOn` or `blockedBy` are rejected).
- **Reviewer gate before completion**: no feature reaches `completed` without a persisted approved reviewer decision for its scope.
- **Atomic state writes** (post-M2): `.flow/active` and `session.json` are never half-written. In-process saves on the same worktree are serialized (last-writer-wins).
- **Path safety** (post-M2): no user-supplied id escapes `.flow/sessions/` or `.flow/archive/`.
- **Schema parse boundary** (post-M3): tool args parsed exactly once at the tool boundary; transitions accept typed input.
- **Constants centralization** (post-M3): no hard-coded slash-command strings on `nextCommand:` lines outside `runtime/constants.ts`.
- **Recovery metadata exhaustiveness** (post-M4): every `CompletionRecoveryKind` is handled by the exhaustive switch in `recovery.ts`.
- **Idempotent rendering** (post-M5): re-saving an unchanged session writes zero files.

## Testing Surface

- `bun test` — unit + integration over the runtime, tools, installer, transitions, rendering.
- `bun run typecheck` — strict TypeScript (including compile-time schema equivalence checks post-M3).
- `bun run lint` — Biome on the codebase (post-M1).
- `bun run deadcode` — knip for unused files/exports.
- `bun run bench` — mitata micro-benchmarks.
- `bun run build` — produces `dist/index.js` + `dist/index.js.map`.
- Smoke load (`node-script`) — imports `dist/index.js` in a fresh Node VM with a mocked `@opencode-ai/plugin` and exercises the plugin surface end-to-end.

## Performance Envelope (post-mission targets)

- Bundle size: `dist/index.js` ≤ 700 KB (from 990 KB baseline).
- `saveSession` on a 20-feature plan: ≥ 2× faster than baseline.
- No micro-benchmark regresses more than 5% vs baseline without justification.
- Cold-start import < 150 ms median.
