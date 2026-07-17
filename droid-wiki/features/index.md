# Features

Active contributors: ddv1982

Flow's user-visible features are the planning loop, execution gates, embedded guidance, review and validation evidence, and parallel worker guidance. Most features span `src/`, `skills/`, and `tests/`, so this section follows capabilities rather than directories.

## Feature map

| Feature | Main paths |
| --- | --- |
| [Flow loop](flow-loop.md) | `skills/flow/SKILL.md`, `src/application/flow-service.ts`, `src/domain/transitions.ts` |
| [Planning and approval](planning-and-approval.md) | `skills/flow-plan/SKILL.md`, `src/application/schema.ts`, `src/domain/transitions.ts` |
| [Execution and completion](execution-and-completion.md) | `skills/flow-run/SKILL.md`, `src/application/flow-service.ts`, `src/domain/transitions.ts` |
| [Review and validation](review-and-validation.md) | `skills/flow-review/SKILL.md`, `skills/flow-test/SKILL.md`, `src/application/schema.ts` |
| [Embedded guidance](embedded-guidance.md) | `src/guidance/catalog.ts`, `src/platform/opencode/tools.ts`, `skills/` |
| [Parallel orchestration](parallel-orchestration.md) | `src/config-shared.ts`, `skills/flow/references/parallel-orchestration.md` |

## Coverage decision

No `apps/` or workspace `packages/` lens is used because this repository ships one npm package and one OpenCode plugin runtime. The package and CLI are covered under [CLI and package](../systems/cli-and-package.md), and the runtime concepts are covered under [Primitives](../primitives/index.md).

Related pages: [Systems](../systems/index.md), [Flow tools](../api/flow-tools.md), and [Architecture](../overview/architecture.md).
