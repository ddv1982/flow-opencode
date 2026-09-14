# Manager inventory handoff change

2026-09-14. Implements recommendation 1 from the retained evidence audit.

The manager's Review instructions now require the baseline inventory in the
existing packet summary. They cover the complete feature base diff, additions,
modifications, deletions, renames, file types, generated artifacts, modes, and
unrelated pre-existing work. Missing or conflicting evidence must be explicit.
The inventory remains manager-supplied; Flow does not attest its completeness.

The reviewer already consumes this evidence for Git-only metadata and inspects
the changed artifacts independently. Its rules and permissions are unchanged.
No new packet field, runtime gate, Git command sequence, or review is introduced.

## Offline worked packet

This example summarizes the retained Sol filename retry's observed metadata.
It is an illustration written by the assistant, not a new model evaluation.
In the existing `packet.summary`, alongside the implementation/validation summary:

> Baseline inventory: the complete feature diff modifies src/platform.ts and
> src/platform.test.ts only. Both remain regular tracked files, mode 100644.
> No additions, deletions, renames, generated artifacts, or mode changes appear
> in that diff. Untracked opencode.json pre-existed the feature and is unrelated.
> These are manager-observed Git facts, not Flow-attested inventory completeness.

This supplies the exact missing evidence named by
`reserved-windows-device-filenames.R5-01`. The original repaired packet and
passing verdict are retained in inventory.json. That historical pass does not
prove a future model will follow the new instruction or avoid the first retry.

For an incomplete observation, the manager must instead identify the gap, for
example: “The tracked diff is inventoried; untracked-file scope is unverified.”
It must not replace an unknown fact with “no unrelated changes.” The reviewer
continues to decide whether the missing evidence blocks the approved outcome.

## Validation

The skill frontmatter validator passes. Existing documentation and prompt-quality
checks pass (30 tests), including maintained prose and prompt budgets. Direct
inspection confirms each reviewer inventory requirement has a manager-side
instruction and missing facts remain explicit. No wording-matching test was added.

This is instruction alignment supported by an observed handoff failure. Reduced
retry frequency, cost savings, and reviewer accuracy remain unmeasured. No paid
eval or canary is required or authorized by this change.
