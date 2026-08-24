# Architecture critique verdict

## Intent

Preserve Flow's strong runtime and real-host harness while making evaluation
results trustworthy enough to guide product changes and bind release claims to
the exact artifact measured.

## Act on

1. Qualification must fail closed on a versioned report schema and derive its
   verdict from atomic attempt rows. The current qualifier can accept a report
   that names every gated scenario in `results` but supplies pass rates for only
   `happy-path`. This was reproduced directly against
   `qualificationFailures()`.
2. Reports and qualification records must identify the exact source, packed
   artifact, evaluator revision, host configuration, manager model, and reviewer
   model. A version string is not enough to bind evidence to a release.
3. Comparative runs must be controlled paired experiments. Baseline and
   candidate artifacts need randomized blocks, pair completeness, a declared
   primary outcome, an abort policy, an effect estimate, uncertainty, a planned
   sample size, and a stopping rule.
4. Reviewer quality needs its own experiment over fixed candidate states. The
   manager path must not decide whether the reviewer receives a planted defect.
   The report must measure reviewer detection and false-positive rates and record
   the actual reviewer model.
5. Product value needs more hidden executable outcomes. Conformance scenarios
   remain useful, but three small benchmark tasks cannot establish that Flow
   improves correctness enough to justify its cost and latency.
6. Scenario evidence policy must be machine-readable and scenario-specific.
   The current common floor of three attempts gives 90 percent and 100 percent
   thresholds the same observed requirement.
7. Evaluator failures, host failures, provider failures, product failures, and
   user escalations must remain distinct. A grader exception must never become an
   excluded environment attempt.
8. Actual instruction exposure must be recorded. The existing prompt footprint
   omits lazily loaded guidance and cannot explain prompt-cost changes.
9. Release automation must state one publishing policy and mechanically require
   the evidence tier appropriate to behavior-changing releases.

## Consider

- Add a credential-free installed lifecycle canary around a deterministic host
  path. Keep the existing packed smoke narrow and fast.
- Replace wording and write-payload proxies with executable or structured
  oracles when a scenario is promoted. Do not block exploratory scenarios on
  perfect graders.
- Add longitudinal report comparison once report integrity and experiment design
  are stable. Trend dashboards built on the current schema would preserve weak
  semantics.

## Noted

- Decision cassettes are a good runtime regression layer. They are not fresh
  capability evidence and should stay separate.
- Mirroring persisted Session shape in eval code is useful evaluator
  independence. The boundary needs defensive parsing, not shared product types.
- Same-model review is a valid minimum product mode when reported honestly. It
  cannot support a cross-family independence claim.
- The packed live smoke should not absorb model-driven lifecycle tests.

## Dismissed

- Hidden graders are not exposed merely because their source lives in this
  repository. Candidate OpenCode hosts receive isolated fixture projects and a
  packed plugin, not the Flow source checkout. Evaluation labels still leak in
  the current benchmark prompt and fixture names, so blinding remains worth
  fixing.
- Replacing the current harness with an external eval framework does not earn its
  cost. Inspect AI and similar systems provide useful patterns, but Flow already
  has the important host integration. The smaller move is to add missing domain
  models and analysis tools in-repo.

## Agreement map

All four critics agreed that the paired benchmark is not decision-grade and that
reviewer identity and reviewer substance are not attributable. Three critics
independently raised scenario-specific sample discipline, release-policy gaps,
and incomplete prompt-footprint measurement. Two independently raised exact
artifact provenance. One critic found the malformed-report qualification defect,
which direct reproduction confirmed. One found that evaluator exceptions can be
misclassified as environment failures. That remains a high-severity finding
because the code path is concrete even without panel consensus.
