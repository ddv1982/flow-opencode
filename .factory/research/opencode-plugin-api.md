# OpenCode Plugin API — Research Notes (captured 2026-04-18)

> Research supporting `opencode-plugin-flow`. Cross-referenced against installed
> `@opencode-ai/plugin@1.3.10` types, the public docs at opencode.ai, the
> sst/opencode (now anomalyco/opencode) repo, the awesome-opencode registry,
> and several comparable plugins.

## 1. Current Plugin API Surface

Primary authority:
- Installed types: `node_modules/@opencode-ai/plugin/dist/{index,tool,shell,tui}.d.ts`
- Official docs: https://opencode.ai/docs/plugins/ (published 2026-04-11)
- Custom tools docs: https://opencode.ai/docs/custom-tools/ (published 2026-04-11)
- Plugin dev guide gist (LLM-generated, partially verified): https://gist.github.com/rstacruz/946d02757525c9a0f49b25e316fbe715

### Plugin signature (from `dist/index.d.ts`)

```ts
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>;
  project: Project;
  directory: string;
  worktree: string;
  serverUrl: URL;
  $: BunShell;
};
export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;
```

### Complete `Hooks` surface (verbatim from v1.3.10 types)

| Hook | Purpose |
| --- | --- |
| `event({ event })` | Catch-all for every SDK event (session/file/tool/etc.) |
| `config(input: Config)` | Mutate opencode config in-place (agents, commands, etc.) |
| `tool: { [name]: ToolDefinition }` | Register custom tools |
| `auth: AuthHook` | Register OAuth / API-key provider |
| `chat.message(input, output)` | Observe incoming user message before send |
| `chat.params(input, output)` | Mutate LLM sampling params (`temperature`, `topP`, `topK`, `options`) |
| `chat.headers(input, output)` | Mutate provider HTTP headers |
| `permission.ask(input, output)` | Auto-allow/deny permission prompts (see known issue below) |
| `command.execute.before(input, output)` | Inject parts before a `/command` runs |
| `tool.execute.before(input, output)` | Mutate tool args before execution |
| `tool.execute.after(input, output)` | Observe / rewrite `{ title, output, metadata }` |
| `shell.env(input, output)` | Inject env vars into shell executions |
| `experimental.chat.messages.transform(input, output)` | Mutate message list |
| `experimental.chat.system.transform(input, output)` | Mutate system prompt array |
| `experimental.session.compacting(input, output)` | Augment or replace compaction prompt |
| `experimental.text.complete(input, output)` | Observe completions |
| `tool.definition(input, output)` | Mutate tool description/parameters sent to LLM |

Additional exports:
- `tool()` helper — `dist/tool.d.ts`. Provides `tool.schema = Zod`. `execute(args, context)` where `context` has `{ sessionID, messageID, agent, directory, worktree, abort, metadata(), ask() }`.
- `BunShell` types — `dist/shell.d.ts`.
- `tui.d.ts` — for future TUI plugin modules (`opentui/solid`); not applicable to Flow.

### Events list (docs `#events`)

Command, File, Installation, LSP, Message, Permission, Server, Session
(`session.created|compacted|deleted|diff|error|idle|status|updated`), Todo,
Shell, Tool, TUI. Consumed via the single `event` hook.

### Known API caveats (found while researching)

- `permission.ask` may not fire in all permission flows — see upstream issue
  https://github.com/anomalyco/opencode/issues/7006 (noted in the plugin-dev
  gist comment 2026-03-16).
