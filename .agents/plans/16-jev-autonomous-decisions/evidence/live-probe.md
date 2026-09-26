# Initial live Jev probe

On 2026-09-21 the user approved an initial probe capped at $0.10 and 24 HTTP
attempts. Source revision: `0192ede787239205f14deb16a58643ca2896d09e`.
The environment supplied the credential; no credential value was retained.

The [summary](live-probe-summary.json) retains authorization, both consumed
dispatches, evidence digests, usage, and spending reservations. The blocker CLI
received 21 attempts/$0.09 and the production adapter received 3 attempts/$0.01.
Both dispatch slots are consumed. No automatic rerun is authorized.

## Results

- All eight development cases returned valid responses from `jev-1.13.0`.
- The production adapter accepted a response to one synthetic recovery packet.
- Nine HTTP attempts ran, with no retries or unavailable responses.
- Total usage: 7,572 input tokens and 836 output tokens.
- Estimated input cost: $0.000318024. Reserved allowance: $0.024192.
- Blocker request latency ranged from 263 to 641 ms; the adapter request took
  594 ms. These nine observations are not a performance qualification.

The cost estimate uses the input price in the [provider model documentation](https://docs.typesafe.ai/models),
checked alongside the [API contract](https://docs.typesafe.ai/api). It is not an invoice.

The model selected the mixed-scope remedy, but its goal score was 0.11 and the
deterministic evaluator rejected it. The ordinary repair also failed the starter
thresholds: goal 0.32 and suitability 0.89. Six cases abstained. No development
case produced an admitted Jev recovery action. Do not relax thresholds to make
these examples pass.

The runtime probe selected `guard-null` with choice probability 0.94, goal 0.95,
and suitability 0.88. The latter is below the current shadow threshold of 0.95.
This probe called the production adapter directly; it did not grant permission,
mutate a Flow session, or exercise unattended recovery.

## Evidence and limits

- [Collector observations](probe-blockers-live.json) retain live response fields
  and metrics; no raw headers or credentials are retained.
- [Offline diagnostic report](probe-blockers-report.json) has verdict
  `inconclusive`. Its CLI deliberately treats reloaded evidence as simulation
  without an operator-reviewed live-import receipt. No such attestation was
  invented for this probe.
- [Runtime result](runtime-live.json) retains the synthetic packet, production
  source digests, validated response, and budget snapshot.
- [Runtime probe source](probe-runtime.ts) records the exact invocation logic.
  Its output is exclusive and its dispatch ledger is exhausted.

The blocker evaluator uses `blocker-v1` questions and its own packet and
eligibility policy. Runtime uses `recovery-v1` with different questions and packet
construction. Blocker results cannot qualify that runtime contract. Next work is
to collect representative runtime packets with independent labels and evaluate
the exact runtime policy, then freeze development thresholds before holdout work.
Manager-only comparison, independent holdouts, and unattended recovery remain
unmeasured. Production delegated activation remains disabled.
