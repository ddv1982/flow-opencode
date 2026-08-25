# Phase 4 Interrogate review

Phase 4 freezes cells before launch, publishes one immutable transcript and
attempt per cell, and finalizes only reports accepted by the strict v2 parser.

The four-model review fixed three integrity gaps. Transcript SHA-256 now comes
from stored bytes and must equal the provenance digest. Attempts publish through
one atomic cell-keyed no-replace claim, so concurrent attempt IDs cannot both win.
Handled persistence failures clean temporary files while real crash leftovers are
ignored during reconciliation. Host and mid-flight attempt errors finalize with a
host stop cause.

The final recheck found no unresolved blocker. Store fault-injection, concurrent
writer, replay, transcript, truncated-ledger, report, and full product gates pass.
The final paid pilot emitted a complete v2 report which independently parsed with
one product attempt and no placeholder provenance or policy.
