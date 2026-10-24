# Cross-judge report for the compaction boundary

Cross-turn sticky behavior is inactive. Trusted hooks did not provide a receipt. This turn follows poteto-mode directly. The independent comment review was not spawned. The parent forbade delegates. The sketch comments stay, because the function bodies throw and those comments are the only behavior specification.

This is a design judgment. I did not edit the repository, run the suite, launch a host, or touch the failed evidence files. `wc -l` on the frozen tree reports 992 lines in `src/platform/opencode/lifecycle.ts` and 997 lines in `src/platform/opencode/auto-drive.ts`.

The base is candidate A. Totals are 14 for A and 10 for B. B has design blockers. A still needs two grafts before anyone implements it. The grafts are small because A already owns the admission ledger. B's pure snapshot cannot see the facts the parent named.

## Scores

| Criterion | A | B |
| --- | --- | --- |
| 1. Interrupted ordinary manual summary, with no lease, no fabricated input, and no checkpoint grant | 3 | 3 |
| 2. Accepted automatic continuation, exact delivery, retry object identity, and no stale revocation of fresh work | 2 | 1 |
| 3. Pending, live and revoked automatic manual, unknown history, checkpoint tools, and ordinary summaries stay distinct | 2 | 1 |
| 4. Prefix, control, reason, and lifecycle are checked at one boundary, with no latest-user inference and no current-epoch grant | 2 | 2 |
| 5. One owner, a small caller interface, and deleted compensating branches | 2 | 1 |
| 6. Verification plan covers the failed native sequence, the packed smoke, and a component matrix, with honest limits | 3 | 2 |

Artifacts read end to end:

| File | SHA-256 |
| --- | --- |
| `candidate-a/candidate.md` | `a9869f2c73ba0cd37e965c2b1bc954c69681701ee3d5327308f2c3df841b1f55` |
| `candidate-a/sketch.ts` | `d9e814ccfee875490117167a59eb3625df9aca6c47a74453be8cb1d86adec371` |
| `candidate-b/candidate.md` | `2e7a1765ccb4aa781e1b3f4709a225c6582665e21b459f982e1286ad79a589ce` |
| `candidate-b/sketch.ts` | `b941508f2c6decc7d6428405a934bef0343a4207aa5c83d42580377ac91295b6` |

## Source facts the sketches have to meet

`lifecycle.ts` registers a command only after `revoke` and an awaited `session.get`. `revoke` runs at line 513. `session.get` is awaited at lines 521-526. `attribution.register` runs at line 550. The new message id is created at line 537, still after `get`.

`synthetic` does not revoke. It captures the current host epoch at line 321, awaits `session.get` at lines 333-339, creates the id at line 345, and registers at line 347.

`revoke` at lines 146-157 ends the current primary, increments the host epoch, revokes automatic execution, and deletes the checked compaction. It leaves `#admissions` in place.

`ExecutionAttribution.#admissions` is private at line 156. Public lookup is by a known id: `inputEpoch`, `inputOrigin`, `admitted`, and `hasAdmission` at lines 237-269. There is no enumeration and no frontier generation. `register` at lines 173-199 inserts one admission and returns its `ready` promise. `clear` at lines 547-553 rejects pending admissions. An epoch change does not.

`compactedInputOrigin` at lines 101-112 always returns a new frozen object. The retry path keeps identity only because `compactions.get` returns the stored `CheckedAutoCompaction` and `compactionOrigins.get` returns the object stored under that same key. The set is at line 788. The get is at lines 407-410. `prepareContinuationRetry` re-enters context. It does not run the compaction hook again.

`Lease` is a private type. `messageId` is on that type at line 148. `AutoDriveAuthority` at lines 87-91 is `hostSessionId`, `token`, and `epoch`. `captureAuthority` at lines 475-488 returns that value or null. `isAuthorityCurrent` at lines 490-497 compares `messageId` only when the caller passes a source. It returns false both when `messageId` is null and when `messageId` is a different id. No public method returns `messageId`.

The compaction hook pushes guidance at lines 715-716 before it knows the decision. If an accepted origin still exists, lines 748-764 call `assertOwned` before `session.context`. The unknown-history return is the `inputEpoch === undefined` branch at lines 733-746. Interrupted ordinary work still has an admission, so it takes the `assertOwned` path. `root-native-facts.json` records that throw, consumed id `msg_16deb972a001cSXagGDxecwI3c` on both controls, one provider request, and no added request after the failed compact.

