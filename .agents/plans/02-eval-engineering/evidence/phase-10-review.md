# Phase 10 architecture, review, and verification record

## Architecture Arena

Three independent candidates reviewed the same live defect and constraints. The
judge scored each design on short control-request timeouts, long session-request
ownership, early rejection visibility, unchanged stall and scenario limits,
deterministic verification, and reader cost.

| Candidate | Score | Design |
| --- | ---: | --- |
| Terra | 28/30 | Per-session `AbortController`; the progress wait owns termination and request cleanup. |
| Luna | 26/30 | Unbounded session POST plus an injected post seam, without wait-owned cancellation. |
| 55 | 25/30 | Explicit nullable timeout policy and pure policy tests, without wait-owned cancellation. |

The independent judge selected Terra. Luna's settlement handle was grafted into
the test seam. The nullable and undefined timeout sentinels were rejected because
they add a second timeout-policy language and permit detached requests to outlive
the harness decision. The implementation later simplified the same ownership
rule into `runSessionRequest`, which composes request start, the required
`SessionRequest` handle, the progress wait, and final cancellation.

## TDD record

The first regression imported `startSessionRequest` before that function existed.
The red run failed during module loading with:

```text
SyntaxError: Export named 'startSessionRequest' not found in module 'evals/harness.ts'.
0 pass
1 fail
1 error
```

The first implementation made that combined regression pass in a 57-test focused
file. Deslop split cancellation and external rejection into separate cases, and
Interrogate replaced the low-level exported seam with the composed
`runSessionRequest` boundary. The final focused file therefore has 58 passing
tests. The count changed because review strengthened the regression, not because
the earlier result was rewritten.

## Interrogate

The first four-model panel used GPT-5.6 Sol, GPT-5.5, GPT-5.6 Terra, and GPT-5.6
Luna. It found no critical issue. Valid warnings were:

- cancellation suppressed any rejection that settled after owner cancellation;
- local fetch cancellation waited behind the control abort request;
- request state and cleanup could be supplied as separate optional callbacks;
- the low-level helper test did not cover the composed ownership handoff;
- the evidence description named cancellation in `waitForQuiet` after cleanup
  had moved to its callers.

The implementation now suppresses only the exact harness-owned abort reason,
preserves an external rejection racing cancellation, starts the control abort and
immediately cancels the local fetch, passes one required `SessionRequest` into
`waitForQuiet`, and tests `runSessionRequest` as a composed boundary. The evidence
wording was corrected. The same four models rechecked the current diff; each
reported no remaining critical or warning finding.

## Product verification

The final post-Interrogate happy-path report is bound by file digest
`3710c6e2aa9fb128dc22f5f4863c870cc5c7b3529b1bcc1c7ba185c66b65f56c`.
It passed after 194 seconds with no false completion and no unsubmitted review.
The resulting decision cassette was replayed with:

```text
bun run replay -- --from evals/results/2026-08-25T19-17-19-292Z.cassettes
Replaying 1 cassette(s) from evals/results/2026-08-25T19-17-19-292Z.cassettes
- happy-path--xai_grok-4.6--1.json ... MATCH
1/1 gated cassette(s) reproduced
```

The local full gate kept the repository's typecheck, lint, release metadata,
build, and test steps. Only Bun's per-test allowance changed from 5 to 20 seconds
because the unchanged paired bootstrap test also took about 10 seconds on the
final-main worktree. The gate passed 522 tests, skipped the intentional live smoke,
and failed none. GitHub CI retains the canonical 5-second default.
