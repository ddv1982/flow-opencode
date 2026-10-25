# OpenCode v2 core review, round 6

Verdict **ISSUES**. One P2 production liveness defect is reproduced on the actual native host. Ordinary coding without a Flow automatic lease cannot resume after automatic compaction. The current automatic-lease fix passes its decisive native cases, including compaction before the first primary and compaction followed by a response-less retry.

This verdict covers the frozen core source. It gives no release approval. The branch and base are supplied as `feat/opencode-v2` and `8103f1cd42e1b4d111f25d2a311935d4e41fb997`. I ran no Git command. All reviewer writes are under `/tmp/flow-v2-core-review-r6`.

## P2. Ordinary coding stops after automatic compaction without a lease

Primary location is [lifecycle.ts:737](/Users/vriesd/projects/flow-opencode/src/platform/opencode/lifecycle.ts:737). The downstream rejection is [lifecycle.ts:413](/Users/vriesd/projects/flow-opencode/src/platform/opencode/lifecycle.ts:413), through lines 429. The context hook calls that resolver at line 687.

An ordinary unmarked user prompt records a real-input candidate and revokes prior execution authority. It does not create a Flow automatic lease. If native automatic compaction happens before its primary context, the compaction hook returns at line 737 because both guidance and accepted automatic authority are absent. It never resolves the real candidate or records the exact running automatic control.

Native compaction then succeeds and prunes the original user. The resumed context consumes only the completed control ID. There is no checked control in `compactions`, no registered admission for that ID, and no real candidate for a compaction record. `resolveOrigin` throws `Flow context has an unknown, synthetic, or stale real input.` The user's normal coding execution fails before its next provider request.

I reproduced both requested prior states with unchanged production setup and handlers on native OpenCode 2.1.4:

- After a public plugin reload, no primary is retained in the new lifecycle instance. A fresh ordinary unmarked user is accepted. Automatic compaction completes. The first resumed context fails with the exact error above. There are zero subsequent provider requests and zero protected tool completions.
- With an ended manual primary retained, the same accepted unmarked input, automatic control, pruning, and rejection occur. There are again zero subsequent provider requests and zero protected tool completions.

The first native run is [run-20261024-130946-865865](native/run-20261024-130946-865865/native-ordinary-compaction-result.json). The second is [run-20261024-131002-888264](native/run-20261024-131002-888264/native-ordinary-compaction-result.json). Their `cases.stdout` files give compact observations. [native-review-verification.json](native-review-verification.json) checks the causal joins, source identity, and cleanup. Both controls have reason `auto`, status `running` at the hook, and status `completed` afterward. Each running control's consumed prefix ends in the fresh native user ID. Each resumed context consumes exactly its completed control ID. Neither case calls `/flow-auto`, admits marked metadata, or creates durable Flow state.

The probe uses the existing loopback provider's reported token usage to trigger real native automatic compaction. The observer supplies a summary through the public compaction hook. It does not insert transcript records or replace product handlers. This is a native control and context path, not an exported transcript interpreted afterward.

[ordinary-compaction.test.ts](ordinary-compaction.test.ts) independently reproduces the same production lifecycle transitions offline. Its no-compaction controls execute the protected tool with `authority === null`. Both compacted variants fail. [ordinary-compaction.log](ordinary-compaction.log) records two passing controls and two failing expected-success tests. The native collection scripts exit zero after validating the observed defect. That exit code is not a product success verdict.

Minimal recommendation. Preserve ordinary input provenance through an exact native automatic control independently of an automatic lease. Check the accepted real input, complete consumed prefix, selected agent and model, running control, and completed control before allowing ordinary primary attribution. Keep its automatic authority absent. Summary text, current epoch, and latest-user position must not mint a grant. A manual-reason control must still fail the existing automatic-authority preservation checks. Add the two ordinary cases with a successful resumed primary and protected tool before closing this finding.

To rerun the actual cases, use the two `run-ordinary-native.py` commands in [commands.json](commands.json). The private entry and immutable dependency cache must remain present.

## Current automatic-authority fix

The data model separates the accepted `InputOrigin`, its registration epoch, a checked compaction control, a frozen provider attempt, and immutable assistant and Request bindings. Pending registrations expose a promise, not an accepted origin. Context and compaction share `resolveOrigin`. The compaction path no longer requires a retained primary to establish an accepted input's provenance.

The independent native reruns pass:

- [Stale compaction callback](native/run-20261024-130720-862983/native-stale-callback-result.json). The old callback fails. A distinct fresh running control consumes the newly accepted user. The first fresh context consumes that exact completed control after pruning. The protected `flow_status` completes with active automatic authority. Durable Flow state remains revision 2 with the accepted draft and approval.
- [First invocation with no retained primary](native/run-20261024-130750-590231/native-first-compaction-result.json). Public reload clears the lifecycle after genuine native long history. The fresh marked command compacts before its first primary. Its exact completed control reaches the protected tool. No plan is created implicitly.
- [Automatic compaction plus response-less retry](native/run-20261024-130804-281373/native-compaction-retry-result.json). Public `model.request` selects a closed loopback port after the checked control completes. Native retry policy remains unchanged. The retried primary reuses the unfinished assistant and successfully executes `call_post_compaction`. The copied verifier passes all 24 assertions. See [native-compaction-retry-verification.json](native-compaction-retry-verification.json).
- [Delayed old context entry](native/run-20261024-130823-799926/native-stale-context-result.json). The old context enters after fresh admission and fails its epoch check. The fresh context and protected tool succeed.