The context hook does not await a pending `inputOrigin`. Lines 638-644 treat a promise as null. `owns` at lines 174-188 then calls `captureAuthority` when the owner has a source and no origin. `pending-activation.json` records the result. `activate` has made a lease capturable while `messageId` is still null, and context throws `Flow execution epoch was revoked.` The file says this is component-only.

## Trace 1. Hook entry after a command or synthetic begins, before `session.get` returns

The new private id does not exist in this window. A snapshot of `#admissions` cannot show it. A sketch that claims unchanged `execution-attribution.ts` also cannot grow a public list for it.

Command. `revoke` has already moved the host epoch. Both of A's snapshots, if taken after that `revoke`, agree on the new epoch. The old ordinary origin is still in the admission record with the old epoch. A classifies it as `retired-ordinary` (`sketch.ts` lines 59-64 and 91-94, `candidate.md` lines 31-35). Manual admission then takes summary-only (sketch lines 151-153). That record has no `InputOrigin`. This does not mint the command's new epoch into an origin. It also does not see the command. The command is only a local `owner` inside `execute` until line 550.

Synthetic. Nothing synchronous changes. The host epoch is unchanged. The frontier is unchanged. The `real` map is unchanged. A hook that enters here and finishes before line 347 is looking at the pre-synthetic ledger. If the last consumed origin is still live and the reason is `auto`, A's admit comment at lines 148-149 keeps the existing continuation. That copies the live origin's epoch. It is an execution grant for the old source, issued while `synthetic` has already checked the token and is blocked in `session.get`.

A's frontier moves on real-prompt observation and on private registration (`sketch.ts` lines 81-86, `candidate.md` lines 31-32). Registration is the late `attribution.register`. The sketch never bumps that frontier at the start of `execute` or `synthetic`. `InputLedger.capture` is defined on `SessionContext` (sketch lines 75-76), which is the compaction and context hooks, not the command or synthetic prologue.

B cannot see this window either. `OperationSnapshot.admissionIDs` (sketch lines 75-85) requires a list `ExecutionAttribution` does not export. `realCandidateIDs` can see the `real` map, and neither command nor synthetic writes that map. For a command, pre and post can both sit after `revoke`, so `hostEpoch` agrees and step 1 does not fire. Dead ordinary manual then returns summary-only at step 4 (sketch lines 131-132). That part matches A and does not grant. A live automatic source under synthetic still reaches step 6 and returns `continue`.

Cleanup while the command epoch is already current is the sharp edge. B's `applyCompactionDecision` comment (sketch lines 214-216) runs `failOwned` when the refused snapshot epoch is still the host epoch. After `revoke`, a snapshot taken in the gap has that new epoch. A refuse in that gap can revoke the epoch the command just reserved. A forbids that for a retired source. Sketch lines 159-163 say failure cleanup applies only to an exact captured record that is still live, and `candidate.md` line 38 says retired and unknown summary scopes supply no cleanup authority. The scope's captured lifetime epoch must not be the cleanup key. The source origin's liveness is the key.

Required graft on A. Bump the same ledger frontier synchronously at the start of command `execute` and `synthetic`, before the awaited `session.get`. Do it again at `register` only if the generation would otherwise stay still. An interrupt revokes and does not take that path, so retired ordinary manual summary still proceeds. A compaction that enters during the gap sees a frontier the consumed prefix does not cover (A sketch lines 86-88) and refuses without `revoke`.

## Trace 2. A new unconsumed same-epoch private admission while the native read is pending

Command `revoke` between the two observations is visible without listing admissions. The host epoch changes. A's `assertCurrent` checks lifetime (sketch lines 90-91). B's step 1 refuses when `hostEpoch` disagrees (sketch lines 123-125). That refusal must use the pre-command epoch for any cleanup decision. The post-revoke epoch belongs to the command.

Synthetic registration does not change the host epoch. It only inserts into `#admissions`.

A can see that insert if `register` bumps one generation on the same ledger and the scope captured the old generation before the native read. After the read, `assertCurrent` fails closed. Sketch lines 142-144 require that post-await check. This is one writer. It does not need an exported id list. A already changes `execution-attribution.ts`, so this does not contradict its module list.

B cannot see that insert. The compaction hook does not know the new id, so `hasAdmission(id)` cannot be asked. The native prefix can still equal `consumed` because the synthetic prompt has not landed. Step 1 then sees equal epochs, equal `realCandidateIDs`, and equal readings for the old ids. Step 6 returns `continue` and calls `compactedInputOrigin`, which allocates a new checkpoint. The in-flight synthetic is ignored. Building `admissionIDs` in `lifecycle.ts` would be a second list kept in step with the private map. B's `candidate.md` lines 85 and 125 say `execution-attribution.ts` stays unchanged and no second historical collection is added. Those two sentences leave no legal source for `admissionIDs`.

