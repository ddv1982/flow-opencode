# Planning examples: good and bad plans

Worked examples for decomposing goals into Flow features. Each feature in a saved plan needs an outcome, a scope, and a validation plan; the plan as a whole needs a stack profile and a done condition.

## Example 1 — Good: "Add rate limiting to our public API"

**Context recorded with the plan:** Node 22 / TypeScript, Fastify 4, pnpm (`pnpm-lock.yaml`), tests via `pnpm test` (vitest), lint via `pnpm lint` (biome), CI runs `pnpm typecheck && pnpm test`. Relevant surfaces: `src/app.ts`, `src/config.ts`, existing API-key auth middleware, existing session Redis dependency, README env-var docs. Out of scope: changing auth semantics or adding a new billing tier.

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

**As a `flow_plan_save` payload** (abridged — feature ids are lowercase kebab-case; `verification` is each feature's validation plan; `fileTargets` is its scope):

```json
{
  "goal": "Add rate limiting to our public API",
  "planning": {
    "packageManager": "pnpm",
    "repoProfile": [
      "Node 22 / TypeScript, Fastify 4",
      "tests: pnpm test (vitest); lint: pnpm lint (biome)",
      "CI gate: pnpm typecheck && pnpm test",
      "Redis already a dependency (sessions)"
    ],
    "research": [
      "Read src/app.ts middleware registration order",
      "Read existing API-key auth middleware and config loader",
      "Checked README env-var documentation pattern"
    ]
  },
  "plan": {
    "summary": "Per-API-key rate limiting with Redis-backed counters",
    "overview": "Middleware-based limiting: in-memory store first, Redis store for multi-instance, operator docs last.",
    "requirements": [
      "Requests beyond N/min per API key get 429 with Retry-After",
      "No behavior change under the limit"
    ],
    "architectureDecisions": [
      "Counters in Redis; in-memory store stays as the dev fallback"
    ],
    "notes": [
      "Out of scope: auth semantics, billing-tier limits, and unrelated API hardening"
    ],
    "features": [
      {
        "id": "rate-limit-middleware",
        "title": "Rate-limit middleware with in-memory store",
        "summary": "Requests beyond N/min per key receive 429 with Retry-After; under the limit, no behavior change.",
        "fileTargets": ["src/middleware/rate-limit.ts", "src/app.ts", "src/config.ts"],
        "reviewScope": [
          { "id": "middleware-order", "kind": "file", "target": "src/app.ts", "description": "Verify rate limiting runs after API-key identity is known." },
          { "id": "config-contract", "kind": "file", "target": "src/config.ts", "description": "Verify defaults and env parsing are explicit." }
        ],
        "verification": ["pnpm test middleware (new limit/reset/header cases)", "pnpm typecheck"]
      },
      {
        "id": "redis-store",
        "title": "Redis-backed store for multi-instance deployments",
        "summary": "Counters shared across instances; in-memory remains the dev fallback.",
        "dependsOn": ["rate-limit-middleware"],
        "fileTargets": ["src/middleware/stores/redis.ts"],
        "verification": ["pnpm test stores (redis mock)", "manual two-process check, recorded in evidence"]
      },
      {
        "id": "operator-docs",
        "title": "Operator documentation and limits tuning",
        "summary": "README section + env var reference for limits; defaults justified.",
        "priority": "nice_to_have",
        "fileTargets": ["README.md"],
        "verification": ["pnpm lint", "reviewer reads for accuracy"]
      }
    ]
  }
}
```

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

> 1. **Audit auth module** — outcome: a findings list with severity and file/line evidence; validation: every finding cites code actually read, and every blocking finding records the mitigating paths checked (flow-run's audit rubric).
> 2. **Fix blocking findings from the audit** — scope set by feature 1's output; validation: regression test per fix.

## Example 5 — Bad: vague acceptance and hidden coupling

> 1. **Improve API robustness** — summary: "make the API more resilient"; verification: `["manual testing"]`.
> 2. **Add limits config** — fileTargets: `["src/config.ts"]`.
> 3. **Enforce limits in middleware** — fileTargets: `["src/middleware/rate-limit.ts", "src/config.ts"]`; no `dependsOn`.

Three distinct failure modes:

- **Vague acceptance (1):** "more resilient" is not a done condition — no one can say when it is finished, so it never is. "Manual testing" with no recipe is not a validation plan. Sharpen until a teammate could verify the outcome line alone.
- **Hidden coupling (2+3):** both touch `src/config.ts`, and 3 cannot be validated without 2 — yet the plan declares them independent. Interruption between them leaves nothing completable. **Fix:** merge them into one feature, or declare `dependsOn` and give 2 a validation story of its own (it has none — "config exists" is not validation, see Example 3).
- **Scope smuggling (1):** a catch-all feature alongside specific ones becomes the dumping ground for whatever comes up. Cut it; new scope goes through a plan revision, not a vague bucket.

## Sizing heuristics, condensed

- Can a reviewer see which files, tests, docs, contracts, and risks shaped the plan? If not, add context before features.
- Can you state how this feature alone gets validated? If not, it is not a feature.
- Would a teammate understand "done" from the outcome line alone? If not, sharpen it.
- Two unrelated validation stories → split. Cannot validate alone → merge.
- Riskiest first: unknowns surface while the plan is still cheap to change.
- 1–5 features for most goals. More than ~7 usually means the goal needs splitting into sessions.
