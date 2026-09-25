# Current-code JEV-2 and JEV-3 unit verification

The required JEV-2 and JEV-3 focused Bun commands ran at code head `39c144b193606456a6f5413ba86ecd1f9190608b`. JEV-2 passed 113 tests across five files; JEV-3 passed 142 tests across five files. The [receipt](receipt.json) binds both full logs, focused test bytes, package and lockfile, and the measured commit. `bun .agents/plans/16-jev-autonomous-decisions/evidence/unit-current/verify.ts` recomputes those hashes and refuses changes to runtime, skills, evaluations, scripts, tests, or root build inputs on the current branch, including uncommitted files.

The JEV-2 log includes pre-transport key and packet refusal, shadow advice without mutation authority, source-drift refusal, exact accepted-operation replay, and preservation of the first automatic reset. The JEV-3 log includes Session v5 exact-operation replay, explicit retry requirements while independent work continues, cancellation fencing, deduplication of concurrent proposals, and refusal to mint new authority from an old reset replay. Both commands used only local test doubles and made no paid provider call.

These are **unit-gate results only**. They do not close the JEV-2/JEV-3 real-host interaction lanes, live decision quality, or performance comparisons, and they do not qualify delegated recovery.