## Trace 3. The scope is waiting on `admission.ready`, and epoch, frontier, or unload changes, while `ready` never settles

Today the compaction hook awaits that promise directly (`lifecycle.ts` lines 724-726). Nothing in `revoke` settles it. The hook stays there.

A makes the same coupling explicit. `InputScope.settled` is one `Promise<void>` (sketch lines 71-72). The comment at line 89 says it awaits only that record's `ready`. `admit` awaits it and only then calls `assertCurrent` (sketch lines 142-144). While `ready` is pending, the frontier check does not run. `finally` does not run. `#pending` keeps the operation slot (sketch lines 133-140). A later compaction is rejected and does not revoke the holder. The fresh primary stays. The fresh compaction does not. Sketch lines 190-192 say a stale scope neither occupies nor clears a replacement slot. That is true only after `settled` fulfills and `finally` runs. It is false for this trace.

Unloading is the exception already in the source. `clear` rejects pending `ready`. A waiter of that same promise wakes. Epoch and frontier changes do not call `fail`.

Rejecting `ready` itself to wake the scope also rejects the admission. If that admission is the fresh command, the wake destroys it. The scope wait has to be a different promise from `admission.ready`.

B describes the right split and does not provide it. `waitForSettledOrigin` (sketch lines 182-188) takes `stillValid: () => boolean`. A predicate does not fire when the epoch changes. The comment says an epoch change, unload, stream loss, or new admission rejects the wait and does not revoke a newer primary. The function can observe `stillValid` only by polling or by `ready` settling. Polling is not in the sketch. Unchanged `execution-attribution.ts` still leaves `ready` pending across `revoke`. The advertised rejection does not happen.

Graft on A. The ledger that bumps the frontier also rejects the scope promise when that scope's lifetime, frontier, or open bit no longer matches. Leave `admission.ready` pending unless that admission itself is the stale one. `sourceFailure` stays a no-op when the captured source is not live. Do not call `revoke`.

## Partial activation

Current context treats a pending `inputOrigin` as absent, then `owns` reads `captureAuthority`. The lease is capturable. `messageId` is null. `isAuthorityCurrent(authority, source)` is false. Context throws before the native read.

A's primary callsite (sketch lines 12-21) captures a scope, waits for `scope.settled`, and only then resolves a positive origin. `capture` does not consult `captureAuthority` (sketch lines 81-83). `candidate.md` lines 32-33 and 38 delete the current-host authority fallback for pending ownership. After `ready` resolves, the existing live-origin checks run. No public `messageId` read is required. `auto-drive.ts` can stay frozen. This matches the component pause. `freeze` has not run while `activate` is held. The hang in trace 3 is what remains if `observeAccepted` never settles `ready`.

B's `contextAdmission` (sketch lines 163-172) waits only when the reading is pending, `captureAuthority` already returns a lease, and `messageBound` is false. The usage in `candidate.md` lines 46-55 sets `messageBound` from `lease.messageId === sourceID`. That field is private. `isAuthorityCurrent(authority, sourceID)` cannot stand in for it, because a lease bound to a different message is also false. B says `auto-drive.ts` is unchanged (`candidate.md` line 85). The wait input is then unavailable unless the shell leaks the lease. The pre-receipt path is intentionally left on today's refusal (`candidate.md` lines 97 and 163-169). The proved window is the one that needs the private field.

## Repeat proof and the same checkpoint object

The behavior the current tests exercise is a second context entry after one compaction. `freeze` keeps the primary when `prior.origin === origin`. That origin is the WeakMap value stored on the first compaction.

A's `completed` (sketch lines 167-175) looks up the stored record by control id and returns the existing `#origins` object. It says never to reconstruct it. The WeakMap is keyed by the `CheckedContinuation` object (sketch lines 131-132). A second `admit` that allocates a new record and overwrites `#records` orphans that key. "Exactly one" checkpoint origin (sketch lines 155-157) is the right rule only if `admit` returns the stored record when host, control id, and consumed ids match, and does not call `compactedInputOrigin` again. The sketch does not write that lookup. An overwrite compiles against the types.

B writes the reuse rule and writes it on the wrong value. `proveCompaction` step 6 always sets `checkpointOrigin` from `compactedInputOrigin` (sketch lines 137-140). That helper returns a new object on every call. `applyCompactionDecision` keeps a stored continuation only when the origin object is the same object (sketch lines 117-120 and 211-212). The new allocation is not the stored object, so the second proof replaces the WeakMap entry. Permit reuse by control id and consumed ids is specified. Continuation reuse by control id is not. A repeat proof therefore changes the object identity that response-less retry compares.

