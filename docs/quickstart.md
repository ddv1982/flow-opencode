# Start a verified Flow session

Use this guide to install Flow, confirm its reviewer configuration, and run one
consequential change. Read the plan and the review before accepting the result.

## Install Flow

Install the exact release and start OpenCode inside your project as shown in the
[README installation section](../README.md#install). Finish or explicitly close
active Flow sessions before upgrading, then restart OpenCode.

## Select Flow models

Skip this if structural separation from the manager's model is enough.
`/flow-models` lists connected providers and saves the review and optional
planning models globally. Planning stays with the manager until one is chosen.

Without the terminal UI, name the reviewer in the Flow plugin entry and restart:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "<same exact Flow plugin entry>",
    "options": { "reviewer": { "model": "provider/model", "steps": 80 } }
  }]
}
```

A project can override either global picker choice through plugin options:

```json
{
  "modelPreferences": {
    "review": { "kind": "model", "model": { "providerID": "provider", "id": "model" } },
    "planning": { "kind": "default" }
  }
}
```

Place `modelPreferences` inside that plugin's `options` object. An absent role
inherits its global choice. A project `default` restores the role's configured
behavior. Reviewer options, then `OPENCODE_FLOW_REVIEWER_MODEL` and
`OPENCODE_FLOW_REVIEWER_STEPS`, supply the base settings.
The coding model stays under OpenCode's normal model selection.

## Verify the installation

Run:

```text
/flow-status
```

For a new project, the report includes `Status: idle`, `Next action:
flow_plan_save`, and the process-local reviewer selection. Availability remains
`unverified` because Flow reports requested configuration, not model health. A
successful review is separate evidence that OpenCode could start the reviewer.

If a Flow command or tool is missing, restart OpenCode and follow
[configuration troubleshooting](troubleshooting.md#flow-commands-are-missing).

## Run a goal

Choose work where an incorrect change would be expensive:

```text
/flow-auto add rate limiting to the public API
```

Flow inspects the repository and proposes an immutable feature plan. Confirm the
canonical repository gate and any external evidence before approval. After
approval, Flow implements one feature at a time, observes validation, dispatches
an independent review, and closes with a short delivery summary. The same close
response retains the full versioned report for requested detail.

If the host cannot continue between features, run `/flow-run` for each next
feature. Run `/flow-status` after any interruption or failed review.
