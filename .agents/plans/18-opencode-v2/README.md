# Upgrade Flow to OpenCode v2

Deliver Flow 10.0.0 for OpenCode 2.1.4 and newer tested 2.x releases.
Remove OpenCode 1 support. Keep one implementation and Session v5.
Update the README, maintained documentation, and public wiki.
Publish through the existing qualified release workflow.

Implementation started on 2026-10-24 on `feat/opencode-v2`.
The committed R8 candidate passed local and packed checks, but its approved
real-account smoke failed after one completed status call without saving a plan.
Both authorized dispatches are consumed. Offline investigation confirmed lost
native terminal evidence and a Responses logical-completion cancellation case.
Evaluator diagnostics and the core request-lifetime correction are implemented.
The new exact package passes macOS/Linux packed smoke, recovery, picker, and
unwrapped Responses compatibility. Four test fixtures now model the pre-dispatch
read, and final macOS and Linux checks each pass 4,744 tests. Evaluator R2 and
core R9 reviews passed. Commit and pre-push gates remain.
The actual paid cause remains unresolved. No push or release occurred.
Current execution evidence is recorded in [execution.md](execution.md).
Research is recorded in [research.md](research.md). Decisions are recorded in
[decisions.tsv](decisions.tsv).
The stream correction is recorded in [stream lifetime](stream-lifetime.md).

## Read and execute the plan

Run this migration under the installed Poteto `figure-it-out` workflow.
Use its hypothesis, change, verify, and retain loop at each phase.
Check a box only when its named evidence exists.
Keep runtime unknowns marked unverified until the real host proves them.
Do not substitute compilation or permission-list inspection for execution proof.

Use one integration branch for phases 0 through 4. Intermediate host breakage
may exist there. Merge only the complete, verified v2 implementation, tooling,
and documentation. Do not add a temporary V1 adapter.
Use a second PR for qualification evidence after the candidate is frozen.
Keep source, evaluator, and package inputs fixed during that evidence PR.
Publish the wiki from its separate Git repository after the release is verified.

The parent owns integration, authoritative checks, PRs, and external writes.
Run the repository contribution preflight before commits and pushes.
Link every created PR to the T3 thread. Review before merging.
Use the repository release process rather than replacing it with a new publisher.

## Hold the scope

- [x] Set the Flow release to `10.0.0` and record the tested host baseline.
- [x] State the support contract as follows. "For OpenCode v2. Requires
  OpenCode 2.1.4. Later 2.x releases are supported after passing the compatibility
  check. OpenCode 1.x is unsupported."
- [x] Set the new plugin package range to `>=2.1.4 <3` if the chosen
  dependency arrangement passes isolated installation. Pin development and
  qualification packages to exact versions. Treat this range as install
  eligibility rather than proof of future compatibility. Do not infer host
  versions from SDK package versions.
- [x] Use the Promise API from `@opencode/plugin`. Do not introduce an
  application-wide Effect rewrite.
- [x] Preserve the application response shape, serial workflow, review rules,
  source-bound validation, and Session v5 persistence contract.
- [x] Require users to finish or explicitly close active sessions before
  upgrading. Do not promise cross-host continuation of an active session.
- [x] Record the requested immediate V1 removal as an explicit exception to
  the prior-announcement cadence in `docs/release-qualification.md`.
  Do not add a V1 bridge release to this migration.
- [x] Leave historical tags, qualification bundles, transcripts, and changelog
  entries intact. Historical evidence is not an active compatibility path.

## Phase 0. Prove the required v2 contracts

Complete this phase before committing to the adapter design.

- [ ] Record registry metadata and exact versions for `@opencode/cli`,
  `@opencode/plugin`, and `@opencode/client`. Recheck latest 2.x at execution
  start. Adopt a newer version only before candidate freeze and repeat probes.
- [ ] Capture the existing deterministic baseline with `bun run check` and
  the pinned V1 packed smoke. Save commands, SHA, and sanitized results.
- [ ] Launch the selected v2 host with temporary configuration, data, and
  cache directories. Leave the user's installed binary and configuration alone.
  Resolve the package's platform executable and assert its reported version.
  The isolated macOS version command already reports `opencode v2.1.4`.
  Repeat this check for the canonical Linux qualification launcher.
  Record the exact executable and argv that start a server and pass a health
  request. Do not assume V1's `serve` command still starts the required host.
