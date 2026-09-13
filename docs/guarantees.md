# What Flow guarantees

Flow plans, validates, and independently reviews work before reporting it done.
This contract distinguishes runtime enforcement, trusted host observations, and
model judgments. Each tier names what can fail.

## The five tiers

| Tier | What it means | If the model is wrong |
| --- | --- | --- |
| **TS-enforced** | A type, schema, or transition guard refuses the state. | The call fails. |
| **Host-attested** | OpenCode reports the fact; Flow records it and cannot forge it. | Recorded as ineligible, never as a pass. |
| **Caller-declared** | Flow validates the shape, not the truth. | Stored as a declaration and labelled as one. |
| **Model-judgment** | A prompt asks for it; nothing checks it. | Silently wrong. |
| **Unenforced** | Known gap, deliberately not closed. | Silently wrong. |

## TS-enforced

- One active feature run; dependencies complete before a run starts.
- A plan is a bounded acyclic graph, immutable after approval.
- `completed` closure requires a completed current run for every planned feature.
  Inspections may complete with blocking findings, without full completion assurance.
- Exactly one review assignment per run; `feature` or `final` is derived, never
  chosen by the caller.
- Only the reserved `flow-reviewer` identity may submit a new review result.
- A failed verdict needs a blocking finding; a passing verdict cannot carry one.
- A failed review must carry every still-live prior finding id forward.
- Review is refused while a vetoed command's latest evidence is not a pass:
  any command an observation claimed at `broad` scope, any command whose bytes
  match the feature's plan-listed validation, and the plan's gate command.
- A `broad` observation must run the plan's gate command byte-for-byte, and may
  not select which tests it runs.
- Final review requires a passing broad observation for current source.
- Final review and `completed` closure are refused while any `plan.evidence`
  entry has not passed on the OS that entry declared. Feature reviews are not,
  so a goal can be split into the half this host can prove and the half it cannot.
- One revision per accepted mutation; an operation id replays exactly or conflicts.
  Validation observations replay by capture id, not operation id.
- Every mutation validates the whole schema and writes atomically under one
  cross-process lock.

## Host-attested

- The validated command's **exit code** and **output truncation flag**, read from
  the host's own Bash metadata. A model cannot report these; a host that reports
  neither yields a durable never-passing observation rather than a silent pass.
- That the executed command's bytes equal the armed command.
- The **host platform** each observation ran on, normalized from what the runtime
  reports. A model cannot claim it, and an evidence entry naming an OS is
  satisfied only by an observation recorded on it.
- **Which declared test cases the command reported passing**, read from a JUnit report
  the command wrote after Flow armed it. An entry naming cases is satisfied only when
  each is reported `passed`; `skipped` and `absent` discharge nothing, so exit zero for
  a case that never ran no longer counts ([ADR 0012](adr/0012-named-results-over-exit-codes.md)).
- The **workspace-content digest** binding validation and review to source. It is a
  content fingerprint of tracked, non-ignored files — not a Git audit chain, and it
  cannot see an edit that reverts before persistence.
- The reviewer's agent identity on submission.

## Caller-declared

- `artifactsChanged`. Flow validates bounded workspace-relative paths and labels
  them Flow-reported. It does not prove a path exists, changed, or is exhaustive.
- The plan's gate command itself. Nothing decides whether a command is a *test*:
  a plan may declare a check that cannot fail. That decision is made at planning
  time, in the document the user approves.
- Feature `validation` prose, `targets`, `requirements`, and closure summaries.

## Model-judgment

The runtime cannot enforce these judgments. Read the review before trusting its verdict.

- **Goal alignment.** Whether a request continues the same goal. Evaluated by
  `goal-change-refused` and `continuation-accepted` in `evals/`.
- **Review substance.** That the reviewer read the artifacts, completed the risk
  checklist, and failed an unprovable claim instead of passing it conditionally.
  `unprovable-claim-refused` and `defect-fails-review` put work in front of it that
  should not pass; neither can force the review path.
