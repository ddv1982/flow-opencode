# Skill Review Checklist

Use this checklist when reviewing changes under `skills/**`. Skill quality is review-owned: tests can catch stale tool names and obvious contract drift, but they cannot prove the instructions will drive good agent behavior.

## Checklist

- Does every state-changing instruction route through a registered `flow_*` tool, with no direct edits to `.flow/**`?
- Does the skill preserve the skills-vs-code split: judgment in skills, binary persistence and completion gates in runtime code?
- Does planning avoid invented scope, unnecessary features, and separate "write tests" cleanup features?
- Are auto-approval conditions narrow enough for small, non-destructive work the user has actually authorized?
- Does execution stay one feature at a time and treat scope growth as a plan-change decision?
- Does validation require commands that actually ran, with honest gaps instead of implied success?
- Does review stay read-only and route fixes back through execution?
- Does final review check the session done condition, broad validation, and cross-feature integration?
- Does final review check behavior, not just review accounting or the presence of recorded evidence?
- For small diffs, does the review still account for lifecycle, async, state rollback, data-loss, or test-oracle risk when those surfaces are touched?
- For audit-style deliverables, does the review attempt to refute blocking findings instead of only verifying that cited files or lines exist?
- For parallel orchestration, do workers stay read-only by default and avoid state-changing `flow_*` tools?
- Does the manager synthesize worker handoffs into existing Flow fields instead of persisting raw worker state?
- Are parallel validation checks independent, with command, scope, environment, and observed outcome preserved?
- Are worker findings treated as candidate evidence until deduplicated, reconciled, and refuted where needed?
- Does recovery guidance anchor on `flow_status` and runtime recovery metadata instead of conversation memory or repeated tool-call symptoms?
- Are reference files loaded only when their skill says they are needed, and are those references still named correctly?
- Does recovery stop repeated failed attempts instead of encouraging loops?
- Are terms, tool names, command names, and runtime policies consistent with `README.md` and `docs/maintainer-contract.md`?
