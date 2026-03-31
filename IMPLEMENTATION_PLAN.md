# Flow For OpenCode: Implementation Plan

## Goal

Build an opencode-native workflow plugin that supports:

- planning a scoped goal into an ordered feature plan
- approving and trimming that plan
- executing one feature at a time with review/validation evidence
- autonomous plan-and-run loops for broader goals
- status inspection and reset/reopen flows
- durable workflow state across opencode sessions

The design should feel native to opencode instead of recreating a shell-heavy wrapper system.

## Research Findings

### Opencode primitives we should use

- Plugins can be loaded locally or from npm.
- Plugins can contribute hooks and custom tools.
- Plugins can also mutate runtime config through a `config` hook.
- Commands are prompt templates, not shell-first wrappers.
- Agents can be defined with focused prompts and restricted permissions.
- Skills are optional, on-demand instruction packs.
- Custom tools are the right place for authoritative state transitions.

### Concrete implication

The cleanest architecture is:

1. a TypeScript plugin package
2. a `config` hook that injects commands and agents
3. plugin-owned custom tools that act as the workflow runtime
4. prompt-only slash commands that instruct agents to call those tools

This avoids the least opencode-native parts of the older design:

- bash wrappers as the primary interface
- command files owning workflow transitions
- a separate terminal loop for autonomy

## Recommended Architecture

## 1. Package shape

Use a small npm-style TypeScript plugin package:

- `src/index.ts`
- `src/config.ts`
- `src/runtime/`
- `src/tools/`
- `src/agents/`
- `src/prompts/`
- `src/state/`
- `package.json`
- `tsconfig.json`

## 2. Plugin responsibilities

The plugin should do three things.

1. Detect whether the current workspace should expose the workflow commands.
2. Inject opencode config for commands and agents.
3. Register custom tools that own workflow state transitions.

Recommended detection rules:

- always active inside this repo during development
- later: active when `.flow/` exists, or when the user explicitly invokes a flow command

## 3. State model

Keep durable workflow state, but make it thinner than the previous implementation.

Recommended canonical artifact:

- `.flow/session.json`

Recommended optional derived artifacts:

- `.flow/docs/index.md`
- `.flow/docs/features/<feature-id>.md`
- `.flow/history/*.json`

Recommended top-level schema:

- `version`
- `id`
- `goal`
- `status`
- `approval`
- `plan`
- `execution`
- `notes`
- `artifacts`
- `timestamps`

Keep one active session for the MVP. Add multi-session support only after the single-session workflow is solid.

## 4. Runtime surface

Do not make slash commands the runtime.

Instead, create plugin tools that are authoritative for transitions. Smallest useful tool surface:

- `flow_status`
- `flow_plan_start`
- `flow_plan_apply`
- `flow_plan_approve`
- `flow_plan_select_features`
- `flow_run_start`
- `flow_run_complete_feature`
- `flow_reset_feature`
- `flow_reset_session`

If we want a smaller API, these can collapse into one `flow_runtime` tool with an `action` enum, but separate tools will be easier for the model to use correctly.

Tool responsibilities:

- validate inputs
- load and save `.flow/session.json`
- enforce state transitions
- generate compact summaries for agents and commands
- reject invalid transitions deterministically

## 5. Agents

Inject two dedicated subagents and optionally one orchestrator profile.

### `flow-planner`

Purpose:

- inspect repo context
- optionally use research tools
- return a compact structured plan payload

Constraints:

- read-only
- no direct writes to `.flow/`
- repo evidence first
- use external research only to resolve implementation direction, tradeoffs, and validation signals

Tools:

- allow read/search tools
- allow `webfetch`
- allow task/question if useful
- allow external research tools when available
- deny edit/write/bash for MVP planner mode

### `flow-worker`

Purpose:

- execute exactly one planned feature
- run targeted validation
- return structured execution and review output

Constraints:

- scoped to one feature
- supporting edits allowed
- must inspect existing code before editing
- must return review and validation evidence

Tools:

- allow read/search/edit/bash
- allow task only if we explicitly want nested subagents later

### Optional `flow-orchestrator`

Purpose:

- drive `/flow-auto`
- call runtime tools
- spawn planner and worker subagents
- continue until completion or real blocker

This can also be handled by the default agent via command prompts, so it is optional for MVP.

## 6. Commands

Inject commands through plugin config instead of requiring manual `.opencode/commands` setup.

Recommended commands:

- `/flow-plan <goal>`
- `/flow-run [feature-id]`
- `/flow-auto <goal|resume>`
- `/flow-status`
- `/flow-reset [feature <id>|session]`

Command behavior should be prompt-driven and tool-backed.

Example shape:

- `/flow-plan` tells the agent to call `flow_plan_start`, dispatch `flow-planner`, show a compact draft, then call `flow_plan_apply` and `flow_plan_approve` only when appropriate.
- `/flow-run` tells the agent to call `flow_run_start`, dispatch `flow-worker`, then persist the result via `flow_run_complete_feature`.
- `/flow-auto` tells the agent to repeat planning and execution steps until completion, pause, or human dependency.

