# Flow plugin for OpenCode

`opencode-plugin-flow` adds a durable planning and execution loop to OpenCode. The TypeScript package installs Flow commands and hidden worker agents, exposes embedded guidance plus seven stateful runtime tools, and keeps workflow state in `.flow/session.json`.

## What this project does

Flow turns a broad coding goal into an approved feature plan, runs one feature at a time, records validation and review evidence, and archives the session when it is done. The runtime in `src/application/flow-service.ts`, `src/domain/transitions.ts`, and `src/infrastructure/fs/workspace.ts` enforces the hard rules. The skills under `skills/` contain the judgment for planning, execution, validation, review, cleanup, UI checks, and commit preparation.

## Quick links

| Topic | Start here |
| --- | --- |
| Architecture | [Architecture](architecture.md) |
| Local setup | [Getting started](getting-started.md) |
| Main user workflow | [Flow loop](../features/flow-loop.md) |
| Runtime tools | [Flow tools](../api/flow-tools.md) |
| Session state | [Session, plan, and feature](../primitives/session-plan-feature.md) |
| Release process | [Deployment](../deployment.md) |

## Video overview

The current recording predates the v5 embedded-guidance cutover and is retained
as a historical architecture tour. Use this wiki for current installation and
runtime behavior.

Download the generated English video overview:
[overview.mp4](https://github.com/ddv1982/flow-opencode/raw/main/droid-wiki/video/overview.mp4).

English captions are available as
[captions.en.vtt](https://github.com/ddv1982/flow-opencode/raw/main/droid-wiki/video/captions.en.vtt).

## Main source areas

| Path | Purpose |
| --- | --- |
| `src/platform/opencode/plugin.ts` | OpenCode plugin entrypoint, command preflight, tools, and config hook. |
| `src/application/flow-service.ts` | Typed use cases, repository coordination, and core Zod input schemas. |
| `src/domain/transitions.ts` | Pure state transitions for planning, running, completion, reset, and close. |
| `src/infrastructure/fs/workspace.ts` | `.flow/` persistence, locks, atomic writes, archive, and quarantine. |
| `src/config-shared.ts` | Flow command and hidden worker config injected into OpenCode. |
| `src/guidance/catalog.ts` | Stable ids and Markdown embedded in the plugin bundle. |
| `skills/` | Authored guidance and references consumed by the embedded catalog. |

## Reader map

New users should read [Getting started](getting-started.md), then [Flow loop](../features/flow-loop.md). Runtime maintainers should read [Architecture](architecture.md), [Runtime state machine](../systems/runtime-state-machine.md), and [Workspace persistence](../systems/workspace-persistence.md). Release maintainers should read [Deployment](../deployment.md) and [Tooling](../how-to-contribute/tooling.md).
