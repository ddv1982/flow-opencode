# Start a verified Flow session

Use this guide to install Flow, confirm its reviewer configuration, and run one
consequential change. Read the plan and the review before accepting the result.

## Install Flow

Install the exact release shown in the [README installation section](../README.md#install).
Restart OpenCode after installation.

## Select a reviewer model

Skip this step if structural separation with the manager's model is sufficient.
To use another model, list the model IDs that OpenCode knows:

```bash
opencode models
```

Add the selected ID to the existing Flow plugin entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "<same exact Flow plugin entry>",
      { "reviewer": { "model": "provider/model", "steps": 80 } }
    ]
  ]
}
```

Restart OpenCode. Tuple settings take precedence over the
`OPENCODE_FLOW_REVIEWER_MODEL` and `OPENCODE_FLOW_REVIEWER_STEPS` fallbacks.

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
[configuration troubleshooting](troubleshooting.md#flow-is-not-available-after-installation).

## Run a goal

Choose work where an incorrect change would be expensive:

```text
/flow-auto add rate limiting to the public API
```

Flow inspects the repository and proposes an immutable feature plan. Confirm the
canonical repository gate and any external evidence before approval. After
approval, Flow implements one feature at a time, observes validation, dispatches
an independent review, and closes with a versioned delivery report.

If the host cannot continue between features, run `/flow-run` for each next
feature. Run `/flow-status` after any interruption or failed review.
