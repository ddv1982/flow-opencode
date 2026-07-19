---
name: flow-test
description: Choose, run, and summarize validation checks for Flow features. Use when selecting validation coverage, running tests or browser/e2e QA, classifying test failures, or preparing validation observations for flow_review_start. Visual design judgment stays in flow-ui-quality and review verdicts stay in flow-review.
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
2. Run the command or manual workflow when the environment allows it.
3. Record exact command, status, and observed result.
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

Return a concise validation summary and a `validations` array that the manager
can place inside `flow_review_start.request` if it accepts the evidence:

```json
{
  "validations": [
    {
      "command": "bun test tests/foo.test.ts",
      "summary": "3 pass; covered foo creation, duplicate rejection, and reset behavior",
      "startedAt": "ISO-8601",
      "completedAt": "ISO-8601",
      "exitCode": 0,
      "outputDigest": "sha256:<64 lowercase hex characters>",
      "environmentKeys": []
    }
  ],
  "testSummary": "Targeted behavior and package shape passed. Browser evidence was not applicable.",
  "gaps": []
}
```

Only passing checks belong in `validations` for assignment. Failed, skipped,
or unavailable checks belong in `testSummary`, `gaps`, or a blocker outcome.
Each summary must state what behavior, file set, route, command, or state was
covered. Static inspection alone is a gap for behavioral changes.

`startedAt` and `completedAt` are reported times. Record them honestly and in
order; Flow rejects observations that precede the active execution, end after
assignment start, or postdate runtime acceptance. Broad final validation must
start no earlier than the passing feature-assignment result.

Never relabel a failed command as passed, invent output, or present "not run"
as passing validation.
