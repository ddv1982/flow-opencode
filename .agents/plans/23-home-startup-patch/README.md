# Flow 10.0.3 home-startup patch

The operator requested a new release without new model qualification on
2026-10-29, and explicitly invoked full-stop: prepare an open, reviewed PR; do
not merge or publish from that task.

The published 10.0.2 package fails plugin setup when OpenCode loads its global
configuration at home. A workspace safety guard is correct for mutation but was
also used as a fatal startup precondition. The patch handles that precise error
as an inactive plugin location with an actionable warning. It does not create
home state or weaken root, missing-directory, validation or review guards.

## Release assurance

Use the existing baseline-qualified-patch route with an exact-version reviewed
startup exception. Compare directly against measured source `fdd11b7d` and the
published `v10.0.2` tag at `a920f737`. The patch record binds candidate package
bytes and both changed runtime files. The 10.0.2 matrix (80/81 under unchanged
thresholds) and native canary (6/6) remain historical. No model evaluation or
model canary is measured for 10.0.3. Full-matrix two-provider policy is unchanged.

The provider-free native regression must reject the published artifact and pass
the patch at home, in a Git project and in a non-Git folder. CI also runs full
checks, replay, package smoke and strict baseline/patch verification. Changes to
approved code require refreshed hashes and review; no skip flag is added.

Dependabot PRs #213 and #214 remain separate: dependencies and lockfiles stay
identical to the measured baseline for this narrowly reviewed patch.

## Linux installation after publication

```sh
opencode2 plugin add opencode-plugin-flow@10.0.3
cd /path/to/your/project
opencode2
```

An exact existing 10.0.2 pin does not update itself. No software was installed on
the user's Linux laptop by this work. Publication needs a merged commit and its
annotated version tag; the existing workflow owns npm and GitHub publication.
