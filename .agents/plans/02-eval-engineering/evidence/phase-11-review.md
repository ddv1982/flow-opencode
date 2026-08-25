# Phase 11 architecture and review record

## Architecture Arena

Three candidates compared the remaining long-request fixes against exact OpenCode
1.18.6 behavior. The independent judge scored the designs on command-hook
preservation, narrow timeout ownership, existing cancellation, bounded short
requests, verification strength, and reader cost.

| Candidate | Score | Design |
| --- | ---: | --- |
| A | 28/30 | Dedicated Bun session-post adapter with `timeout: false` and required owner signal. |
| C | 25/30 | Generic post policy union with a Bun timeout mode. |
| B | 15/30 | Change Flow's plugin `prompt_async` continuation path. |

Candidate A won. Candidate C contributed the type invariant that the timeout
opt-out requires an owner signal. Candidate B was rejected because it changes the
wrong request and does not preserve `/command` expansion or Flow's awaited command
hook. `node:http`, global timeout disablement, and local `/prompt_async` command
emulation were also rejected.

## TDD and review sequence

The inspect wording and benchmark schema tests failed before their contract fixes.
The transport regression failed because `postSessionJson` did not exist. The
adapter-level test now observes the exact owner signal and `timeout: false` on the
actual fetch init. Order-independent known-good fixtures failed before grader
changes. Interrogate then supplied negated inspect statements, a visible
source-marker bypass, property-order variants, missing Markdown value semantics,
sparse-line semantics, total-line semantics, and blank/empty-document coverage as
additional red cases before each correction.

The final panel found two remaining false-positive paths. A negated numeric claim
could pass beside an unrelated blocker or inside a contradictory digest. A digest
could also pass without delivering the finding to the user. Both regressions
failed against that code. A later panel pass showed that surrounding delivery text
could still negate an embedded certificate. The grader now requires one exact
public certificate in both a live, failed, blocking compact-digest row and the
complete final response, with no other response text. A fresh Grok inspect run
already had that exact shape. It passed in 183 seconds, preserved the independent
false-completion finding, and replayed `MATCH`. The final check also requires a
completed `flow_status` call with an `ok` response and reports digest and delivery
failures separately.

The final four-model Interrogate recheck reported no critical or warning findings.
`phase-11-final-interrogate.md` preserves each final response.

CI exposed one stale hand-written inspect cassette that still encoded the old
free-form contract. The cassette now uses the exact certificate in both its failed
blocking finding and final response, and the committed replay gate reproduces all
13 cassettes.

The automated PR review also found that the scenario catalog still described the
superseded final-text, close-delivery, or digest rule. The catalog now states the
exact digest-and-final conjunction.

Deslop kept the Bun-specific behavior in one eval-only adapter. Generic short
requests and Flow runtime code remain unchanged. The final repository gate passes
534 tests with one intentional live-smoke skip and no failures. The three existing
Biome template-placeholder warnings are outside this diff.
