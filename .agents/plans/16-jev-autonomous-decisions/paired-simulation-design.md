# Paired simulation proof

The existing host checks exercise guarded recovery and operator continuation
separately. This change combines them under one frozen episode registration and
produces a comparison from recovered journals for each selected manager.

## Chosen structure

Use an opt-in integration test to compose the existing episode APIs. Each manager
gets a separate registration, finite simulation budget, two sequential isolated
hosts, and paired report. Register both actual arm identities before execution.
The combined script uses actual tool results to propose recovery, apply the
returned grant when available, ask a question, and continue after a bound reply.

Build a deterministic blocked Flow session through existing domain helpers before
registration. Declare its bytes among the fixture files. Both arms start from the
same file map. Frozen Git ignore rules exclude generated host configuration from
Flow approval source identity. The episode reset still verifies the declared
session bytes. No state is inserted after reset verification.

Retain final recovery evidence through a local evaluation wrapper before host
cleanup. Bind its digest into completion evidence. Derive report observations
from recovered journals. Preserve unknown safety and spending measurements.
Retained evidence is test-observed simulation evidence, not independent review.

## Alternatives and synthesis

| Design | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Test-owned composition with retained output | Reuses current runner and report APIs | Requires the test runner to reproduce the proof | Selected |
| Fixed simulation campaign CLI | Dedicated operator command | New command and runtime fixture contract | Deferred |

Independent design review selected the test-owned composition. The selected
design adopts the other proposal's evaluation-time evidence binding. Final state
captured only during stop would not bind that evidence into the completion record.
The source-identity probe confirmed that ignored host configuration does not
change the approved source digest, while workload edits do. Native-host equality
remains part of the integration check.

## Verification contract

Run both arms for OpenAI GPT-5.6 Terra and xAI Grok-4.6 separately. Require equal
registered reset bytes, actual artifact verification, and valid source identity.
Require the treatment's guarded reset before the operator reply and no delegated
reset in control. Check the actual grant operation ID against the persisted reset.
Recover journals, verify continuation in the same session and model, and compare
reports regenerated from retained inputs. Require exactly one Jev request in each
treatment and none in control. Check finite synthetic request reservations.

## Limits

One deterministic pair per manager proves integration. It does not establish
representative tasks, model quality, actual prices, independent review, or a
qualification sample. Scripted operator replies do not measure human judgment.
Reports remain inconclusive. Live execution still requires reviewed cost bounds,
an explicit new paid campaign cap, and the planned qualification evidence.
