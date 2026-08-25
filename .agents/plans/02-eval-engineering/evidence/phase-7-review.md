# Phase 7 Interrogate review and pilot

Phase 7 replaces the marginal benchmark summary with one frozen v2 paired
experiment. Per-block arm allocation is independently seeded and hidden behind a
nonce-backed commitment. Product outcomes are immutable, only non-product failures
activate a preallocated whole reserve pair, and task-stratified bootstrap gives
each task equal weight.

Architect and Arena selected a pure experiment boundary over extending the legacy
summary. The independent judge required four corrections before implementation:
salted commitments, exact report and masked hash binding, per-block token
semantics, and the order finalized report, durable masked analysis, allocation
reveal, directional estimate.

Interrogate found and fixed scanner-to-transcript binding, fabricated masked
observations, final-link durability, startup cleanup, plain reserved-label
detection, rejected request delivery, failure-origin attribution, and a permissive
pure reveal seam. The masked record now carries every
versioned scan and exact transcript SHA-256. `ReportStore` recomputes masked
semantics from the finalized report and fsyncs the final directory entry before
removing its recovery link. The evaluator digest binds benchmark cases, hidden
graders, runner, experiment, power contract, report schema, and pairing logic.

The accepted packed-host pilot ran one complete pair under a $1 ceiling. Both the
candidate and ordinary baseline passed the hidden executable grader. The scan was
clean, no reserve was activated, and masked analysis was durable before allocation
reveal. Observed cost was $0.2450722 for 4,464 output tokens.

The tie supports no product-value claim. The conservative power contract requires
265 pairs for the preregistered 0.2 minimum detectable effect and 0.8 target power;
the pilot planned one. `claimEligible` is therefore false and the directional
decision is `inconclusive`. Flow tool presence remains visibly unblinded and is
recorded as a limitation.

Earlier Phase 7 campaigns are diagnostic only and excluded from evidence. The
final full repository gate passes, and the final multi-model recheck has no
unresolved blocker.
