# Parallel Discovery

Use this when planning or review is too broad for one read. Flow uses
parallelism only for read-only discovery. The manager still owns the session,
synthesis, plan payload, reviewer decision, and every `flow_*` call.

## When to use it

- Broad repository audits with independent areas or risk lenses.
- Research across APIs, packages, designs, or migrations.
- Large codebases with clear module or workflow boundaries.
- Review-first goals where the first feature is a findings report.

Skip small tasks, cross-talk-heavy slices, shared edits, or Flow state mutation.

## Discover serially first

Profile before spawning workers:

- Identify package manager, scripts, tests, and framework conventions.
- List modules, state paths, commands, docs, and contracts.
- Sample representative files before deciding the split axis.
- Name any surfaces that are out of scope.
- Name the workflow shape: implementation, review, migration, release, refactor.

Record synthesis in existing fields: `planning.repoProfile`,
`planning.workflowProfile`, `planning.research`, `planning.reviewFindings`,
requirements, architecture decisions, feature `fileTargets` / `reviewScope`,
and notes. Do not invent a context-pack or worker-results field.

## Decompose by ownership

Good split axes:

- Path or module: `src/runtime`, `src/adapters/opencode`, `skills`, `tests`.
- Risk lens: correctness, security, persistence, concurrency, release/install,
  API compatibility, validation coverage.
- Research stream: one API, dependency, migration target, or design option per
  worker.
- Data slice: disjoint files, log ranges, ticket ranges, or transcript ranges.

Keep prompts self-contained: goal, slice, paths or commands, out-of-scope
surfaces, and handoff format.

## Worker rules

- Workers are read-only unless isolated worktrees or non-Flow experiments are
  explicitly chosen.
- Workers must not call state-changing Flow tools. The manager owns
  `flow_plan_save`, `flow_plan_approve`, `flow_run_start`,
  `flow_feature_complete`, `flow_review_record`, and `flow_session`.
- Workers must not complete features, approve plans, record reviews, or edit
  `.flow/**`.
- One worker inspects one slice and returns one handoff. The manager compares
  slices and writes the final plan, report, or recommendation.
- Parallel implementation is outside normal Flow execution. Use separate
  worktrees, then route the chosen result through one active feature.

## Research / review handoff

Ask each read-only worker to return exactly this structure:

```markdown
## Status
success | partial | blocked

## Scope
<exact slice: paths, module, risk lens, data range, or question>

## Findings and evidence
- <finding with evidence: file:line, command summary, URL, version, metric>
- <finding ...>

## Sources
- <paths read, commands run, docs fetched, data covered>

## Open questions / gaps
- <ambiguity, missing source, contradiction, or out-of-scope item>

## Suggested Flow follow-ups
- <planning context, review finding, feature, validation check, or note>
```

For audit work, blocking findings follow
`../../flow-run/references/audit-rubric.md`: name guards or mitigations checked.
Without that grounding, a finding is a candidate.

## Manager synthesis

After workers return:

- Treat worker findings as candidate evidence. Reconcile contradictions first.
- Deduplicate overlapping findings and downgrade unverified hypotheses.
- Preserve useful paths, URLs, commands, and data ranges in `planning.research`,
  `planning.reviewFindings`, requirements, decisions, targets, scopes, or notes.
- Convert only evidence-backed work into features. Broad "fix the repo" plans
  start with review-first discovery unless concrete findings already exist.
- Spawn a second read-only wave only for gaps that affect the plan, review
  decision, or done condition.

The final output is a synthesized Flow artifact: saved plan, review decision, or
findings report. Do not forward raw handoffs as the final answer.

## Execution boundary

Flow execution remains serial. `flow_run_start` activates one approved feature
until it is completed, blocked, or reset. Parallel workers must not mutate the
same active session or complete separate features concurrently.
