# Flow Maintainer Risk Checklist

Use this as a merge-time checklist for risky changes. It is intentionally not the canonical contract.

Canonical current-facing maps:

- `docs/maintainer-contract.md` owns commands, tools, state paths, invariants, the surface-expansion freeze, and the compact "if you touch X, run Y" map.
- `docs/contributor-map.md` owns contributor onboarding risk by area: read-first files, required checks, and "do not" rules.

If this checklist conflicts with either file, update this checklist or delete the duplicate guidance. Do not treat this file as a second source of truth.

## Before changing a high-risk area

1. Identify the touched area in `docs/maintainer-contract.md`.
2. Read the matching section in `docs/contributor-map.md` before editing.
3. Run the narrow checks listed there before broad checks.
4. Run `bun run check` before release, cross-surface merges, or persistence-affecting changes.
5. Record the risk/alternative in Lore release notes or commit trailers when behavior, contracts, or public surfaces change.

## Surface expansion freeze

New commands, tools, prompt contracts, state paths, and runtime modes are frozen by default.

Only add one when the change records an explicit retirement or replacement tradeoff in the release/commit lore. If there is no retirement/replacement story, treat the change as scope expansion and defer it.

## Compatibility hotspots

These areas require extra caution because they affect external or cross-surface contracts:

| Area | Canonical map |
| --- | --- |
| `zod`, `@opencode-ai/plugin`, or tool argument compatibility | `docs/maintainer-contract.md` dependency/tool rows; `docs/contributor-map.md` runtime schema and tool schema sections |
| Completion, final review, or recovery transitions | `docs/maintainer-contract.md` completion/runtime rows; `docs/contributor-map.md` runtime transitions section |
| Prompt text, command templates, or mode contracts | `docs/maintainer-contract.md` prompt rows; `docs/contributor-map.md` prompts section |
| Session paths, persistence, history, or workspace-root handling | `docs/maintainer-contract.md` state path rows; `docs/contributor-map.md` session persistence section |
| Install/uninstall, package contents, or release scripts | `docs/maintainer-contract.md` release/package row; `docs/contributor-map.md` config/install/release section |
| Performance-sensitive save/render/schema paths | `docs/maintainer-contract.md` performance row; `docs/contributor-map.md` performance section |

## Historical evidence docs hygiene

`docs/releases/**`, `docs/investigations/**`, generated `release-notes.md`, and `CHANGELOG.md` are historical evidence unless explicitly refreshed.

When touching historical or evidence-heavy docs:

- keep old values labeled as historical snapshots with capture date/context, or re-run the evidence and update it as current
- do not make old file names, deleted artifacts, or retired plans look like active contracts
- confirm `package.json` before presenting version-specific statements as current facts

Quick checks:

- `bun test tests/docs-stale-reference-policy.test.ts tests/docs-semantic-parity.test.ts`
- `bun test tests/docs-tool-parity.test.ts` when command/tool docs change

## Full release gate

Before merging any cross-surface or persistence-affecting change:

- `bun run check`
