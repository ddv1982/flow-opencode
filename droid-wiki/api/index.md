# API

The public API for this project is OpenCode-facing rather than HTTP-facing. It has one read-only guidance tool, seven stateful runtime tools, five Flow slash commands, hidden worker agents, and one npm binary.

## Surfaces

| Surface | Page |
| --- | --- |
| Runtime tools | [Flow tools](flow-tools.md) |
| OpenCode commands | [OpenCode commands](open-code-commands.md) |
| npm CLI | [CLI and package](../systems/cli-and-package.md) |

## Non-goals

The repo does not expose REST, GraphQL, WebSocket, or database APIs. Runtime state is local workspace JSON managed by `src/infrastructure/fs/workspace.ts`.

Related pages: [OpenCode adapter](../systems/opencode-adapter.md), [Runtime state machine](../systems/runtime-state-machine.md), and [Configuration](../reference/configuration.md).
