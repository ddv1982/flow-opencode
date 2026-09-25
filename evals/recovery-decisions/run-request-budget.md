# Enforce a shared evaluation request budget

Use a request budget for the selected OAuth manager routes and Jev. The budget
applies to HTTP inference attempts from the isolated OpenCode host, including
manager, title, subagent, and retry requests. It supplements the existing
`FLOW_EVAL_AUTHORIZATION` command-dispatch limit.

## Freeze the authorization

Create an authorization JSON file with the following fields.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `origin` | `simulation` or `live` |
| `purpose` | Short campaign purpose, without credentials or task content |
| `maxRequests` | Positive integer maximum across all listed models |
| `maxMicroUsd` | Positive integer total reservation cap; 1,000,000 microdollars equals $1 |
| `expiresAt` | UTC ISO timestamp |
| `models` | Unique model reservation definitions |

Each model definition has `model`, `reservationMicroUsd`, and `basis`. Supported
models are `openai/gpt-5.6-terra`, `xai/grok-4.6`, and `typesafe/jev-1.13.0`.
Every request reserves the model's full fixed amount. Jev's reservation cannot
fall below the production transport's conservative request bound.

For simulations, use `basis: {"kind":"simulation"}`. A live definition instead
requires `{"kind":"reviewed-upper-bound","reviewedBy":"reviewer","evidenceDigest":"<64-character canonical evidence hash>"}`.

The reviewer must establish a conservative cost bound for one complete request on
the actual connection, including output, reasoning, context tiers, and any billing
conditions. An API price table alone does not establish OAuth billing. The evidence
hash and reviewer name are attestations, not authenticated billing guarantees.
Incorrect bounds invalidate the claimed spending cap. No bound is inferred from
zero catalog cost, observed average usage, or a successful login.

A new paid campaign still needs the user's explicit spending authorization.
These commands do not create that permission on their own.

```sh
bun run eval:recovery request-budget-create authorization.json NEW-budget-directory
bun run eval:recovery request-budget-status budget-directory
bun run eval:recovery request-budget-cancel budget-directory
```

Creation refuses an existing directory. Cancellation persists and blocks new
reservations. It does not refund requests or revoke already admitted network work;
stop the host to terminate in-flight work.

## Attach the budget to a host

Pass `requestBudget` to `EvalHost.start` or through `createEpisodeHostDriver`'s
`host` options.

```ts
requestBudget: {
	directory: budgetDirectory,
	authorizationDigest: datasetDigest(authorization),
	managerModel: "openai/gpt-5.6-terra",
}
```

Use the same directory and digest for every host and both arms in the campaign.
Budgeted hosts currently require OpenCode 1.18.31. The host installs the evaluation
plugin before Flow, disables native LLM and WebSocket paths, sets the small model
to the selected manager, and restricts enabled providers to that manager's provider.
Startup verifies that the gate wrote its receipt from the server's process group.
Ordinary hosts remain unchanged when `requestBudget` is absent.

The episode runner still refuses live episodes. Reviewed monetary bounds, the
isolated experimental Jev treatment, operator-resume support, and qualification
remain separate requirements. Wiring this budget does not populate release profiles.

## Understand request accounting

The gate intercepts the final `fetch` after the provider's OAuth adapter. OpenCode's
[OpenAI adapter](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/plugin/openai/codex.ts)
rewrites inference to the ChatGPT Codex Responses endpoint. Its
[xAI adapter](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/plugin/xai.ts)
adds OAuth authorization to the xAI request. Metering only a chat-parameter hook
would miss retries and OpenAI's final request rewrite.

Before forwarding, the gate publishes an exclusive, synced `request-NNNNNN.json`
claim. Concurrent processes compete for the same next slot; a losing writer
reloads the ledger and checks both remaining caps. Claims bind the exact
authorization, model, sequence, time, and integer reservation. Requests, credentials,
headers, responses, and task text are not retained in the ledger.

Timeouts, transport failures, crashes, and retries never refund a claim. Every
retry needs another reservation. No response-side usage estimate can increase the
remaining budget. Missing, malformed, changed, or over-budget ledger entries stop
admission. This is conservative reservation accounting, not an invoice.

The gate permits only the selected inference endpoints and models. It refuses
redirects, unknown routes, hosted tools, legacy search settings, multiple
completions, background work, premium service tiers, and oversized bodies.
Loopback host control traffic, the public model catalog, and the two OAuth refresh
endpoints do not consume inference reservations. Simulation mode forwards no
provider or refresh request; it returns a fixed simulated refusal instead.

This controls OpenCode's verified HTTP provider path. It is not an operating-system
network sandbox for arbitrary shell programs or a defense against code that tampers
with the gate, authorization, or ledger. A new transport or OpenCode version needs
verification before use.

## Verify without paid inference

```sh
bun test tests/recovery-request-budget.test.ts
FLOW_REQUEST_BUDGET_SMOKE=1 bun test tests/recovery-request-host.test.ts
```

The opt-in smoke starts real OpenCode hosts with Flow disabled, no inherited
provider credentials, fake OAuth tokens, and simulated provider responses. Both
selected models exercise SDK retries and exhaust the two-request ceiling. It
checks host integration, not response quality or live billing. The ordinary suite
skips this host smoke. The unit tests cover shared caps, multi-process contention,
restart accounting, cancellation, stale authority, malformed receipts, secret
omission, route refusal, and the actual budget CLI.
