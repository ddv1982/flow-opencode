# Parallel orchestration

Use fan-out when Flow work is broad enough that independent workers can gather
evidence faster than one linear pass. The manager still owns the Flow session:
only the manager calls state-changing Flow tools, approves plans, completes
features, records reviews, or closes sessions.

Every parallel pass runs the same loop:

**orient → slice → manifest → fan out → account → verify → synthesize →
extend or stop.**

This file is the whole playbook; read it once and run the pass. Two companions
stay separate:

- `handoff-format.md` holds the worker response templates. The manager pastes
  the matching template verbatim into every worker prompt.
- `parallel-pass-example.md` walks one concrete end-to-end pass (synced with
  the `flow` skill; not bundled into commands).

## Choose a pass

| Situation | Flow pass | Output the manager may synthesize |
| --- | --- | --- |
| Repo shape is unclear before planning | Discovery pass | Requirements, decisions, targets, validation entries, or a review-first feature |
| A broad finding set needs refutation | Audit pass | Surviving findings with guards checked and gaps named |
| Changed files or risk lenses are too broad for one review pass | Review pass | One feature review packet or `finalReview` payload owned by the manager |
| Test strategy or route coverage is unclear | Validation pass | Candidate commands or authorized raw command evidence |
| A claim is single-source, surprising, high-stakes, or payload-bound | Verification pass | Per-claim keep, narrow, rewrite, or remove decisions |
| Multiple implementation paths are plausible | Candidate pass | Candidate patches inspected and validated by the manager before use |

Pass notes:

- **Discovery**: workers read specific modules, routes, docs, commands, or risk
  lenses; only evidenced claims become plan fields.
- **Audit**: workers actively look for guards, lifecycle resets, deployment
  constraints, and counterexamples before reporting a finding. A finding
  without refutation work stays advisory or becomes a follow-up question.
- **Review**: workers separate blocking findings from advisory notes; the
  manager resolves conflicts and returns one review payload.
- **Validation**: workers run only manager-authorized commands and report the
  exact command, status, and raw outcome summary.
- **Verification**: verifiers judge atomic claims against cited sources or
  commands; do not ask a verifier to redesign the work or review the whole
  feature.
- **Candidate**: only with explicit user authorization plus isolated worktrees
  or exact non-overlapping path ownership. Patches stay proposals until the
  manager inspects, merges or rejects, and validates.

## When to stay serial

- One file, command, or design question determines the next step.
- Slices would share the same contracts, fixtures, or edit targets.
- The manager can inspect the full scope faster than writing and checking
  worker prompts.
- The result would still need the same manual synthesis with no time saved.

Do not fan out to keep agents busy. Every worker should reduce a named
planning, validation, review, audit, or implementation uncertainty. A normal
first pass is two to five workers with independent slices; use more only when
the manifest stays countable and non-overlapping.

## Modes

When fanning out Flow work, select the matching hidden Flow agent by name. These
workers are injected by the plugin config; invoke the named worker when it is
available. Do not use generic subagents for Flow slices because Flow workers
carry the permission boundaries for each mode.

| Mode | Use agent | Worker output | Write access | Flow tools |
| --- | --- | --- | --- | --- |
| `evidence` | `flow-evidence-worker` | Coverage, facts, files inspected, confidence, gaps, suggested plan targets | No | `flow_status` only if needed |
| `review` | `flow-reviewer` | Coverage, candidate findings or review slice summary, confidence, gaps | No | `flow_status` only if needed |
| `validation` | `flow-validation-worker` | Command options or manager-authorized raw output, coverage, confidence, gaps | No code edits; commands only when explicitly allowed | `flow_status` only if needed |
| `audit` | `flow-audit-worker` | Refuted or surviving finding candidates, guards checked, confidence, gaps | No | `flow_status` only if needed |
| `verifier` | `flow-verifier-worker` | Per-claim verdicts against cited evidence or commands | No | `flow_status` only if needed |
| `candidate-implementation` | `flow-candidate-worker` | Candidate patch summary from an isolated worktree or exact path-owned slice | Only with explicit user authorization plus isolation or exact non-overlapping path ownership | No state-changing Flow tools |

Use worker-specific model routing where the installation can support it:
`OPENCODE_FLOW_READONLY_WORKER_MODEL` for evidence, validation, and audit
workers; `OPENCODE_FLOW_REVIEW_WORKER_MODEL` for reviewer and verifier workers;
`OPENCODE_FLOW_CANDIDATE_WORKER_MODEL` for candidate implementation workers; and
`OPENCODE_FLOW_WORKER_MODEL` as a fallback for all hidden Flow workers. Model IDs
are OpenCode installation-specific (`provider/model`), so leave these unset when
the configured provider is unknown. Spend stronger models where being wrong is
expensive; read-heavy discovery slices tolerate the cheapest configured option,
while verifier and review slices deserve the strongest.

