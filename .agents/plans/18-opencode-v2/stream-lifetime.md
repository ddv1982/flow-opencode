# Captured HTTP lifetime synthesis

Select the tested request-lifetime shape. Candidates A and B are rejected.
The parent read both full candidates, the cross-judge, native binary and adapter
source, the corrected held-tool probe, and the full third-shape prototype.
No whole-assistant completion barrier or pending-confirmation flight survives.

## Callers and data shape

An existing primary HTTP response still passes to ExecutionAttribution.response.
Its exact Request captures one FrozenPrimary. Natural EOF and consumer cancel
both end that captured resource. Neither declares model success nor writes the
input epoch. A real read failure, non-OK response, missing/locked body, or Request
mismatch retains its current captured failure callback. Cancellation cleanup is
awaited and its rejection propagates; an old callback never substitutes the
current primary.

FrozenPrimary keeps its existing context/request/streaming/ended phase. Ended is
a resource state, not a clean assistant or native execution result. No new state,
registry, parser, package, watcher, signal thread, or public method is needed.
The code sketch is async cancel(reason) { finish(); await reader.cancel(reason); }.

The tool caller still proves the exact live admitted origin, Request, native
assistant, frozen prefix, model, workspace, running call and immutable binding.
The actual native ToolContext.signal remains checked before tool execution and
again through the guarded mutation context. Native user interruption aborts that
signal. Real steer, event-stream loss, unload and observed owned failure retain
their existing epoch revocation. No revoked origin is revived by resource end.

The native context caller keeps readiness and exact-source admission. Automatic
idle dispatch still requires the owned native session's succeeded outcome.
Compaction keeps its exact control, reason, full prefix, delivery and ledger
source/history proof. No completion field can create InputOrigin or a checkpoint.

## Why this shape

The shared false premise was that body cancellation proves user stop or native
execution failure. The installed Responses takeUntil cancels on completed and
failed terminals. Whole-assistant finish/completed is published after tool fibers
exit, so using it to admit the first tool creates a cycle. Streamed is present in
both completed and failed held cases and cannot prove success.

The disposable prototype changed only this cancel callback and inserted a
measurement-only barrier before the unchanged tool signal check. A completed
open body allowed the actual status tool and automatic second request. A public
interrupt aborted the actual callback signal, caused no persisted mutation and
no follow-up. A fresh ordinary input then saved only its own revision-1 operation.
That is prototype evidence, not exact-package qualification or the paid cause.

A non-interrupt provider failure did not abort the already-issued read-only tool.
It completed before native idle failed. Preserve this boundary explicitly.
A protocol failure is not a user interrupt, and tools may execute before the model
stream ends even with natural EOF. Do not invent rollback or a whole-step-success
permission barrier. An observed native failure must not be reported as success.
The separate evaluator correction retains that idle and reports its failure.
No failed-provider mutation proof is claimed by this design.

## Actor census and required gates

- Natural EOF. Existing resource end and exact tool guards stay unchanged.
- Logical protocol completion before EOF. Consumer end keeps the live input;
  first unbound tool and automatic second request must work.
- Consumer cancel without an observed native failure. Ends only the resource;
  it is not positive input authority or evidence of native success.
- Read rejection, non-OK HTTP, missing/locked body and Request mismatch. Immediate
  captured-owner failure remains. Original HTTP400 diagnostics remain intact.
- True public interrupt. Actual signal or fiber interruption must prevent mutation;
  old callbacks cannot affect a separately accepted fresh input.
- Steer and new private admission. Existing epoch/frontier ownership stays exact.
- Old EOF, cancel or delayed cancel rejection. Touches only the captured primary;
  fresh authority and protected tools remain usable.
- Pending admission. Await readiness without borrowing a live host lease.
- Normal tool loops and reviewer return. Preserve exact native caller identities.
- Automatic, ordinary and manual compaction. Re-run the original interrupted
  ordinary manual-summary sequence without reload or a fabricated user.
- Same-origin request retry. Existing request-phase retry facts and object identity
  remain authoritative; resource end grants no retry.
- Auxiliary HTTP kinds. They cannot terminate or prove a primary.
- Owned failed/interrupted native idle. Existing negative observation and succeeded
  idle admission stay in force. Test a visible matching terminal and fresh-source
  neighbor; do not add speculative guards without a reproduced missing boundary.
- Unload and event-stream loss. Clear and refuse as before.

Rewrite tests that label raw body.cancel with a reason string as user intent.
They must distinguish consumer-resource end from an explicit steer/native
interrupted terminal. Preserve old-effect refusal and fresh-input assertions.
Do not delete failing tests or replace their effect assertions with callback counts.

## Scope and verification

Implement in execution-attribution.ts and its focused tests. Lifecycle source is
read-only unless a concrete census failure proves a required boundary; surface
that exact evidence before changing its policy. Minimum lifecycle test migration
is allowed. InputAdmissions, CompactionBoundary, AutoDrive, recovery policy,
domain persistence, tools, package/auth/eval sources remain outside this fence.

The parent owns one new archive, unchanged 119-assertion smoke on macOS/Linux,
exact packed continuation/compaction/stop/retry proof, picker checks and a fresh
independent core review. Types, lint, architecture and focused tests precede the
freeze. Real-account smoke needs a new concrete paid authorization. The old two
claims stay consumed, its report stays FAIL, and its cause stays unresolved.

## Artifact basis

- /tmp/flow-v2-stream-completion-design/crossjudge/report.md
- /tmp/flow-v2-stream-completion-design/native-source-contract/
- /tmp/flow-v2-paid-smoke-investigation/responses-addendum/pre-tool-contract-corrected/report.md
- /tmp/flow-v2-stream-lifetime-prototype/report.md
- /tmp/flow-v2-stream-lifetime-prototype/patch-receipt.json
- /tmp/flow-v2-stream-lifetime-prototype/receipt.json

Attack the Premise separated consumer resource end from user intent. Model the
Domain kept resource phase distinct from admission and terminal evidence.
Boundary Discipline retained exact native tool and interrupt checks. Laziness
Protocol deleted confirmation flights and new state. Prove It Works requires the
new archive and actual effect checks before any release claim.
