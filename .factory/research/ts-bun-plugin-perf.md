# TypeScript/Bun plugin performance + coding-standards research (for `opencode-plugin-flow`)

Date: 2026-04-18
Scope: raw notes gathered to inform tuning of a small Bun-bundled Node-target TypeScript plugin whose hot paths are JSON fs session reads/writes, Zod validation, and markdown rendering.

Current project baseline (from `/Users/vriesd/projects/flow-opencode/package.json` and `tsconfig.json`):

- Build: `bun build ./src/index.ts --outfile ./dist/index.js --target node`.
  - No `--minify`, no `--sourcemap`, no `--external` nor `--packages external`.
  - Peer dep: `@opencode-ai/plugin` (^1.3.10). Runtime dep: `zod ^4.3.6`.
  - Dev deps: `bun-types`, `knip`, `typescript ^6.0.2`.
- `tsconfig`: `strict: true`, `noUnusedLocals/Parameters: true`. **Missing**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`.
- **No lint config** in repo (no `.eslintrc*`, `biome.json`, `oxlint.json`, `.prettierrc*`). Confirmed by LS and package.json inspection — no linter scripts either.
- Scripts: `test` = `bun test`, `check` = typecheck+knip+test+build.

---

## 1. Zod v4 performance best practices

Sources:
- https://zod.dev/v4 (v4 release notes)
- https://zod.dev/packages/mini (Zod Mini docs)
- https://dev.to/dzakh/zod-v4-17x-slower-and-why-you-should-care-1m1 (cold-creation regression discussion)
- https://moltar.github.io/typescript-runtime-type-benchmarks/

Key points:

- Zod 4 switched to JIT-compiled parsers (`new Function`) similar to TypeBox/ArkType. Once a schema is created, `parse`/`safeParse` is dramatically faster than v3: ~14× for strings, ~7× for arrays, ~6.5× for `z.object()` safeParse (Moltar benchmark). This **only applies to cached/reused schemas**. One-shot schema creation in a hot path is actually *slower* than Zod 3 due to JIT cost (Sury author's benchmark: ~6 ops/ms for create+parse-once in v4).
- **Recommendation from the JIT tradeoff:** always define schemas at **module top level (or inside a singleton)** so the JIT compiles once. Never construct a schema inside a per-call hot path.
- `z.object({...}).strict()` vs `.passthrough()` vs default "strip": official docs do not claim meaningful perf differences. Behavior differences dominate: default strips unknown keys; `.strict()` throws on unknowns (still has to enumerate keys); `.passthrough()` keeps unknowns. For very small session objects the difference is negligible; pick based on correctness. For robustness against unexpected fields in persisted session files, default (strip) or `.strict()` are both fine; `.passthrough()` is *not* recommended because it allows schema drift into your runtime types.
- `safeParse` vs `parse`:
  - `parse` throws a `ZodError` on failure; throw+stack is allocation-heavy. Prefer `safeParse` on the hot path where validation failure is an expected (non-exceptional) outcome and you want to branch on `result.success`.
  - Successful `parse` and `safeParse` have essentially the same cost. The difference only shows up on failure.
  - Use `parse` only at explicit "boundary assertions" where failure means "bug / programmer error".
- `.readonly()` and `.brand()` are type-only markers; they do not change runtime parser performance. Don't use them for perf, use them for type safety.
- Tree-shaking: Zod's method-chained API is **not** friendly to bundlers — Zod 4 `import * as z from "zod"` still pulls ~5.36 kB gzip minimum (v3 was ~12.47 kB). `zod/mini` (functional API, `import * as z from "zod/mini"`) tree-shakes down to ~1.88 kB gzip for trivial schemas, ~4 kB for small objects. For a **Node-target** plugin this matters less than for browser bundles, but for a plugin shipped as a single file it still reduces startup parse cost.
- `zod/mini` trade-offs:
  - Less ergonomic (no chaining, `.check()` with top-level `z.minLength`, etc.).
  - Zod Mini **does not load the default English locale**; error messages default to "Invalid input" unless you `z.config(z.locales.en())`.
  - Same parsing functions, same JIT behavior.
- Alternatives worth knowing for hot paths:
  - **valibot** (~1 kB gzip per small schema, ~2-3× faster than Zod v3 for parse, close to ArkType/Zod 4 on some benchmarks; functional API with `v.pipe`). Good for bundle-critical code.
  - **arktype** (fastest on most Moltar benchmarks, 3–4× faster than Zod v4 for nested objects per Pockit 2026 comparison; ~40 kB gzip but once-paid).
  - **typia** (compile-time code-gen via TS transformer; fastest but requires `ttypescript` / unplugin-typia build step — not a fit for a simple Bun-build pipeline).
  - **zod-mini**, **sury** (formerly rescript-schema): Sury claims fastest JIT with small size (~4 kB gzip), but ecosystem is tiny.

Bottom line for Flow: **stay on Zod 4** but (a) define schemas once at module load, (b) prefer `safeParse` in hot paths, (c) keep default object "strip" semantics or explicit `.strict()`. Zod Mini / valibot / arktype is an optimization to consider only if profiling shows Zod is a real bottleneck.

---

## 2. Fast JSON (de)serialization in Node/Bun 2026

Sources:
- https://v8.dev/blog/json-stringify ("How we made JSON.stringify more than twice as fast", 2025)
- https://github.com/fastify/fast-json-stringify ("2x faster than JSON.stringify()")
- https://www.javacodegeeks.com/2025/01/handling-json-in-node-js-performance-ti... (2025 overview)
- https://lemire.me/blog/2024/03/12/how-to-read-files-quickly-in-javascript/ (Daniel Lemire on Bun vs Node IO + JSON)

Key points:

- `JSON.parse` / `JSON.stringify` in Node 22+ and Bun use V8's/JSCore's SIMD-accelerated implementations. V8 shipped a ~2× `JSON.stringify` speedup in 2025. For session files in the KB range, **native is already the right default**.
- `fast-json-stringify` (Fastify) is 1.5-2× faster than `JSON.stringify` but requires a precompiled JSON-schema-like definition. Useful for hot write paths where the shape is stable *and* cost matters. For a plugin writing <10 KB session files a few times per transition, the native path is fine.
- `simdjson`/`simdjson-rs` bindings exist for Node but add a native dep — avoid for a lean plugin.
- `turbo-stream` / `devalue` — handle cycles, `Map`/`Set`, `Date`; slower than `JSON.*`. Only useful if you need non-JSON values.
- Bun-specific fast paths:
  - `Bun.file(path).json()` is generally the fastest way to read+parse JSON when you're on Bun.
  - `Bun.write(path, obj)` auto-stringifies efficiently.
  - **But**: the plugin is built with `--target node` and shipped as a single file to users. At runtime, `process.versions.bun` may or may not be defined (opencode runs on Node). Using `Bun.*` requires a feature check; for a portable plugin, stick with `fs.promises` + `JSON.*`.

Bottom line: **native `JSON.parse`/`JSON.stringify` is fine.** Only introduce `fast-json-stringify` if profiling shows stringify is >1 ms on a hot path, and only for the serialization of the most stable-schema struct.

---

## 3. fs I/O patterns

Sources:
- https://nodejsdesignpatterns.com/blog/reading-writing-files-nodejs/ (2026-01)
- https://github.com/npm/write-file-atomic (v7.0.1, 2026-02)
- https://oneuptime.com/blog/post/2026-01-22-nodejs-write-files-async/
- https://nodejs.org/api/fs.html

Key points:

- For **small files** (<100 KB), `fs.readFileSync`/`writeFileSync` are often faster in wall-clock terms than `fs.promises.readFile`/`writeFile`: async has setup+queue overhead. For a plugin in a workflow (not a high-concurrency server), `readFileSync` on a hot path is acceptable and often preferable.
- For correctness, especially to guard against torn writes (session state must never be half-written if a crash occurs mid-write), use **atomic rename** pattern:
  1. Write to `path + ".tmp-<pid>-<rand>"`.
  2. `fsyncSync` the file descriptor.
  3. `fs.renameSync(tmp, path)` (atomic on same filesystem on POSIX; emulated on Windows).
- `write-file-atomic` (npm, v7) is a well-known wrapper doing exactly this + handling Windows edge cases, uid/gid, and concurrent writes to same file. Small extra dep (pure JS). Alternatively, hand-roll 10 lines.
- `fs.promises` vs sync: for the plugin's workflow transitions (serial, not concurrent), `fsSync` with atomic rename is simplest and eliminates Promise scheduling overhead. If you already touch async boundaries (awaiting the plugin host), `fs.promises` is idiomatic and roughly as fast for single small files.
- **mtime-based caching**: a common pattern for "is this session dirty?" is to stat the file and cache parsed content keyed by `(path, mtimeMs, size)`. Works well for session JSON that changes rarely; avoids re-parsing identical bytes. Combine with a bounded `Map` for memory safety.
- Avoid `fs.existsSync` in write paths; use try/catch around the read or `fs.promises.access`. `existsSync` is racy.

Recommendation: use `fs.promises.readFile`/`writeFile` with atomic-rename writes; cache parsed sessions by mtime in a `Map` bounded to e.g. last 32 sessions.

---

## 4. Render caching / memoization

Sources:
- https://www.npmjs.com/package/lru-memoizer (v3, 2024)
- https://www.npmjs.com/package/memoizee
- General 2025 guidance (various)

Patterns:

- For **pure, deterministic render functions** (state snapshot -> markdown string):
  - Hash the input (e.g. stable JSON stringify + fast hash like `Bun.hash` or Node `crypto.createHash('sha1')` over a canonical string; or a cheaper string key via `JSON.stringify` with sorted keys), keep a `Map<string, string>` of rendered output.
  - Bound size: simple LRU via `Map` insertion order (`Map` preserves insertion order; when size > N delete the first key). Zero-dep ~10 lines.
  - Alternatives: `lru-cache` (npm, well-maintained) if you want time-based eviction.
- Avoid `JSON.stringify` for keys if the state is deeply nested/large — hash the stringified form once.
- For markdown rendering where the output is large and the input changes often, memoization may not pay off. Profile before adding.
- The `Bun.hash()` API is fast (xxHash); for Node parity use `crypto.createHash` with 'sha1' or a userland xxhash.

Recommendation: start with a **single bounded `Map<string, string>`** (~16–64 entries) keyed by a canonical hash of the render input. Add only if render is on a hot path.

---

## 5. TypeScript coding standards 2026

Sources:
- https://2ality.com/2025/01/tsconfig-json.html (Axel Rauschmayer)
- https://www.totaltypescript.com/tsconfig-cheat-sheet (Matt Pocock)
- https://medium.com/@colizu2020/unlock-blazing-fast-typescript-builds-... (2025-10)
- https://dev.to/whoffagents/advanced-typescript-patterns-branded-types-discriminated-unions (2026-04)

Recommended tsconfig baseline for a Bun-built, Node-target, ESM TS lib in 2026:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun-types"]
  }
}
```

