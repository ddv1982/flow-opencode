# F2 local verification

The native OpenCode 1.18.6 probe passes eight cases without any provider request.
It proves top-level variant delivery through the existing v1 SDK and shows that
a nested-only follow-up loses the variant. Native variant-only agent config is
visible but does not apply without an explicit agent model. Unknown variant
names also persist, so request acceptance does not prove provider support.
The probe records host termination and removal of disposable state.

The parent ran the implemented configuration, continuation, plugin integration,
and provenance tests. `parent-focused.log` records 101 passes and 431 assertions.
`parent-live-smoke.log` records 21 passes and 86 assertions against the packed
plugin in the pinned host. `docs.log` records 11 passes and 102 assertions.

Independent review found an unrelated model-conflict reason being copied into
missing variant evidence. The owner fixed it and added a regression. The final
scoped review passes. No-comments review recommends zero deletions. The native
protocol comment qualifies as an external-dependency explanation.

The reviewer checked variant forwarding, explicit clearing, checkpoint model
changes, authenticated compaction handling, reviewer option precedence, and the
unsupported variant-only status. Parent and reviewer model-family diversity is
unverified.

The native runtime boundary is committed as 614e6de and 9cd6c51. An isolated
full check initially found the source byte budget exceeded by 586 bytes. Sharing
reviewer setting resolution removed 700 bytes without changing behavior.
`isolated-check-final.log` records 849 passes, one opt-in skip, zero failures,
and 4,531 assertions. The checked worktree had no content difference from
9cd6c51. The parent removed that owned verification worktree after the check.

The combined eval changes still await F1's report and runner verification. Native runtime
changes and eval observation changes have separate file ownership, but the new
report schema and observation helpers must be committed coherently. No provider
application, served-model identity, real reviewer-child execution, or model
quality is qualified by these credential-free checks.
