# Flow For OpenCode: Retrospective Implementation Plan

## Purpose

This document is a reference plan rewritten from the code that exists today.

It answers two questions:

- what has actually been implemented in this plugin
- what implementation plan we would have written if we were planning toward the current design from the start

## Goal

Build an OpenCode-native workflow plugin that can:

- create and persist a scoped planning session
- turn a goal into a structured feature plan
- approve or narrow that plan before execution
- execute one feature at a time
- require validation evidence before a feature can complete
- require reviewer approval before a feature or full session can advance
- support autonomous plan, run, review, and replan loops
- expose status and reset flows through runtime tools and slash commands
- persist durable state and readable markdown artifacts under `.flow/`

## What The Codebase Implements Today

### Package and entrypoints

The plugin is a small TypeScript package built with Bun:

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- `src/config.ts`
- `src/tools.ts`
- `src/runtime/`
- `src/prompts/`
- `tests/`

The entrypoint in `src/index.ts` exports a plugin that registers:

- a `config` hook
- a Flow tool surface

### Config injection

The config hook in `src/config.ts` injects five agents:

- `flow-planner`
- `flow-worker`
- `flow-auto`
- `flow-reviewer`
- `flow-control`

It also injects seven slash commands:

- `/flow-plan`
- `/flow-run`
- `/flow-auto`
- `/flow-status`
- `/flow-history`
- `/flow-session`
- `/flow-reset`

This is unconditional config injection. There is no workspace-detection gate in the current implementation.

### Runtime state and artifacts

The canonical session artifact is:

- `.flow/active`
- `.flow/sessions/<session-id>/session.json`

The plugin also renders derived markdown artifacts on every save:

- `.flow/sessions/<session-id>/docs/index.md`
- `.flow/sessions/<session-id>/docs/features/<feature-id>.md`

State is loaded and saved through `src/runtime/session.ts`, with paths defined in `src/runtime/paths.ts`.

### Session model

The runtime schema in `src/runtime/schema.ts` implements a single active session with:

- `version`
- `id`
- `goal`
- `status`
- `approval`
- `planning`
- `plan`
- `execution`
- `notes`
- `artifacts`
- `timestamps`

The planning model includes:

- plan summary and overview
- requirements
- architecture decisions
- ordered features
- goal mode
- decomposition policy
- completion policy
- planning context such as repo profile, research, and implementation approach

The execution model includes:

- active feature tracking
- last outcome, next step, and validation run
- last reviewer decision
- last feature result
- execution history

### Tool surface

The tool runtime in `src/tools.ts` currently exposes:

- `flow_status`
- `flow_history`
- `flow_history_show`
- `flow_auto_prepare`
- `flow_plan_start`
- `flow_plan_apply`
- `flow_plan_approve`
- `flow_plan_select_features`
- `flow_run_start`
- `flow_run_complete_feature`
- `flow_review_record_feature`
- `flow_review_record_final`
- `flow_session_activate`
- `flow_reset_feature`
- `flow_reset_session`

Compared with the earlier plan, the implemented runtime is stricter and more complete because reviewer decisions are first-class state transitions.

### Transition rules

The transition engine in `src/runtime/transitions/` enforces:

- plan schema validation through Zod
- feature dependency and blocker graph validation
- duplicate and cyclic dependency rejection
- plan narrowing only while the plan is still a draft
- plan approval only before execution starts
- one active feature at a time
- runnable feature selection based on dependencies and blockers
- replan flow when a worker returns `replan_required`
- blocked flow when a worker returns a blocking outcome
- dependency-aware feature reset that also resets downstream dependents

### Review and validation gates

This is a major implemented behavior and should be part of any accurate plan.

A feature cannot complete successfully unless:

- validation evidence is present
- validation passes fully
- a reviewer decision has already been recorded
- the reviewer decision is approved for the active scope
- `featureReview` is passing

The final completion path is stricter. When the last feature completes, the runtime also requires:

- `validationScope: broad`
- a recorded final reviewer decision through `flow_review_record_final`
- a passing `finalReview`

This means the plugin does not treat review as advisory text. Review is a persisted workflow gate.

### Recovery contract and blocked-state behavior

The current runtime also returns structured recovery metadata for retryable failures.

That recovery metadata includes:

