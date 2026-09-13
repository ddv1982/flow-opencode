# Compact guide candidate coverage

This is an unpromoted rewrite of the plan and run guides. No policy change is intended. Clause coverage is an author check, not proof of semantic equivalence or model benefit. The parent owns independent semantic review before artifact or campaign use.

Original paths below are relative to the repository. Draft paths are relative to this candidate directory. Only this directory was written. Production guides, schemas, registries, kernel text, and delivery code are unchanged.

## Size

Counts include unchanged frontmatter. Words are whitespace-separated, not tokenizer counts. The primary stack is the unchanged auto router, loaded plan guidance, and loaded run guidance joined by newlines.

| Text | Original bytes | Draft bytes | Saved bytes | Original words | Draft words |
| --- | ---: | ---: | ---: | ---: | ---: |
| `skills/flow-plan/SKILL.md` | 6,957 | 6,378 | 579 | 976 | 896 |
| `skills/flow-run/SKILL.md`, before appended kernel | 8,185 | 7,633 | 552 | 1,109 | 1,030 |
| Primary assembled manager stack | 17,346 | 16,215 | 1,131 | 2,386 | 2,227 |

The primary static reduction is 6.5202%. This is larger than the isolated A2a alternative, but changes more wording. It is not a one-factor test of kernel placement or proof that the 25% planning target is feasible under the same constraints. Source and draft SHA-256 values are recorded in `metrics.json`.

## Kernel and entry timing

Neither original raw `SKILL.md` contains a literal manager kernel placeholder. The draft preserves that layout. The existing run-guide assembly remains:

```ts
`${flowRunSkill.trimEnd()}\n\n${FLOW_MANAGER_KERNEL}\n`
```

The plan guide remains the raw file. The orientation guide, auto and direct-run routers, initial retry, continuation, handback, and compaction keep their existing kernel copies and positions. The kernel remains 788 bytes and 103 whitespace words. The primary assembled stack still contains two copies. Tool-only run guidance keeps its copy. No context-tracking state or conditional deduplication was introduced.

## Plan clauses

The original is `skills/flow-plan/SKILL.md`. The draft is [the compact plan guide](skills/flow-plan/SKILL.md). Line references use the bytes identified in `metrics.json`.

