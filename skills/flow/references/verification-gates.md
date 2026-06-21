# Verification gates

Verification is how Flow keeps parallel work from turning into parallel
guesswork. Worker handoffs are candidate evidence; the manager decides what can
enter the plan, validation record, review payload, audit report, or final
answer.

## Before fan-out

Run a pre-fan-out gate after serial orientation and before spawning workers:

- Count the total work items when countable: files, modules, routes, commands,
  rows, findings, screenshots, or claims.
- List every slice with path/range/lens and expected count.
- Check that countable slices add back to the total.
- Check for overlapping ownership, missing areas, empty slices, and ambiguous
  shared contracts.
- Fix the slice map centrally before spawning if the gate does not reconcile.

If the scope cannot be counted, state the completeness rule instead, such as
"all changed files plus callers" or "all public commands plus release docs."

## Every handoff

Accept a handoff only after a cheap manager-side pass:

- `Status` is terminal: `success`, `partial`, or `blocked`.
- Coverage matches the assigned slice, or skips are explicit.
- Important claims have concrete evidence and confidence tags.
- Cited paths, commands, screenshots, URLs, or metrics resolve.
- The evidence supports the claim, not just the topic.
- Findings stay inside the worker's slice.
- Headline counts can be recounted or traced.
- Contradictions between workers are either resolved or explicitly marked as
  contested.

Demote, drop, re-task, or verify claims that fail this pass.

## Verifier triggers

Use `flow-verifier-worker` when a claim is:

- blocking or release-sensitive.
- high-stakes for user data, security, persistence, permissions, or public API
  behavior.
- low-confidence, inferred, surprising, or single-sourced.
- citation-heavy enough that source drift would change the conclusion.
- contradicted by another worker or by manager inspection.
- a count, benchmark, command result, or pass/fail claim that a Flow payload will
  rely on.

Give the verifier atomic claims, cited sources or commands, and the acceptance
question. Do not ask it to redesign the work or review the whole feature.

## Flow payload acceptance

Planning fields may use worker evidence only when the source and scope are clear.
Unverified broad findings should become a review-first feature, not a fix plan.

`validationRun` entries may use worker-reported commands only when the worker
was explicitly authorized to run the command and reported the exact command,
status, and raw outcome summary.

`featureReview` and `finalReview` may use worker review slices, but the manager
owns the pass/fail decision and must resolve blockers, contradictions, and
coverage gaps before returning the payload.

Audit reports may include only findings that survived refutation. Blocking audit
findings need guards checked, deployment context, and evidence that the current
code exhibits the behavior.

Candidate implementation patches are not Flow evidence until the manager
inspects, merges or rejects them, and runs suitable validation in the main
Flow-managed workspace.

## Manager synthesis barrier

Before presenting or recording the result:

- Preserve confidence: verified, single-sourced, inferred, and unresolved claims
  stay distinct when it matters.
- When workers disagree, inspect the cited artifact or rerun the cited command
  instead of arbitrating from summaries.
- Run the strongest practical local check for the deliverable.
- Re-read critical files or docs that will be cited in the final decision.
- Move only distilled, evidence-backed claims forward; raw handoffs remain
  candidate evidence, not a plan, review, completion payload, or final answer.
- Record gaps honestly instead of converting missing evidence into success
  language.

`Status: success` only says the worker believes its slice is done. The manager
still checks coverage and evidence before trusting the result.
