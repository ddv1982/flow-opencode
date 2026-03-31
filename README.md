# Flow Plugin For OpenCode

Flow is an opencode-native workflow plugin for goal planning, feature execution, status tracking, and autonomous plan-and-run loops.

## What it provides

- `/flow-plan` to create or update a draft plan
- `/flow-run` to execute one approved feature
- `/flow-auto` to plan, approve, and execute autonomously
- `/flow-status` to inspect the active workflow session
- `/flow-reset` to reopen a feature or clear the active session

## Install

### Local development plugin

Build the plugin:

```bash
bun install
bun run build
```

Then point opencode at the built plugin by linking or copying it into a plugin directory such as:

```text
.opencode/plugins/
```

or:

```text
~/.config/opencode/plugins/
```

OpenCode loads local plugin files from those directories at startup.

### npm-style plugin

This repo is structured like an npm plugin package. After publishing, it can be added to `opencode.json`:

```json
{
  "plugin": ["opencode-plugin-flow"]
}
```

## Usage

Typical flow:

1. `/flow-plan <goal>`
2. Review the draft plan
3. `/flow-plan approve`
4. `/flow-run` or `/flow-auto`
5. `/flow-status`

Useful commands:

- `/flow-plan <goal>` creates or refreshes a draft plan
- `/flow-plan approve` approves the draft plan
- `/flow-plan select <feature-id>` narrows the current draft to the listed feature ids
- `/flow-run [feature-id]` executes the next runnable feature or a specific runnable feature
- `/flow-auto <goal>` plans and executes autonomously
- `/flow-status` shows the current session summary
- `/flow-reset feature <id>` reopens a feature
- `/flow-reset session` clears the active session

## Architecture

- A plugin `config` hook injects commands and agents.
- Custom tools own workflow state transitions.
- Session state is persisted in `.flow/session.json`.
- Planner and worker behavior live in dedicated agent prompts.

## Development

```bash
bun install
bun run check
```

### Local dev loop

```bash
bun install
bun run build
bun run check
```

### Packaging notes

- entrypoint: `dist/index.js`
- source plugin entry: `src/index.ts`
- plugin config injection: `src/config.ts`
- runtime tools: `src/tools.ts`
- runtime state and rendering: `src/runtime/*`

### Derived docs

The plugin writes derived docs from runtime state into:

```text
.flow/docs/index.md
.flow/docs/features/<feature-id>.md
```

These docs are projections of `session.json`, not a second source of truth.

## State

The plugin persists a single active session in:

```text
.flow/session.json
```

That artifact is the authoritative workflow state for the current worktree.
