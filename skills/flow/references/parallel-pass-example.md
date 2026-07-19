# Parallel pass example

Use this example only after `flow/references/parallel-orchestration.md` routes a
broad Flow task to fan-out. It illustrates the manifest, execution, and
synthesis references; derive real slices from the actual repo during serial
orientation.

Goal: review whether a web app's API error handling is consistent before
planning a refactor.

Serial orientation: the manager reads the router entry point enough to identify
twelve API route modules, one shared error middleware, and an integration test
directory. The manager keeps the middleware local because it is one file and
anchors every other judgment.

Pass manifest: twelve countable route modules remain after the local check, and
4 + 3 + 5 adds back to 12 with no overlaps or gaps. The pass id is
`api-error-handling-read`.

| Row id | Slice scope | Expected coverage | Mode | Depends on | Write scope | Verification tier | Handoff ref | Verification status | Synthesis ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `routes-auth` | auth and account routes | 4/12 modules | `evidence` | none | none | accept locally | pending | pending | pending |
| `routes-billing` | billing and subscription routes | 3/12 modules | `review` | none | none | verify once | pending | pending | pending |
| `routes-admin` | remaining content and admin routes | 5/12 modules | `audit` | none | none | verify once | pending | pending | pending |

Worker prompts:

```text
Overall goal, context only: confirm API error handling is consistent.
Mode: evidence
Pass id and manifest row id: api-error-handling-read / routes-auth
Your exact slice: the four auth and account route modules under src/routes/.
Expected coverage: 4/4 modules.
Dependencies and write scope: none; none.
Do: report each route's error paths, status codes, and middleware usage with file:line evidence.
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from flow/references/handoff-format.md>
```

```text
Overall goal, context only: confirm API error handling is consistent.
Mode: review
Pass id and manifest row id: api-error-handling-read / routes-billing
Your exact slice: the three billing and subscription route modules under src/routes/.
Expected coverage: 3/3 modules.
Dependencies and write scope: none; none.
Do: separate blocking findings from advisory notes and cite file:line evidence.
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from flow/references/handoff-format.md>
```

```text
Overall goal, context only: confirm API error handling is consistent.
Mode: audit
Pass id and manifest row id: api-error-handling-read / routes-admin
Your exact slice: the five content and admin route modules under src/routes/.
Expected coverage: 5/5 modules.
Dependencies and write scope: none; none.
Do: check each claimed error path against the shared middleware contract and report divergences with evidence.
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from flow/references/handoff-format.md>
```

Accounting: three manifest rows spawned means three handoffs collected before
synthesis. If slice B returned `partial`, the manager would re-spawn it once
with a narrower scope, then cover it directly, and as a last resort carry it
into the synthesis explicitly as not-covered.
The manager fills `handoffRefs`, `verificationStatus`, `outcome`, and
`synthesisRef` for each row before any claim becomes a plan decision or review
payload.

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
a plan decision, assignment result, or docs patch. Raw handoffs and unverified
suggestions do not move into the next pass or user-facing answer.

If the pass shaped feature execution, the manager records bounded accounting in
`flow_feature_complete.request.result.orchestrationPasses`, such as pass id
`api-error-handling-read`, kind `review`, worker count `3`, slice ids
`routes-auth`, `routes-billing`, and `routes-admin`, verification status
`mixed` or `passed`, and a synthesis ref pointing to the manager-owned summary.
