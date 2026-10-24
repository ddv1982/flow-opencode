# Native v2 host boundary

The selected design uses a process-local primary request snapshot for each
native session, an admission registry, and immutable assistant bindings.
It does not reconstruct authority from the latest transcript user or the
arrival order of asynchronous events.

The context hook captures consumed input IDs before the model request. Tool
execution verifies the exact native session, assistant, agent, call, workspace,
and consumed-input prefix. A later input cannot relabel an earlier assistant.
The prompt hook can revoke old authority. Positive authority requires an exact
accepted admission joined to the private dispatch and its live epoch.

Automatic compaction has its own checked control identity. The causal
compaction hook reads the native running automatic-compaction record. Resume
requires that same record to be completed and the same epoch to remain live.
The model-facing checkpoint uses a user role but grants no new user authority.

## Selection and proof

The independent Grok 4.7 cross-judge selected the request snapshot over the
larger event ledger. Its initial findings required more steering and compaction
proof. The later native probe extension supplies those observations. The parent
reran the original 49 receipt assertions and the 44-assertion live extension.
The extension passed all four cases. These counts describe bounded probe
assertions, not release qualification or provider coverage.

The cross-judge also corrected a duplicate-admission timestamp claim in the
earlier design. Duplicate identity is the input ID and payload. Timestamps and
hook invocation counts are not admission identity.

Retained compact receipts are `probe-verification.json` and
`probe-extension-verification.json`. The rerunnable probe lives in
`probes/server/`. Run `python3 probes/server/bootstrap.py --exe <exact-host>`.
It copies its owned fixtures into `/tmp/flow-v2-server-probe` and keeps all
host state there. The executable must report OpenCode 2.1.4. The default path
names the isolated Darwin executable used in this session. Linux remains a
separate verification gate.

## Concurrent ownership

- The server owner ports registration, role transforms, tools, session guards,
  validation capture, and composition.
- The continuation owner ports command handling, request attribution, native
  hooks, compaction, and continuation policy integration.
- The picker owner ports the terminal and server-owned model preferences.
- The evaluation owner ports host transport, identity observations, metadata
  probes, experimental evaluation plugins, and packed live smoke.
- The canary owner ports preparation, budgeted launch, and native evidence.
- The parent owns package metadata, release policy, workflows, public docs,
  the wiki draft, integration, authoritative checks, and external writes.

Writers share the integration checkout with exclusive file ownership.
The parent runs complete checks after their changes converge.

## Remaining product gates

Probe success does not certify the integrated Flow package. Runtime tests must
exercise the actual packed candidate, its role permissions, source-bound
validation, reviewer child, automatic continuation, and model picker.

No matching terminal live-control skill was installed. The native computer-use
attempt returned `Computer Use is not allowed to use the app 'com.apple.Terminal'
for safety reasons.` That restriction remains in effect. PTY receipts establish
terminal input and returned values. Visual review remains open.

Paid qualification requires a concrete approved dispatch proposal. Publication
requires the prepared exact candidate and the repository's final approval gate.

## Selected native account source

The user chose existing OpenCode 2 accounts. Metadata inspection found saved
OAuth connections for OpenAI and xAI. The authenticated background service
reports 2.1.4. No real credential values or refresh tokens were exported.

A private export bank was rejected. Native import skips an existing credential
ID, and native create returns a conflict. A cloned OAuth refresh could therefore
leave the original account stale. The key-only research helper is not adopted.

The selected design keeps refresh in the existing native service. A temporary
project plugin resolves only approved active connections and replaces the
original refresh value with a placeholder before returning data. A private local
relay connects that authenticated native RPC to the isolated test host. The
child overrides only the selected OAuth method and delegates its refresh to the
source. The original refresh token never enters the child. Broker requests and
host leases are serialized. Account switches or source failures are refused.

The synthetic two-host prototype persisted source rotation, preserved identity
and unrelated accounts, sent the correct bearer to a loopback model, and failed
before another model request when the source was unavailable. Its proof is
`/tmp/flow-v2-native-auth-probe/report.md`. Production integration passed native
bootstrap and shutdown proof with no model generations at
`/tmp/flow-v2-eval-auth-integration/verification.json`. Synthetic private Linux
forwarding passed separately. Actual provider qualification and independent
account-helper review remain open.
No real source-service plugin or account state has changed.
