# Eval engineering architecture brief

## Artifact

Produce one design package for Flow's next evaluation architecture. Start with
the maintainer's command-line usage and the release decision it produces. Then
derive the TypeScript data shapes, pure functions, module boundaries, report and
qualification flow, and an incremental phase sequence. Do not implement code.

The design must build on the current in-repo OpenCode harness. It must not replace
Flow's Session runtime, add an external evaluation service, or turn exploratory
model judgments into release gates before calibration.

Read these inputs first:

- `.agents/plans/02-eval-engineering/grounding.md`
- `.agents/plans/02-eval-engineering/critique-verdict.md`
- `evals/harness.ts`
- `evals/run.ts`
- `evals/benchmark.ts`
- `evals/benchmark-run.ts`
- `evals/scenarios.ts`
- `scripts/qualify-release.ts`
- `docs/release-qualification.md`
- `.github/workflows/evals.yml`
- `.github/workflows/release.yml`

## Gradeable criteria

1. Integrity and provenance. A versioned attempt-centric report is parsed at the
   boundary, qualification is derived from atomic evidence, malformed or partial
   evidence fails closed, and the report binds to source, packed artifact,
   evaluator, host configuration, manager model, and reviewer model.
2. Experimental validity. Comparative runs use blinded organic tasks, randomized
   paired blocks, complete-pair accounting, a declared abort policy, a primary
   outcome, an effect estimate with uncertainty, a planned sample size, and a
   stopping rule.
3. Product relevance. The design separates conformance, regression, capability,
   compatibility, reviewer-only, and paired-value evidence. It supports hidden
   executable outcomes and reviewer detection plus false-positive measurement.
4. Incremental fit. It preserves the current packed-host harness, cassette replay,
   runtime boundaries, and low-cost checks. Each phase is independently landable,
   ends in a real check, and puts the riskiest integrity unknown first.
5. Operability. Maintainers get explicit commands, readable reports, cost limits,
   scenario-specific evidence policies, clear VERIFIED, NOT VERIFIED, and
   INCONCLUSIVE verdicts, and a concrete manual OpenCode stop gate.
6. Simplicity. Core invariants live in a small typed domain model with pure
   analysis functions and thin I/O shells. The proposal avoids duplicated sources
   of truth, compatibility scaffolding, and framework-sized abstractions.

## Required design package

- Caller usage with at least three real command examples.
- Core TypeScript type sketches and function signatures with unimplemented bodies.
- Module map and data flow.
- Release and experiment decision rules.
- A phase sequence with an acceptance predicate and stop gate per phase.
- Tradeoffs, alternatives, risks, and the first implementation unit.
- A short rationale that follows the Architect rationale template.
