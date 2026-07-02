# Flow plugin for OpenCode

`opencode-plugin-flow` adds a durable planning and execution loop to OpenCode. The package is a TypeScript npm plugin that installs Flow commands, hidden worker agents, managed skills, and seven runtime tools while keeping workflow state in `.flow/session.json`.

## What this project does

Flow turns a broad coding goal into an approved feature plan, runs one feature at a time, records validation and review evidence, and archives the session when it is done. The runtime in `src/runtime/api.ts`, `src/runtime/transitions.ts`, and `src/runtime/workspace.ts` enforces the hard rules. The skills under `skills/` contain the judgment for planning, execution, validation, review, cleanup, UI checks, and commit preparation.

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

Download the generated English video overview:
[overview.mp4](https://github.com/ddv1982/flow-opencode/raw/main/droid-wiki/video/overview.mp4).

English captions are available as
[captions.en.vtt](https://github.com/ddv1982/flow-opencode/raw/main/droid-wiki/video/captions.en.vtt).

## Main source areas

| Path | Purpose |
| --- | --- |
| `src/adapters/opencode/plugin.ts` | OpenCode plugin entrypoint, command preflight, tools, config hook, and optional compaction hook. |
| `src/runtime/api.ts` | Tool-facing runtime API and Zod input schemas. |
| `src/runtime/transitions.ts` | Pure state transitions for planning, running, completion, reset, and close. |
| `src/runtime/workspace.ts` | `.flow/` persistence, locks, atomic writes, archive, quarantine, and generated instructions. |
| `src/config-shared.ts` | Flow command and hidden worker config injected into OpenCode. |
| `src/distribution/sync.ts` | Managed skill sync, doctor, and uninstall behavior. |
| `skills/` | Bundled skill instructions and references copied into the OpenCode skills root. |

## Reader map

New users should read [Getting started](getting-started.md), then [Flow loop](../features/flow-loop.md). Runtime maintainers should read [Architecture](architecture.md), [Runtime state machine](../systems/runtime-state-machine.md), and [Workspace persistence](../systems/workspace-persistence.md). Release maintainers should read [Deployment](../deployment.md) and [Tooling](../how-to-contribute/tooling.md).
