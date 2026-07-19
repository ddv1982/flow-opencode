# Parallel pass synthesis

Read this when worker handoffs return. Account for every manifest row, verify
material claims, and let only the root manager synthesize or mutate Flow state.

## Account for handoffs

Check each manifest row before synthesis. A missing, errored, empty,
unstructured, malformed, `partial`, or `blocked` response is a coverage gap.
For each row record:

- `handoffRefs`: worker ids or reopenable artifact locations.
- `verificationStatus`: `not-needed`, `pending`, `passed`, `failed`, `mixed`,
  or `downgraded`.
- `outcome`: `accepted`, `modified`, `rejected`, `partial`, `not-covered`, or
  `superseded`.
- `synthesisRef`: the manager-owned result that carries accepted work forward.

Serial and skipped decision rows have no handoff, but still require an id,
decision, reason, verification status, and outcome.

Worker failure ladder:

1. Retry once with a narrower slice and the first attempt's concrete gap.
2. Cover the slice directly in manager context if the retry fails.
3. Carry a persistent blocker into synthesis as `not-covered`.

Never present incomplete coverage as a complete pass.

## Accept and verify

Treat worker `Status: success` as a claim, not proof. Accept a handoff only when:

- status is exactly `success`, `partial`, or `blocked` and every required
  section is non-empty;
- coverage matches the assigned slice or names every omission;
- important claims have concrete evidence and confidence;
- paths, commands, screenshots, URLs, counts, and metrics resolve;
- evidence supports the assertion rather than merely its topic;
- findings stay inside the assigned slice;
- dependency claims cite a verified upstream handoff or synthesis;
- candidate work identifies exact-path or isolated-worktree ownership and the
  manager's patch inspection result;
- contradictions are settled from source evidence or marked contested.

Demote, drop, retry, or independently verify claims that fail these checks.

### Verification tiers

Assign the cheapest tier that matches the consequence of error:

- **Accept locally**: direct, low-risk evidence the manager can cheaply inspect
  or recount.
- **Verify once**: use `flow-verifier-worker` for surprising, inferred,
  low-confidence, citation-heavy, contested, single-source, or
  Flow-payload-bound claims, including counts and command results.
- **Verify strongly**: independently inspect or rerun evidence for blocking,
  release-sensitive, data-loss, security, persistence, permissions, or public
  API claims.
- **Do not accept**: unsupported, out-of-scope, contradicted, or topic-only
  evidence.

Verifier prompts use stable ids, one atomic assertion and cited source or
command per id, and one exact acceptance question. Do not reveal the generating
worker or ask the verifier to redesign the work.

## Synthesize

Before presenting or recording a result:

- Preserve meaningful distinctions between verified, single-source, inferred,
  and unresolved claims.
- Resolve worker conflicts from the cited artifact or command; never average
  contradictory summaries.
- Run the strongest practical local check for the deliverable.
- For medium- or high-risk broad implementation, use one verifier after manager
  synthesis to check planned coverage, worker validation claims, changed code,
  generated artifacts, and plausible test coverage.
- Re-read critical sources that support the final decision.
- Move only distilled evidence forward and name remaining gaps honestly.

Planning evidence may become requirements, decisions, targets, validation, or a
review-first feature. Authorized command evidence may become `validations`
only with exact command, status, and observed result. Review workers inform but
do not own the final assignment result. Audit findings must survive refutation.
Candidate patches become usable only after manager inspection, integration, and
validation in the Flow-managed workspace.

## Record bounded accounting

Use the canonical manager record in `flow/references/handoff-format.md` for
every material pass or implementation decision. Runtime semantics are:

- `candidateDecision: "used"` requires actual candidate execution evidence.
- `candidateDecision: "serial_required"` means candidate work was ineligible.
- `candidateEligibility: "eligible"` plus `candidateDecision: "skipped"`
  increments skipped-candidate accounting.
- Candidate and verifier pass counts come from actual pass kind, mode, or worker
  count evidence, never a decision label alone.

Keep full handoffs, scratch tables, and long logs out of `.flow/session.json`.
When another pass or resume is likely, persist the accounted manifest, accepted
claims with evidence and confidence, dropped claims with short reasons, and
open gaps in a manager-owned temporary file outside `.flow/**` and the repo
worktree. Follow-up prompts cite that artifact; do not replay the transcript.

## Extend or stop

Stop when every manifest row and dependency is accounted for, accepted claims
are evidenced and scoped, material claims have the required verification, and
remaining gaps are explicit but non-blocking.

Start at most one routine follow-up pass when material scope was missed,
workers disagree on a decision-changing claim, a high-impact claim needs more
verification, a newly verified dependency unlocks a slice, or a rejected
candidate still has a cheaper isolated alternative. Extra passes require a
specific high-impact reason. Workers never recursively launch workers; the
manager creates any follow-up manifest and prompt.