- In 1.2.17 `sessionID` became optional on
  `experimental.chat.system.transform` input
  (micode #40 lockfile PR commit note).
- 1.3.10 → 1.4.x added: **plugin tool execute results can return `metadata`**
  (changelog "Let plugin tools return metadata in execute results."), **custom
  workspace adaptors** ("Plugins can now register custom workspace adaptors
  that appear in workspace creation"), **`auth` UX improvements** (login now
  asks API key only when `authorize` exists), **theme-only plugin packages**,
  **fix for `Tool.define()` tools wrapping `execute` multiple times**, and
  **plugin install hardening** (pinned versions, blocked install scripts,
  skip plugins without matching server/TUI entrypoint).

## 2. Idiomatic Patterns

### Tool schemas

- `tool.schema` is a re-export of Zod (`dist/tool.d.ts`: `tool.schema: typeof z`).
  Zod is the official, idiomatic option. Every official example and most
  community plugins use it.
- The official `Custom Tools` docs also show the "plain object" path using
  `import { z } from "zod"` and returning an object with `{ description,
  args, execute }` — works identically. So Flow's usage of
  `const z = tool.schema;` is perfectly idiomatic.
- **Validation behavior**: nothing in the installed types shows `tool()` calling
  `z.parse()` itself; it simply returns the input. Runtime validation is handled
  inside opencode core before `execute` is invoked. So Flow's extra
  `withParsedArgs(schema, ...)` is a belt-and-suspenders wrapper that's not
  strictly needed, but doesn't hurt and gives Flow a consistent error JSON
  response shape.
- `tool.schema.enum([...])` and `.describe(...)` are recommended — helps the
  LLM pick the right value.

### Config injection (agents + commands)

Two patterns observed:

1. **Imperative mutation** (Flow-style and Conductor-style):
   ```ts
   config: async (_config) => {
     _config.command = { ..._config.command, "my:cmd": {...} };
   }
   ```
   Conductor (`derekbar90/opencode-conductor/src/index.ts`) does this exact
   shape, including `description` + `template` per command. It also injects
   live filesystem context (file tree, setup state) into the template string
   at plugin-init time. Flow's approach (pre-baked templates, cloned on each
   call) is cleaner — Conductor's runtime filesystem reads on plugin boot are
   an anti-pattern for long-lived plugins because config runs once.

2. **Config file merge** (micode-style): read a sidecar JSON
   (`~/.config/opencode/micode.json`) inside `config` hook to override
   per-agent model / temperature / thinking budget. Useful when users need
   per-install overrides without editing the plugin.

Agent shape Flow uses (`mode: "primary"`, `description`, `prompt`, optional
`permission`, `tools`) matches the schema the `Config` type accepts
(`config.agent?: Record<string, unknown>` in our code matches the SDK shape,
which is intentionally loose). There's no stricter public type currently — the
SDK `Config` type treats `agent` as an opaque record.

### Slash command templates + arg passing

From the docs (`/opencode docs/commands`, referenced by `subtask2`) and
observed plugins:
- `template` uses `$ARGUMENTS` as the literal argument placeholder.
- `subtask: true` frontmatter makes a command execute as a subagent task.
- Advanced extensions like `subtask2` add: `return`, `loop`, `parallel`,
  `{as:name}` / `$RESULT[name]`, `$TURN[n]`, inline `{model:...}` / `{agent:...}`
  overrides. These are superset features provided by their plugin, not core.
- Flow uses `description` + `agent` + `template`, which is exactly what core
  accepts.

### Custom agents (flow-planner, flow-reviewer, etc.)

Flow's `FlowAgentConfig` shape is correct. Read-only agents via
`permission` + `tools` maps is idiomatic — same pattern used by
oh-my-opencode and Conductor. The `mode: "primary"` value is canonical for
user-facing agents; `mode: "subagent"` is used for agents only the top-level
agent may call.

### Error surfaces

Flow returns JSON strings with `{ status, summary, ... }` per tool. That's
the de-facto pattern (opencode itself consumes `execute`'s return value
verbatim). Alternatives seen:
- Throwing (e.g. `throw new Error(...)` in the `.env` protection example) — the
  LLM will see the thrown error. Fine for fatal conditions.
