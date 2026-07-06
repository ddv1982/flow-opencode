# Parallel pass example

Use this example after `parallel-orchestration.md` when a broad Flow task needs a
concrete pass shape. The project below is illustrative; derive your own slices
from the actual repo during serial orientation.

Goal: review whether a web app's API error handling is consistent before
planning a refactor.

Serial orientation: the manager reads the router entry point enough to identify
twelve API route modules, one shared error middleware, and an integration test
directory. The manager keeps the middleware local because it is one file and
anchors every other judgment.

Pass manifest: twelve countable route modules remain after the local check, and
4 + 3 + 5 adds back to 12 with no overlaps or gaps.

| # | Slice scope | Expected coverage | Mode | Verification tier |
| --- | --- | --- | --- | --- |
| A | auth and account routes | 4/12 modules | `evidence` | accept locally |
| B | billing and subscription routes | 3/12 modules | `review` | verify once |
| C | remaining content and admin routes | 5/12 modules | `audit` | verify once |

Worker prompts:

```text
Overall goal, context only: confirm API error handling is consistent.
Mode: evidence
Your exact slice: the four auth and account route modules under src/routes/.
Expected coverage: 4/4 modules.
Do: report each route's error paths, status codes, and middleware usage with file:line evidence.
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from handoff-format.md>
```

```text
Overall goal, context only: confirm API error handling is consistent.
Mode: review
Your exact slice: the three billing and subscription route modules under src/routes/.
Expected coverage: 3/3 modules.
Do: separate blocking findings from advisory notes and cite file:line evidence.
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from handoff-format.md>
```

```text
Overall goal, context only: confirm API error handling is consistent.
Mode: audit
Your exact slice: the five content and admin route modules under src/routes/.
Expected coverage: 5/5 modules.
Do: check each claimed error path against the shared middleware contract and report divergences with evidence.
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from handoff-format.md>
```

Accounting: three manifest rows spawned means three handoffs collected before
synthesis. If slice B returned `partial`, the manager would re-spawn it once
with a narrower scope, then cover it directly, and as a last resort carry it
into the synthesis explicitly as not-covered.

Handoff checks: the manager accepts only reports with terminal status, matching
coverage counts, concrete file:line evidence, confidence tags, and claims inside
the assigned slice. A claim such as `[high] billing routes bypass the error
middleware; evidence: src/routes/billing.ts:88-104; corroboration: single
source` is usable. A claim such as `[high] error handling looks fine; evidence:
routes reviewed` is dropped or retasked.

Verifier pass: the manager sends any single-source claim that will enter the
Flow payload to `flow-verifier-worker`, for example: `C1: billing and
subscription routes return raw exceptions while all other routes use the shared
error envelope; sources: src/routes/billing.ts, src/routes/subscription.ts`.

Final synthesis: the manager re-reads the relevant route and middleware lines,
keeps only verified or clearly labeled claims, and records one artifact such as
a plan decision, review payload, or docs patch. Raw handoffs and unverified
suggestions do not move into the next pass or user-facing answer.