Coding patterns considered current best-practice:

- **`satisfies` operator** for config/registry objects where you want both "literal type inference" and "this must conform to X". Example: `const flowStates = { ... } satisfies Record<string, FlowStateDef>` so individual keys keep narrow types.
- **Branded types** for IDs (`type SessionId = string & { __brand: "SessionId" }`) — catches accidentally passing a raw string in a session key. Implement via helpers, not Zod `.brand()` if you want zero-runtime cost.
- **Discriminated unions** everywhere for state (`{ kind: "planning", ... } | { kind: "executing", ... }`). Exhaustiveness via `never`-check in `default:` branch of `switch`.
- **`Result<T, E>` / `Either`** pattern for recoverable failures instead of throwing. TypeScript 6 has no built-in; 10-line union suffices:
  ```ts
  export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
  ```
  Throw only on truly exceptional cases (invariant violation). The `neverthrow` package is the most popular 3rd-party choice, but zero-dep is preferable for a lean plugin.
- Zod errors map well to `Result`: `const r = Schema.safeParse(x); return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error };`
- Prefer **`type` aliases** over `interface` unless you need declaration merging — simpler mental model.
- `verbatimModuleSyntax` forces you to use `import type` consistently, which helps tree-shaking/transpilation (Bun respects this).
- **`isolatedModules: true`** is required for Bun/esbuild/SWC-compatible transpilation. Bun's transpiler handles TS per-file, so constructs that require whole-program info (const enum, re-exported types without `type`) are errors.