## Where a history fact stops being a live `InputOrigin`

A retained admission after `revoke` is still an `InputOrigin`-shaped object in `#admissions`. Its epoch is stale. `inputOrigin` returns that object today. It is not positive execution authority. `assertLive` fails it.

A's public evidence for that row is `retired-ordinary` or `retired-automatic` (sketch lines 59-64). The comment at lines 93-94 derives automatic from a non-null historical authority even when `automatic` is false, and it forbids turning an arbitrary throw into `retired-ordinary`. A summary record carries no origin (sketch lines 157-158). `completed` throws for summary-only (sketch lines 170-171). A later real input resolves through its own accepted record. The current host epoch is never copied onto a new origin for this row.

B's `readSource` drops the object on the way out (sketch lines 65-72). `dead-ordinary` and `dead-automatic` are tags. `ManualSummaryPermit` has no origin and no epoch (sketch lines 91-96). That is the right shape for the reading. The stored admission still has the old origin, and B leaves that store in place (`candidate.md` line 125). Any caller that keeps using `inputOrigin` bypasses the tag. The fence is the reading, not the record.

B's `OperationSnapshot` still carries `hostEpoch` as a number (sketch lines 75-80). The opaque `SnapshotToken` is a second field on that same object. Step 6 copies the epoch from the live origin, which is the right copy. The shell still receives the current host epoch on every proof. A later edit can pass it to `makeOrigin`. A's summary type has nowhere to put it.

Interrupted ordinary manual, traced on the written steps:

1. The ordinary origin stays stored. Interrupt has moved the host epoch. No new input id exists.
2. A reads `retired-ordinary`. Manual, no live guidance requirement for an ordinary host, no active primary. Result is summary-only. No `makeOrigin`, no recovery observation, no guidance append. The current push at `lifecycle.ts` lines 715-716 has to move inside the continuation branch. A says that (`candidate.md` line 34, sketch lines 158-159).
3. B reads `dead-ordinary`. Step 4 returns summary-only and does not call `compactedInputOrigin`. `apply` writes a permit and skips `captureOwner`, `failOwned`, recovery, and `observeCompaction` (sketch lines 206-209).
4. Later context for the completed control finds no continuation origin. The checkpoint tool fails. A later accepted real input uses its own record.

That is criterion 1 for both. It is not a reason to pick B.

The neighbor row is the blocker. Live ordinary manual, authority null, reading `live`. Step 4 requires every reading to be absent or `dead-ordinary`. Step 6 requires reason `auto`. Step 5's "non-null authority" clause does not name this row. Step 7 refuses every other shape (sketch lines 131-143). There is no `continue` for manual plus a live null authority. The same hole refuses grantless `flow-plan` and `flow-reviewer` manual continuation. The matrix at `candidate.md` lines 174 and 185 says those rows continue. The steps are the contract. The matrix is a prose guarantee.

Active primary overlap has the same split. The matrix says the existing refusal remains. Steps 1 through 7 do not read `primaryIdentity` except to see whether pre and post changed. An unchanged live primary passes step 1. A's admit comment refuses that overlap (sketch lines 151-153).

## Red flags

A puts source facts and the frontier generation on one ledger, and parsing plus the outcome record on one compaction boundary. `admit` and `completed` are the caller interface. `PrimaryHost` is marked as a sketch of existing lifecycle behavior (`candidate.md` lines 15-16). Implementing it as a real class would be a pass-through. The historical projection repeats `id` and `delivery` so that a retired row is not an `InputOrigin`. That repetition is the fence. Two indexes, id and frontier generation, belong to one writer. I do not see a second authority cache.

B's five functions hide the policy only if the snapshot can be built. It cannot, under the unchanged modules B named. `admissionIDs` plus a private map is a hand-synced list. `messageBound` is a lease leak. `dead-automatic` drops the authority token and step 5 then asks whether that token was non-null. The tag can carry the classification only if `readSource` is the sole classifier. The shell still has `SourceFacts.record`, which still holds the origin (sketch lines 51-62).

Both sketches delete `isUnattributedManualSummary` and the `inputEpoch === undefined` branch. That deletion is right. The unknown-history branch is a missing record, not a revoked ordinary record.

## Verification

A's plan names the unchanged packed smoke, the interrupted ordinary sequence with its reload control, a copied census, the pending barrier, and the existing lifecycle cases. It says native overlap, auxiliary retry, and the missed transport stimuli are unproved. It says this candidate ran no suite. I agree with that limit. I did not run those checks either. The parent rerun of the census asserts the current failure. It is not acceptance.

