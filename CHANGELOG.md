# Changelog

One short entry per release, written for users deciding whether to upgrade.

## [4.3.7] - 2026-07-08

Package-smoke patience lore keeps the 4.3.6 release path portable across slower
macOS Node 24 runners:

- The package smoke test now has an explicit timeout large enough for the packed
  consumer declaration check to finish on CI, avoiding a runner-speed-only
  failure after the Release workflow already passed.

## [4.3.6] - 2026-07-08

Phase-continuity lore removes the rough stop after three completed features and
adds sharper handoffs around long Flow sessions:

- Completed feature counts are now telemetry only; approved plans keep moving to
  the next runnable feature instead of requiring a fresh session after three
  completions.
- `flow_status` now includes a human-readable progress line, `nextFeature`,
  `pendingFeatures`, and remaining feature count so resumed sessions name the
  exact next slice.
- Hidden worker prompts now fail closed on empty or unstructured handoffs, and
  worker model routing can be configured with `OPENCODE_FLOW_*_WORKER_MODEL`
  environment variables.
- Release publishing now has `bun run release:monitor`, which watches the
  release commit's CI and tag-triggered Release workflow before declaring the
  release healthy.

## [4.3.5] - 2026-07-08

Flow now stops long autonomous loops more deliberately without making reviews
shallower:

- Runtime budget telemetry records completed features since the last phase
  boundary, feature/final review counts, failed review counts, per-feature
  retry attempts, and host token telemetry availability.
- Failed feature and final reviews now pause by default, allow only one
  autonomous repair plus one retry, then block the feature with a compact
  resume packet instead of continuing to edit in the same root session.
- Feature completion now records `featureReviewDepth` and rejects evidence that
  is shallower than the approved feature requires.
- Large sessions now checkpoint after three completed features and require an
  explicit `phaseBoundaryAck` in a fresh phase before the next feature starts.
- Flow planning, running, review, README, maintainer docs, and wiki pages now
  describe scoped review packets, risk-based review depth, retry limits, and
  phase-boundary handoffs.

## [4.3.4] - 2026-07-07

Planning and final-review lore sharpened without changing the runtime surface:

- `flow-plan` now has a pre-approval quality gate that checks outcome,
  requirements, decisions, uncertainty, feature shape, bounded targets,
  validation levels, dependencies, and review policy before a plan is saved or
  approved.
- Planning examples now cover bugfix, UI/frontend, runtime/schema, docs-only,
  audit-first, and stronger validation patterns, giving agents better few-shot
  guidance for common Flow sessions.
- Final review now includes a convergence scan that traces the original goal,
  approved requirements, every planned feature, changed artifacts, and
  validation evidence before returning a passing `finalReview`.
- The new planning checklist is shipped through synced skills and bundled
  `/flow-plan` and `/flow-auto` command instructions, so fresh and stale skill
  discovery paths get the same guidance.

## [4.3.3] - 2026-07-07

Verification only — no behavior change:

- The live OpenCode smoke test now proves the hidden read-only workers'
  isolation actually binds at runtime: against a real server it asserts each
  worker's resolved permission rules deny the state-changing `flow_*` tools,
  `task`, `skill`, and `edit`, while keeping `flow_status` readable. This
  confirms OpenCode compiles Flow's tool-name and wildcard permission keys
  (which are absent from the SDK's simplified permission type) rather than
  silently dropping them, closing the one unverified question from the 4.3.2
  review.

## [4.3.2] - 2026-07-07

Correctness and safety hardening from a full-project review, repairing two
edges introduced in 4.3.1 and several older ones:

- Uninstall no longer deletes a user file that merely resembles a backup name:
  a file counts as removable Flow residue only when its name and its content
  checksum both match Flow's backup format. Doctor applies the same check.
- Sync no longer overwrites a user-owned skill folder that has files at managed
  paths but no `SKILL.md` — any managed folder without a Flow marker is left
  untouched, not clobbered without a backup.
- An empty `HOME` no longer makes the skills root a current-directory-relative
  path (which sync wrote into and uninstall removed); it falls back to the OS
  home. `engines` now requires Node `>=20.12` (doctor/uninstall rely on it).
- The CLI no longer aborts on a stray `flow-*` file in the skills root, and a
  CRLF-converted skill marker is no longer misreported as outdated.
- Session locks recover from more failure modes: a far-future or foreign-host
  lock timestamp and a recycled process id are now reclaimable instead of
  wedging every Flow call, and stale-lock reclamation no longer races two
  waiters into holding the lock at once.
- `flow_status` re-checks the session under the lock before quarantining, so a
  session written by a concurrent process can't be quarantined by mistake; a
  session file with an archive-unsafe id now routes to quarantine recovery
  instead of wedging every archive; and its output is framed as data to blunt
  instruction-injection from a cloned repo's session file.
- A user command named like an object built-in (e.g. `/toString`) no longer
  crashes command preflight, and a Flow command invoked with an attachment now
  keeps its worker isolated instead of double-running the instructions.
- Session history is bounded so long autonomous loops cannot grow the session
  file without limit. Docs corrected to match the current uninstall/doctor
  behavior.

## [4.3.1] - 2026-07-06

Doctor and uninstall now account for the `.backup` files Flow writes when it
retires a locally-edited managed skill file:

- `doctor` reports leftover `.backup` files as action-required instead of
  saying "ok", lists each one, and explains that they hold your earlier edits
  and can be deleted once you no longer need the saved copy.
- `uninstall` treats a folder that is pristine apart from Flow-created
  `.backup` residue as removable and names the removed backup files, so the
  cleanup is no longer silently blocked or silently destructive.

## [4.3.0] - 2026-07-06

Parallel orchestration reworked into a single pass playbook, plus sharper
planning and routing:

- The parallel-orchestration references collapse into one playbook with an
  explicit loop — orient, slice, manifest, fan out, account, verify,
  synthesize, extend or stop — so a manager reads one file instead of four
  cross-linked ones. Every bundled public Flow command got smaller as a result.
- A new pass manifest doubles as the pre-fan-out coverage gate and the
  accounting contract: one row per slice with its scope, expected coverage, and
  verification tier, and N rows spawned means N handoffs accounted for before
  synthesis.
- A worker-failure ladder handles a slice that errors, blocks, or returns
  partial: re-spawn once narrower, cover it directly, or carry it into the
  synthesis explicitly as not-covered — never as if coverage were complete.
- `flow-plan` gains uncertainty-typed decomposition: resolve specification
  uncertainty by stating an assumption (or asking when a wrong guess is costly)
  and environment uncertainty by inspecting, never by asking.
- Frontmatter descriptions for `flow-plan`, `flow-run`, and `flow-review` now
  describe only when to reach for each skill, so single-phase asks route
  cleanly.

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
