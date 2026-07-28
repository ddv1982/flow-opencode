# ADR 0012: Acceptance Evidence Names Test Cases, Not Exit Codes

Date: 2026-07-28

## Status

Accepted. Closes the limitation [ADR 0011](0011-declared-external-evidence.md)
recorded rather than fixed.

## Context

ADR 0011's amendment ends on an admission: "Flow still cannot see a suite that
skips — it reads exit codes, not skip counts — which is why the check is on the host
rather than on the result."

That was the right move with the evidence available, and it is half a fix. Comparing
the declared `platform` against the host an observation ran on closes the *wrong
machine*. It does nothing about the same skip on the right one, where the command
exits zero for a case guarded by a runtime check, excluded by a filter, renamed out of
the run, or never written. Every route lands where the measured failure landed: a
green process, a true record, and the acceptance criterion unobserved.

The gap is not about environments. `exitCode === 0` is the only result Flow has ever
recorded about a command, and a process succeeding never meant a particular case ran.
Three evidence rules — the declared gate, the declared environment, the declared
command — all terminate in that one number.

## Decision

**Declare the cases at planning time.** Each `externalEvidence` entry carries
`assertions`: the test case names whose passing *is* that observation. `savePlan`
requires the field; an empty list is the common and correct answer for a credential,
a device, or a setting, and keeps the exit-code rule.

**Satisfy it only from a report the command wrote.** `flow_validation_start` takes
`resultsPath`, the repository-relative JUnit XML the command produces. After the
command, the runtime reads that file and records what it said about each declared
name — `passed`, `failed`, `skipped`, or `absent` — as `observedAssertions`.

**Read the names from the plan, never from the caller.** The caller supplies only
where its command writes a report, because only it knows that. Which names to look
for comes from the approved plan. This is the same split
[SLSA provenance](https://slsa.dev/spec/v1.2/build-provenance) draws between
`externalParameters`, which are under external control and must be verified, and
fields the build platform populates, which need no verification because the platform
is trusted.

**Require the report to postdate the arming.** A path is caller-supplied, so a report
left from an earlier run — or committed by hand — would otherwise discharge an entry
no command produced anything for. A file not modified after arming is read as no
report at all.

**Fail closed, identically, on every absence.** No `resultsPath`, an unreadable file,
a path escaping the workspace, an oversized file, unparseable XML: each records every
declared name as `absent`, because they all mean nothing observed those cases.

**Count it in the metric too.** `completionHonesty` compares declared names against
recorded outcomes, so the release number does not depend on the veto it measures.

## Simplicity boundary

One field per entry, two per observation, one optional tool parameter, and a JUnit
reader. No new tool, no new lifecycle state, no test-runner integration: Flow does not
run the command, does not choose the reporter, and does not know which runner produced
the file. It reads four attributes out of one element.

Regex over XML, which is normally wrong, is right here: one bounded, well-specified
element, and a parser dependency to read four attributes is a worse trade than a
pattern with a suite pinning it. JUnit XML because it is the one format every runner
already emits — `bun test --reporter=junit`, likewise jest, vitest, pytest, go, cargo
— so one reader covers the repositories Flow runs in without adopting anything.

Only `externalEvidence` names cases. `plan.gate` does not, and should not: a gate is a
whole-suite claim, and naming a handful of cases inside it would make it look narrower
than it is.

## Consequences

The route the amendment closed is now closed from both ends. An entry declaring
`platform: "win32"` and `assertions: ["creates the replacement on Windows"]` cannot be
discharged by any run on Linux, and cannot be discharged on Windows either unless that
case is reported passing.

`assertions: []` is the remaining escape, and it is deliberate — the same trade as
`platform: "other"`. An entry whose acceptance is a credential has no case names, so
refusing an empty list would make the honest answer unavailable. What the field buys
is that the empty list is a visible line in the plan the user approves, and the
reviewer is given the entries.

This is the third field of this shape, and that is the finding. Each closed a real
measured failure, and each added one more thing a plan must declare and a reader must
check. The next move is not a fourth: it is to collapse the gate, the environment, and
the named results into one evidence record with one satisfaction rule, and to stop the
declarer from being the party that benefits from a weak declaration.

A repository whose runner emits no machine-readable report can declare no assertions
and keeps exactly the behavior it had before this ADR.

## Rejected alternatives

**Parsing the command's output text.** Flow stores an output digest, never the text,
deliberately. Recovering "3 pass, 1 skip" from prose is a classifier over English,
which is what ADR 0011 rejected for the environment and rejects again here.

**Counting skips instead of naming cases.** A skip count catches a suite that skipped
*something*, not the suite that skipped *the case the acceptance turns on*, and it
cannot see a case that was never written. Naming is what makes it checkable.

**Letting the caller supply the names alongside the results.** The shape of every
failure these ADRs record: the party that benefits from a weak claim writing it after
seeing the result. The names are fixed in the approved plan, before there is a report.

**Requiring `resultsPath` whenever assertions are declared.** It would turn a silent
`absent` into an upfront refusal, and it also forbids arming the command once to see
what its report contains. The `absent` outcome already refuses everything a missing
path would have.

**Failing the observation itself when a declared case did not pass.** The observation
is a true record of what the command did, and the gate rules read its exit code too.
Marking it ineligible would let one entry's unmet case invalidate the repository gate,
which is a different claim.
