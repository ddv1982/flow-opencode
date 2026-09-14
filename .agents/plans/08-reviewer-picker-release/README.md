# Offline qualification for the reviewed 8.4.0 picker

The operator explicitly authorized a provider-free qualification path for this
feature on 2026-09-14. This path covers only 8.4.0 and reviewer-picker-v1. It does
not establish live model behavior or provide a reusable exemption for new features.

## Frozen scope

scripts/feature-release.ts pins the merged PR #78 commit
ff605d9bb7e814cddd4d22f7e55ca251f8de60bc. Every enumerated picker source, server
configuration adapter, prior flow-run guide, package manifest and build/type
surface must match that commit's Git blob and regular-file mode exactly.
The commit must remain an ancestor of the candidate. Any edit, removal, or mode
change fails even if a new manifest claims approval. The approved file list is
code-owned, not supplied by the release record.

Other differences from the fully measured 8.3.0 source must satisfy the existing
patch tooling/documentation allowance. Domain logic, persistence, validation,
review gates, other guides, lockfiles, and unknown paths remain excluded.
Dependencies, engines, package identity and package manager must match 8.3.0.
Formatter settings must match the reviewed feature commit.

## Baseline and assurance

The original 8.3.0 matrix and canary remain baseline evidence only. The baseline
must independently regrade under current verifier authority, match its tag and
artifact, and satisfy the unchanged seven-day matrix and 72-hour canary limits.
A new seal may retain the same original evidence under current verifier sources;
it is not a rerun or a new candidate measurement. Baseline-qualified 8.3.1 cannot
substitute for the fully measured baseline. Original evidence and seals remain intact.

Candidate assurance consists of reviewed frozen code, full deterministic checks,
all retained gated replays, package checks, and the provider-free OpenCode smoke.
PR #78 also exercised native picker/confirmation rendering with a synthetic catalog
and real global-config save/reset behavior in an isolated host without submitting
a model prompt. These checks do not measure reviewer accuracy or coding outcomes.

The new feature record binds exact candidate tarball/manifest hashes, names the
reviewed commit and feature, and records the operator's rationale. Generated release
notes explicitly state that no candidate live model eval or canary ran and that
prior 76/76 passes belong to 8.3.0. No result is relabeled VERIFIED for 8.4.0's model
behavior. No paid-run authorization is created by this policy.

## Publication and recovery

The explicit CLI mode is --feature, separate from --patch and --canary. Exactly
one mode is accepted. CI and publication select it only when the candidate's
record exists under evals/qualification/features/. Conflicting patch and feature
records fail. Ordinary development commits without a new release declaration do
not rerun candidate qualification.

The baseline bundle is retained under this plan's baselines/ directory. It is a
canonical content-addressed archive, not maintained prose or formatter input.
Initialization and resume both recheck the exact feature record, code boundary,
artifact and fresh baseline. Existing full and patch release records stay valid.
The release record keeps its optional feature path and binds the feature record
hash through bundleSha256. Remote publication convergence is unchanged.

The offline CI candidate job runs replay and provider-free host smoke before
initialization. The publication workflow also runs replay before packing, alongside
its existing full checks and provider-free host smoke. Expired or mismatched
evidence stops publication; it never starts a model run automatically.
