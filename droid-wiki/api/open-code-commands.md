# OpenCode commands

Flow injects five OpenCode command ids through `FLOW_CORE_COMMANDS` in `src/config-shared.ts`. Command preflight in `src/adapters/opencode/plugin.ts` replaces command parts with bundled current instructions before OpenCode executes them.

## Commands

| Command | Purpose | Template source |
| --- | --- | --- |
| `/flow-auto <goal>` | Drive the whole Flow loop. | `FLOW_AUTO_COMMAND_TEMPLATE` in `src/config-shared.ts` |
| `/flow-plan <goal>` | Plan and approve work. | `FLOW_PLAN_COMMAND_TEMPLATE` in `src/config-shared.ts` |
| `/flow-run` | Run one approved feature. | `FLOW_RUN_COMMAND_TEMPLATE` in `src/config-shared.ts` |
| `/flow-review` | Run read-only review as `flow-reviewer`. | `FLOW_REVIEW_COMMAND_TEMPLATE` in `src/config-shared.ts` |
| `/flow-status` | Call `flow_status` and report state. | `FLOW_STATUS_COMMAND_TEMPLATE` in `src/config-shared.ts` |

## Command preflight

`createCommandPreflightHook` in `src/adapters/opencode/plugin.ts` strips leading slashes, checks whether the name is in `FLOW_CORE_COMMANDS`, renders the template with arguments, and rewrites OpenCode output parts. For action commands, `renderFlowCommandPreflight` adds setup warnings from `src/distribution/sync.ts` when skill sync says a restart or user decision is needed.

## Hidden reviewer command

`/flow-review` is configured with `agent: "flow-reviewer"` and `subtask: true` in `src/config-shared.ts`. That agent denies edits, shell, native skill loading, nested tasks, and Flow state-changing tools, while allowing `flow_status`.

## Key source files

| File | Purpose |
| --- | --- |
| `src/config-shared.ts` | Command definitions, templates, and worker config. |
| `src/adapters/opencode/plugin.ts` | Command preflight and title seeds. |
| `skills/flow/SKILL.md` | End-to-end command behavior. |
| `tests/distribution-and-surface.test.ts` | Command and permission contract tests. |

Related pages: [OpenCode adapter](../systems/opencode-adapter.md), [Managed skills](../features/managed-skills.md), and [Parallel orchestration](../features/parallel-orchestration.md).
