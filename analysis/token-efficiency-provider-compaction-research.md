# Optional research artifact: OpenCode compaction and provider prompt caching

Verified against official docs on April 5, 2026.

## Purpose

This note is **guidance only** for operators of `opencode-plugin-flow`. It does **not** change runtime behavior and should not become a required dependency for Flow correctness.

## Official OpenCode controls

### `compaction.auto`, `compaction.prune`, `compaction.reserved`

OpenCode exposes a `compaction` config block:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 10000
  }
}
```

Official docs describe these as:

- `auto`: automatically compact the session when context is full.
- `prune`: remove old tool outputs to save tokens.
- `reserved`: keep a token buffer so compaction has room to run without overflowing the window.

Source: OpenCode config docs — <https://opencode.ai/docs/config/>

### `experimental.session.compacting`

OpenCode plugins can hook `experimental.session.compacting` before OpenCode generates a continuation summary. The docs show two supported patterns:

1. append domain-specific context via `output.context.push(...)`
2. replace the compaction prompt entirely via `output.prompt = ...`

The same docs explicitly mark this hook as **experimental**. For Flow, that means any use should stay optional and must preserve approval/review invariants if ever adopted.

Source: OpenCode plugins docs — <https://opencode.ai/docs/plugins/>

### Provider option `setCacheKey`

OpenCode provider config supports:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "anthropic": {
      "options": {
        "setCacheKey": true
      }
    }
  }
}
```

The OpenCode config docs describe `setCacheKey` as: ensure a cache key is always set for the designated provider.

Source: OpenCode config docs — <https://opencode.ai/docs/config/>

## Provider-side caching facts

### OpenAI prompt caching

OpenAI says prompt caching is automatic on recent models for prompts of **1024+ tokens**. Cache hits require an **exact prefix match**, so static instructions/examples should be placed first and per-request data last. OpenAI also documents the optional `prompt_cache_key` parameter, which can improve routing for requests that share long prefixes.

Relevant details:

- automatic on recent models, no code changes required
- exact-prefix matching matters
- `prompt_cache_key` can improve hit rates
- `prompt_cache_retention` can be `in_memory` or `24h`

Source: OpenAI prompt caching guide — <https://developers.openai.com/docs/guides/prompt-caching>

### Anthropic prompt caching

Anthropic documents two modes:

- top-level automatic caching with `cache_control`
- explicit block-level cache breakpoints

Anthropic also states that caching covers the prompt prefix across `tools`, then `system`, then `messages`, with a default **5-minute** cache lifetime and an optional **1-hour** TTL. The docs warn that cache usefulness depends on putting the breakpoint at the end of a stable prefix.

Source: Anthropic prompt caching docs — <https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>

## Flow-specific interpretation

These are repo-local recommendations inferred from the official docs above:

1. **Keep stable Flow instructions at the front.** The plugin already has large repeated prompt prefixes; that layout is compatible with both OpenAI exact-prefix caching and Anthropic prefix/breakpoint caching.
2. **Avoid putting volatile data inside any would-be cached prefix.** Timestamps, transient status strings, and noisy tool dumps reduce cache reuse.
3. **Treat OpenCode compaction as an operator knob, not a product requirement.** `compaction.auto`/`prune` can help control session growth, but Flow must still work with default behavior and without external tuning.
4. **If `experimental.session.compacting` is ever used, only inject durable workflow state.** Good candidates would be active feature, approval state, blockers, and next step. Replacing the full compaction prompt is higher risk because it could accidentally omit Flow review/approval constraints.
5. **`setCacheKey` is safest as opt-in config guidance.** Based on OpenCode's config docs plus OpenAI's `prompt_cache_key` guidance, enabling a provider-managed cache key appears useful when many requests share the same large Flow prefix. This is an inference from the combined docs, not a stronger guarantee made by OpenCode.

## Recommended optional wording for future docs

If this is surfaced to users later, keep it narrow:

- "OpenCode compaction and provider prompt caching are optional tuning knobs."
- "Flow does not require external cache or compaction features for correctness."
- "If you experiment with compaction hooks, preserve Flow approval/review checkpoints in the continuation context."

## Sources

- OpenCode config docs: <https://opencode.ai/docs/config/>
- OpenCode plugins docs: <https://opencode.ai/docs/plugins/>
- OpenAI prompt caching: <https://developers.openai.com/docs/guides/prompt-caching>
- Anthropic prompt caching: <https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>