---

## 6. State machine patterns

Sources:
- https://github.com/statelyai/xstate (v5.30, March 2026)
- https://github.com/chakra-ui/zag (discussion #355)
- https://stately.ai/docs/xstate

Key points:

- **xstate v5** is full-featured (statecharts, actors), ~15-25 kB gzip depending on imports. Overkill for a simple linear-ish workflow with a small set of states.
- **@xstate/fsm** was discontinued; the slim story in v5 is "just use xstate but only the FSM features".
- **zag** is UI-component-oriented (accessibility state machines) — wrong fit for a server-side plugin.
- For a workflow plugin like Flow with N discrete states and well-defined transitions, the recommended pattern in 2025-2026 is a **hand-rolled reducer over a discriminated union**:

  ```ts
  type State = { kind: "planning"; plan: Plan } | { kind: "executing"; step: number } | { kind: "done"; result: R };
  type Event = { type: "PLAN_APPROVED" } | { type: "STEP_DONE" } | ...;

  function transition(state: State, event: Event): State {
    switch (state.kind) {
      case "planning":
        if (event.type === "PLAN_APPROVED") return { kind: "executing", step: 0 };
        break;
      case "executing": ...
    }
    return state; // no-op / error
  }
  ```

- This gets you:
  - Zero runtime deps.
  - Exhaustive checking via TS `never` default.
  - Trivial serialization (state is plain JSON).
  - Easy testing (`transition(oldState, event)` is a pure function).
