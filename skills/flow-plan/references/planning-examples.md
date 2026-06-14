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

## Decomposition anti-patterns

- Feature per file when behavior crosses files.
- Feature per implementation step with no user-visible or reviewable outcome.
- Plan fixes for findings not yet verified.
- Validation that only says "manual testing".
- Targets that name the entire repo.
- Features with hidden dependencies instead of `dependsOn`.