- Returning plain strings. Idiomatic for simple tools.
- Returning JSON strings (Flow's approach) — best when the LLM must route on
  a machine-readable status. Conductor/micode both lean on string/Markdown;
  Flow is actually more structured than typical.
- **1.4.x additions**: tool execute results can now return `metadata` — that
  pairs nicely with `ToolContext.metadata({ title, metadata })`. Flow doesn't
  currently call `context.metadata(...)`, so structured rendering in the TUI
  (title + metadata) is unused.

## 3. Performance Idioms

- Plugin functions run once per server startup (and per project when
  multiple worktrees are open; changelog: "TUI plugins now load against the
  correct project when multiple directories are open"). So plugin-load work
  is amortized.
- **npm plugins** are `bun install`ed into `~/.cache/opencode/node_modules/`
  on startup (docs `Plugins > How plugins are installed`). Startup cost is
  only paid when a version changes. This favors npm distribution over
  hand-copied files.
- Comparable plugins (micode, oh-my-opencode) happily run dozens of tools and
  hooks with no noticeable latency from the plugin layer. Flow's 16 tools is
  unremarkable.
- Tool-call latency is dominated by `execute()` work + LLM round-trip; the
  plugin shim is cheap. The async `await` on every hook makes sequential hook
  execution (changelog: "all hooks run in sequence"). Keep hook work cheap.
- There is no documented "cache across sessions" hook. Options used by peers:
  - Use `ctx.project.id` + local FS (what Flow does, under the worktree).
  - Use `client.app.log()` for structured logs instead of console.
  - Use the new experimental session-compaction hook to persist context when
    opencode compacts, without your own invalidation logic.

## 4. Flow vs Comparable Peers

| Plugin | Compare | Architectural notes |
| --- | --- | --- |
| `derekbar90/opencode-conductor` | Similar protocol-driven lifecycle (Setup → Spec → Plan → Implement). Registers agents + slash commands via `config` only; no custom `tool` surface. | Ships prompts as JSON assets bundled via `"with { type: 'json' }"`. Embeds project FS snapshot into templates (cheap, but stale after session start). Semantic-release to npm, installs via `"plugin": ["opencode-conductor-plugin"]` in `opencode.json`. Has a Vitest suite for tools. |
| `vtemian/micode` | Brainstorm→Plan→Implement orchestrator with multi-agent flow (commander, planner, implementer, reviewer). Uses Zod (actually Valibot for config boundaries in the newest commits). Multiple hooks: context injection, auto-compact, think-mode, file-ops tracker. | Publishes to npm (`micode`), installed via `"plugin": ["micode"]`. Has robust quality gate (biome + eslint + typecheck + test). Reads a `micode.json` sidecar inside the `config` hook for per-agent overrides. Tracks plugin version bumps in lockstep. |
| `spoons-and-mirrors/subtask2` | Command-flow orchestrator — chain/loop/parallel subagents. Registers `/subtask` via `config`. Heavy use of `command.execute.before` and synthetic-message rewriting. | Published as `@openspoon/subtask2`. Shows idiomatic use of inline syntax in templates and post-execution response rewriting. Not a state-machine like Flow, but the closest peer for "taking strong ownership of the agent loop." |
| `code-yeongyu/oh-my-opencode` | Full suite (many sub-agents + tools, LSP/AST/MCP tools). | Huge surface; worth skimming for the "Claude Code compatible layer" approach. |

What Flow does **better** than these peers:
- Structured session state persisted under worktree with clear archive flow.
- Reviewer/validation loop baked into the state machine (most peers rely on
  prompts alone).
- Strong Zod schemas per tool with explicit `WorkerResultArgsShape` contracts.
- Separation of config-shared constants (read-only tools / permissions).

What Flow **omits** that these peers use:
- No `event` hook — could power session-idle hand-off or file-edit
  invalidation.
- No `tool.execute.after` / `tool.definition` hooks — Flow could use them to
  inject session context into built-in tools (like read/write) automatically.
- No `experimental.session.compacting` hook — Flow state would disappear on
  compaction unless the active session prompt replays it.
- No `client.app.log(...)` calls — all signals are emitted only as tool
  return JSON.
- No use of `ToolContext.metadata()` for structured TUI rendering.

## 5. Version Movement (1.3.10 → latest)

- As of 2026-04-18, `@opencode-ai/plugin@1.4.11` is published (9h ago per
  npm). Flow peerDep is `^1.3.10`, which admits 1.4.x under normal semver.
- Notable changelog items since 1.3.10 (selected from opencode.ai/changelog):
  - **Plugin tools can return `metadata` in execute results.** (@jquense)
  - **Plugins can register custom workspace adaptors** that appear in
    workspace creation.
  - **Theme-only plugin packages** now supported.
  - **Plugin install hardening**: pinned versions during install; install
    scripts blocked; plugins without matching server/TUI entrypoint are
    skipped with a warning; default options read from package exports.
  - **Entry-point resolution** fix for paths without leading dot (useful for
    our `~/.opencode/plugins/flow.js` shape).
  - **Plugin auth UX**: no longer asks for API key when the plugin has no
    `authorize` method; asks for API key when the plugin needs authorization.
  - **Experimental `compaction.autocontinue` hook** to stop auto-continue.
  - **Plugin installs preserve JSONC comments in configuration files.**
  - **Plugin installs from npm aliases and git URLs** fixed (incl. Windows
    cache paths).
  - **TUI fix**: plugin `replace` slots no longer mount twice.
  - **TUI plugins load against the correct project** when multiple
    directories are open.
  - **`Tool.define()` tools no longer wrap `execute` multiple times.**

None of these appear to be breaking for Flow. The `metadata` return for tool
executes is a pure-additive opportunity.

## 6. Distribution / Install

Official docs state the canonical locations:
- Project-level plugins: `.opencode/plugins/` (inside the repo)
- **Global plugins: `~/.config/opencode/plugins/`**
- npm plugins: listed in `opencode.json > plugin`.

Flow's current installer writes to `~/.opencode/plugins/flow.js`
(`src/installer.ts`, `OPENCODE_PLUGIN_DIRECTORIES = [[".opencode", "plugins"]]`).
This is **not** the documented global path. The docs don't mention
`~/.opencode/plugins/`. Historically opencode did accept `~/.opencode/` (the
old home config location), but the current documented path is
`~/.config/opencode/plugins/`. Git log on our plugin says "Align Flow
install/uninstall paths with ~/.opencode plugin resolution" so the author
opted for the legacy path intentionally.

The idiomatic modern approach (per docs + peers):
1. Publish to npm as `opencode-plugin-flow` (the `opencode-*` prefix is
   recommended in the plugin-dev gist).
2. Users add `"plugin": ["opencode-plugin-flow"]` to `~/.config/opencode/opencode.json`.
3. Opencode runs `bun install` into `~/.cache/opencode/node_modules/` on
   startup.

For local development the idiomatic path is `file:///path/to/dist/index.js`
in `plugin[]`, or dropping the built file into `~/.config/opencode/plugins/`
or `.opencode/plugins/` at repo root.

### Source pointers

- `node_modules/@opencode-ai/plugin/dist/index.d.ts` — full hook/type surface.
- `node_modules/@opencode-ai/plugin/dist/tool.d.ts` — `tool()` helper.
- https://opencode.ai/docs/plugins/ — canonical plugin guide (2026-04-11).
- https://opencode.ai/docs/custom-tools/ — canonical tool guide (2026-04-11).
- https://opencode.ai/changelog — rolling changelog (2026-04-10).
- https://github.com/awesome-opencode/awesome-opencode — 5.3k-star directory
  (last auto-regen 2026-03-21).
- https://github.com/sst/opencode → redirects/forks at
  https://github.com/anomalyco/opencode (owner moved).
- https://www.npmjs.com/package/@opencode-ai/plugin — 1.4.11 latest.
- Comparable peers:
  - https://github.com/derekbar90/opencode-conductor
  - https://github.com/vtemian/micode
  - https://github.com/spoons-and-mirrors/subtask2
  - https://github.com/code-yeongyu/oh-my-opencode
  - https://github.com/zenobi-us/opencode-plugin-template (archived)
- Dev guide gist (LLM-sourced, mostly accurate):
  https://gist.github.com/rstacruz/946d02757525c9a0f49b25e316fbe715.

## 7. Implications for `opencode-plugin-flow`

(Severity-tagged recommendations — see final summary in the task reply.)

- MUST: switch install target to `~/.config/opencode/plugins/flow.js` or
  better, publish to npm so users opt in via `"plugin": ["opencode-plugin-flow"]`.
- SHOULD: remove `withParsedArgs` double-parse, or keep it but document the
  error-contract guarantee it enforces.
- SHOULD: adopt `context.metadata({ title, metadata })` in selected tools so
  the TUI renders them meaningfully (status / feature name).
- SHOULD: consider `experimental.session.compacting` to inject Flow session
  summary into compaction so long runs keep planning state.
- NICE: add an `event` hook that watches `session.idle` / `file.edited` to
  auto-resync artifacts without relying on user commands.
- NICE: use `client.app.log(...)` for structured debug output instead of
  `console.log` when something needs to be visible to the user.
- NICE: ship an npm package (publish `opencode-plugin-flow`) and deprecate
  the local copy installer.