- Add xstate **only if** you need: hierarchical states, parallel regions, after/delay, actor spawning, visualizer tooling. For a linear workflow with a handful of states, hand-rolled wins.

---

## 7. Bun build pitfalls

Sources:
- https://bun.com/docs/bundler
- https://medium.com/@Nexumo_/bun-bundlings-sourcemap-traps-acc302bd8809 (2026-03)

Key points applicable to `bun build ./src/index.ts --outfile ./dist/index.js --target node`:

- **`--target node`** emits `.mjs` output expectations, prioritizes the `node` export condition. Good.
- **peerDependencies are NOT automatically externalized.** Without `--external`, Bun will try to inline `@opencode-ai/plugin` into the bundle. That would bloat the output and break because the plugin host provides the runtime. Fix: add `--external @opencode-ai/plugin` (or `--packages external` to externalize all bare imports, then your only actual runtime dep is `zod`).
- Decide whether to bundle `zod` in or externalize it:
  - **Bundle in**: single-file plugin users don't need to install zod. Slight duplication if opencode itself bundles zod, but usually fine. Current default.
  - **Externalize**: requires users to have zod in their env; not a great plugin DX.
  - Recommendation: keep `zod` bundled, externalize only the peer dep.
- `--minify`:
  - Identifier minification is safe. Syntax minification is safe. Whitespace minification is safe.
  - Cost: makes stack traces unreadable unless sourcemaps are attached.
  - Benefit for a Node-target plugin: small (parse time reduction only). Not critical.
  - Recommendation: `--minify-syntax --minify-whitespace` only, skip identifier minification to keep names in stack traces; or omit `--minify` entirely since this is a server plugin where bundle size isn't critical.
