# Provider prices for campaign planning

Checked official documentation on 2026-09-13 through Exa, Ref, and OpenAI Docs.
These are standard API prices, not a quote for the operator's account or gateway.

| Model | Input per million | Output per million | Cache read per million | Cache write per million |
| --- | --- | --- | --- | --- |
| GPT-6 Astra | $10 | $50 | $1 | $12.50 |
| Claude Fable 5 | $10 | $50 | $1 | $12.50 for five minutes, $20 for one hour |
| Claude Opus 5 | $5 | $25 | $0.50 | $6.25 for five minutes, $10 for one hour |

[OpenAI pricing](https://developers.openai.com/api/docs/pricing) supplies the Astra
rates. Its [model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra)
raises input/cache rates twofold and output rates 1.5-fold above 272K input tokens.
Fast mode costs twice the applicable standard rates. Account defaults matter.

[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing)
supplies the Claude rates. [Fable 5](https://platform.claude.com/docs/en/models/fable-5/overview)
is now documented as the most capable widely released Claude model. The original
plan's Opus 5 remains a useful comparison option, not a hardcoded latest model.
Fable's refusal handling and always-on adaptive thinking require host qualification.

The runner must remain model-agnostic. Freeze selected routes, variants, host,
and pricing assumptions after catalog checks. No entitlement or provider execution
has been proved here. No paid campaign is authorized or started.
