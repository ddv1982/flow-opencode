# ADR 0012: Acceptance Evidence Names Test Cases, Not Exit Codes

Date: 2026-07-28

## Status

Accepted. Amended on 2026-08-28 after the release matrix exposed unusable
immutable report declarations. Closes the limitation
[ADR 0011](0011-declared-external-evidence.md) recorded rather than fixed.

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

**Bind the report at planning time.** A named evidence command writes
`.flow/results.xml`. Flow rejects a new named plan whose command lacks that exact
path. The `.flow` namespace is already outside the source fingerprint, so writing
evidence cannot make its own validation source-stale.

**Satisfy it only from a report the command wrote.** `flow_validation_start` uses
the approved path when the caller omits it and rejects a different caller path.
After the command, the runtime reads that file and records what it said about each
declared name as `passed`, `failed`, `skipped`, or `absent`.

**Read the names and path from the approved command, never from the execution
caller.** The optional execution-time path remains only for approved Session v5
plans written before this amendment.

**Require a change during the command window.** Before the exact command, Flow
snapshots any report's digest and mtime. Afterward, it accepts only a changed report
modified after arming and no later than command observation.

**Fail closed at both boundaries.** A new named plan with no safe managed path is
rejected before approval. For legacy plans, an omitted, unsafe, unreadable, stale,
unstable, oversized, malformed, or unparseable report records every declared name
as `absent`.

## Simplicity boundary

One assertion field, two observation fields, one compatibility parameter, and a
JUnit reader. No new persisted field, tool, lifecycle state, or test-runner
integration. Flow binds one managed convention and reads four attributes.

The bounded JUnit reader extracts only the attributes needed for declared names.
Common test runners can produce the format without Flow learning runner-specific
output text.

Amended 2026-09-05: strict XML parsing replaces regex extraction, which accepted
cases inside comments, CDATA, and truncated documents. Only cases within suite
structure count; any parse error or DTD discards the report. The parser lives in
infrastructure and retains only declared names, with no new state fields.

Gate and extra evidence use the same record. A whole-suite exit claim uses
`assertions: []`. A gate may also bind an exact acceptance case when that case is
part of the whole-suite command; the command still remains the canonical broad gate.

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

**Letting new plans defer `resultsPath` until execution.** This was the original
decision. Campaign `2026-08-28T11-10-09-556Z.v2` disproved it. OpenAI repeatedly
approved a JUnit command and later supplied an incompatible or absolute path. The
runtime failed closed, but the immutable plan could not recover. New plans therefore
bind the managed path in the command before approval; approved legacy plans retain
the old fallback.

**Failing the observation itself when a declared case did not pass.** The observation
is a true record of what the command did, and the gate rules read its exit code too.
Marking it ineligible would let one entry's unmet case invalidate the repository gate,
which is a different claim.