- `--sourcemap linked` requires `--outdir` (not `--outfile`). With `--outfile`, use `--sourcemap external` or `--sourcemap inline`. Recommendation: `--sourcemap external` for production plugins — makes error reports actionable.
- **CLI vs `Bun.build()` default drift** (Nexumo article): `bun build --sourcemap` defaults to `"linked"`, but `Bun.build({ sourcemap: true })` is `"inline"`. Be explicit: `--sourcemap external|inline|linked`.
- **`--compile` + `--minify` + `--sourcemap`** is a known bug-prone combination. Not relevant to this plugin (no `--compile`).
- Accidental dev-code inclusion: watch for `if (process.env.NODE_ENV !== "production")` branches — Bun does not strip those unless you pass `--define process.env.NODE_ENV='"production"'`. Alternatively use `--env inline` or `--env PUBLIC_*`.
- Bun's bundler does **not** strip `console.*` by default; pass `--drop console --drop debugger` for a prod-stripped plugin (at the cost of losing logs — often undesirable).

Recommended build command:

```
bun build ./src/index.ts \
  --outfile ./dist/index.js \
  --target node \
  --external @opencode-ai/plugin \
  --sourcemap external \
  --minify-syntax --minify-whitespace
```

---

## 8. `bun test` idioms

Sources:
- https://bun.com/docs/test
- https://bun.com/docs/test/mocks
- https://bun.sh/guides/test/mock-functions

Patterns:

- Globs for test discovery: `*.test.ts`, `*_test.ts`, `*.spec.ts`, `*_spec.ts`. Co-locate or `tests/` directory — both work.
- `--preload ./setup.ts` for global `beforeAll`/`afterAll` or env setup. Good place to seed tmpdir / mock `fs`.
- `mock(() => ...)` / `spyOn(obj, "method")`: Jest-compatible. Use `mock.module("node:fs", () => ({...}))` for module-level mocks — but note `fs` mocking with `bun:test` has historically been finicky (see Stack Overflow thread).
- For fs-heavy tests, **prefer using real tmpdirs** (`os.tmpdir()` + `fs.mkdtempSync`) over module mocks. Faster, closer to reality. Clean up in `afterEach`/`afterAll`.
- **In-memory fs options**: `memfs` works in Node, requires mocking `fs`. Heavier than just using tmpdir. For small JSON files (<10 KB), tmpdir is fine and probably faster.
- Fixtures: share via a helper (`function makeSession(overrides) { ... }`). Avoid global mutable fixtures; they interact badly with `--concurrent` mode.
- `test.concurrent` / `--concurrent` (default max 20): useful for I/O-bound suites, but **not safe if tests share mutable tmpdir/cwd**. Isolate via per-test tmpdirs.
- `--randomize [--seed N]` — catches order-dependent flakes. Enable in CI.
- `--coverage` with `lcov`: supported, can be written to `./coverage`. Works with most CI coverage tools.
- GitHub Actions integration is automatic (annotations in console output). For JUnit XML use `--reporter=junit --reporter-outfile=./bun.xml`.

---

## 9. Benchmark libraries for Bun/Node

Sources:
- https://bun.com/docs/project/benchmarking (official Bun recommendation)
- https://github.com/evanwashere/mitata
- https://github.com/tinylibs/tinybench (v6.0.0, 2025-12)
- https://github.com/bestiejs/benchmark.js

Comparison:

| Library | Last release | Bun-compatible | Notes |
|---|---|---|---|
| `mitata` | active (2025) | ✅ **Bun team's official recommendation** | High precision, native Bun/Node, lovely DX, garbage-collection-aware, compiled C++ hot path. Small, no deps. Output is a clean table. |
| `tinybench` | 6.0.0 (2025-12) | ✅ | Web-API-based (`performance.now`), 2 kB min+gz, well-maintained, supports `bunNanoseconds` and `timestampProvider: 'auto'`. Stats: std dev, p50/p99, margin of error. AbortController support. |
| `benchmark.js` | stagnant | ⚠️ | Old lodash-based monster, not recommended in 2025+. |
| `tatami-ng` | active | ✅ | Fork of mitata with more features. |

**Recommendation**: `mitata` is the safest pick — Bun docs explicitly recommend it and it's the fastest-evolving. `tinybench` is a good second choice if you want the wider library's stats breakdown. Either integrates well with Bun; both produce stable, reportable numbers.