## Permission contract

The plugin injects these hidden workers with the following permission values.
`Flow state tools` means the `flow_*` rule, while `Flow status` documents the
explicit `flow_status` exception.

| Worker | Edit | Bash | Task | Skill | Flow state tools | Flow status |
| --- | --- | --- | --- | --- | --- | --- |
| `flow-reviewer` | deny | deny | deny | deny | deny | allow |
| `flow-evidence-worker` | deny | deny | deny | deny | deny | allow |
| `flow-validation-worker` | deny | ask | deny | deny | deny | allow |
| `flow-audit-worker` | deny | ask | deny | deny | deny | allow |
| `flow-candidate-worker` | ask | ask | deny | deny | deny | allow |
| `flow-verifier-worker` | deny | ask | deny | deny | deny | allow |

Do not fan out parallel `flow_plan_save`, `flow_plan_approve`,
`flow_run_start`, `flow_feature_complete`, `flow_feature_reset`, or
`flow_session_close` calls. Runtime locking protects files, but Flow accepts only
one active feature result at a time.

Workers may read files, inspect docs, run authorized read-only commands, and
summarize evidence. Candidate implementation workers may edit only when the
manager assigned an isolated worktree or exact path ownership that does not
overlap sibling workers or manager edits. Workers must not edit `.flow/**`,
must not call state-changing Flow tools, and must not approve work, close
sessions, record Flow validation, or claim validation they did not run. A
worker may report raw validation output it actually ran; the manager decides
whether it is strong enough to record.

## Stage 1 — Orient (serial)

Call `flow_status` if a Flow session may already exist. Read enough files,
schemas, docs, tests, commands, or artifacts to identify real slices. Keep the
immediate blocker local: do not delegate the question that determines whether
fan-out is even valid.

## Stage 2 — Slice

Split along whichever axis keeps slices independent: modules or path sets,
route or endpoint groups, risk lenses, command surfaces, data ranges, or claim
sets. Each slice needs a one-line scope, expected coverage, and a defined
output the manager can check.

## Stage 3 — Manifest (the pre-fan-out coverage gate)

Before spawning, write a pass manifest: one row per slice, plus a totals check.

| # | Slice scope | Expected coverage | Mode | Verification tier |
| --- | --- | --- | --- | --- |
| 1 | `src/core/**` plus its tests | 14 files | `evidence` | accept locally |
| 2 | release contract: CI workflows, `package.json`, changelog | 6 files | `evidence` | verify once |

- Count the total work items when countable: files, modules, routes, commands,
  rows, findings, screenshots, or claims. Confirm slice counts add back to the
  total, with no overlaps, gaps, empty slices, or ambiguous shared contracts.
- If the scope cannot be counted, state the completeness rule instead, such as
  "all changed files plus callers" or "all public commands plus release docs."
- Assign each slice's verification tier now (see Stage 6). Deciding where a
  wrong claim is expensive belongs before handoffs arrive, not after.
- Fix the slice map centrally before spawning if the gate does not reconcile.

The manifest is also the accounting contract for the pass: N rows spawned means
N handoffs collected and checked in Stage 5 before anything is synthesized.

Write the manifest where it survives the pass: the conversation is enough for a
single bounded pass, but when a follow-up pass or a session resume is
plausible, persist it with the synthesis (Stage 7) so the accounting can be
reconstructed.

## Stage 4 — Fan out

Every worker prompt includes:

```text
Overall goal, context only: <goal>
Mode: evidence | review | validation | audit | verifier | candidate-implementation
Your exact slice: <paths, modules, command, claim ids, risk lens, or worktree>
Expected coverage: <count, paths, range, or complete question set>
Do: <bounded actions>
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from handoff-format.md>
```

Hidden workers cannot load skills or read `handoff-format.md` themselves. The
manager copies the matching handoff template into every worker prompt; a bare
filename reference is not enough. Workers also cannot read the conversation, so
prompts cite file paths — including any synthesis file from an earlier pass —
instead of restating chat history.

For research or current-doc slices, require source checks for versioned or
time-sensitive facts. For implementation candidates, remind workers that other
work may be active and that they must not revert unrelated changes.

Continue non-overlapping manager work while workers run.

## Stage 5 — Account

Check every manifest row off against a returned handoff before synthesis. A
worker that never returns, errors out, returns empty or unstructured output, or
reports `partial` or `blocked` is a hole in the pass, and synthesizing around it
silently drops a slice.

Worker failure ladder:

1. Re-spawn once with a narrower slice and a note about what the first attempt
   returned.
2. If it fails again, cover the slice directly in the manager session.
3. If it stays blocked, carry the slice into the synthesis explicitly as
   not-covered. Never present results as if coverage were complete.

## Stage 6 — Verify