- [ ] Build a disposable plugin probe that loads through `Plugin.define`,
  registers a command and tool, reads options, and unloads cleanly.
  Keep the probe and its sanitized receipt as rerunnable evidence.
  Keep disposable probe files outside the published package.
- [ ] Observe native session parentage and `session.location.directory`.
  Prove that a tool call's agent and session identity can be checked against
  server-owned facts. Do not confuse child-session parentage with assistant
  message parentage.
- [ ] Observe a real shell tool's ID, command, call ID, completed/error result,
  exit status, completeness flags, and full-output retrieval path.
  Exercise a nonzero command and output larger than the inline limit.
- [ ] Prove custom-tool permission enforcement for allowed and denied roles.
  Determine whether each Flow tool needs a declared permission or explicit
  `ctx.permission.assert` call. Inspected rule arrays alone do not pass.
- [ ] Prove prompt admission, duplicate admission, assistant execution identity,
  queued continuation, interruption, compaction, and event-stream shutdown.
  V2 prompt hooks can run more than once before one admission wins.
  Synthetic messages bypass that hook.
- [ ] Prove that a server-configured package loads its `./tui` entrypoint
  automatically. Exercise dialogs, commands, model discovery, preference
  writes, and cleanup against the same v2 server.
  Inspect its actual runtime imports in an isolated packed installation.
  Resolve Solid and OpenTUI imports through the public module graph.
  Choose a supported import path or declare the required compatible peer set
  from that proof. Declaration files and dialog signatures cannot settle it.
- [ ] Record the live-control method for the terminal. If none is available,
  leave TUI interaction proof blocked. HTTP or unit tests cannot replace it.
- [ ] Resolve each failed probe before phase 1. If v2 cannot expose trustworthy
  validation or continuation attribution, report the exact upstream limitation.
  Do not weaken Flow's guarantees or silently remove `/flow-auto`.

Exit with a contract map, probe source, host version, source SHA, and receipts.
Architecture exploration during execution compares native v2 attribution
choices against these receipts before selecting one. It does not compare
unverified assumptions or add a V1 compatibility design.

## Phase 1. Port server registration and lifecycle enforcement

Depends on phase 0. Keep host adapters in `src/platform/opencode/` and the
existing shared host configuration in `src/config-shared.ts`.
Keep domain and persistence code independent of the host API.

- [x] Define the boundary data shapes before logic. Use the released v2
  session, prompt, tool-result, and event types. Represent completed and failed
  tool observations with a discriminated union. Translate them once into the
  existing application inputs.
- [x] Replace the function entrypoint in `plugin-composition.ts` and `plugin.ts`
  with a stable `Plugin.define` ID and `setup(ctx)`.
- [x] Replace `sdk.ts` V1 exports with released v2 types. Remove active imports
  from `@opencode-ai/plugin`, its TUI package, and `@opencode-ai/sdk/v2`.
- [x] Replace the mutable config hook in `src/platform/opencode/config.ts` and
  host-facing `src/config-shared.ts` with agent, command, skill, and tool transforms as needed.
  Keep replayed transform callbacks synchronous and free of one-time effects.
- [x] Register tools through `ctx.tool.transform`. Generate JSON Schema from
  existing application schemas and parse inputs at the application boundary.
  Delete `schema-adapter.ts` and its old host-Zod bridge when callers move.
- [x] Return Flow responses inside the v2 result's content without changing
  `{status, summary, workflowData}`. Keep `flow_guidance` Markdown output.
  Recognize accepted mutations from application values before host serialization.
- [x] Port `tool-guard.ts` to verified v2 session identity and location.
  Preserve root-manager and reviewer-child restrictions, replay behavior,
  and duplicate-runtime rejection. Test both allowed and rejected execution.
- [x] Port validation capture to the observed v2 shell contract. Preserve exact
  command matching, call attribution, source binding, failure vetoes, fresh JUnit
  checks, and safe full-output reads. Unknown completeness stays ineligible.
- [ ] Port command handling and `auto-drive*.ts` to v2 prompt and execution
  events. Use accepted native identities and idempotent admission handling.
  Preserve stale-token rejection, approval authority, stop/cancel, one eligible
  automatic retry, reviewer return, and compaction recovery.