- `errorCode`
- `resolutionHint`
- `recoveryStage`
- `prerequisite`
- optional `requiredArtifact`
- `nextCommand`
- optional `nextRuntimeTool`
- optional `nextRuntimeArgs`

This matters because the implemented system now distinguishes between:

- failures blocked on missing prerequisites such as reviewer decisions or validation reruns
- failures that have an immediately executable next step such as `flow_reset_feature`

Blocked session summaries also became smarter. When the latest blocked outcome is retryable or auto-resolvable and does not require human input, the runtime now points the next command back to `/flow-reset feature <id>` instead of stopping at `/flow-status`.

### Agent design

The prompt layer in `src/prompts/agents.ts` defines clear roles:

- `flow-planner`: read-only planning agent
- `flow-worker`: single-feature execution agent
- `flow-auto`: autonomous orchestration agent
- `flow-reviewer`: read-only approval gate for feature and final review
- `flow-control`: status and reset agent only

Notable implemented constraints:

- planner, reviewer, and control agents are explicitly read-only
- worker must not complete work while findings remain
- autonomous flow must keep looping through fix, validate, and review until clean or truly blocked
- final completion requires broad validation and final cross-feature review
- autonomous recovery must satisfy structured prerequisites before using any runtime recovery action

### Command behavior

The command templates in `src/prompts/commands.ts` implement the user-facing workflow:

- `/flow-plan` supports draft creation, feature selection, and approval from arguments
- `/flow-run` executes exactly one approved feature
- `/flow-auto` runs plan, approval, execution, review, and replanning autonomously
- `/flow-status` reads runtime state only
- `/flow-history` reads current and archived session history, and can inspect one stored session by id
- `/flow-session` repoints the active session pointer to a stored session id
- `/flow-reset` resets a feature or archives the active session

The current autonomous contract is also intentionally strict about empty-input behavior:

- empty `/flow-auto` is resume-only
- empty `/flow-auto` with no active session must stop and request a goal
- completed sessions are not resumable in that path
- the autonomous agent must not invent a new goal from repository inspection in that path
- a dedicated `flow_auto_prepare` runtime tool now gates that decision before planning starts

### Rendering strategy

The current implementation did not stop at JSON-only summaries.

`src/runtime/render.ts` renders:

- a session index document with plan, status, next command, notes, artifacts, validation, reviewer state, and history
- per-feature documents with summaries, file targets, verification, dependencies, and execution history

Markdown rendering also normalizes multiline content to avoid malformed docs.

### Testing coverage

The current test suite covers both configuration and runtime behavior.

`tests/config.test.ts` covers:

- command and agent injection
- read-only agent configuration
- tool arg-shape compatibility
- prompt and contract expectations for worker, reviewer, and autonomous flows

`tests/runtime.test.ts` covers:

- session creation, save, and load
- markdown doc rendering
- plan apply, select, and approve flows
- feature start and completion flows
- reviewer recording behavior
- blocked and replan-required outcomes
- final-review completion rules
- reset behavior
- prerequisite-aware recovery metadata for review, validation, payload, and reset failures

## Architecture We Effectively Chose

If we reduce the implemented design to its core architectural decisions, it is this:

1. Build a TypeScript plugin package.
2. Use the plugin `config` hook to inject commands and agents.
3. Make Flow tools the only authoritative state transition layer.
4. Keep one active durable session pointer in `.flow/active` and store run history under `.flow/sessions/<session-id>/session.json`.
5. Treat planning, execution, review, and reset as explicit runtime transitions.
6. Keep slash commands prompt-driven, but always tool-backed.
7. Require persisted reviewer decisions before successful completion.
8. Render markdown docs as derived artifacts for human inspection.
9. Keep autonomous execution inside OpenCode's agent model rather than a terminal-owned loop.

## Retrospective Implementation Plan

If we were planning toward the current implementation from scratch, this is the plan we would write.

## Phase 1: Scaffold The Plugin

- create `package.json`, `tsconfig.json`, and `src/index.ts`
- set up Bun build, test, and typecheck scripts
- export a plugin that wires config injection and custom tools

## Phase 2: Inject Commands And Agents

