# Choose the reviewer inside OpenCode

The 8.4.0 candidate adds an optional TUI module and native /flow-reviewer command.
This is a feature PR, not a published release. Installed 8.3.1 remains unchanged.
No paid evals or canaries are authorized.

## User flow

Open /flow-reviewer or choose “Flow: Choose reviewer model” from the command
palette. Search connected providers' text/tool-capable models. Deprecated models
are omitted. Availability here means configured catalog availability; no paid
probe establishes actual provider execution.

Choose a model, then confirm the global save and server reload. Current-project
busy sessions block saving. The confirmation tells the user to finish other
projects first because OpenCode's global config API disposes server instances.
The picker does not claim it can atomically rule out work starting elsewhere.
Cancellation makes no write. Choosing the already-selected value closes the picker.
A changed project, disconnected model, changed preference, or disposed plugin
prevents the pending save. API errors surface without claiming success.

## Stored preference and precedence

The picker patches only agent.flow-reviewer.options.flowReviewerModel through
OpenCode's global configuration API. It never writes the returned plugin list,
providers, credentials, or the manager's model. A project value for this same
preference overrides the global value through OpenCode's normal config merge.
There is no project-write UI in this first version.

A nonempty picker preference takes priority over reviewer.model tuple options
and OPENCODE_FLOW_REVIEWER_MODEL. It uses default model reasoning and retains
configured reviewer steps. An empty preference (“Use default”) restores the
existing tuple/environment model and variant. It does not delete or materialize
those settings. Project tuple settings alone do not override a nonempty picker
preference; use an empty project preference to restore tuple/environment behavior.

Flow consumes the preference during config application and reports its effective
requested source as picker in /flow-status. It is removed from the generated
agent options, so it is not forwarded as a provider option. OpenCode still owns
persistence, configuration layering, and reload behavior. No Session v5 fields or
new lifecycle tools are added.

## Packaging and host boundary

The package retains its server entry point and adds ./tui with its own compiled
module and declaration. OpenCode's installer detects both targets; reinstalling
with --force registers the TUI entry. Manual users must list the package in their
tui.json as well as their server config on OpenCode 1.18.6.

Only the existing SDK seam imports OpenCode types. The optional TUI implementation
has an 8 KiB source allowance; server-side preference resolution adds 1 KiB to the
existing config/status allowance. Runtime workflow code is otherwise unchanged.

Sources inspected for the pinned host:
- https://github.com/anomalyco/opencode/blob/v1.18.6/packages/opencode/specs/tui-plugins.md
- https://github.com/anomalyco/opencode/blob/v1.18.6/packages/plugin/src/tui.ts
- https://github.com/anomalyco/opencode/blob/v1.18.6/packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts

## Verification

Unit tests cover connected-model filtering, minimal preference patches, precedence
and reset, cancellation, confirmed saves, busy sessions, stale preferences, removed
models, and server config propagation. Existing surface and package checks pass.

Pinned OpenCode 1.18.6 rendered the real native picker and confirmation in an
isolated PTY using a synthetic catalog and a disabled write transport. This proves
UI registration and rendering; it is not a real provider or billing test. Early
probe attempts hit an old PATH executable and then a syntax error in the temporary
wrapper; the corrected pinned-host probe rendered both dialogs. Terminal capture
is retained outside Git in the temporary flow-picker-ui workspace.

The provider-free host smoke uses the real global PATCH API against an isolated
candidate installation. It verifies selected model/default reasoning, retained
steps, restoration of the original model/variant, unchanged unrelated environment
references in the config file, and no .flow state creation. No prompt is submitted.

The 8.3.1 baseline patch record cannot qualify this new public UI and runtime
configuration behavior. No 8.4.0 tag or publication is part of this implementation.
