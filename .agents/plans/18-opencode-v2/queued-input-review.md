# Queued input review

This records the source boundary reviewed for PR 197 after commit `70e7184`.
Paid qualification, merge and publication remain on hold.

## Confirmed defect

Native OpenCode 2.1.4 prepares queued input before delivering it. Flow revoked
the active request at preparation. In the pinned native reproduction, the
original shell completed, but its next provider request failed with an epoch
error. The queued follow-up completed. A final succeeded session concealed the
original failed idle.

The correction keeps preparation as a registration without authority. Exact
native consumption proves the payload, selected identity and complete input
prefix before a new immutable scope replaces the predecessor. Explicit steer
keeps its immediate barrier. Inbox events can veto local scheduling but cannot
grant provenance. Authenticated dispatch intents commit send state only when a
matching receipt activates them.

## Review findings

The first source review found four unique defects. All have component controls.

- D1. An obsolete retry's rejected projection read revoked a fresh primary.
  Failure cleanup now checks the captured terminal owner.
- D2. Recovery expiry could throw after send state changed. The throwing claim
  commitment now precedes those changes.
- D3. A checked checkpoint could not bridge a new public prefix. Only the
  existing owned compaction record supplies that bridge.
- C1. An observed manual-compaction inbox item conflicted with its own control
  identity. Final alias installation now permits only the checked non-positive
  observation transfer and retains genuine identity conflicts.

Fresh independent OpenAI core and dispatch reviews passed. The parent ran all
594 focused tests, including the Git-backed case, and all 25 original reviewer
control executions. The full source check passed 4,958 tests, skipped 27 and failed none.
The two original queue regressions were committed first in `3a04a9f2`; their
assertions remain unchanged. Earlier failed checks and review receipts remain.

The shared fixture now recognizes completed controls rather than inventing a
prompt. Matched decision cases observe the actual coordinator completion,
synthetic submission or public waiting state. All 42 surface cases and their
original assertions remain. Post-stop ignored idles and the final unmatched
interrupt and idle still prove intake only. They do not prove universal
terminal-job completion.

## Remaining qualification limits

The native API exposes no atomic plugin admission mechanism for a public
preparation or delayed inbox event arriving after the final local gate. That
retained race is unqualified. Hook-only preparation cannot prove a pending
admission. No timeout supplies absence proof and automatic use stays enabled.
Native context overlap and auxiliary retry also remain unproved.

Source checks do not replace the required new exact archive and unchanged
native reproduction. The queue control must show two requests for each turn,
both individual idles succeeded, the literal original shell result and real
`flow_status` with application status `ok`. Steer remains a separate control.
No account or paid-provider qualification follows from these synthetic checks.

Local evidence is under `/tmp/flow-v2-queued-input-20261025/`. Independent reports
are `core-review-r2/review.md` and `dispatch-review-r2/review.md`. Parent checks
are in `parent-integration-r2/`. Package and native evidence get their own
identities rather than replacing the original failed reproduction.
