# Flow guidance maintainability

## Intent

Make Flow guidance easier to follow and cheaper to change while preserving its
own product boundary: approved work, current-source evidence, independent review,
and explicit closure. The comparison with tstack motivates clarity, composition,
and bounded review; no skill text is copied and tstack is not a dependency.

## Phases

1. **Define and measure.** Record a Flow-specific writing standard. Add outcome
   scenarios for ordinary read-only status, blocked detail, and status failure.
   Test each grader with both conforming and adversarial traces. Reuse the
   existing scenario runner, provenance, authorization and report pipeline.
2. **Simplify the guidance.** Put the ordinary plan/run path before recovery
   details. Give goal alignment and delivery one authored source, embedded into
   each existing guide by the catalog. Keep all four guide IDs and existing
   commands. Make status routing ordered: compact, error or conditional detail,
   render, stop. Keep approval, scope, evidence, reviewer, retry, and archive
   replay contracts intact.
3. **Make verification routine.** Provide one offline contributor command for
   prompt structure, scenario graders, native surface integration and cassette
   replay. Document the optional live scenario command separately. Keep local
   results, live model behavior and release qualification clearly distinguished.
   Run normal CI and independent Sol review before merge.

## Writing standard

The maintained [Flow writing standard](../../../skills/README.md) owns
instruction order, shared contracts, authority, judgments, and eval discipline.

## Acceptance and boundaries

- Shared alignment and delivery contracts have one maintained source; packaged
  guides remain self-contained and readable without filesystem access.
- Normal execution precedes exception detail in the authored run guide.
- Status never advances work, does not read detail on ordinary state, reads it
  once when blocked/awaiting direction, and stops after any status error.
- Existing lifecycle, schema, source binding, permissions, review/retry rules,
  release thresholds, frozen artifacts and historical receipts remain unchanged.
- New model scenarios are ordinary development cases, not silently added to the
  sealed 10.0.1 release matrix or treated as qualification evidence.
- No publication or fresh paid campaign is part of this change. Live model runs
  require their own current bounded dispatch authorization; offline tests and
  replay cannot establish that rewritten instructions perform better on models.

## Follow-up measurement

Before claiming better model adherence, run the documented existing scenario
selection under a fresh bounded authorization. Compare retained outcomes and
instruction size with the base. Replace older phrase assertions only after the
matching behavioral coverage exists; do not remove them merely to permit a
rewrite. Full release qualification still applies to any future candidate.

## Evidence

- `bun run eval:guidance`: 84 focused tests pass; all 13 gated cassettes reproduce.
  The new graders use actual native-plugin fixture responses and adversarial
  variants, including a tool read after a status error.
- `bun run check`: 5,766 pass, 27 skip, zero failures before final review fixes;
  the clean committed push preflight repeats the complete gate after those fixes.
- `bun run smoke:live`: two packed OpenCode tests, 128 assertions, pass using a
  local scripted provider. No real provider dispatch or account use.
- Independent GPT-6.1 Sol review: three rounds, final APPROVE. Fixed all findings:
  accepted-close archive retry remains exact and immediate; status error grading
  rejects every following tool call, not just further status reads. Error handoffs
  retain supplied delivery and the mutation statement, including archive collisions.
- Authored skill text including shared fragments falls from 36,220 to 29,853
  bytes. The ordinary manager stack is effectively flat: 23,599 to 23,592 bytes;
  compiled command/agent surfaces fall from 14,496 to 14,335. Existing prompt
  ceilings ratchet down; documentation and source ceilings are unchanged.
- Contributor preflight now owns one mandatory offline guidance command. Live
  model measurement is explicitly separate, rather than silently attempted by
  an ordinary contribution. No release threshold or qualification gate changes.
- New scenario behavior on real models remains unmeasured. No release, model
  comparison, new dispatch ledger, paid evaluation, or old-budget reuse occurred.