- [x] Abort subscriptions and release timers, validation captures, continuation,
  and leadership during unload. Handle stream failure without leaving an
  apparently active but unobserved coordinator.
- [x] Port reserved agent permissions to ordered v2 action/resource/effect rules.
  Preserve worker bans on shell, delegation, Flow mutations, `.flow`, and `.git`.
  Preserve the reviewer's read-only workspace, `flow_status` access, and sole
  authority to submit a new reviewer completion.
- [x] Update bundled guidance that instructs native tool usage. Verify actual
  tool IDs independently from permission action names.

Run focused schema, parentage, leadership, validation, command, continuation,
and compaction tests after their respective changes. Exercise the same contracts
against the real host. Finish with `bun run typecheck` and package import proof.
Do not advance on an inconclusive identity or output-completeness result.

## Phase 2. Port the model picker

Depends on phase 1. Keep the `./tui` package export.

- [x] Replace `src/tui.ts` with `Plugin.define` from `@opencode/plugin/tui`.
  Use `keymap.layer`, promise-based dialogs, location data, and `ui.toast.show`.
- [x] Replace old client calls and response assumptions using the released
  client declarations and live responses. Do not unwrap `.data` by convention.
- [x] Port `model-picker.ts` and preference configuration to native v2 fields.
  Keep preferences owned by the server when they govern server-side roles.
  Do not move shared planning and review settings into client-only `cli.json`.
- [x] Preserve project precedence, separate planning/review choices, reset to
  default, explicit picker variant clearing, and the user's coding model.
- [x] Recheck connected models, current preferences, location, and activity
  before save. Reject stale choices and preserve unrelated configuration.
- [ ] Prove search, unavailable selection, cancellation, save, reset, concurrent
  changes, busy-session refusal, reload, and unload in the actual terminal.
  Save screenshots or a recording with sanitized host receipts.

Run picker tests and inspect the packed package's real automatic TUI loading.
The operator reviews the picker screenshots and recording before merge.
Keep JSX out unless rendering requires it. Select dependency declarations from
the runtime import proof in phase 0, including any Solid or OpenTUI peers.

## Phase 3. Port evaluation tooling and CI

Start its independent client research after phase 0. Integrate after phases 1
and 2 so tests exercise the final plugin rather than a placeholder.

- [ ] Update `package.json`, build externals, declaration output, lockfile,
  architecture boundaries, package import assertions, and Dependabot pins.
  V2's default export is a definition object, not a function.
- [ ] Make the smoke and eval host launch the exact `@opencode/cli` version.
  Remove `opencode-ai@...` launch paths from active tooling.
  Avoid an unqualified `opencode` executable in canary execution.
- [ ] Port `evals/harness.ts`, `host-observation.ts`, metadata probes, reviewer
  runs, and active benchmark/recovery launchers to the v2 client and config.
  Verify session trees, model/variant identity, messages, tools, and errors.
- [ ] Port or explicitly retire the recovery evaluation plugins. Preserve
  paid-dispatch accounting when replacing their old hook or fetch assumptions.
  Do not rewrite stored historical captures to resemble v2 output.
- [ ] Port canary preparation, verification, and `canary-run.ts`. Use a valid
  local plugin directory or the packed package, not a V1 `flow.js` path.
  Bind execution to the selected host, package bytes, and prepared fixture.
- [ ] Add a prospective version-specific host policy for 10.0.0 and later
  v2-targeting Flow releases. Preserve the existing 9.x host pin and exact
  historical policy digests. Route canary host checks through the same
  version selection. Do not mutate `RELEASE_HOST_POLICY` globally.
  Add regression checks that retained 9.x evidence still verifies offline.
  Add a prospective release profile that keeps all 17 current release cases,
  including auto-continuation and delivery. Require two route providers unless
  the operator approves a documented exception. Keep historical policies stable.
- [ ] Generate the frozen sample and dispatch proposal from that profile.
  With unchanged thresholds and two providers, 17 cases imply 144 primary cells
  and 34 environmental reserves. Derive dispatch counts separately because
  scenario followups and probes can consume additional dispatches.
- [ ] Port release host permissions and model identity checks. Check recovery
  mode explicitly. Give the prospective version deliberate equivalents of
  `releaseReviewerModel`, `releaseHostPermissions`, and the recovery-key refusal.
  Preserve their historical 9.6.0 behavior and policy hashes.
