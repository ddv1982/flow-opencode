---
name: flow-test
description: Choose, run, and summarize validation checks for Flow features. Use when selecting validation coverage, running tests or browser/e2e QA, classifying test failures, or preparing validation receipt refs for flow_review_start. Visual design judgment stays in flow-ui-quality and review verdicts stay in flow-review.
---

# Flow Test

Use this skill to decide and gather validation evidence. It produces validation
evidence only: the manager still owns `flow_review_start`, `flow_feature_complete`, review results,
plan approval, session closure, and every other Flow state change.

Do not mutate `.flow/**`, approve plans, complete features, close sessions, or
substitute for `flow-review`. If Flow tools are unavailable, this skill can still
produce an advisory validation plan or test summary, but it cannot record Flow
state.

## Inputs

Start from the smallest concrete surface:

- The approved feature `summary`, `targets`, and `validation` entries when a
  Flow session exists.
- The actual diff, changed files, package scripts, docs, and test conventions.
- Recent command output from this session or from a trusted worker handoff.
- Any user-stated acceptance criteria, browser target, fixture, or environment
  constraint.

Prefer repository scripts and local conventions over invented commands. If a
command has not been run in this session or directly reported by a trusted
worker with raw outcome, recommend it instead of claiming it passed.

## Select Coverage

Choose checks from changed-surface risk, not from habit:

- **Targeted behavior**: unit, integration, CLI, route, or component tests that
  exercise the changed behavior and would fail without the fix.
- **Integration and persistence**: database, filesystem, API, adapter, lock, or
  serialization paths touched by the feature.
- **Browser or e2e**: user-visible workflows, responsive states, accessibility
  basics, form flows, and screenshots when a local target and browser tooling
  are available.
- **Package and build shape**: typecheck, lint, build, generated distribution,
  or schema checks when public contracts, bundling, or package exports changed.
- **Docs and mechanical edits**: markdown rendering, link/path sanity, spelling
  of commands, or the narrowest project check when behavior is unchanged.
- **Cleanup/refactor**: behavior-preservation tests plus the relevant broad
  check; formatting alone is not evidence of preserved behavior.
- **Final feature**: the repository's broad gate, full relevant suite, build, or
  equivalent release gate before `validationScope: "broad"` is recorded.

If the planned coverage is weaker than the risk, say so explicitly and list the
missing evidence.

## Run Discipline

For each check:

1. State the hypothesis: what behavior or contract the check is expected to
   prove.
2. For Bash evidence, call `flow_validation_start` immediately before the exact
   command with current causal guards, feature id, coverage scope, and
   environment key names; run that byte-for-byte Bash command next.
3. Inspect the outcome and collect the immutable object appended after
   `[flow-validation-receipt]`. Do not author validation timestamps, exit status,
   output digests, or a per-command API summary.
4. If it fails, classify the failure before editing:
   - product failure
   - test failure
   - environment failure
   - pre-existing failure
   - flake
   - unrelated failure
5. Before a fix attempt, write a short failure hypothesis that names the likely
   cause and the file or behavior to inspect.
6. After a fix, rerun the failing check and one appropriate regression check.

Do not trim failure output so far that the manager cannot understand the
failure. Do redact secrets and credentials.

## Validation Schedule

- A pre-edit diagnostic baseline is advisory only. It identifies existing
  failures but does not validate changed source.
- Run focused checks after changes and rerun them after every relevant edit.
- For artifact-only work, run the complete applicable artifact gate: docs,
  generated output, package/build shape, or other checks that can actually fail
  for that artifact.
- Run the broad final gate once, after a passing feature review and the final
  edit. Do not run it early as ceremony.

Evidence is applicable only to the exact feature run and source identity it
observed. Do not carry it across a source edit or a new run. Targeted evidence
cannot be relabeled or reused as broad validation; broad final evidence comes
from its own execution.

## Browser and Exploratory QA

For meaningful UI or browser workflow changes, browser evidence is expected when
a local target can run:

- Open the relevant route or story with the available browser tooling.
- Exercise the main changed workflow, not only page load.
- Check desktop and mobile breakpoints when responsive behavior is in scope.
- Capture screenshots or describe the viewport, route, steps, and observed
  result.
- Inspect visible error states, empty states, long labels, focus behavior, and
  console or network failures when the tooling exposes them.

Browser claims are evidence requirements, not guaranteed coverage. If browser
tooling, credentials, seed data, or a local server is unavailable, record the
gap and provide the next-best evidence such as component tests, build output, or
static inspection.

Exploratory QA should be scenario-based. Name the user path, the state varied,
and the expected outcome. Do not replace automated evidence with exploratory QA
when a practical automated check exists.

## Output

Return the accepted immutable refs and gaps. The manager can place the refs
unchanged inside `flow_review_start.request.validationRefs`:

```json
{
  "validationRefs": [
    {
      "kind": "validation_receipt_ref_v1",
      "digest": "sha256:<64 lowercase hex characters>",
      "byteLength": 1234
    }
  ],
  "gaps": []
}
```

Only refs appended after passing commands belong in `validationRefs`. Failed,
skipped, unavailable, mismatched, or unreceipted checks belong in `gaps` or a
blocker outcome. Static inspection alone is a gap for behavioral changes. Flow
owns receipt chronology; broad final capture still runs only after the passing
feature-assignment result.

Never relabel a failed command as passed, invent output, or present "not run"
as passing validation.