For macro benchmarks (command-line level), `hyperfine` is the Bun-docs recommendation.

---

## 10. Coding-standard enforcement

Sources:
- https://sph.sh/en/posts/compare-typescript-formatting-linting-tools/ (2026-01)
- https://www.solberg.is/fast-type-aware-linting (2025-07)
- https://betterstack.com/community/guides/scaling-nodejs/biome-eslint/ (2025-10)
- https://dev.to/themachinepulse/why-i-chose-biome-over-eslintprettier-... (2025-12)

Landscape in April 2026:

| Tool | Role | Speed vs ESLint+Prettier | Type-aware rule coverage | Maturity |
|---|---|---|---|---|
| ESLint + typescript-eslint + Prettier | linter + formatter | baseline | 100% of typescript-eslint rules | very mature |
| **Biome** | all-in-one | 15–25× faster | ~75–85% via Biotype | stable (v2.x) |
| **Oxlint** (+ eslint-plugin-oxlint) | linter only | 50–100× faster | 43 rules via tsgolint (experimental) | stable for syntactic rules |
| dprint, oxfmt | formatters | fastest formatters | n/a | dprint stable, oxfmt alpha |

For a small TS plugin (this repo):

- **Biome** is the most pragmatic 2026 choice: one config file (`biome.json`), one binary, linter + formatter + import organizer, type-aware `noFloatingPromises` ships today, runs on all platforms via Rust binary. The project currently ships **no** lint config, so migration cost is zero.
- **Oxlint** is great for speed but lacks formatting. Use it alongside Biome *only* if you want the additional rule set.
- **ESLint + Prettier** is still the right call if you need: specific ESLint plugins without Biome equivalents, full type-aware coverage, or you already have a team ESLint config.
- For this plugin with ~12 files and no current lint setup: **Biome** (single `biome.json`, add `bun run biome check --write` to the `check` script). Very low overhead; makes `knip` + `tsc` + `biome` + `bun test` + `bun build` a clean "check" pipeline.

Example minimal `biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

---

## Appendix: Source list (URLs)

1. https://zod.dev/v4
2. https://zod.dev/packages/mini
3. https://dev.to/dzakh/zod-v4-17x-slower-and-why-you-should-care-1m1
4. https://moltar.github.io/typescript-runtime-type-benchmarks/
5. https://pockit.tools/blog/zod-valibot-arktype-comparison-2026/
6. https://v8.dev/blog/json-stringify
7. https://github.com/fastify/fast-json-stringify
8. https://www.javacodegeeks.com/2025/01/handling-json-in-node-js-performance-tips-with-fast-json-stringify/
9. https://github.com/simdjson/simdjson
10. https://lemire.me/blog/2024/03/12/how-to-read-files-quickly-in-javascript/
11. https://github.com/npm/write-file-atomic
12. https://nodejsdesignpatterns.com/blog/reading-writing-files-nodejs/
13. https://nodejs.org/api/fs.html
14. https://www.totaltypescript.com/tsconfig-cheat-sheet
15. https://2ality.com/2025/01/tsconfig-json.html
16. https://dev.to/whoffagents/advanced-typescript-patterns-branded-types-discriminated-unions
17. https://github.com/statelyai/xstate
18. https://github.com/chakra-ui/zag
19. https://bun.com/docs/bundler
20. https://medium.com/@Nexumo_/bun-bundlings-sourcemap-traps-acc302bd8809
21. https://bun.com/docs/test
22. https://bun.com/docs/test/mocks
23. https://bun.com/docs/project/benchmarking
24. https://github.com/evanwashere/mitata
25. https://github.com/tinylibs/tinybench
26. https://sph.sh/en/posts/compare-typescript-formatting-linting-tools/
27. https://www.solberg.is/fast-type-aware-linting
28. https://betterstack.com/community/guides/scaling-nodejs/biome-eslint/
29. https://www.npmjs.com/package/lru-memoizer
30. https://bun.com/reference/node/fs/readFileSync
