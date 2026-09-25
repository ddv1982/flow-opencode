# JEV-2 plugin idle-event diagnostic

The production plugin's `session.idle` event hook was replayed at pre-JEV-2 trunk `c9813f9a87b9b7438671658cfd523adcd89f3098` and the current stacked runtime `f798dc5b1c0c4ac86f3269068346a47b699f8b2b`. Each arm used a disposable, file-backed Flow workspace and a mocked OpenCode client. The replay invoked `/flow-auto` through the command and chat hooks, then timed the event hook until the mock verified the initial-route text, target session, model delivery, and the exact command activation token. Setup was outside the timed interval. Three pairs used the same frozen fixture, 300 warmup events and 1,500 measured events per arm; all 10,800 expected prompts occurred and the fetch guard saw zero calls.

| Pair | Trunk p95 (µs) | Head p95 (µs) | Added p95 (µs) |
| --- | ---: | ---: | ---: |
| 1 | 50.656 | 26.543 | -24.113 |
| 2 | 26.097 | 31.316 | +5.219 |
| 3 | 27.852 | 46.974 | +19.122 |

The largest observed p95 increase was 19.122 microseconds, below the proposed 5 ms disabled-mode routing limit in this replay. The raw process RSS snapshots and every latency sample are retained in six deterministic gzip files. Source-identity hashing ran after all reported timing and RSS checkpoints. `verify.ts` checks their hashes, recomputes the latency and RSS summaries, verifies the complete runtime inputs (`src/`, `skills/`, `package.json`, and `bun.lock`) against the pinned commits and checks phase ancestry, and refuses a changed current runtime. Each raw process records its arm, pair, ordinal, and UTC start/end times; the verifier checks the alternating, nonoverlapping sequence. These process-reported times expose run order but are not an external time attestation.

This probe exercises the production plugin hook and real file-backed Flow status, but it uses a mocked OpenCode client rather than a running OpenCode server. It measures the empty-workspace initial-prompt route. The separate `../idle-perf/` probe covers a blocked recovery checkpoint and the inactive-controller proposal lookup. Neither measures pinned live shadow advice latency, so the JEV-2 performance gate remains open.

To reproduce, create detached worktrees at the pinned commits, run `bun install --frozen-lockfile` in each, then run `bun <evidence-directory>/probe.ts <worktree>/src/platform/opencode/plugin.ts <new-output.json> <trunk|head> <pair-index> <sequence-ordinal>` from that worktree. Compress each output with `gzip -n`, preserve the paired order, and run `bun verify.ts` from the evidence branch. The verifier requires the measured source to match the branch's current `src/` tree.
