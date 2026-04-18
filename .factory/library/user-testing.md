# User Testing — Validation Surface

Runtime-findings reference for the user-testing validator. Contains the validation surface, required skills/tools, and resource cost classification.

---

## Validation Surface

The plugin is NOT a web app or TUI app. Its "surface" is the OpenCode plugin API. Validation assertions therefore use a small set of mechanisms:

- **`bun-test`** — assertion checked by a unit or integration test in `tests/` via `bun test`. Primary surface. Covers ~80% of assertions.
- **`cli-smoke`** — assertion checked by running a command and asserting exit code + output (`bun run lint`, `bun run typecheck`, `bun run build`, `bun run install:opencode` with temp HOME, `npm pack --dry-run`, etc.).
- **`fs-inspection`** — assertion checked by inspecting repo files (grep, stat, git ls-files, file-size check). No behavioral execution.
- **`node-script`** — assertion checked by a short Node/Bun script that imports the built `dist/index.js` (or source) in a fresh V8 isolate with a mocked `ctx` and exercises behavior in-process.

**`agent-browser` and `tuistory` are not applicable** to this mission. Do not invoke them.

### Required testing skills / tools

- Bun test runner, Node VM for bundle smoke-loading, basic shell + grep + jq.
- `mitata` for benchmark assertions (`bench/BASELINE.md`, `bench/RESULTS.md`).

## Isolation Strategy

- **Temp HOME and temp worktree** for every test. Use `fs.mkdtempSync(path.join(os.tmpdir(), 'flow-...'))` and `rm -rf` in `afterEach`. Never reach into `~/.opencode/` or `~/.config/opencode/` outside of temp-HOME overrides.
- **Per-test spies** for `fs/promises` monkey-patches — always restore in `afterEach`. Do NOT parallelize fs-monkey-patch tests.
- **`Date.now` mocks** at the `nowIso` / `archiveTimestampNow` boundary, not globally.

## Validation Concurrency

Up to **5 concurrent validators** per surface. The plugin is file-based with trivial resource cost (no services, no long-running processes, <200 ms test suites). Each validator instance:
- Spawns a `bun test` subprocess (< 250 MB RSS, completes in < 1 s).
- Optionally invokes a Node smoke script (<100 MB RSS, <2 s).

On an 18 GB machine with 12 CPU cores and ~6 GB baseline use, usable headroom is 12 GB × 0.7 = 8.4 GB. 5 × (~350 MB) = ~1.75 GB — comfortably within budget.

Reducing to 3 concurrent validators is acceptable if the machine reports <8 GB free RAM at start time.

## Known Constraints

- The user testing validator must NOT run `bun run bench` as part of assertion validation unless the specific assertion (M5 bench gates, cross-area bench gate) explicitly requires it. Benchmarks take substantial time and CPU.
- Some assertions reference artifacts produced by earlier milestones (e.g. `bench/BASELINE.md`, `tests/__fixtures__/render/`). If a validator is asked to verify an M5 assertion before M1/M3 has landed, return with a clear blocker — the precondition isn't met.
