# Flow Plugin For OpenCode

Flow is an opencode-native workflow plugin for goal planning, feature execution, status tracking, and autonomous plan-and-run loops.

## What it provides

- `/flow-plan` to create or update a draft plan
- `/flow-run` to execute one approved feature with reviewer gating
- `/flow-auto` to plan, approve, execute, review, fix, and validate autonomously
- `/flow-status` to inspect the active workflow session
- `/flow-reset` to reopen a feature or clear the active session

## Install

### Local development plugin

Build the plugin:

```bash
bun install
bun run build
```

The exact file OpenCode should load is:

```text
dist/index.js
```

Copy or symlink that built file into a plugin directory such as:

```text
.opencode/plugins/
```

or:

```text
~/.config/opencode/plugins/
```

Example using a copy:

```bash
cp dist/index.js .opencode/plugins/flow.js
```

Example using a symlink for local development:

```bash
ln -s /absolute/path/to/your/repo/dist/index.js .opencode/plugins/flow.js
```

OpenCode loads plugin files from those directories at startup, so the important part is that the built `dist/index.js` file is what ends up there.

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
4. `/flow-run` or `/flow-auto <goal>`
5. `/flow-status`

Useful commands:

- `/flow-plan <goal>` creates or refreshes a draft plan
- `/flow-plan approve` approves the draft plan
- `/flow-plan select <feature-id>` narrows the current draft to the listed feature ids
- `/flow-run [feature-id]` executes the next runnable feature or a specific runnable feature, then requires recorded reviewer approval before completion
- `/flow-auto <goal>` plans and executes autonomously from a new goal
- `/flow-auto resume` resumes an active autonomous session
- `/flow-status` shows the current session summary
- `/flow-reset feature <id>` reopens a feature
- `/flow-reset session` clears the active session

### Autonomous execution model

`/flow-auto` uses a reviewer-gated loop:

1. plan
2. approve
3. execute the current feature
4. run targeted validation
5. review the result
6. fix findings and repeat until approved
7. persist the feature only after recorded reviewer approval
8. on the final feature, run broad validation and require a passing `finalReview`

This means Flow will not advance to the next feature until the current one is clean, and it will not complete the session until final broad validation and review pass.

## Architecture

- A plugin `config` hook injects commands and agents.
- Custom tools own workflow state transitions.
- Session state is persisted in `.flow/session.json`.
- Planner, worker, reviewer, control, and autonomous orchestration behavior live in dedicated agent prompts.
- Reviewer decisions are durably recorded and gate successful completion.

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

### Agents

- `flow-planner`: planning only
- `flow-worker`: implementation and validation
- `flow-reviewer`: review-only approval gate
- `flow-control`: status/reset only
- `flow-auto`: orchestrates the full planner-worker-reviewer loop

### Tool schema note

OpenCode plugin tools expect `args` to be a raw Zod shape, not a top-level `z.object(...)` or `z.discriminatedUnion(...)`.

Good:

```ts
const ArgsShape = {
  featureId: z.string().optional(),
};
```

Avoid using a top-level schema instance directly as `args`. Keep richer schemas for runtime validation inside the implementation path.

This plugin intentionally splits validation into two layers:

- SDK-facing tool `args` stay as raw shapes for OpenCode compatibility
- stricter semantic validation happens in runtime schemas like `WorkerResultSchema` during execution

### Derived docs

The plugin writes derived docs from runtime state into:

```text
.flow/docs/index.md
.flow/docs/features/<feature-id>.md
```

These docs are projections of `session.json`, not a second source of truth.

They include:

- session summary and next command
- validation and outcome summaries
- feature-level execution history
- recorded reviewer decisions for completed work

## State

The plugin persists a single active session in:

```text
.flow/session.json
```

That artifact is the authoritative workflow state for the current worktree.
