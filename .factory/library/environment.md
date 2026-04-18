# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (see `.factory/services.yaml`).

---

## Runtime

- **Bun** ≥ 1.3.5 required (build, test, bench, lint driver).
- **Node** ≥ 22 required for building bundles and smoke-loading `dist/index.js`.
- **No services** — the plugin is entirely local, synchronous, and file-based.

## Filesystem

- Sessions live under `<worktree>/.flow/` by convention. Tests and smoke scripts use `mkdtempSync` under the system temp dir; never target real `$HOME` directories.
- OpenCode plugin install targets: canonical `~/.config/opencode/plugins/flow.js` (post-mission), legacy `~/.opencode/plugins/flow.js` (backwards-compatible fallback). All install/uninstall tests use a temp HOME override — never write to the user's real home.

## External Services

None. No API keys, no network requests, no databases.

## Peer Dependencies

- `@opencode-ai/plugin` is a peer dependency. It must be externalized from the build (`--external @opencode-ai/plugin`, post-M5) and resolved by the OpenCode host at plugin load time. For smoke tests that load `dist/index.js` under plain Node, provide a mocked stub via `NODE_PATH` or `--experimental-vm-modules`.

## Dev Dependencies

- `@opencode-ai/plugin` (also listed under devDependencies for TS types during build/typecheck).
- `bun-types`, `typescript`, `knip` — baseline.
- `@biomejs/biome` — lint + format (added in M1).
- `mitata` — benchmark runner (added in M1).
- `semver` — version-bump validation in release assertions (add if not already present).

## Gotchas

- `@opencode-ai/plugin` ships `tool.schema` which IS Zod. Previous indirection via `SchemaApi` is removed in M3.
- The `tsconfig.json` uses `moduleResolution: "bundler"`, so bundle-first imports are idiomatic.
- `bun build` does NOT auto-externalize peer deps. You must add `--external <pkg>` explicitly. Missed in the pre-M5 build.
- Bun's `Date.now` is mockable via `mock.module()` but leaks across tests unless restored — prefer mocking `nowIso` at the boundary.
- Tests must not use machine-specific absolute repository paths; use worktree-relative paths (`import.meta.dir`, `process.cwd()`, or resolved fixtures) to keep checks portable across CI and developer machines.
