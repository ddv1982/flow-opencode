# Run the external Flow pilot

Use this pilot to measure first-use friction, evidence selection, review, and
recovery without adding telemetry. Submit one report per Flow session through
the Flow pilot issue form.

## Pilot target

The first pilot ends after all of these conditions hold:

- Five people outside the maintainer's normal test loop participate.
- They complete at least ten sessions across three repository toolchains.
- Two sessions recover after interruption or a blocked review.
- Two sessions request an explicit reviewer model and record whether review
  dispatch completed.

These counts measure participation. They do not prove correctness.

## Run a session

1. Follow [Start a verified Flow session](quickstart.md).
2. Choose a consequential task that you already understand well enough to judge.
3. Record the intended canonical gate before planning.
4. Run Flow through closure or a user-direction checkpoint.
5. Submit the structured pilot report.

## Report only bounded facts

Include the OpenCode version, operating system, repository toolchain, reviewer
selection mode, intended gate, planned gate, terminal status, recovery outcome,
elapsed time, and the step that was unclear. Include a minimal reproduction only
when the same problem can be shown without private source.

Do not attach `.flow/session.json`, provider credentials, repository source,
unredacted transcripts, raw command output, or customer data. Flow has no upload
hook and collects no telemetry.

## Review the pilot

Group reports into setup, planning evidence, execution, review, and recovery.
Promote repeated, reproducible problems into product work. Keep one-off
preferences in the pilot report. Do not turn a pilot count into a release gate.
New release thresholds need two complete provider baselines and the existing
qualification process.
