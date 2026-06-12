# Planning examples: good and bad plans

Worked examples for decomposing goals into Flow features. Each feature in a saved plan needs an outcome, a scope, and a validation plan; the plan as a whole needs a stack profile and a done condition.

## Example 1 — Good: "Add rate limiting to our public API"

**Stack profile recorded with the plan:** Node 22 / TypeScript, Fastify 4, pnpm (`pnpm-lock.yaml`), tests via `pnpm test` (vitest), lint via `pnpm lint` (biome), CI runs `pnpm typecheck && pnpm test`. Redis already a dependency (sessions).

**Features:**

1. **Rate-limit middleware with in-memory store**
   - Outcome: requests beyond N/min per API key receive 429 with `Retry-After`; under the limit, no behavior change.
   - Scope: new `src/middleware/rate-limit.ts`, registration in `src/app.ts`, config knob in `src/config.ts`.
   - Validation: new vitest unit tests for limit/reset/headers; `pnpm typecheck`; targeted run `pnpm test middleware`.
2. **Redis-backed store for multi-instance deployments**
   - Outcome: counters shared across instances; in-memory remains the dev fallback.
   - Scope: `src/middleware/stores/redis.ts`, store selection by config.
   - Validation: unit tests with redis mock; manual two-process check documented in evidence.
3. **Operator documentation and limits tuning**
   - Outcome: README section + env var reference for limits; defaults justified.
   - Scope: docs only.
   - Validation: `pnpm lint` (docs pass markdown checks); reviewer reads for accuracy.

**Why this is good:** each feature ships alone (1 is useful without 2), each has its own validation story, dependency order is explicit, the risky/unknown part (shared state) is isolated in feature 2, and docs ride as a real feature with a real outcome instead of "cleanup".

## Example 2 — Bad: too coarse

> 1. **Implement rate limiting** — add middleware, Redis store, config, docs, tests.

One mega-feature with four unrelated validation stories. When validation fails you cannot tell what is broken; when the session is interrupted, nothing is completable. **Fix:** split along validation boundaries, as in Example 1.

## Example 3 — Bad: too granular / phase-shaped

> 1. Create rate-limit file. 2. Add config type. 3. Register middleware. 4. Write tests. 5. Run lint. 6. Update docs.

These are steps, not features: 1–3 cannot be validated independently ("file exists" is not validation), and 4–5 are validation activities that belong *inside* features. Ten micro-features create ten completion ceremonies with no checkpoint value. **Fix:** collapse 1–5 into one feature whose validation plan includes the tests and lint.

## Example 4 — Bad: planning fixes without findings

Goal: "Review the auth module and fix what's wrong."

> 1. Fix SQL injection in login. 2. Fix session fixation. 3. Fix weak hashing.

The planner invented findings — none of these were verified to exist. **Fix (review-first decomposition):**

> 1. **Audit auth module** — outcome: a findings list with severity and file/line evidence; validation: every finding cites code actually read.
> 2. **Fix blocking findings from the audit** — scope set by feature 1's output; validation: regression test per fix.

## Sizing heuristics, condensed

- Can you state how this feature alone gets validated? If not, it is not a feature.
- Would a teammate understand "done" from the outcome line alone? If not, sharpen it.
- Two unrelated validation stories → split. Cannot validate alone → merge.
- Riskiest first: unknowns surface while the plan is still cheap to change.
- 1–5 features for most goals. More than ~7 usually means the goal needs splitting into sessions.
