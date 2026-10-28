# Writing Flow guidance

- Start with the task, normal path and finish condition. Put exceptional recovery
  under a named later section; branch to it explicitly before a mutation.
- Give each shared rule one authored owner. Compile shared Markdown into existing
  guides rather than add a new tool, state ledger, or model-side include protocol.
- State authority, source of truth and failure behavior concretely. A tool's next
  action supplies direction, not additional permission.
- Use one conditional instruction per branch. A terminal stop belongs inside its
  branch or at the end, never before a conditional follow-up read.
- Keep identifiers and executable commands exact. Explain judgments honestly;
  runtime enforcement does not prove review quality or goal alignment.
- Protect behavior with outcome graders and adversarial fixtures. Keep text checks
  for wiring, valid examples, ownership and size; avoid pinning incidental prose.
- Load only relevant phase guidance. Minimize assembled context as well as source
  duplication, and ratchet existing prompt ceilings down when cuts permit it.

## Composition

The four guide IDs remain self-contained. The catalog embeds the shared
manager-entry and delivery Markdown from `skills/flow/references/` after the
ordinary phase workflow. Routers select a phase without copying its full rules.
Status reads compact, optionally detail, renders one response, then stops. An
error ends its branch before another read or mutation.

## Verification

`bun run eval:guidance` is the offline contributor check, also invoked by push
preflight when guidance or native surface paths change. It exercises compiled
contracts, scenario graders, the native plugin surface, and cassette replay.
CI already runs the same tests and replay. Keep the existing release matrix and
exact-artifact qualification gates intact; contributor checks cannot replace them.

Live model behavior remains a separate authorized measurement. The
[guidance evaluation instructions](../evals/README.md#guidance-changes) use the
existing runner and reports. Do not create another local framework, weaken
existing release thresholds, or call synthetic grader fixtures model evidence.

The current consolidation shares authored contracts and lowers assembled size.
It does not eliminate all repeated context across successive guide loads. Further
lazy loading needs evidence that recovery still works, rather than more guide IDs
or a second model-side loader added on speculation.
