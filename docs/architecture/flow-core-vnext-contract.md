# Flow Core vNext Contract

This contract freezes the small runtime core for the simplification effort. It started as a slice-1 boundary marker and now records the post-Item-5 supported contract.

## Authority

- **Session shape:** the persisted `Session` snapshot in `src/runtime/schema.ts` remains the state shape.
- **Transition authority:** `src/runtime/transitions/**` owns plan, run, review, completion, reset, recovery, and completion-gate behavior.
- **Application facade:** `src/runtime/application/flow-core.ts` exposes the compact command/query names and delegates to existing session action handlers.
- **Persistence authority:** `src/runtime/application/session-engine.ts` remains the only mutation persistence gate: load snapshot, run transition, save snapshot, optionally sync rendered artifacts.
- **Adapter responsibility:** OpenCode tools should stay thin: parse args, enforce workspace mutability where required, call the Flow Core facade or existing delegated session action path, and format JSON responses.

## Commands

Flow Core commands are write or lifecycle requests. They are the union of:

- Workspace lifecycle commands from `SESSION_WORKSPACE_ACTION_NAMES`: `plan_start`, `activate_session`, `close_session`.
- Runtime mutation commands from `SESSION_MUTATION_ACTION_NAMES`: planning context, plan application/approval/selection, run start/completion, reset, and reviewer decisions.

Commands must not implement state transitions directly. They build or select an existing session action and enter the session engine persistence path.

## Queries

Flow Core queries are read-only session requests from `SESSION_READ_ACTION_NAMES`: status loading, history listing/loading, and resumable-session loading.

Queries must not mutate session snapshots or rendered artifacts.

## Completion and recovery

Completion safety remains always on in the runtime transition layer: validation evidence, passing validation, feature/final review requirements, final completion policy, and structured recovery metadata stay owned by `src/runtime/transitions/**` and supporting runtime domain helpers.

## Persistence

The product path is snapshot-first. Active, stored, and completed session snapshots plus optional rendered markdown artifacts are the durable format for this contract. Event logs, checkpoints, projection stores, and core workflow replay wrappers are not product-supported surfaces after Item 5.

## Post-Item-5 boundaries

The Flow Core facade, runtime transitions, snapshot persistence, and thin OpenCode adapter registry are the supported simplification surfaces. Descriptor/projection bridge metadata may remain only when it is generated from or checked against the small registry and actively used by tools, docs, prompts, or tests. Strict review governance remains optional for review/review-and-fix or explicit strict review mode. Do not change zod / `@opencode-ai/plugin` SDK alignment without a reviewed SDK-boundary decision.
