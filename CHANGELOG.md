# Changelog

One short entry per release, written for users deciding whether to upgrade.

## [4.2.1] - 2026-07-05

Skill routing and boundary clarity across the managed skill set:

- Frontmatter descriptions now route single-phase asks cleanly: `flow`
  defers plan-only work to `flow-plan` and single-feature execution to
  `flow-run`, `flow-test` no longer claims every testing intent,
  `flow-deslop` leaves review verdicts to `flow-review`, and
  `flow-ui-quality` hands browser-run mechanics to `flow-test`.
- `flow-deslop` and `flow-ui-quality` now state explicitly that they are
  helper skills: they contribute evidence only, and the manager owns every
  state-changing `flow_*` call.
- The `flow` skill gained a routing note covering plan-only, single-feature,
  and status-only asks, and `flow-review` names its manager context
  accurately (the `flow`/`flow-run` skills or a bundled public Flow command).
- The repo-local contribution preflight now states its output is commit/push
  readiness evidence only and never substitutes for Flow validation or
  review evidence.
- README lists all four managed non-command helper skills.

## [4.2.0] - 2026-07-01

Safety and usability overhaul across the runtime, packaging, skills, and docs:

- Uninstall no longer deletes managed skill folders that contain your own
  files or have a damaged version marker; `uninstall --dry-run` previews
  removals.
- Crashed sessions recover: stale session locks expire automatically and the
  lock timeout error names the manual fix; corrupt or older-version
  `session.json` files are quarantined into `.flow/history/` with recovery
  guidance instead of failing every tool with a raw validation dump.
- Fixed a batch of small correctness bugs: `$`-sequences in goals no longer
  get mangled, attachments to Flow commands are preserved, failed plan saves
  no longer discard the previous session, replacing a draft plan archives it,
  and `needs_input` no longer reports a stale prior error.
- OpenCode compatibility: the peer dependency is now a range
  (`>=1.17.3 <2`) so newer OpenCode versions install cleanly; a live smoke
  test boots a real OpenCode server against the packed tarball in CI; CI runs
  on macOS and Node 20/22/24; published bundles are no longer minified and
  ship sourcemaps.
- Skills: repo-specific content removed from distributed skills, duplicated
  orchestration rules consolidated (smaller command prompts), the read-only
  reviewer no longer receives instructions it cannot execute, and managers
  are told to paste handoff templates into worker prompts.
- New opt-in `FLOW_EXPERIMENTAL_COMPACTION=1` injects the active session
  summary into OpenCode session compaction; the default stays hook-free.
- README rewritten around a quick start; install/repair depth moved to
  `docs/troubleshooting.md`.

## [4.1.18] - 2026-07-01

Review-skill guidance: keep the audit rubric bundled with `/flow-review`,
restrict commit preflight to the staged boundary, and make long reference
docs easier to navigate.

## [4.1.17] - 2026-06-28

Parallel-pass guidance: verify worker handoffs before use, prune retired
managed skill files during sync, and state explicitly that only the manager
synthesizes worker output.

## [4.1.16] - 2026-06-22

Quote skill frontmatter values so GitHub renders SKILL.md previews correctly;
CI now guards against future YAML frontmatter regressions.

## [4.1.15] - 2026-06-22

Add a condensed "quick path" to the orchestration guidance, bundle a worked
parallel-pass example, test that skill doc links resolve, and document the
trusted-publishing release process.

## [4.1.14] - 2026-06-22

Publish through npm trusted publishing (GitHub Actions OIDC) so releases no
longer depend on expiring npm tokens.

## [4.1.13] - 2026-06-21

Walk a full parallel pass in the orchestration guidance and pin hidden worker
permissions to a tested documentation table.

## [4.1.12] - 2026-06-18

Harden hidden worker prompts, add scriptable `doctor --check`/`--strict`
modes, type the package smoke test, and tighten session edge-case contracts
without changing the v4 runtime surface.

## [4.1.11] - 2026-06-17

Give bundled Flow commands a real title seed so OpenCode can name new chats,
while keeping the heavy command instructions out of the visible prompt.

## [4.1.10] - 2026-06-17

Move ambient Flow session context onto stable OpenCode `config.instructions`;
experimental chat hooks no longer shape default runtime context.

## [4.1.9] - 2026-06-17

Make public Flow commands fully self-contained so stale native skill
discovery cannot block the required loop.

## [4.1.8] - 2026-06-17

Command preflight now replaces stale resolved Flow command bodies with
current bundled instructions; review instructions are bundled where skill
discovery can lag.

## [4.1.7] - 2026-06-17

Sharpen the flow-test and flow-commit skills' triggers, and require explicit
maintainer intent before any `.flow/**` artifacts are committed.

## [4.1.6] - 2026-06-16

Recommend `--force` in the pinned installer command so OpenCode replaces
older global plugin entries instead of leaving stale versions behind.

## [4.1.5] - 2026-06-16

Adopt OpenCode's native plugin installer as the primary install path, with a
pre-start skill sync and a manual-config fallback for older versions.

## [4.1.4] - 2026-06-16

Make skill loading restart-aware across every command, add manual sync
repair, and treat missing optional helper skills as explicit coverage gaps.

## [4.1.3] - 2026-06-16

Align final-review language between skills and runtime, broaden gate test
coverage, add CLI smoke tests, and route command preflight through skill
awareness.

## [4.1.2] - 2026-06-15

Surface skill-registry lag with restart-aware setup warnings, add the
`doctor` command, and bundle a review fallback for stale OpenCode startups.

## [4.1.1] - 2026-06-15

Keep local session state out of Git by default with a generated
`.flow/.gitignore`, while preserving opt-in versioning for teams that
intentionally archive session evidence.

## [4.1.0] - 2026-06-15

Add Flow-native orchestration handoffs, verification gates, and a hidden
verifier worker, inspired by Ray Fernando's parallel agent workflow skill
work and RepoPrompt CE's context-engineering approach. Public runtime surface
unchanged.

## [4.0.1] - 2026-06-15

Fan out through named evidence, validation, audit, review, and candidate
workers while keeping runtime state changes manager-owned.

## [4.0.0] - 2026-06-14

Breaking overhaul: Flow is now a skills-first plugin with a minimal v4
runtime ledger, seven tools, one active `.flow/session.json`, archived
history, review evidence embedded in completion, and no context-pack or
separate review-decision framework.
