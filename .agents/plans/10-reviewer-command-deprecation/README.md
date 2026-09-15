# Deprecating the `/flow-reviewer` command

`/flow-reviewer` shipped in 8.4.0, when review was the only selectable role.
8.5.0 generalised the same picker to cover planning and added `/flow-models`
over it, but left the old entry point in place. It is now a pure alias: both
commands reach one `open()` handler in `src/tui.ts` with the same active-work
check, staleness check and configuration write. The alias saves one keypress.

The surface is also asymmetric. There is no `/flow-planner`, so a second
review-only command implies the reviewer is special when it is not, and hides
planning-model routing from anyone who learned the 8.4.0 command first.

## Timeline

Announced deprecated in the release that follows 8.5.0; removed no earlier than
9.0.0, per the cadence rule in `docs/release-qualification.md`. The palette entry
carries the notice, because a changelog line reaches nobody who already knows the
command. Behaviour is unchanged while deprecated.

Removal is deliberately held for the major. The command is public surface, as is
the `opencode-plugin-flow.reviewer-picker` module id that is renamed with it. A
major requires full qualification for other reasons, so the removal adds no
qualification cost of its own.

## Why this carries no release of its own

No patch release is available. `assertPatchScope` requires the baseline to share
the candidate's major and minor, and the baseline must carry a sealed bundle and
canary. Only 8.3.0 has those, so no 8.5.x patch can qualify. Releasing this alone
would cost a third offline feature entry or a funded live campaign, and a
deprecation notice does not justify either. It rides out with the next release
that happens for a product reason.

For the same reason this change does not touch `package.json`. Once `src/tui.ts`
diverges from the reviewed commit `c0064dc`, the 8.5.0 feature record can no
longer re-verify, and `.github/workflows/ci.yml` runs that verification exactly
when a change touches the record or `package.json`.

## Test seam

`tests/reviewer-picker.test.ts` reaches review through `/flow-models` and the role
menu, so the suite does not depend on the alias. One test still exercises the
alias directly and asserts its palette title marks it deprecated. Removing the
command at 9.0.0 deletes that test and nothing else.

## Documentation corrected alongside

`docs/quickstart.md` is what the README sends new users to, and it predated
8.4.0: it taught only the `opencode.json` tuple route, never mentioned either
picker, and contradicted the README on precedence. It now leads with
`/flow-models` and states the real order.

`docs/troubleshooting.md` pinned `opencode-plugin-flow@8.1.3` through four
releases. It now refers to the README, and a contract test keeps the asserted
README pins the only ones in maintained prose.