The original causal success assertion was retained. The new native running control consumes the exact fresh accepted user before compaction. The later primary and tool consume the exact completed control after the native context removes that user. No test requires the pruned user to remain present or treats summary text as authority.

## Ownership checks and an unresolved component objection

The current source captures input ownership before native reads. Cleanup checks epoch, exact attempt when applicable, and known source. `failOwned` separates ending an owned attempt from revoking a host. Old finally blocks delete only their own pending slot. Known old assistant and Request bindings cannot borrow a replacement primary for cleanup. Both tool entry routes share verification. Accepted-message observation checks ownership around awaited policy work. Per-host native read failures remain host-scoped. Subscription error and EOF still close all sessions.

[cleanup-census.json](cleanup-census.json) independently regenerates the owner's lexical census. It has 31 cleanup sites and four direct host-revoke sites. This is an actor inventory, not proof of runtime ordering.

The copied R5 challenge [r5-challenges.ts](r5-challenges.ts) passes all 18 retained cases on current source. It reads the native array after a delayed read resumes, so an old callback can observe the replacement transcript. Delayed context and compaction resolve and reject leave the fresh context and protected tool runnable. Repeated response-less retries, bound-assistant rejection, late registered responses, old stream cancel, and stale automatic shell after manual replacement remain covered. The exact-Request fail-closed observation for an unregistered response is retained without a new native claim.

One additional component objection remains explicit. [lifecycle.ts:663](/Users/vriesd/projects/flow-opencode/src/platform/opencode/lifecycle.ts:663) compares a pending context's epoch but not its source. In [same-epoch.test.ts](same-epoch.test.ts), an old context is paused in its native read. A new private synthetic input is accepted in the same epoch. A new context then encounters the old pending slot, throws `Flow primary context callbacks overlap.`, and revokes the fresh authority. This occurs for delayed old resolve and reject. If the old callback settles first, both controls execute the fresh protected tool and preserve authority.

[same-epoch.json](same-epoch.json) records the actual failures. The failed contexts never reach their tool, and the receipt explicitly records `toolRan: false`. Native overlapping primary callback reachability for this exact sequence is unproved. I retain this as an unresolved source-level concurrency objection, not a second demonstrated native production defect. The parent should establish whether the native host serializes these callbacks across cancellation. If overlap is supported, the pending slot must distinguish stale source ownership while continuing to reject genuine same-input overlap. The P2 above independently prevents source PASS.

## Retained findings and provenance corrections

R1 stream cancel, read failure, missing body, locked body, stale response, and setup-after-freeze sequences pass current focused tests. HTTP 400 preserves the provider response and releases the exact attempt. R2 pre-response failure and interruption recovery also pass. The specific originally reported sequences stay closed. I did not rerun every historical native stream profile on this private entry.

R3's origin recreation defect stays closed. The exact `CheckedAutoCompaction` object retains its memoized `InputOrigin`. `freeze` still requires `prior.origin === origin` at execution-attribution line 312. Native compaction plus refusal and reused-assistant retry now passes in this review. Already bound assistants and consumed retry tuples remain rejected.

R4's old callback cleanup finding stays closed in its recorded command-replacement sequences. R5's PASS applies to its old source only. The later rejected archive is not accepted here.

I recomputed the historical marker identities in [marker-provenance.json](marker-provenance.json). R1's recorded lifecycle `1e8d5991dcaa756ef19484a6219dcca980551f201d21676c63534019af463772` already allocates and persists the initial marker. Its missing-marker claim is unsupported for those bytes. The earlier `0e4ba80b...` archive contains lifecycle `188ec484...`, which genuinely lacks both operations. The `224f3c78...` source contains both. Original reports and trails remain unchanged.

The parent's reconciliation was read as historical evidence. Its statement calling d3d46d92 the final product archive is superseded by the supplied rejection brief and retained native failure. The old callback's correct rejection did not prove fresh lease revocation. The distinct fresh preprimary control was the failure in that archive.

## Other production boundaries

The relevant current permission, tool, validation, preference, store, picker, TUI, transport, and composition paths were reread. The retained base diff and current five-file patch were inspected. [reviewed-files.sha256](reviewed-files.sha256) records scoped identities, including the deleted V1 adapter. Native dependencies remain external in both package build commands. Inward application layers do not import the native host. The architecture tests pass, including all source ceilings and referenced exports.

The moved prompt converter and command-name parser have unchanged bodies after accounting for export and rename. [moved-code-check.json](moved-code-check.json) compares actual old archive source with current source. Delimiter-counted lines remain lifecycle 993, auto-drive 998, execution attribution 607, auto-compaction 73, command-hook 247, and recovery-policy 1000. No ceiling exception or compressed formatting was introduced.