- add a config hook in `src/config.ts`
- inject planner, worker, auto, reviewer, and control agents
- inject `/flow-plan`, `/flow-run`, `/flow-auto`, `/flow-status`, `/flow-history`, `/flow-session`, and `/flow-reset`
- lock planner, reviewer, and control to read-only tool permissions

## Phase 3: Define Runtime Schema And Persistence

- create Zod schemas for sessions, plans, features, worker results, and reviewer decisions
- persist the active session under `.flow/sessions/<session-id>/session.json` and track it via `.flow/active`
- create session load, save, create, and delete helpers
- define runtime path helpers for session and docs artifacts

## Phase 4: Implement Planning Transitions

- implement `flow_plan_start`
- implement `flow_plan_apply`
- implement `flow_plan_select_features`
- implement `flow_plan_approve`
- validate feature ids, dependency graphs, and selection consistency
- store planning context such as repo profile, research, and implementation approach

## Phase 5: Implement Execution Transitions

- implement `flow_run_start`
- select the next runnable feature from dependency-aware plan state
- enforce single active feature execution
- implement `flow_run_complete_feature`
- support successful completion, replanning, and blocked outcomes
- record artifacts, notes, validation runs, and execution history

## Phase 6: Make Review A First-Class Gate

- add reviewer decision schema and persistence
- implement `flow_review_record_feature`
- implement `flow_review_record_final`
- require recorded approval before successful feature completion
- require broad validation and final review on session completion

## Phase 6.5: Add Structured Recovery Metadata

- add typed recovery metadata to transition failures
- distinguish missing prerequisites from executable next actions
- keep user-facing `nextCommand` valid even when no runtime action is yet possible
- expose runtime reset actions only when they are actually executable
- make blocked session summaries point back into recovery when the outcome is retryable

## Phase 7: Add Reset And Inspection Flows

- implement `flow_status`
- implement `flow_history`
- implement `flow_history_show`
- implement `flow_session_activate`
- implement `flow_reset_feature`
- implement `flow_reset_session`
- make feature reset dependency-aware so downstream work returns to pending when needed

## Phase 8: Add Derived Markdown Rendering

- render `.flow/sessions/<session-id>/docs/index.md`
- render `.flow/sessions/<session-id>/docs/features/<feature-id>.md`
- include summary, feature progress, validation evidence, reviewer decisions, and history
- prune stale feature docs after plan changes

## Phase 9: Write Prompt Contracts And Command Templates

- define plan, worker, and reviewer contracts in prompts
- make planner produce compact structured plans
- make worker operate on exactly one feature
- make reviewer return `approved`, `needs_fix`, or `blocked`
- encode autonomous review and fix loops in the auto prompt
- encode prerequisite-aware recovery handling in the auto prompt so structured runtime errors lead back into execution instead of stopping

## Phase 10: Harden With Tests

- test config injection and permissions
- test raw tool arg shapes
- test session persistence and doc rendering
- test planning and approval transitions
- test execution and review gating
- test replan-required and blocked outcomes
- test final-review completion rules
- test reset behavior

## Scope We Actually Reached

Implemented now:

- plugin scaffold and build pipeline
- config-driven command and agent injection
- single-session durable runtime
- planning and execution transition tools
- explicit reviewer and final-review tools
- autonomous prompt-driven loop design
- prerequisite-aware structured recovery metadata on transition failures
- status and reset flows
- derived markdown docs
- transition and prompt tests

Not implemented in the current codebase:

- multi-session support
- conditional activation based on workspace detection
- additional hooks beyond `config`
- external notifications
- history archives outside the session artifact

## Design Decisions To Keep

- tools own runtime state transitions
- one active pointer with retained session history is enough for v1
- one active feature at a time keeps execution deterministic
- review approval is persisted, not implied
- final completion requires broader validation than normal feature work
- replanning is a normal path, not a failure mode
- runtime recovery should distinguish missing prerequisites from executable next actions
- markdown docs are derived artifacts, not the source of truth
- autonomy stays inside OpenCode's native agent model

## Recommendation

Use this document as the reference implementation plan for the plugin as-built.

It reflects the current codebase more accurately than the original draft because it captures the parts that turned out to matter most in implementation: strict transition ownership in tools, persisted reviewer gates, final-review completion rules, and derived session docs beside `.flow/sessions/<session-id>/session.json`.