## 7. Autonomous mode

This is the biggest place to be opencode-native.

Do not shell into a separate terminal-owned loop for MVP.

Instead:

- `/flow-auto` runs as a normal opencode command
- the acting agent uses runtime tools plus `task` subagents
- the loop stays inside opencode's native agent model

Loop outline:

1. load or initialize state
2. if no approved plan exists, run planner
3. if approval is required, stop and ask
4. start next runnable feature
5. run worker
6. persist result
7. if replan is required, return to planning
8. stop on complete, blocked, paused, or human decision

## 8. Research strategy inside planning

Research should be optional and capability-based.

Planner instructions should say:

- use repo evidence first
- if Ref tools are available, use them first for docs
- if Exa tools are available, use them second for code/examples
- use `webfetch` or built-in web search as fallback
- keep research bounded and source-linked

Do not make the plugin depend on a specific MCP server being installed.

## 9. Rendering strategy

Do not overinvest in derived markdown early.

For MVP:

- runtime tools return structured JSON plus concise human summaries
- commands render compact status blocks in chat
- write `.flow/docs/*` only if it materially improves usability

This keeps the authoritative state in one place and reduces sync bugs.

## 10. Hooks

Use hooks sparingly in v1.

Possible hooks worth adding later:

- `config`: inject commands, agents, permissions
- `session.idle`: optional notification when autonomous flow finishes
- `experimental.session.compacting`: inject current flow state into compaction context

Do not build the core workflow around hooks other than `config`.

## MVP Scope

Build this first:

1. plugin scaffold and build pipeline
2. config hook that injects commands and agents
3. session schema and state load/save helpers
4. planning runtime tools
5. planner agent prompt and payload contract
6. run runtime tools
7. worker agent prompt and payload contract
8. `/flow-status` and `/flow-reset`
9. `/flow-auto` loop inside opencode

Defer this until later:

- multiple concurrent sessions
- startup hooks and summaries
- rich rendered docs per feature
- external notifications
- advanced review-only and review-and-fix plan modes

## Implementation Phases

## Phase 1: Scaffold

- create `package.json`, `tsconfig.json`, and `src/index.ts`
- add build output to `dist/index.js`
- verify plugin loads locally

## Phase 2: Config injection

- add `config` hook
- inject commands
- inject agents with correct permissions
- validate command names and agent prompts in a live opencode session

## Phase 3: Runtime core

- define session schema types
- implement state read/write helpers
- implement deterministic transition functions
- implement summary projection helpers

## Phase 4: Planner flow

- implement `flow_plan_start`, `flow_plan_apply`, `flow_plan_approve`, `flow_plan_select_features`
- write planner prompt and output contract
- test narrow goal, broad goal, and underspecified goal cases

## Phase 5: Execution flow

- implement `flow_run_start` and `flow_run_complete_feature`
- write worker prompt and output contract
- test completed, blocked, and replan-required outcomes

## Phase 6: Autonomous flow

- add `/flow-auto`
- implement loop guardrails
- test completion, approval stop, blocker stop, and replan loop

## Phase 7: Hardening

- add schema validation for planner and worker payloads
- add fixture-based tests for transition logic
- add integration smoke tests for command prompts and tool contracts

## Testing Plan

### Unit tests

- session schema validation
- transition rules
- feature selection and reset behavior
- summary projection helpers

### Fixture tests

- fresh plan creation
- plan approval
- run start with active feature
- worker completion
- worker replan-required
- blocked/human-input outcomes
- session reset and feature reset

### Live manual tests

- `/flow-plan` with a small implementation goal
- `/flow-plan` with a broad review/fix goal
- `/flow-run`
- `/flow-auto <goal>`
- `/flow-status`
- `/flow-reset feature <id>`
- `/flow-reset session`

## Design Decisions To Keep

- runtime tools are authoritative for transitions
- planner is read-only
- worker is scoped to one feature
- broad goals are valid
- replanning during execution is normal, not an error
- external research is optional and bounded

## Design Decisions To Drop

- shell wrappers as the main execution path
- command markdown reconstructing workflow transitions
- a separate terminal-only autonomy runner for MVP
- duplicated state ownership across prompt files and runtime code

## Open Questions

1. Do we want the public command names to stay `flow-*`, or should this plugin use a new prefix?
2. Do we want single-session only for v1, or do we need `--all` style multi-session support immediately?
3. Should the plugin persist derived markdown docs in v1, or rely entirely on chat summaries plus `session.json`?
4. Should `/flow-plan` require explicit approval every time, or allow an auto-approve mode only for `/flow-auto`?

## Recommendation

Start with a TypeScript plugin that injects commands and agents through a `config` hook, and put all real workflow behavior into plugin tools backed by a thin `.flow/session.json` runtime.

That gives us the same core workflow shape while making the implementation clearly opencode-native.
