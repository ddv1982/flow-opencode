# Flow Maintainer Risk Checklist

Use this as a compact merge-time risk pointer. It is intentionally **not** canonical.

Canonical current-facing maps:

- `docs/maintainer-contract.md` owns commands, tools, state paths, hard invariants, frozen surfaces, and the compact "if you touch X, run Y" map.
- `docs/contributor-map.md` maps risk by area: read-first files, required checks, and "do not" rules.
- `docs/release-process.md` owns the repeatable release-candidate smoke path and manual live OpenCode evidence protocol.

If this checklist conflicts with any canonical file above, update this checklist or delete the duplicate guidance. Do not treat this file as a second source of truth.

## Merge-time risk check

1. Identify the touched surface in `docs/maintainer-contract.md`.
2. Read the matching risk area in `docs/contributor-map.md` before editing.
3. Run the narrow checks listed for that area before broad checks.
4. Run `bun run check` before release, cross-surface merges, or persistence-affecting changes.
5. Record the risk/alternative in Lore release notes or commit trailers when behavior, contracts, or public surfaces change.

## Current-facing docs hygiene

- Keep detailed command, tool, state-path, gate, and invariant guidance in the canonical docs above.
- Keep completion-gate wording aligned with `src/runtime/domain/semantic-invariants.ts`; canonical docs must mention validation evidence, validation scope, `featureReview`, final `finalReview`, strict reviewer decisions, and unfinished-feature close blocking.
- Do not duplicate boundary-hotspot tables here; point readers back to the canonical maps.
- Keep historical evidence (`CHANGELOG.md`, `docs/decisions/decision-log.md`, and `docs/releases/README.md`) labeled as historical unless evidence is freshly re-run and promoted to current guidance.

## Quick docs checks

- Follow the "If you touch X, run Y" map in `docs/maintainer-contract.md` for the touched area.
- Keep current-facing docs aligned with `docs/maintainer-contract.md`; release history stays historical.
