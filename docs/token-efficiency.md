# Recommended OpenCode Config for Flow

This guide is for people who want Flow to stay high-quality while also being as fast and token-efficient as possible.

## Short Version

For real runtime wins, focus on:

- stable prompts
- provider-side prompt caching
- OpenCode compaction
- avoiding unnecessary extra orchestration

Flow itself already keeps its workflow strict. The main tuning happens in your OpenCode config.

## Recommended Baseline

Start with something like this in your `opencode.json`:

```jsonc
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 10000
  },
  "provider": {
    "openai": {
      "options": {
        "setCacheKey": true
      }
    },
    "anthropic": {
      "options": {
        "setCacheKey": true
      }
    }
  }
}
```

## What Each Setting Does

### `compaction.auto`

```json
{ "compaction": { "auto": true } }
```

Lets OpenCode compact the session when context gets full.

Use this if:
- you run longer Flow sessions
- you use `flow-auto` a lot
- you want less manual intervention

### `compaction.prune`

```json
{ "compaction": { "prune": true } }
```

Drops older tool output that often adds token noise without helping the next step much.

Use this if:
- your sessions accumulate lots of shell/tool output
- you care about reducing unnecessary context growth

### `compaction.reserved`

```json
{ "compaction": { "reserved": 10000 } }
```

Leaves token headroom so OpenCode can compact before the window is exhausted.

Use this if:
- you want safer behavior in long sessions
- you use larger prompts, tool results, or long histories

You can raise or lower it depending on your model/context window, but `10000` is a reasonable conservative start.

### `provider.*.options.setCacheKey`

```json
{
  "provider": {
    "openai": { "options": { "setCacheKey": true } },
    "anthropic": { "options": { "setCacheKey": true } }
  }
}
```

Helps OpenCode consistently attach cache keys where the provider supports them.

Use this if:
- you repeatedly run similar Flow prompts
- you want better prompt-cache hit rates
- you care about latency and cost on repeated work

## Suggested Profiles

### Balanced default

Good for most people:

```jsonc
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 10000
  },
  "provider": {
    "openai": { "options": { "setCacheKey": true } },
    "anthropic": { "options": { "setCacheKey": true } }
  }
}
```

### Conservative / quality-first

Use this if you want to minimize the chance of losing useful context:

```jsonc
{
  "compaction": {
    "auto": true,
    "prune": false,
    "reserved": 12000
  }
}
```

This keeps more history, but may cost more tokens.

### Aggressive / cost-conscious

Use this if you care more about cost and responsiveness in long sessions:

```jsonc
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 8000
  },
  "provider": {
    "openai": { "options": { "setCacheKey": true } },
    "anthropic": { "options": { "setCacheKey": true } }
  }
}
```

This is leaner, but may compact sooner and more aggressively.

## Quality Guardrails

Flow should stay strict even when tuned for efficiency.

Do **not** optimize by weakening:

- reviewer gates
- validation requirements
- final review requirements
- default status clarity

The right goal is:

> compress redundancy, not decision quality

## When to Customize Compaction Further

OpenCode already has built-in compaction plus a hidden compaction agent.

Only go further if you see evidence that long sessions are losing important Flow state.

If that happens, the right extension point is usually:

- `experimental.session.compacting`

Use it to preserve specific Flow state during compaction, not to replace the whole system prematurely.

## Practical Advice

If you want the best balance:

1. keep Flow prompts stable
2. enable provider cache keys
3. enable OpenCode compaction
4. prune old tool output
5. only add custom compaction logic if a real problem appears

## Further Reading

- OpenCode config docs: https://opencode.ai/docs/config/
- OpenCode plugins docs: https://opencode.ai/docs/plugins
- OpenCode agents docs: https://opencode.ai/docs/agents
- OpenAI prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching/
- Anthropic prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
