# Changelog

## [1.0.0] - 2026-04-18

### Added

- OpenCode tool metadata now emits structured titles and payloads for all 15 Flow tools to improve TUI rendering.
- The plugin now registers an `experimental.session.compacting` hook so long-running sessions preserve Flow context during compaction.
- Release packaging now includes a committed changelog and explicitly ships only the runtime bundle plus top-level license/readme artifacts.

### Changed

- Canonical install and release-script messaging now target `~/.config/opencode/plugins/flow.js`, while still honoring a pre-existing legacy install in `~/.opencode/plugins/flow.js`.
- Plugin-internal runtime logging now routes through `ctx.client.app.log(...)` instead of `console.*` in the hot path.
- Published package contents are restricted to `dist/`, `LICENSE`, `README.md`, and `CHANGELOG.md` (plus npm's auto-included `package.json`).

### Breaking

- This release bumps to `1.0.0` because the mission introduced breaking `.flow/` schema and session-format changes across the runtime and transition layers.
- OpenCode installs should now treat `~/.config/opencode/plugins/flow.js` as the canonical plugin path; legacy `~/.opencode/plugins/flow.js` remains migration-only compatibility behavior.
