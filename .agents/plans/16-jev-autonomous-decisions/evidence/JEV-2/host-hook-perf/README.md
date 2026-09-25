# JEV-2 plugin idle-event diagnostic

The production plugin's `session.idle` event hook was replayed at pre-JEV-2 trunk `c9813f9a87b9b7438671658cfd523adcd89f3098` and the current stacked runtime `f798dc5b1c0c4ac86f3269068346a47b699f8b2b`. Each arm used a disposable, file-backed Flow workspace and a mocked OpenCode client. The replay invoked `/flow-auto` through the command and chat hooks, then timed the event hook until it produced the expected initial prompt. Setup was outside the timed interval. Three pairs used the same frozen fixture, 300 warmup events and 1,500 measured events per arm; all 10,800 expected prompts occurred and the fetch guard saw zero calls.

| Pair | Trunk p95 (µs) | Head p95 (µs) | Added p95 (µs) |
| --- | ---: | ---: | ---: |
| 1 | 26.887 | 48.623 | +21.736 |
| 2 | 27.910 | 27.048 | -0.862 |
| 3 | 48.417 | 52.031 | +3.614 |

The largest observed p95 increase was 21.736 microseconds, below the proposed 5 ms disabled-mode routing limit in this replay. The raw process RSS snapshots and every latency sample are retained in six deterministic gzip files. `verify.ts` checks their hashes, recomputes the latency and RSS summaries, verifies the complete transitive `src/` tree against the pinned commits and checks phase ancestry, and refuses a changed current runtime. The three pairs alternate run order to expose startup and scheduler variation.

This probe exercises the production plugin hook and real file-backed Flow status, but it uses a mocked OpenCode client rather than a running OpenCode server. It measures the empty-workspace initial-prompt route. The separate `../idle-perf/` probe covers a blocked recovery checkpoint and the inactive-controller proposal lookup. Neither measures pinned live shadow advice latency, so the JEV-2 performance gate remains open.

To reproduce, create detached worktrees at the pinned commits, run `bun install --frozen-lockfile` in each, then run `bun <evidence-directory>/probe.ts <worktree>/src/platform/opencode/plugin.ts <new-output.json>` from that worktree. Compress each output with `gzip -n`, preserve the paired order, and run `bun verify.ts` from the evidence branch. The verifier requires the measured source to match the branch's current `src/` tree.
