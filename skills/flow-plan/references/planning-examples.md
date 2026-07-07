# Planning examples

## Rate limiting feature set

Human summary:

1. **In-memory rate limit middleware** - add request counting and response headers for one-process deployments.
2. **Redis-backed limiter** - add shared store adapter for multi-instance deployments.
3. **Operator docs** - document configuration and rollout notes.

Payload:

```json
{
  "goal": "Add API rate limiting with local and Redis-backed stores",
  "plan": {
    "summary": "Add configurable rate limiting for API routes.",
    "overview": "Implement middleware first, then a Redis store, then document rollout.",
    "requirements": [
      "Preserve existing route behavior except rate-limit responses.",
      "Expose deterministic headers for limit, remaining, and reset time."
    ],
    "decisions": [
      "Start with an in-memory store for single-process deployments.",
      "Keep Redis behind a store interface so tests can use a mock."
    ],
    "finalReviewPolicy": "detailed",
    "features": [
      {
        "id": "rate-limit-middleware",
        "title": "In-memory limiter",
        "summary": "Add middleware, config, and tests for single-process rate limiting.",
        "targets": ["src/middleware/rate-limit.ts", "src/app.ts", "src/config.ts"],
        "validation": ["route tests for limit/reset/header behavior", "typecheck"],
        "dependsOn": []
      },
      {
        "id": "redis-store",
        "title": "Redis store",
        "summary": "Add a Redis-backed rate limit store without changing middleware behavior.",
        "targets": ["src/middleware/stores/redis.ts", "src/middleware/rate-limit.ts"],
        "validation": ["store tests with Redis mock", "manual two-process recipe if practical"],
        "dependsOn": ["rate-limit-middleware"]
      },
      {
        "id": "operator-docs",
        "title": "Operator docs",
        "summary": "Document configuration, headers, and rollout guidance.",
        "targets": ["README.md", "docs/operations.md"],
        "validation": ["lint docs if available", "review examples against implemented config"],
        "dependsOn": ["redis-store"]
      }
    ]
  }
}
```

## Review-first cleanup

Bad plan:

```text
1. Simplify services
2. Remove duplication
3. Improve tests
```

Why it is bad: no evidence names which services are actually tangled, what duplication exists, or which behavior needs test coverage.

Better plan:

```text
1. Audit service layer - produce evidence-backed findings with file:line citations, guards checked, and follow-up order.
2. Consolidate confirmed config parsing duplication - only if the audit proves the duplication exists and is safe to merge.
3. Add behavior-preservation tests for the changed service paths.
```

## Bugfix plan

Human summary:

1. Reproduce and localize the failed password reset redirect.
2. Fix the redirect state handling and cover the regression.
3. Update release notes only if user-facing behavior changed.

Payload:

```json
{
  "goal": "Fix password reset links landing users on the wrong page",
  "plan": {
    "summary": "Password reset links land users on the intended reset confirmation flow.",
    "overview": "Start with a focused reproduction, then fix the redirect state and update user-facing notes only if the behavior change needs documentation.",
    "requirements": [
      "Preserve existing token validation and expiry behavior.",
      "Users with valid reset links should not be sent to the generic sign-in page before completing the reset."
    ],
    "decisions": [
      "Treat the current redirect mismatch as a regression until reproduction proves otherwise."
    ],
    "finalReviewPolicy": "detailed",
    "features": [
      {
        "id": "reset-redirect-repro",
        "title": "Redirect reproduction",
        "summary": "Produce a failing focused check or trace that identifies where the reset redirect is lost.",
        "targets": ["src/auth/reset", "tests/auth"],
        "validation": ["targeted unit or integration reproduction for reset redirect behavior"],
        "dependsOn": []
      },
      {
        "id": "reset-redirect-fix",
        "title": "Redirect fix",
        "summary": "Preserve reset redirect state through token validation and completion.",
        "targets": ["src/auth/reset", "tests/auth"],
        "validation": ["targeted regression test passes", "auth package/build check if available"],
        "dependsOn": ["reset-redirect-repro"]
      },
      {
        "id": "reset-redirect-notes",
        "title": "User-facing notes",
        "summary": "Document the corrected reset-link behavior if release notes or help text mention the flow.",
        "targets": ["CHANGELOG.md", "docs/auth.md"],
        "validation": ["docs/static check if available", "review docs against implemented behavior"],
        "dependsOn": ["reset-redirect-fix"]
      }
    ]
  }
}
```

## UI/frontend plan

Human summary:

1. Map the current checkout empty state and responsive constraints.
2. Implement the empty state with accessible controls and mobile layout.
3. Verify the visual states with screenshots or browser evidence.

Good feature outline:

```text
1. Empty-state discovery - inspect the route, component boundaries, design tokens, existing empty states, and likely responsive breakpoints.
2. Empty-state implementation - add the checkout empty state, action wiring, focus order, and loading/error boundaries in the existing component style.
3. Visual and interaction verification - capture desktop and mobile evidence, run available route/component checks, and fix overlap or accessibility regressions.
```

Why this is better than one "build UI" feature: the plan names the uncertain
surface first, keeps implementation scoped to the route/components, and makes
visual evidence part of completion rather than an afterthought.

## Runtime or schema plan

Human summary:

1. Introduce the schema change behind a backward-compatible parser.
2. Migrate callers and persistence writes.
3. Add compatibility validation and docs.

Good feature outline:

```text
1. Compatible schema reader - accept old and new session payloads, with targeted parser tests for both.
2. New writer path - emit the new field from runtime transitions and update affected callers.
3. Compatibility sweep - run persistence/workspace tests, update docs, and verify old sessions still recover.
```

Use `finalReviewPolicy: "detailed"` for this shape. Persistence and schema work
usually has hidden downstream contracts, so feature validation should name both
targeted parser checks and broader workspace/runtime gates.

## Docs-only plan

Docs-only work can use `finalReviewPolicy: "broad"` when it does not change
commands, configuration, generated files, or release metadata.

Good feature outline:

```text
1. Align installation docs - update README and troubleshooting steps for the current setup flow.
2. Verify commands and links - check documented commands against package scripts and make sure links/paths resolve.
```

Bad validation:

```text
validation: ["manual review"]
```

Better validation:

```text
validation: ["docs/static link and path review", "command examples checked against package scripts"]
```

## Audit-first and review-first plans

Use an evidence-producing first feature when the request asks to "review",
"audit", "clean up", "modernize", or "improve" a broad area.

Good feature outline:

```text
1. Audit checkout state management - cite concrete findings with file:line evidence, refutation checks, severity, and recommended fix order.
2. Fix confirmed high-impact state leak - only for findings that survived the audit.
3. Regression validation - add or run checks covering the changed state paths.
```

Do not plan fixes for guessed findings. If the audit might find no actionable
issue, say that in the first feature summary and make later features conditional
on evidence.

## Validation examples

Weak:

```text
validation: ["run tests", "manual testing"]
```

Stronger:

```text
validation: [
  "targeted unit tests for empty and invalid input",
  "integration test for persisted session recovery",
  "package/build gate for changed TypeScript exports",
  "browser screenshot at desktop and mobile widths for layout-sensitive UI",
  "docs/static review for changed command examples"
]
```

The stronger version says what level of evidence is expected and which behavior
or surface it covers.

## Decomposition anti-patterns

- Feature per file when behavior crosses files.
- Feature per implementation step with no user-visible or reviewable outcome.
- Plan fixes for findings not yet verified.
- Validation that only says "manual testing".
- Targets that name the entire repo.
- Features with hidden dependencies instead of `dependsOn`.
