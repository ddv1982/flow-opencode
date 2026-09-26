# Bind episode execution to artifact bytes

Episode registration currently identifies host versions and repository sources.
A version label does not identify the executable selected by `bun x`, or the
installed files copied from the Flow package cache.

## Chosen design

Capture a canonical artifact manifest when creating the episode driver. Include
its identity in the existing `harnessDigest`. At host startup, copy the selected
native OpenCode executable, Bun executable, and applicable package cache into
private host storage. Compare those copies with the registered identity before
launching OpenCode directly.

Keep local file locations separate from stable identity. The manifest identifies
platform, architecture, executable versions and bytes, and cache entries. Cache
entries cover directories, regular files, executable bits, and contained relative
symlinks. Source treatment explicitly records that it uses no production cache.

Freeze caller input before asynchronous work. Recheck the copied artifacts after
startup and before command or prompt dispatch. Operator continuation uses the same
check. The actual Bun process that builds a treatment bundle must match the
registered Bun bytes. On Linux, inspect the running OpenCode executable through
its process ID.

Retain readable artifact evidence with the private episode journal. A hash alone
does not independently attest that a process ran. Existing live-execution and
qualification gates continue to apply.

## Alternatives

| Design | Decision |
| --- | --- |
| Capture at driver creation, copy and verify inside each host | Selected. Uses the existing driver and host lifetimes. |
| Reusable content-addressed artifact store | Deferred. Adds publication, reopening, cleanup, and shared-file responsibilities. |
| Hash Bun while retaining `bun x` startup | Rejected. Leaves the selected OpenCode executable unidentified. |

Two independent design candidates covered these alternatives. An independent
judge selected the first design, scoring it 25 of 25 against 23 for the reusable
store. The selected design incorporates the second candidate's builder identity
check and artifact checks before operator continuation. Model diversity was not
verified.

Model the Domain led to one manifest with separate stable identity and local
locations. Laziness Protocol kept registration on `harnessDigest` and avoided a
new storage lifecycle. Separate Before Serializing Shared State led to private
host copies. Prove It Works requires a real native host, a real packed cache, and
rejection of altered artifacts before dispatch.

## Limits

These checks detect observed artifact drift. They do not verify publisher
signatures or isolate the process from a malicious actor using the same account.
Operating-system libraries and arbitrary child programs remain outside the
manifest. Repeated hashes have runtime cost and must apply consistently to paired
arms. Source treatment retains its existing bundle receipt.

Implementation and runtime results are recorded in `implementation-status.md`.
