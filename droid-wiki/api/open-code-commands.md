# OpenCode commands

Flow injects five OpenCode command ids through `FLOW_CORE_COMMANDS` in `src/config-shared.ts`. `src/prompt-surfaces.ts` compiles their role/phase-specific instructions, and command preflight in `src/adapters/opencode/plugin.ts` replaces command parts with current compiled prompts before OpenCode executes them.

## Commands

| Command | Purpose | Template source |
| --- | --- | --- |
| `/flow-auto <goal>` | Drive the whole Flow loop. | `compileFlowPromptSurface("flow-auto")` |
| `/flow-plan <goal>` | Plan and approve work. | `compileFlowPromptSurface("flow-plan")` |
| `/flow-run` | Run one approved feature. | `compileFlowPromptSurface("flow-run")` |
| `/flow-review` | Run read-only review as `flow-reviewer`. | Small compiled task prompt plus the reserved agent contract |
| `/flow-status` | Call `flow_status` and report state. | `compileFlowPromptSurface("flow-status")` |

## Command preflight

`createCommandPreflightHook` in `src/adapters/opencode/plugin.ts` strips leading slashes, checks whether the name is in `FLOW_CORE_COMMANDS`, renders the template with arguments, and rewrites OpenCode output parts. For action commands, `renderFlowCommandPreflight` adds setup warnings from `src/distribution/sync.ts` when skill sync says a restart or user decision is needed.

## Hidden reviewer command

`/flow-review` is configured with `agent: "flow-reviewer"` and `subtask: true` in `src/config-shared.ts`. The task prompt does not duplicate the review rubric; the reserved agent owns the independent review contract. That agent denies edits, shell, native skill loading, nested tasks, and Flow state-changing tools, while allowing `flow_status`.

## Key source files

| File | Purpose |
| --- | --- |
| `src/prompt-surfaces.ts` | Prompt compiler, canonical fragments, and offline worker handoff validators. |
| `src/prompt-quality.ts` | Metrics, static scenario contracts, and repetition classification. |
| `src/prompt-model-evaluation.ts` | Opt-in model-decision packets, schemas, and graders. |
| `src/config-shared.ts` | Command definitions and worker config consuming compiled prompts. |
| `src/adapters/opencode/plugin.ts` | Command preflight and title seeds. |
| `skills/flow/SKILL.md` | End-to-end command behavior. |
| `tests/distribution-and-surface.test.ts` | Command and permission contract tests. |
| `tests/prompt-quality.test.ts` | Prompt growth, role, schema, static-contract, and model-grader regression tests. |

Related pages: [OpenCode adapter](../systems/opencode-adapter.md), [Managed skills](../features/managed-skills.md), and [Parallel orchestration](../features/parallel-orchestration.md).
