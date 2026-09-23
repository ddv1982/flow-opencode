# Capture private recovery inputs

Use the evaluation capture plugin to retain the exact session, source digest,
and proposal supplied to recovery assessment. The plugin returns unavailable
advice and never sends a Jev request. Manager requests still follow the host's
existing provider configuration and authorization.

## Select the capture plugin

1. Choose a new absolute output directory outside the workspace. Its parent must
   exist. Do not create the output directory yourself. Each recorder claims its
   own directory and refuses an existing one. A failed startup may still claim
   the directory. Use a new path for the next attempt.
2. On a POSIX host, in the target workspace's OpenCode configuration, replace the ordinary Flow
   plugin entry with the absolute source entry and capture options below.
   Replace both example paths with actual absolute paths. Do not load both Flow
   entries together.

```json
{
  "plugin": [
    [
      "file:///absolute/flow-opencode/evals/recovery-decisions/capture-plugin.ts",
      {
        "captureDirectory": "/absolute/private-parent/new-recovery-captures",
        "reviewer": { "model": "provider/reviewer-model" }
      }
    ]
  ]
}
```

Preserve any existing `reviewer` option from the ordinary Flow plugin entry;
omit it if none was configured. Windows capture is unsupported because POSIX
directory and file permission checks do not provide a privacy guarantee there.

OpenCode combines user and workspace plugin entries. If your user configuration
loads the ordinary Flow plugin, the workspace entry above loads a second Flow
instance and capture cannot start. On Linux, use an empty private configuration
directory for the capture run. Keep `HOME` and `XDG_DATA_HOME` unchanged so
OpenCode can still read stored provider credentials. If your user configuration
also defines provider settings, put the required non-secret fields in
`/absolute/private-parent/opencode-config/opencode/opencode.json`. Do not copy
its `plugin` list or credentials.

```sh
mkdir -m 700 /absolute/private-parent/opencode-config
XDG_CONFIG_HOME=/absolute/private-parent/opencode-config \
	opencode /absolute/workspace
```

The workspace's `opencode.json` still supplies the capture plugin. The
command-scoped `XDG_CONFIG_HOME` leaves your usual configuration unchanged.

3. Start a fresh OpenCode process from the target workspace. Use an existing
   recovery proposal at a blocked checkpoint. The capture plugin keeps the
   normal Flow tools and command rules. It does not start a manager request or
   activate recovery by itself.
4. Inspect the private files locally. Keep the directory after a failed or
   interrupted run. To start another recorder, choose a new output directory.

The recorder writes before the controller validates the recovery proposal.
A rejected proposal can therefore leave a file, including a proposal submitted
without an active recovery lease. The file does not establish that a provider
received the proposal or that an action was permitted.

If manager execution is already authorized, use the existing shadow command to
have the manager propose recovery at the checkpoint. Keep the approved goal.

```text
/flow-auto --recovery=shadow --recovery-calls=1 --recovery-usd=0.01 <approved goal>
```

The existing command parser requires these recovery limits. With the capture
plugin, the provider remains unavailable and spends nothing on Jev. These limits
do not bound the manager's own requests. Delegated recovery remains unavailable.

## Review the captured inputs

1. Check the raw record's payload and canonical payload digest. Treat its tool
   context and timestamp as local observations. They do not authenticate the
   producer or preserve the source tree's bytes.
2. Sanitize a separate copy. Remove private information while preserving internal
   session, revision, candidate, and evidence bindings. Keep the original private.
3. Establish source provenance and record the actual sanitization review. A raw
   capture has unverified origin. Do not label a synthetic test capture as an
   observed operational case.
4. Follow the [reviewed dataset workflow](README.md#reviewed-datasets) to import
   the sanitized snapshot, assign labels and splits, and obtain independent
   review. The importer refuses a raw capture directly.

## Storage limits

The recorder creates a directory with mode `0700` and complete exclusive JSON
files with mode `0600`. It checks canonical paths so output cannot sit inside the
observed workspace through a directory alias. These permissions do not protect
against another process running as the same user.

One recorder allows at most 128 records, 1 MiB per encoded record, and 16 MiB of
encoded records in total. It reserves capacity before asynchronous writes.
Failed writes consume their reservation. A write failure or exhausted limit
stops the opted-in proposal before controller assessment. No success response
silently drops the capture.

Captures are private raw inputs, not a corpus or qualification report. They do
not supply labels, independent review, provider pricing, spending authorization,
or production qualification.

## Verify capture locally

Run the deterministic capture and tool checks without inference.

```sh
bun test tests/recovery-capture.test.ts
```

These tests exercise private files, exact payloads, storage failures and limits,
active shadow advice, and the registered plugin tool. They use synthetic fixtures
and do not supply operational evaluation evidence.
