# Proposed first funded comparison

Status: prepared, not authorized or executed. No provider requests made.

Compare the frozen f10c386 production guides against the independently reviewed
compact guide artifact. Both retain the same runtime and kernel delivery. Two
separate smoke studies request GPT-6 Astra and Claude Fable 5 at high effort for
both manager and reviewer. Native catalog and entitlement checks must pass;
requested effort is not proof of effective provider effort.

Each study uses two development tasks, one pair per task, four task attempts,
no reserves, and one separately budgeted entitlement probe. Across both studies:
eight task attempts and at most two probe requests. No holdout tasks are selected.

Proposed observed stop allowances: $25 for each study plus $1 for each preflight,
$52 total. These are soft limits, not invoice caps; a single in-flight request can
exceed a threshold. Unknown cost stops execution. Each study additionally allows
80,000 generated tokens and 40 minutes, with 1,000 tokens and two minutes for its
preflight. The $5-per-attempt estimate is an explicit planning allowance, not a
forecast from these new models. Review provider billing independently.

This smoke can expose transport, grading, and gross workflow problems. It cannot
establish noninferiority, model superiority, reviewer calibration, or the plan's
efficiency target. Stop after these studies and review evidence before freezing
or funding a larger exploratory sample. Production guides remain unchanged.

Run only the dry-run command until the operator authorizes the spend. Executable
commands are `bun run benchmark -- --manifest <astra.json or fable.json>`;
append `--dry-run` to inspect without starting a host or copying credentials.

Artifact paths are relative to each manifest. Packed tarballs remain local; a
fresh clone needs the exact retained artifacts described in the work-record
README before either dry-run can pass.