B names the census row flip, the pending test, the stale lifecycle cases, and the smoke's `completed` status. It also says it did not run them. The plan is thinner on the packed smoke's full assertion count and on keeping the original census bytes. More importantly, a suite that expects live ordinary manual continuation will fail if the steps are implemented, and a suite that follows the matrix will not test the steps.

## Grafts and rejected ideas

Keep A's ledger, typed summary record, and continuation record. Graft only these.

1. Synchronous frontier bump at the start of command `execute` and `synthetic`, before `session.get`, on the same generation `register` bumps. Interrupt must not take that path.
2. A scope promise distinct from `admission.ready`. The ledger rejects the scope promise when lifetime, frontier, or open state changes. It does not reject the fresh admission, and it does not call `revoke`. This is the part of B's `stillValid` comment worth keeping. The pull predicate itself is not.
3. `admit` returns the stored continuation record and the stored origin object when host, control id, and consumed ids match. It does not call `compactedInputOrigin` again. B's permit rule by control id and consumed ids is the model. B's comparison against the newly allocated origin is the part to leave behind.

Reject these.

- A universal manual bypass. It drops live ordinary and grantless continuation, then needs a second bridge to get them back. A already rejected this.
- Deleting the ordinary admission inside `revoke` so the unknown-history branch returns. A late callback and a real unknown summary become the same missing record. B already rejected this.
- `if (authority === null) skip assertOwned` inside the current hook. The hook would still build a checkpoint whenever a record exists, and pending ownership would still read the partial lease. B already rejected this.
- B's step 7 as the permission table. It refuses live null-authority manual continuation.
- An `admissionIDs` array or a readings map maintained beside `#admissions`.
- Reading `lease.messageId` from outside `AutoDrive`, or treating `isAuthorityCurrent(authority, source) === false` as proof that `messageId` is null.
- Using the current host epoch as the epoch of a new origin for retired, unknown, or summary rows.

## Convergence

The sketches agree on one split. A manual summary of history that is not a live positive origin stores no `InputOrigin` and cannot satisfy a checkpoint tool. A live accepted source keeps the existing continuation and the existing epoch. Native control, prefix, and reason are read before that choice. The current `assertOwned` before `session.context` goes away.

They do not agree on a shape. A moves the knowledge to the module that already performs `register`. B leaves that module unchanged and then reads facts it does not export. Averaging them would put a pure function on top of a second registry. That is the hand-synced list the red-flag screen rejects.

## Principles that changed this judgment

Model the domain made A the base. The outcome is a sum of live origin, retired ordinary, retired automatic, pending, rejected, and unknown. B's steps collapse live null-authority manual into the final refuse.

Type system discipline kept A's summary record, which cannot carry an origin or an epoch. B's permit agrees. B's public `hostEpoch` on the snapshot undoes part of that fence.

Boundary discipline put the native prefix and control check on the compaction boundary after the read, and left `auto-drive.ts` frozen. That is why A's pending wait is legal and B's `messageBound` input is not.

Attack the premise kept the census conclusion. The failed premise is that a summary requires a live owned epoch. Another condition inside `assertOwned` would share that premise.

Laziness and subtract before you add kept the caller interface at `admit` and `completed`, and kept the grafts on the frontier A already needs. They rejected a snapshot list as extra state.

Minimize reader load rejected `PrimaryHost` as a future production class and rejected five public functions whose inputs the shell cannot build.

Separate before serializing shared state rejected a lifecycle copy of `#admissions`. One generation counter written by `register`, by the real-prompt path, and by the new pre-`get` reservation is one writer.

Make operations idempotent required the stored origin object on repeat proof. B's identity check fails that test. The scope-wait graft is the same rule for a wait that must converge when `ready` never settles.

Fix root causes separated the hung wait from the authority bug. Waking the waiter by rejecting `admission.ready` would punish the fresh admission. The root is that the scope has no promise of its own.

Redesign from first principles kept the pre-`get` reservation on the frontier rather than adding a special case in the compaction hook. The reservation is what a command or synthetic already is, from the moment `execute` or `synthetic` begins.

Prove it works and test behavior kept criterion 6 on named sequences and literal summary-versus-tool outcomes. I did not treat either candidate's plan as a run. B's matrix does not match B's steps, so the steps decide the score.

Exhaust the design space is why this did not collapse into one verdict with no grafts. The two shapes were compared. Only one can observe a same-epoch private insert without a second registry.