`Status: success` only says the worker believes its slice is done. Accept a
handoff only after a cheap manager-side pass:

- `Status` is present and terminal: `success`, `partial`, or `blocked`; empty or
  unstructured output fails this check.
- Coverage matches the assigned slice, or skips are explicit.
- Important claims have concrete evidence and confidence tags.
- Cited paths, commands, screenshots, URLs, or metrics resolve.
- The evidence supports the claim, not just the topic.
- Findings stay inside the worker's slice.
- Headline counts can be recounted or traced.
- Contradictions between workers are either resolved or explicitly marked as
  contested.

Demote, drop, re-task, or verify claims that fail this pass.

### Verification tiers

One taxonomy decides how much verification a claim gets: the manifest assigns
a default tier per slice, and this stage applies it per claim. Use the cheapest
check that matches the risk:

- **Accept locally**: low-risk claims with direct evidence that the manager can
  cheaply inspect or recount.
- **Verify once** with `flow-verifier-worker`: single-source, surprising,
  inferred, low-confidence, citation-heavy, contested, or Flow-payload-bound
  claims, including any count, benchmark, command result, or pass/fail claim a
  Flow payload will rely on.
- **Verify strongly**: blocking or release-sensitive claims and claims that
  affect user data, security, persistence, permissions, public API behavior,
  release behavior, or data loss. Use independent verifier checks, manager-run
  commands, or direct artifact inspection strong enough to settle the claim.
- **Do not accept**: claims without concrete evidence, claims outside the
  assigned slice, claims contradicted by inspected artifacts, or claims where
  the cited evidence supports only the topic rather than the assertion.

Verifier prompts use stable claim ids, one atomic assertion per id, the cited
source or command for each id, and the exact acceptance question. Do not
include the generator's reasoning unless that reasoning is the thing being
verified, do not say which worker produced the claim, and do not ask a
verifier to redesign the work or review the whole feature.

## Stage 7 — Synthesize

Apply the manager synthesis barrier before presenting or recording anything:

- Preserve confidence: verified, single-sourced, inferred, and unresolved claims
  stay distinct when it matters.
- When workers disagree, inspect the cited artifact or rerun the cited command
  instead of arbitrating from summaries. Do not average conflicting claims.
- Run the strongest practical local check for the deliverable.
- Re-read critical files or docs that will be cited in the final decision.
- Move only distilled, evidence-backed claims forward; raw handoffs remain
  candidate evidence, not a plan, review, completion payload, or final answer.
- Record gaps honestly instead of converting missing evidence into success
  language.

Where accepted evidence goes:

- Planning evidence becomes `requirements`, `decisions`, feature `targets`,
  feature `validation`, or plan notes — only when the source and scope are
  clear. Unverified broad findings become a review-first feature, not a fix
  plan.
- Validation evidence may become `validationRun` only when the worker was
  explicitly authorized to run the command and reported the exact command,
  status, and raw outcome summary.
- Review evidence informs `featureReviewDepth` plus `featureReview`, or `finalReview`, but the manager
  owns the pass/fail verdict and must resolve blockers, contradictions, and
  coverage gaps before returning the payload.
- Audit evidence becomes findings only after refutation; blocking findings need
  guards checked, deployment context, and evidence that the current code
  exhibits the behavior.
- Candidate patches are not Flow evidence until the manager inspects, merges or
  rejects them, and validates the main Flow-managed workspace.

Persist the manifest and the synthesis when another pass may follow or the
session is long enough to be compacted or resumed: write the distilled result —
the accounted manifest, accepted claims with evidence and confidence, dropped
claims with one-line reasons, and open gaps — into plan prose fields or a
manager-owned scratch file outside both `.flow/**` and the repository worktree,
such as a file in the OS temporary directory. The runtime owns the `.flow/**`
layout, and scratch files left in the worktree end up staged or reviewed as if
they were project changes. Follow-up worker prompts cite that path; files are
the only shared memory between passes.

## Stage 8 — Extend or stop

Stop after a pass when:

- the manifest's coverage rule is satisfied and every row is accounted for.
- accepted claims are evidenced, scoped, and confidence-labeled.
- material single-source, contested, high-stakes, or payload-bound claims have
  been verified or downgraded.
- remaining gaps are explicit and do not block the Flow artifact being produced.

Start a bounded follow-up pass only when:

- the original slice map missed material scope.
- workers disagree on a claim that affects the Flow decision.
- a high-stakes or payload-bound claim needs verification.
- a first pass exposes a narrower implementation or validation slice worth
  isolating.

Run at most one routine follow-up pass. Extra passes need an explicit manager
reason, such as a high-stakes verifier check or a newly discovered bounded
slice. Do not recurse by default: if a worker says it needs another worker, the
manager decides whether that is a follow-up pass and writes the next bounded
prompt, starting again from the manifest.
