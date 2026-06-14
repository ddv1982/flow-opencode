# Parallel Discovery for Planning

Use after `../../flow/references/parallel-orchestration.md`.

Use for broad audits, migrations, review-first goals, or large codebases where
serial inspection would leave shallow `planning.research`. Skip small tasks,
overlapping slices, or one local unknown.

## Workflow

1. Profile serially first: package manager, scripts, framework, state paths,
   tests, docs, local rules, representative files.
2. Choose `planning.workflowProfile`: `bugfix`, `refactor`, `release`,
   `review`, `migration`, or `default`.
3. Split read-only questions by module/path, risk lens, dependency/API,
   migration target, validation, or CI surface.
4. Give workers the goal as context, one slice, paths or commands, exclusions,
   and the shared handoff.
5. Synthesize before saving; do not paste raw handoffs into the plan.

## Synthesis rules

Save evidence only in existing fields: `planning.repoProfile`,
`planning.workflowProfile`, `planning.research`, `planning.reviewFindings`,
requirements, decisions, feature `fileTargets` / `reviewScope`, and notes. Do
not create `contextPack`, `workerResults`, or parallel-discovery state.

Convert only evidence-backed work into features. Broad "review and fix" with no
findings starts with a review-first feature. Split by validation story, not
worker slice. Resolve done-condition gaps and conflicts before saving.

Release-risk slices: runtime/persistence, adapter/tool compatibility,
distribution/install, skill/review quality, validation coverage. Save a
review-first feature if no blockers are confirmed; save fix features only for
confirmed findings grouped by validation story.