| ID | Original lines | Draft lines | Preserved clause and treatment |
| --- | --- | --- | --- |
| P00 | 1-9 | 1-8 | Frontmatter copied byte-for-byte. Purpose remains a concise executable plan grounded in repository facts. |
| P01 | 13 | 12 | Compact status remains the first call. |
| P02 | 14-16 | 13, 22 | Top-level error requires exact summary and recovery, available delivery handoff, an initial-read no-mutation statement, and stop. |
| P03 | 17-20 | 14, 22 | Archive retry precedes alignment, replays the exact projected request, reports delivery or recovery, refreshes only unconfirmed publication, and continues only from a confirmed projection or stops without saving. Cleanup grants no work. |
| P04 | 21-22 | 24 | Close conflicts refresh compact and retry only the same session and goal with a still-permitted kind. Replacements cannot be closed. |
| P05 | 23-25 | 15 | Same-goal or outcome-preserving method/emphasis narrowing remains required before mutation. Completed work is closed. |
| P06 | 25-30 | 16, 20, 22 | Explicit deferred/abandoned choice, non-completed state, compact id/revision, fresh operation id, chosen kind, optional summary, exact archive retry, handoff, and stop remain. Other new scope makes no mutation and gets conversational choices. Fresh-close parameters moved to one local paragraph. |
| P07 | 31-33 | 22 | Delivery report stays verbatim. ID maps use only outcomeSummary/terminalFindings. Missing history is unavailable, never invented or fetched through detail solely for closure. |
| P08 | 34-36 | 17 | Approved same-goal plan-only requests read detail once and report immutable plan/progress without saving, approving, or running. |
| P09 | 37-38 | 18 | Missing plan-save or plan-approve tools remain an incomplete-plugin-load stop. |
| P10 | 39-42 | 26 | Repository inspection stays in manager context. No planning worker. Workers remain for authorized implementation after approval. Only material missing product choices prompt a question. |
| P11 | 43-50 | 30 | Discovery order, requested behavior/current platform, preference for explicit whole-repository commands, non-mutating fitness probes, source/rationale recording, and armed-observation-only proof remain. Moved into a dedicated section. |
| P12 | 54-59 | 34-39 | One plan still names summary, overview, requirements, and decisions with their original meanings. Intentional gaps moved here from the final checklist. |
| P13 | 60-63 | 40, 43 | One canonical whole-repository gate, needed extras, requirement/environment/command/platform/assertions, and the four platform values remain. |
| P14 | 63-69 | 45, 47 | Exact case names, managed JUnit path, complete Bun command, rejection of outfile-only/alternate/absolute paths and all-tests summaries, and empty assertions for non-case claims remain. |
| P15 | 70-75 | 45, 47 | A skipped named case is made runnable only within approved scope or kept as extra evidence on a host where it runs. No local substitute. Separate local proof has empty assertions. Names omit introducer words. |
| P16 | 76-81 | 49 | Broad gate bytes, current-host observability before omitting extras, extra-entry platform/named-case passing before final review and completed closure, and failed/claimed-broad veto remain. |
| P17 | 82-84 | 41 | Ordered features retain stable id, title, summary, bounded targets, concrete validation, dependency IDs, and optional kind. |
| P18 | 86-88 | 51 | One observable outcome, independent-failure/true-dependency splitting, no file-overlap splitting, indivisible invariants, and avoidance of step-shaped features and vague checks remain. |
| P19 | 90-95 | 53 | Exact finding/issue/requirement IDs remain in feature summary or validation and traceable from the immutable plan. Commands remain byte-exact; prose is judgment, not fabricated evidence. |
| P20 | 97-102 | 55 | Inspect-only means no invented repair features. Small inspect feature set, existing paths, reviewer inspection validation, explicit no-edit decision, optional existing gate, and permission before repairs remain. |
| P21 | 104-110 | 39, 57 | Requirement coverage, real targets, behavior-specific validation, true acyclic dependency order, no hidden work, assumptions, and intentional gaps remain. |
| P22 | 114-116 | 61 | Plan save still has one nested request, stable operation id, current revision/zero for new, goal and complete draft. Outcome, feature order, validation, and material decisions are summarized. |
| P23 | 116-121 | 63 | Approval still needs explicit approval or prior autonomous implementation authority, fresh operation id/current revision, and locks the plan. Conversational auto approval needs no new command. A reply may resume only after approval advances the same session. |
| P24 | 123-125 | 65 | Plan-only timing is not persisted as scope. No implementation or plan document without the request. |

## Run clauses

The original is `skills/flow-run/SKILL.md`. The draft is [the compact run guide](skills/flow-run/SKILL.md).