- [ ] Retarget the weekly compatibility workflow to `@opencode/cli` latest 2.x.
  Keep it a non-blocking drift signal.
  Keep the exact pinned host as the reproducible blocking check.
  Record the resolved host version and fail if the major is not 2.
- [ ] Prove raw archive identity across candidate, qualification, canary, and
  publication. Reuse the existing sealed-artifact restoration helper for the
  new release if repacking changes raw bytes despite equal contents.
  Preserve both the tarball and unpacked-manifest digest checks.
- [ ] Preserve publication ref checks, release records, retry reconciliation,
  trusted publishing, and asset verification. Test any release workflow edit
  offline. Do not broaden historical recovery allowlists without a concrete need.
- [ ] Add checks that prevent active V1 SDK imports, V1 package launches, and
  V1 installation examples from returning. Scope exclusions to immutable
  historical evidence and explicit migration explanations.

Run `bun install --frozen-lockfile`, `bun run check`, `bun run replay`,
`bun run package:smoke`, `bun audit --audit-level=high`, and
`bun run smoke:live`. Run `actionlint` when workflows change.
The packed smoke must execute allowed and denied calls, not only list rules.
Keep model-free host checks separate from paid behavioral qualification.

## Phase 4. Update the public instructions and prepare the wiki

Finish this phase before freezing package bytes.

- [ ] Update `README.md`, `docs/index.md`, `docs/quickstart.md`, and
  `docs/troubleshooting.md` with the exact tested minimum and V1 removal.
- [ ] Verify the v2 installation command on the selected release before
  documenting it. Use `plugins` and object-form options in `opencode.json`.
  Name the verified installed executable in the instructions.
  Remove instructions to install Flow twice in `opencode.json` and `tui.json`.
  A server plugin with `./tui` loads its terminal entrypoint automatically.
- [ ] Show the optional `cli.json` path only for a client-only installation.
  Verify the package's actual local/remote behavior before recommending it.
- [ ] Document upgrade order, exact Flow version pins, restart, a clean-project
  verification, model preferences, and active-session closure before upgrade.
- [ ] Update `docs/development.md`, `docs/maintainer-contract.md`,
  `docs/automatic-continuation.md`, and `docs/release-qualification.md` for the
  observed APIs and new release profile. Update other maintained pages only
  when their contracts changed. Add a short hard-cutover ADR and changelog entry.
- [ ] Update documentation tests for native v2 configuration, current exports,
  exact installation pins, current command inventory, and resolvable links.
  Preserve behavioral checks rather than pinning new prose phrases.
- [ ] Prepare a separate clone of `flow-opencode.wiki.git` and record its base
  SHA. Review every Markdown page, including `_Sidebar.md` and `Home.md`.
  Replace stale product instructions with short current summaries and links to
  canonical repository docs. Preserve existing page URLs and useful history.
- [ ] Cover installation, configuration, architecture, commands, tools,
  validation/review, development, and release pages. Remove stale instructions
  for the deleted installer and source tree. Repair missing video links.
  Keep `docs/` authoritative instead of building another documentation system.
- [ ] Verify the staged wiki links against the final release docs. Keep the
  wiki diff reviewable locally until the matching release is public.

Run the documentation-contract test and the complete deterministic check.
Capture the clean-install terminal path for review. Merge the completed
implementation PR only after the code, tooling, and README agree.

## Phase 5. Freeze, qualify, and publish

Depends on all earlier gates. This is the usual full release process.
The patch and offline feature exceptions do not cover this host-major migration.

- [ ] Pass final main CI, deterministic checks, audit, and packed real-host smoke.
  Record the candidate source SHA, evaluator SHA, host version, and both archive
  digests. Finish all product, dependency, README, and changelog edits first.
- [ ] Present the exact paid-run proposal. Name purpose, models, provider routes,
  full dispatch limit, reserve policy, expiry, and separate canary authorization.
  Create a ledger only after those values are approved. Preserve it on retries.
  A general request to release does not approve a specific paid campaign budget.
- [ ] Check availability with `scripts/check-release-models.ts`. Freeze the
  complete profile and case order on the canonical Linux host.
