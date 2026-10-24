# Evaluator terminal evidence synthesis

Choose candidate A as the existing trace-owner base. Parent and independent
Grok cross-judge score A11/B7. Both full candidates and sketches were read.
The actual paid cause remains unresolved. This change fixes a demonstrated
observation gap and does not alter plugin execution policy.

The existing V2 trace owns optional terminal facts on assistant and idle messages.
Old V2 absence remains unobserved; V1 and both tool provenance schemas stay exact.
Assistant finish, error, streamed, and completed are independent native facts.
No raw finish, retry descriptor, compaction terminal extension, response body,
headers, account/config data, extra telemetry store, or new trace version.
One collector sanitizer and pure native-execution reader serve live wait,
outcome collection, and offline interpretation. No raw-native decision adapter
with a second parsing policy.

Capture the last native message id immediately before each command/prompt POST,
after model switching. Command scope and abort attribution are invocation-local.
Only the command root's closing idle after that boundary may create this new
host failure. Owned child ends remain evidence and keep existing product grading.
A later succeeded idle supersedes an interim failed one while execution proceeds.
Missing idle/end fields stay unobserved and do not change existing quiet policy.
Failed and non-self interrupted idle produce host-only, non-retryable failures.
They cannot become provider-rejected-turn, retryable command-aborted, or reserve
eligibility. Keep providerError provider-only. Add a native failure result and
migrate the four runner precedence sites plus direct fixtures. No compatibility
alias or field rename. Product missing-plan and false-completion checks remain.

Keep POST, activity, busy, wedge, deadline, question, and cancellation ordering.
At quiet and immediately before a stop/abort/read failure is committed, recompute
the command-scoped end from the latest already-fetched root snapshot. Do not
latch an interim failure or bypass busy. Preserve the actual native failure
before runner abort or child-read failure can erase it. A cancel before any
observed real failure stays cancel. An exact earlier step/provider failure keeps
its precedence. Reset new abort attribution per invocation; suppress only its
strictly newer interrupted idle, absent/aborted error, with no prior pinned
failure. Equal times, failed idles, old aborts, and unrelated errors do not qualify.

Root-only transient collection may establish the exact root terminal before
child enrichment. Do not publish it as a complete owned-tree trace. If full
child collection fails, retained HostTrace remains unavailable with the real
reason, while the already-established non-retryable native failure and its safe
root/idle diagnostic remain primary. Never fabricate session metadata or child
completeness. Pin actual fetched metadata/messages, not requested directory data.
If the existing Outcome cannot represent this without a new protocol, stop and
surface the exact interface friction before expanding scope.

The sanitizer reads only type, message, optional HTTP status100..599 and bounded
retry-after. Missing error stays absent. Withhold malformed/oversize values,
absolute private paths, opaque long tokens, or residual unsafe text. Use the
existing secret scrubber before bounded UTF8 output. Enforce pre-scrub input,
per-field, per-trace count/byte limits; outcome/timestamps survive a withheld
error. Strict new fields, no parse defaults or historical rewrites.

Implementation owns evals/host-trace.ts, harness.ts, opencode-host.ts,
failure-origin.ts only if the pure mapper needs it, and the minimum actual
run/benchmark/study/reviewer/replay callers and their focused tests. Product
src, auth helpers, schemas outside this contract, package/lock, historical
canary/qualification/cassettes, paid results, docs, Git and publication remain
outside its write fence. Parent owns integration/canonical gates and commits.

Offline tests must cover the captured succeeded/failed pair; missing error;
prior command idle; repeat and recovery; post-abort new command; exact/equal
abort times; pending POST/tool/assistant/compaction; pre-abort native failure
alongside busy work; child-read failure; root success with failed child; outcome
only callers; privacy/bounds; strict old V1/V2 parsing and serialized schema
stability; no reserve eligibility; unchanged missing-plan/false-completion FAIL.
No paid model or account work is authorized. The original paid result stays FAIL.
