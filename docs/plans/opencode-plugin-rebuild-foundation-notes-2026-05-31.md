# OpenCode Plugin Rebuild Foundation Notes — 2026-05-31

Scope: Work Items 1–3 from `docs/plans/opencode-plugin-rebuild-2026-05-31.md`.

## Baseline

- Work began on `main` tracking `origin/main`; no feature branch was created.
- Pre-edit worktree state had one untracked file: `docs/plans/opencode-plugin-rebuild-2026-05-31.md`.

## Frozen stability decisions

- Package/install stability is preserved: package name `opencode-plugin-flow`, main/export `dist/index.js`, and existing OpenCode install/uninstall surfaces are unchanged.
- Snapshot persistence remains the product path; no event-log/checkpoint/replay rewrite was introduced.
- The Flow Core facade and runtime transitions/session engine remain the state mutation boundary; adapter tools and hooks stay thin.
- SDK strictness is unchanged: `@opencode-ai/plugin` / `zod` versions and tool schema strictness policy were not modified.
- No runtime rewrite, package rename, experimental entrypoint, or experimental install path was introduced in this foundation slice.