Reviewer completion permits any verified `flow-reviewer` child in the matching workspace with a parent present. It does not require an assignment-manager parent identity. Other callers retain exact accepted replay only. Validation joins exact shell command, native execution, session, workspace, completeness, report freshness, and source digest at persistence. Unknown host output remains ineligible. Preference persistence retains atomic revisioned updates and stale, model, project, activity, abort, and unload checks. No cross-process atomic prompt barrier or TUI visual proof is claimed.

The supplied comment inventory has three existing public-contract keeps in eval tooling and zero suppressions. Current five-file source markers are the three preexisting auto-drive comments. I give no comment-style findings and no independent Comment Sicko verdict. The parent forbids delegates.

## Executed checks and exact identity

Pinned `/tmp/flow-v2-toolchain/node_modules/.bin/bun --version` reports 1.4.0. The ambient Bun is 1.3.14 and was not used for these tests. [focused-command.json](focused-command.json) records the exact 16-file command and isolated environment. [focused-tests.log](focused-tests.log) records **439 passed, zero failed, one filtered**, with 2241 expectations. This includes all six architecture tests. The filtered test constructs a Git-backed recovery fixture. No full suite, root typecheck, build, pack, install, or Git-backed grader preparation ran here.

The extra review probes are separate from that number. R5's 18 cases pass. The ordinary compaction regression has two passing controls and two expected-success failures. The same-epoch component challenge also has two passing controls and two expected-success failures. Neither set of failures is hidden in the focused suite total.

The private entry is `169609bd9a4d12ba5dd49f60a47ce8251dc9f0dc6d1e9a4bf4604a8096b5e3b3`. Its map is `20636a358fb5c07ec8edef2bbf70158984e280a73396d3dbfebdb47aa12aa662`. I copied both without building. All 74 mapped production contents equal workspace bytes. [source-binding.json](source-binding.json) records the comparison. The private runtime reports development version `0.0.0`. This is not a published or packed 10.0.0 entry.

The immutable archive remains `d3d46d92148a34d829536c939a528f52c3ef6adeb612230afab860b003c09292`. Its server map differs in exactly the five owned production files. [archive-to-current.diff](archive-to-current.diff) records that comparison. No replacement archive was produced.

Initial and final inventories cover 292 source, test, and package files. [drift.json](drift.json) is empty. The owned hashes match freeze-for-r6 throughout. Lifecycle is `8c7b8ff2ffb325afb145fcb1b437732dbf2bf7f1e2fee67217d39a11deacb63e`. Execution attribution is `fbd303985512a0b8a67eb1ae7ff5069b1be4f9b844b9f3815b2179bb64b96b1d`. All scoped hashes are in the inventories. The parent-reported ADR-only update is outside that inventory and explains documentation drift. It does not change this source identity.

Six native runs used isolated HOME, XDG, cache, default-service, and temporary directories under this review output. Providers and health checks used loopback only. All 12 owned host and provider processes were stopped and awaited. Their PIDs and exit codes are in [native-review-verification.json](native-review-verification.json). No process or operation targeted PID 76572. No real credentials, native-account helpers, external provider, paid call, delegate, goal, automation, connector, or repository write was used.

## Limits and trail audit

Actual same-model auxiliary generate retry remains unproved. The current negative component passes. The earlier pending-primary auxiliary generate and unsuccessful reentrant attempt do not establish retry behavior. The owner marker receipt is source-bound evidence that I inspected, not a marker host run by this reviewer. Final export alone does not prove compaction continuity.

The parent's canonical macOS and Linux checks, documentation check, final archive, packed runtime wave, visual gate, official-provider qualification, and paid qualification remain parent-owned. I adopt no parent suite result as a measurement from this run. Native-account helper review and the separate Typesafe key-name configuration review remain outside this verdict.

[decisions.tsv](decisions.tsv) is this run's append-only trail. I audited it against the active conversation, source, retained evidence, command outputs, and probe files. An initial diff-writer generator error was corrected before any identity claim. The initial same-epoch receipt was preserved when I made the unreached tool explicit. No historical owner evidence was rewritten. Native observations distinguish expected success from confirmed failure. Cross-model review of this trail did not run because delegates are forbidden.

Poteto's Model the Domain principle made the review distinguish ordinary input provenance from automatic authority. Attack the Premise extended the census to the no-lease actor missing from the owner's positive matrix. Prove It Works required actual native control-to-context-to-tool behavior and source-map equality. Test Behavior, Not Implementation made the ordinary controls execute a real protected boundary and left failing expected-success tests visible. Minimize Reader Load made the finding trace the single early return and its downstream resolver rejection. The Investigation workflow ran sequentially under the parent's explicit scope.

## Attention

reviewed by gpt-6.1-sol, self-audit only

- Fix ordinary no-lease automatic compaction before claiming bounded source PASS.
- Resolve or bound the same-epoch pending-context objection. Its component failure is proved. Its native concurrent-primary reachability is not.
- Preserve the strict checked-origin retry identity, stale-tool vetoes, initial marker provenance correction, and honest auxiliary retry limit.
- No release approval is given.
