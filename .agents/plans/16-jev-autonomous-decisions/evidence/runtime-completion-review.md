# Completion tooling review

The Poteto run compared a subprocess supervisor with a typed driver over the
existing host. A read-only judge selected the typed driver. The implementation
retains the subprocess design's requirement to confirm host cleanup before writing
a terminal event. No alternate executable protocol was added.

## Decisions shaped by principles

- Model the Domain. Driver lifecycle, event grammar, reviewed outcomes, and gate states remain explicit data shapes.
- Foundational Thinking. Existing frozen registrations and receipt reduction remain the measurement contract.
- Separate Before Serializing Shared State. The implementation delegate owned decision-quality and host-adapter files. The parent owned runner, calibration, qualification, shared dispatch/source files, and documentation.
- Sequence Work into Verifiable Units. Each new unit passed focused behavior checks before the final repository check.
- Prove It Works. Tests execute real CLI subprocesses and inspect persisted artifacts. Injected-host tests are explicitly not live-host evidence.
- Never Block on the Human. Reversible offline implementation continued while the manager provider/model question remained pending. No paid authorization was inferred.

## Findings and disposition

1. Evaluator errors could become measured timeouts if cleanup crossed the deadline.
   The runner now retains execution failure independently. A regression test covers
   an evaluator exception followed by slow cleanup.
2. Durable event writes did not sync the new run directory's parent entry.
   The runner now syncs that parent after exclusive directory creation.
3. Including the fixture in one arm-level harness digest prevented multiple
   different episodes from using a registration. Fixture/check identity now binds
   per episode through task, reset, and executable completion criteria.
4. Real Flow output under `.flow` failed the strict undeclared-file check.
   Frozen generated-directory allowances permit declared output during evaluation.
   Reset verification remains strict.
5. Primary-only safety gates overlooked unsafe secondary selections.
   Any observed unsafe Jev selection now vetoes qualification. Only primary cases
   contribute to the statistical denominator.
6. An interval diagnostic could override a failing point target.
   Qualification now requires both the point target and interval condition.

The independent comment audit found no scoped comments or suppressions to remove.
No reviewer edited application code. The parent inspected changes and ran checks.
All agents used inherited model settings. Cross-model diversity was not verified.
No review lane was cancelled or omitted. The implementation paths were exclusive;
read-only and design lanes shared the checkout.

## Attention

Live execution is still disabled. The host adapter has injected-host tests only.
All-model monetary enforcement, an isolated Jev treatment, operator-resume events,
artifact-byte verification, and a real-host integration run remain code/verification
work. Real reviewed data and budgeted qualification remain external evidence work.
The calibration connection is checked by the separate binding command and combined
qualification report; existing collection does not automatically enforce that link.

The local decision trail is `/tmp/flow-completion-decisions.tsv`. Source files and
verification commands are retained in the repository. Temporary logs and design
candidates are not release artifacts.
