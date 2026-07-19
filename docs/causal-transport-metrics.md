# Causal transport metrics

Run the deterministic local report with:

```sh
bun run transport:report
```

The report drives the current Flow service through the checked-in six-feature
fixture at `tests/fixtures/transport/phase2-current-run.json`. It measures full
UTF-8 JSON response bytes for mutation receipts, compact status, complete
execution context, reviewer context, and unchanged polling. Execution has its
own 12 KiB ceiling and is never truncated. Changed-entity metadata remains
included in the receipt measurement, so the 2,000-byte receipt gate is tested
without an exclusion.

For the current-run reduction check, the reference side explicitly requests the
diagnostic `detail` projection at each state. The current side uses the actual
mutation receipt, explicit compact status, execution projection, reviewer
projection, and unchanged poll response produced for the same accepted
transitions. The report publishes both decision-signature arrays and requires
them to match before the 60% reduction gate can pass. This is a reproducible
local transport comparison, not a reconstruction of historical provider
traffic.

The same-corpus 70% result is intentionally machine-readable as unavailable:
`observedCharacters`, `reductionBasisPoints`, and `pass` are `null`. The verified
investigation baseline remains 1,007,950 characters, with a 302,385-character
target, but the attachment does not include the sanitized call-kind/result-shape
histogram or complete replay corpus needed to calculate a valid post-change
result. The report does not read, extract, or integrate any source database or
provider-specific trace.

The top-level `phase2Acceptance` field therefore reports `status: "blocked"`
even when every reproducible local gate passes. A successful CLI exit means the
report ran and its local gates passed; it does not convert the unavailable
same-corpus gate into an acceptance pass.