- [ ] Run the authorized release matrix against the reviewed tarball and
  unpacked-manifest digests. Retain every attempt and failure.
  Do not combine partial campaigns or count aborted runs as scored results.
- [ ] Prepare a fresh exact-artifact canary with `bun run eval:canary -- prepare`.
  Run it through the maintained budgeted launcher. Record sanitized native
  manager/reviewer evidence and the installed package identity.
- [ ] Seal with `bun run qualify -- --campaign-dir <campaign> --canary
  evals/canary/10.0.0.json`. Reopen and regrade the complete bundle offline.
  Respect the seven-day campaign and 72-hour canary freshness limits.
- [ ] Open the evidence PR. Commit only qualification evidence and required
  archive descriptors without changing measured product or evaluator inputs.
  Review and merge it. Recheck exact packed identity and final main CI.
- [ ] Prepare the exact `v10.0.0` tag target and release notes for review.
  Apply the repository's approval rule immediately before the tag action
  that triggers npm and GitHub publication. Do not ask to publish an
  unprepared candidate.
- [ ] Use the existing release workflow. Verify the event, checkout, fetched
  tag, and remote main ref proofs. Retain the durable release record.
  Let the existing draft, npm, asset verification, and finalization sequence run.
- [ ] Verify npm version and integrity, GitHub notes and assets, and installation
  of `opencode-plugin-flow@10.0.0` into a clean v2 environment.
  Confirm one server instance, commands, tools, and automatic TUI loading.
- [ ] Publish the prepared wiki commit under the authorized wiki scope.
  Re-read the public pages and links. Record the wiki SHA and release URL.
  Do not report the wiki complete from a local diff alone.

The migration is done when Flow 10.0.0 is published from the verified artifact,
the clean v2 installation passes, current documentation agrees, and the public
wiki is current. No active V1 implementation remains. No v3 support is claimed.

## Preserve these verification scenarios

Use these scenarios across focused tests, model-free host checks, and the paid
canary. Record which layer proves each predicate.

1. Load the packed package with all current commands, tools, and reserved roles.
2. Create a plan without granting implementation authority.
3. Reject a Flow mutation from a worker or an unrelated child session.
4. Accept a verified reviewer's submission and preserve exact accepted replay.
5. Capture passing and failing canonical commands with current-source identity.
6. Reject missing completeness, truncated output, stale JUnit, and wrong location.
7. Continue two approved features once each and close with truthful delivery.
8. Preserve approval, stop/cancel, interruption, and compaction boundaries.
9. Fail safely on duplicate load, unload, stream failure, and stale continuation.
10. Save, cancel, and reset model choices through the actual terminal picker.

Record startup and continuation timing as diagnostics during live checks.
Set any numeric regression gate from an observed baseline before measurement.
Follow the benchmark checklist before making a measured performance claim.
This plan makes no speedup claim.

## Keep work independent

Blocking work is phase 0. Core server, identity, validation, and continuation
changes have one owner because they share lifecycle contracts.
TUI work can use a separate owner after the preference contract is fixed.
Eval tooling and documentation research can proceed independently after probes.
Give concurrent writers separate worktrees or explicit disjoint paths.
Serialize `package.json`, the lockfile, `config-shared.ts`, and final integration.
Use fresh independent review at the complete candidate SHA.

## Record risks and unresolved proof

The first blocker is v2 continuation attribution. V1 assistant parent IDs and
compaction markers cannot be assumed. The second is trustworthy shell output
and completeness. Both must pass phase 0 before release design settles.

TUI interaction, paid model behavior, and the port itself remain unverified.
Only an isolated CLI version command ran during planning. Plugin and server
behavior remain unverified. Ref MCP was absent from the live tool
catalog. Exa, official guides, registry metadata, released declarations, and
repository inspection supplied the current evidence.

Use Outcome-Oriented Execution to remove V1 in one delivery.
Use Foundational Thinking to prove host contracts before dependent changes.
Use Model the Domain to express host tool outcomes with typed variants.
Use Sequence Work into Verifiable Units to require each phase's evidence.
Use Prove It Works to require the packed host and published wiki checks.
Use Laziness Protocol to reuse the publisher and link the wiki to maintained docs.
Use Encode Lessons in Structure to prevent silent profile coverage loss and
misdirected compatibility checks.