| ID | Original lines | Draft lines | Preserved clause and treatment |
| --- | --- | --- | --- |
| R00 | 1-8 | 1-8 | Frontmatter copied byte-for-byte. Exactly one approved feature remains the scope. |
| R01 | 12-13 | 12 | Compact status first; nextAction is a durable default, not permission. |
| R02 | 14-17 | 13, 21 | Initial top-level error, exact summary, available recovery/delivery, no-mutation statement, stop, and no nextAction routing remain. |
| R03 | 18-21 | 14, 21 | Exact projected archive retry occurs once. Only unconfirmed publication refreshes. Unlike plan guidance, run guidance stops after cleanup either way. No work authority follows. |
| R04 | 22-27 | 15 | Projected active goal is aligned before mutation. Only same-goal or outcome-preserving narrowing continues. Completed work closes. Apart from explicit closure, expansion stays unstarted and unmutated with conversational choices. |
| R05 | 28-31 | 16, 19, 21 | Aligned explicit deferred/abandoned closure of non-completed work keeps exact fresh-close fields, handoff, projected retry, and stop. Parameters moved to one local paragraph. |
| R06 | 32-34 | 17 | Idle/planning status reports its planning action and approved-feature prerequisite, then stops without mutation. |
| R07 | 36-41 | 21, 23 | Verbatim delivery and restricted ID maps, requirement states, abandoned kind, absent-delivery recovery, same-session/goal/kind conflict retry, and no replacement close remain. |
| R08 | 47-49 | 19, 21, 29 | Completed close retains compact id/revision, fresh operation id, completed kind, handoff, at most one exact archive retry, and stop. |
| R09 | 50-52 | 30 | Await-user-direction or blocked reset still reads detail exactly once before blocked-review routing. |
| R10 | 53-55 | 31 | Running reset still means source-stale review. Continuing uses the same feature as nextFeatureId and never redispatches the stale assignment. |
| R11 | 56-60 | 32 | Pending reviewer dispatch rereads execution status, stops on error, and follows the refreshed action. Dispatch requires the action to remain dispatch-flow-reviewer; a newly stale review resets. |
| R12 | 61-66 | 33-36 | Ready start, compact refresh, execution read, current-worktree resume, review route, and unknown-action stop remain. |
| R13 | 68-69 | 38 | Execution status supplies scope/revision. Work stays in the feature. Wrong designs reset instead of accumulating retries. |
| R14 | 73-75 | 42 | Smallest authorized outcome change, no lifecycle/handoff sidecars, and separate authorization for Git/publication/release mutations remain. |
| R15 | 77-80 | 44 | Serial default, two or three independent beneficial slices, active-run prerequisite, worker role, no Flow tools/children/Bash, and combined integration/diff inspection before validation remain. |
| R16 | 84-91 | 48, 50 | Immediate arming, current revision, feature, exact command/scope, byte-exact execution, managed JUnit path, omitted-or-exact resultsPath, legacy normalized relative exception, and host-owned observation fields remain. |
| R17 | 93-96 | 52 | Broad runs only the plan's gate. Failed/stale planned commands still require their exact current-source pass. |
| R18 | 98-101 | 54-58 | A blocked gate first names the failing case/output. All three exact environment/command/next-step handoff labels remain. Formatting separates them onto source lines. |
| R19 | 103-107 | 60 | Host-observed validation advances revision. Marker fields, next-validation revision use, passed-only review revision use, and refresh when the marker is absent remain. |
| R20 | 109-110 | 52 | The final feature still runs the plan's gate at broad scope after the last relevant edit. Merged with broad validation. |
| R21 | 114-116 | 64 | Successful applicable validation still precedes review-start with fresh operation id, current revision, feature id, changed artifacts, and bounded packet. |
| R22 | 116-122 | 66, 68 | Persistence/schema/migration/replay/recovery and API/config/command/package/documented-contract cases retain their relevant full questions. Ordinary low-risk cases leave riskLenses empty. |
| R23 | 123-124 | 70 | Dispatch stays reserved-reviewer-only. The manager neither reviews nor submits its verdict. |
| R24 | 126-130 | 72 | Post-dispatch compact read, error stop, refreshed running routes, blocked handling, and recorded-pass completion remain. |
| R25 | 134-136 | 76 | One detail projection and nextAction govern routing; compact findingsDigest is printed. Runtime failed-count and scope-blocker projection facts remain. |
| R26 | 138-139 | 78 | Running await-user-direction offers exact command/environment, defer, or abandon, without review or reset. |
| R27 | 141-145 | 79 | Ready await-user-direction identifies the latest relevant failed reviewed outcome, checkpoints unless explicitly authorized, starts the exact feature on authorization, and never resets from ready. |
| R28 | 146-152 | 80-82 | Blocked await-user-direction checkpoints. A projected blocked reset permits one automatic attempt under existing authority, atomic reset/start with exact feature ID, only blocking fixes, full validation/review. Two failures require explicit authority for one more attempt. |
| R29 | 153-155 | 83 | An explicitly selected alternate feature must be planned and dependency-independent. Its exact ID goes in nextFeatureId on reset. |
| R30 | 157-158 | 85 | Direct run reports digest/action and stops. Auto returns to its lifecycle loop. |

## Semantic review focus

No intentional authority, role, validation, retry, closure, or handoff policy changes are included. The main changes are sentence shortening, evidence discovery in its own section, a shared local fresh-close parameter paragraph, and merging related validation statements. No external references were added to either guide.

Fresh-close parameters do not apply to archive retry. Archive retry remains byte-for-byte. Plan guidance can continue from confirmed cleanup; run guidance always stops after that entry cleanup. The current-host empty-assertions sentence remains part of the skipped-case alternative, not a replacement for the original named case. Approval remains a possible process-local resumption, not a promise of continuation support.

The first compact pass was tightened too far in several places. Author review restored the chosen gate rationale, current-host observability, explicit extra-entry passing, immutable-plan ID traceability, no-edit decision wording, exact resultsPath, host-observed revision timing, refreshed dispatch condition, and conditional ready retry. These restorations reduced the byte saving. No percentage target justified dropping them.

Both draft skills pass the installed skill-creator `quick_validate.py`. Their frontmatter matches the originals exactly. This validation does not prove behavioral equivalence. No provider calls, holdout reads, Git mutations, production edits, or model-evidence claims were made.