- **Reviewer independence.** Without an explicit reviewer model from plugin tuple
  configuration or `OPENCODE_FLOW_REVIEWER_MODEL`, the reviewer shares the
  manager's model; independence rests on structure alone.
- **Evidence completeness.** Whether an entry names the requested observation,
  a suitable command, and the required platform. Plan approval and review judge
  fitness. The runtime checks that the declared command passed on the declared OS.
- **Scope discipline.** That implementation stayed inside the approved plan, and
  that a worker wave respected its assigned paths.
- **Honest reporting.** That the closing summary matches what happened.

## Unenforced

- A declared gate that cannot fail. See Caller-declared above.
- A suite that skips where no case names were declared. `assertions: []` keeps the
  exit-code rule, which is the honest answer for a credential or a device and the
  remaining escape for a test result. See Caller-declared.
- Plans saved before `plan.evidence` existed. They declare none and keep the
  older, weaker rules: `broad` is the claimant's word, and no acceptance
  observation is owed. This build does not hydrate `gate` or `externalEvidence`.
- Worker file boundaries beyond `.flow`, `.git`, and Bash denial. Exact per-slice
  write paths are a prompt contract the manager audits afterward.
- `/flow-auto` continuation across model turns, which depends on an unversioned
  host surface. Capability-gated and best-effort: see
  [ADR 0008](adr/0008-bounded-auto-continuation.md).

## Threat model

Who can break a run, and what each is up against.

- **A misbehaving model.** The manager runs with the user's own OpenCode
  permissions by design, since it is the user's agent and Flow does not sandbox
  it. What Flow enforces is that the lifecycle cannot be talked into existence.
  An armed validation command runs byte-for-byte or the observation is
  ineligible, the exit code and output-completeness flag come from the host's
  Bash metadata, and only the reserved reviewer identity submits a review result.
  The hidden worker and reviewer agents do get a deny matrix: no Bash, no
  external directories, no skills, no delegation, no Flow lifecycle tools. The
  reviewer cannot edit at all, and the worker cannot touch `.flow` or `.git`.
- **A compromised host.** Nothing. The host's own reports are the root of trust
  for exit codes, platform, and truncation, so a host that lies defeats every
  host-attested row above. Flow's answer is limited to failing visibly when the
  host reports nothing.
- **User error at approval.** The gate command and the evidence entries are
  approved with the plan, and their fitness stays caller-declared. A gate that
  cannot fail is a declared gate, not an enforced one.

Armed commands have no extra allowlist. Host permissions and plan approval govern
their use. Flow guarantees byte-equality, not command safety. The Unenforced tier
describes worker path limits.

## Assurance at close

Every close derives `delivery.assurance` from canonical closed state. It labels tiers
and limits, distinguishes supported/unsupported/unclaimed completion, marks legacy
gaps not applicable, and is neither persisted nor a correctness probability. See
[ADR 0013](adr/0013-derived-assurance-and-paired-value-measurement.md).
`delivery.handoff.externalActionAuthority` is always `not-granted`; close handoff never
authorizes PR creation, merge, publication, or release work.

## How this page is kept honest

Every enforced row has a test; every judgment is evaluated or labelled unmeasured.
That mapping is maintained by hand, not machine-checked. Eval false completion
independently audits the document, while the paired benchmark measures
hidden-graded correctness against ordinary OpenCode.

Release thresholds are in [release qualification](release-qualification.md).

## Terminal recovery and inspection outcomes

New nonterminal mutations reserve terminal capacity. Legacy full v5 sessions
remain readable and can use the bounded extension except at revision exhaustion. Operation IDs
remain intact. Extended archives support exact replay with a compatible reader.
[Terminal capacity](maintainer-contract.md#terminal-capacity) defines the limits
and downgrade boundary.

An inspection with blocking findings is complete as an inspection. Its findings
remain visible in delivery and prevent full completion assurance. A change run
with a failed review remains blocked. These distinctions are runtime-enforced
and covered by `tests/runtime-close.test.ts`, `tests/assurance-projection.test.ts`,
and `tests/session-capacity.test.ts`.
