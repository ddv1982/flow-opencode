# Changelog

One short line per release. For the full rationale behind each entry — the constraints,
the rejected alternatives, and the validation that was run — see
[`docs/decisions/decision-log.md`](docs/decisions/decision-log.md).

## [Unreleased]

## [3.3.19] - 2026-06-14

Ship deslop and UI-quality skills so cleanup and frontend work get evidence-backed rubrics without adding commands, tools, agents, or runtime state.

## [3.3.18] - 2026-06-14

Split the context-pack, markdown render, and distribution sync hotspots into smaller owner-named modules while preserving the public package, runtime, and workflow surfaces.

## [3.3.17] - 2026-06-14

Teach every Flow skill to use one shared read-only parallel orchestration protocol, bundle the shared references, and lock recovery-code documentation to the runtime matrix.

## [3.3.16] - 2026-06-14

Serialize Flow tool mutations through a session transaction so concurrent planning and execution updates compose instead of racing stale reads or stale docs.

## [3.3.15] - 2026-06-14

Clarify derived signal authority so readiness blockers stay operational, context quality stays advisory, and context packs carry the same handoff contract.

## [3.3.14] - 2026-06-14

Delete stale architecture/test/docs scaffolding that only protected retired prompt/audit history or implementation-shape assertions, with no runtime or public surface change.

## [3.3.13] - 2026-06-14

Remove v2 session-resume compatibility, tighten retired-key payload parsing, shrink the current maintainer contract, and drop empty `core`/`workflow` owners from seam enforcement.

## [3.3.12] - 2026-06-14

Fix-forward the hosted release by making the empty `src/core` guard pass on clean checkouts where Git does not materialize empty directories.

## [3.3.11] - 2026-06-14

Trim-down pass: fix the dead workspace-root guard branch and mark the trusted-roots flag as advisory; remove the self-referential semantic-invariant registries (keeping the behavioral tests); shrink the strict-object JSON scanner to JSON.parse plus a focused duplicate-key check; and right-size the docs (changelog split into a lean log plus a decision journal, release notes consolidated, single-author framing).

## [3.3.10] - 2026-06-14

Teach planning and review to fan out read-only discovery to host subagents while Flow execution stays one feature at a time.

## [3.3.9] - 2026-06-14

Add `flow_context`, a read-only eighth tool that inspects the active session's context pack without mutating `.flow/**`.

## [3.3.8] - 2026-06-14

Derive `workflowReadiness` and `contextTraceability` so status answers whether a session is ready to move and flags scope drift.

## [3.3.7] - 2026-06-14

Render the planned context as a derived `docs/context.md` pack and surface advisory context diagnostics in `/flow-status`.

## [3.3.6] - 2026-06-14

Add maintainer affordances: contribution preflight, an architecture-metrics report, and release-candidate smoke evidence.

## [3.3.5] - 2026-06-13

Broaden the architecture seam guardrail to enforce the living source-ownership map and run it in `bun run check`.

## [3.3.4] - 2026-06-13

Prune the pre-v3 doc maze; promote durable lessons into ADR 0001, the skill review checklist, and the maintainer contract.

## [3.3.3] - 2026-06-13

Split the runtime action hotspot by responsibility while keeping `actions.ts` as a stable compatibility facade.

## [3.3.2] - 2026-06-13

Make the public docs match the real completion contract: validation evidence, `validationScope`, `featureReview`, and final `finalReview`.

## [3.3.1] - 2026-06-13

Route tool-surface logging through the same safe `createFlowLog` wrapper as plugin startup.

## [3.3.0] - 2026-06-13

Add an audit rubric and adversarial findings review so blocking audit findings must survive refutation before shipping.

## [3.2.2] - 2026-06-13

Critical fix: plugin no longer crashes on load against the generated OpenCode SDK client (unbound `app.log`).

## [3.2.1] - 2026-06-13

Make a missing `flow_*` backend an explicit stop-and-tell-the-user condition in the skills instead of a silent downgrade.

## [3.2.0] - 2026-06-13

Surface stale installs: a passive update notice, the running version in `/flow-status`, and documented update steps.

## [3.1.0] - 2026-06-12

Trim to the v3 surface: five commands and seven tools, with the v2 tool-name redirect stubs removed.

## [3.0.1] - 2026-06-12

Sync slash commands and the `flow-reviewer` agent as real discoverable files, not just config-hook injections.

## [3.0.0] - 2026-06-12

The skills-first inversion: hand-authored skills carry the workflow and the plugin shrinks to a safe state backend (18 tools to 7).

## [2.1.0] - 2026-06-12

Move distribution to npm, adopt the Promise-based permission API, and land Phase 1 of the skills-first overhaul.

---

Releases before 2.1.0 are recorded in [`docs/decisions/decision-log.md`](docs/decisions/decision-log.md).
