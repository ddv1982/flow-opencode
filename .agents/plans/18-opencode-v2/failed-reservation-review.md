# Failed command reservation recovery

A failed Flow command can leave a private input ID outside native history.
The next ordinary queued input then fails before provider dispatch because the
input ledger still requires that failed ID in the consumed prefix. Explicit
steer recovers the session. Pinned OpenCode 2.1.4 reproduced this for both a
specialist root and a child session. This is a recoverable availability defect.

## Ownership and recovery

InputAdmissions remains the only owner of entries, reservations, epochs, scopes
and operations. The subordinate input-evidence module owns entry shapes and pure
failure, coverage, history, receipt and payload decisions. Its import fence permits
only the ledger to use it. The source ceiling remains 1,000 lines.

A local terminal failure settles only its exact pending admission and records a
failure fact on that entry. Only an exact current reservation and epoch permit
invalidation and captured lifecycle cleanup. Accepted parents retain their accepted
receipt and resolved readiness after reviewer-child failure. Failed real activation
retains its final reservation and operation token. Earlier settled batch members
remain settled. No cleanup selects a replacement owner by host.

The failed identity stays rejected. A different registered queue must prove its
own complete native prefix, selected delivery, literal payload and metadata, reuse,
ordering and prior primary before gaining a new origin. A distinct unknown native
user or synthetic input can receive ordinary execution only. It gains no Flow
origin, automatic lease or recovery intent and preserves negative compaction
history. A genuinely checked ordinary boundary can reset the history anchor.
Exact old failed IDs remain negative afterward. There is no permanent host taint.

Pending commands still create an immediate barrier before selected-session reads.
Static parse errors still precede reservation. Command post-reservation failures
share one catch. Synthetic selected and automatic-intake checks remain before its
reservation. No RPC rejection is treated as proof of native absence.

Private records have one stable handle and one replaceable phase. Acceptance
captures the pending phase around activation and rechecks that same phase before
settling. No mirrored flat state, compatibility getter or second registry is kept.

## Review corrections

The changing-prefix guard requests a compaction bridge lazily. It asks only when
the existing strict predicate needs a bridge. Both lifecycle callers use this
rule. Direct prefix extension avoids an irrelevant retired checkpoint. Actual
checkpoint-only execution and required bridges retain their live-origin guards.

Independent review rejected the first source candidate for a late same-ID queue
registration race. Its once-only entry check could expire between resolve and
freeze. The corrected terminal scope retains its exact final entry, registration
and failure fact through release, freeze, HTTP and tool use. Cancellation wakes
only the exact affected stale source. Unrelated queued IDs retain their clocks.
The earlier archive and its bounded runtime passes remain historical evidence,
not acceptance of that rejected source.

One old settled-receipt test required a distinct external suffix to fail outright.
The selected contract instead permits ordinary execution with no Flow authority.
The pending row still refuses. Settled user and synthetic rows now verify the
receipt failure, exact private prefix, ordinary HTTP and shell passage, zero Flow
effects, off recovery and both compaction denials after execution. This narrow
reconciliation is separate from failed-ID replay, which remains refused.

The independent review also compared nonterminal and nonfinal unknown-input timing
controls with the original implementation. Those ordinary-native behaviors remain
unchanged. This repair is not a general input-admission arbitration guarantee.

## Evidence and limits

Red commit 7198573ab666eac9ca0f4524e33ce84cccc5d3f2 preserves the failing recovery
regressions before the fix. Its selected matrix had 32 passes and 16 failures.
All 48 recovery rows pass on the corrected source. The registration correction
also has a paired source replay with identical final tests, 7 passes and 70 failures
on the prior source versus 77 passes on the corrected source.

Fresh independent source and comment reviews pass. The parent full repository
check on Bun 1.4.0 has 5,161 passes, 27 skips and zero failures. The focused owner
run has 702 distinct passing tests. Subset reruns are not additional distinct tests.
Both new paths have literal application and zero-effect denial controls.

The native acceptance contract reuses the exact BEFORE driver on a new archive.
Both invalid commands must still reject. Each same-session queued input, both
steer controls and the fresh queue must complete with one fixture request each,
five total. The maintained packed smoke has 119 assertions. Parent byte checks
bind the archive, installed files, source maps and frozen sources before and after.
The current exact archive and resulting native receipts belong in the PR evidence.

Local evidence is under /tmp/flow-v2-failed-reservation-20261025. The selected design
is synthesis-r1/decision.md, with the explicit baseline amendment in
synthesis-r1/baseline-reconciliation.md. Source-review-r2/report.md records the
independent verdict and retained ordinary-native characterization. Implementation
and paired replay receipts are in implementation-r1/review-r1-fixes.

Native overlap, auxiliary retry, public delivery defaults, runtime frequency and
broader L1 arbitration remain unqualified. The historical paid failure stays
unresolved. Paid qualification and release work remain on hold. This fix does not
merge PR 197, publish Flow 10 or qualify a real provider.
