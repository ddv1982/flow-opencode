# Flow eval engineering

## Context

Flow already enforces a careful durable lifecycle and tests it through source
tests, a packed OpenCode smoke, decision replay, real-model scenarios, and a small
paired benchmark. The next step is to make the evidence itself trustworthy.
Qualification currently accepts internally inconsistent reports, paid evidence is
not bound to exact package bytes, comparative runs discard their pairing, reviewer
quality is confounded by manager behavior, and small samples cannot resolve most
product changes.

The definition of done is falsifiable. A maintainer can take one packed artifact,
run a frozen evidence plan, and receive a `VERIFIED`, `NOT VERIFIED`, or
`INCONCLUSIVE` decision derived from atomic attempts. Removing or altering any
required attempt or provenance field cannot improve the verdict. Comparative and
reviewer claims carry declared uncertainty and cannot gate releases before
calibration. A release job can prove it is publishing the artifact that was
measured.

## Scope

Included:

- Versioned attempt-level evidence and fail-closed report parsing.
- Qualification derived from atomic rows.
- Exact source, artifact, evaluator, host, actor, and instruction provenance.
- Machine-readable scenario policy and frozen campaign plans.
- Reviewer-only defect detection and false-positive measurement.
- Blinded paired product-value experiments with complete-pair analysis.
- Manual OpenCode canary records and tag-only publishing.
- Readable report comparison after the evidence model is stable.

Excluded:

- Replacing Session v5 or the Flow runtime.
- Moving the harness to an external evaluation platform.
- Adding durable worker orchestration or a scheduler to the plugin.
- Gating uncalibrated model judges.
- Backfilling legacy reports with provenance they never recorded.
- Claiming live OpenCode behavior the maintainer has not yet observed.

## Constraints

- Preserve the inward source layering and current packed-host `EvalHost`.
- Keep cassettes as decision-layer runtime regression evidence.
- Keep deterministic checks credential-free.
- Parse external JSON at one boundary and trust typed internal values.
- Make concurrent attempts own separate files. No shared mutable report writer.
- Keep each phase independently landable and green before the next starts.
- Probe actual reviewer metadata before the report schema is implemented. If the
  pinned host cannot expose it, record the limitation and exclude cross-family
  reviewer claims rather than inventing observed identity.

## Alternatives

The selected design adds a typed evidence layer over the current harness. A patched
summary qualifier lost because it preserves two sources of truth. An external eval
framework lost because it replaces working host integration without fixing artifact
binding. One universal score lost because conformance, compatibility, reviewer
calibration, and product value answer different questions.

See [architecture](architecture.md), [arena synthesis](synthesis.md), and
[critique verdict](critique-verdict.md). [Research notes](research.md) map primary
sources to design decisions. [Review record](review-record.md) records the model
panels and accepted corrections.

## Applicable skills

Implementers use `pstack:how` before changing unfamiliar host or qualification
paths, `pstack:architect` when a phase changes the type sketch, and
`pstack:typescript-best-practices` for every TypeScript file. Apply
`pstack:principle-sequence-verifiable-units` at every phase boundary and keep the
decision trail through `pstack:show-me-your-work`. Run `pstack:deslop` before each
commit, `pstack:interrogate` before delivery, `flow-contribution-check` before any
GitHub-visible change, and `pstack:babysit` after opening each PR.

## Phases

0. [OpenCode metadata reconnaissance](phase-0-host-capabilities.md)
1. [Strict report and catalog boundary](phase-1-report-boundary.md)
2. [Atomic analysis](phase-2-atomic-qualification.md)
3. [Exact provenance and actors](phase-3-provenance.md)
4. [Crash-safe campaign emission](phase-4-attempt-emission.md)
5. [Qualification cutover](phase-5-qualification-cutover.md)
6. [Reviewer-only calibration](phase-6-reviewer-calibration.md)
7. [Blinded paired comparison](phase-7-paired-comparison.md)
8. [Coverage promotion and trends](phase-8-promotion-trends.md)
9. [Canary and release alignment](phase-9-release-alignment.md)

## Verification

The project gate is `bun run check`. Replay remains `bun run replay`. Packed host
registration remains `bun run smoke:live`. Paid and manual checks are added only in
the phase that defines their evidence contract. [Testing](testing.md) maps every
phase to its static and runtime gate.

## Implementation guidance

Each phase starts from a green predecessor. State the hypothesis, make the smallest
change, run the phase check, and append the verdict to `.audit/eval-engineering.tsv`.
Do not batch phases. A failed or inconclusive phase stops the sequence. Do not
soften an assertion, change a threshold, or reclassify a failure to make a gate
pass. If implementation needs two repeated deviations from the architecture,
return to Architect instead of adding escape hatches.

The throughput checkpoint is after Phase 5. At that point the report boundary,
catalog, provenance, live writer, qualifier, and workflows form one vertical slice.
Measure how many legacy branches and test fixtures remain before continuing. If
adapting a new scenario still requires changes in more than the catalog, runner,
and one test, the evidence model has not reduced maintenance load enough and the
next phase must not start.
