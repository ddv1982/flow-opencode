# Local runtime evidence

The repository contribution skill excludes generated release smoke artifacts from commits unless a maintainer asks to archive each exact artifact. The parent moved these early compact receipts out of the checkout without changing their bytes. Their original decision-log references are historical and are superseded by these locations.

- [canary-r1-fixes.json](/tmp/flow-v2-release-smoke-scaffolding/canary-r1-fixes.json) has SHA-256 `664f0ba2732b0d816d7d6bbeaec9743e76c72e1d05d5666c7c5b0d6e81c2d36b`.
- [packed-continuation-224f.json](/tmp/flow-v2-release-smoke-scaffolding/packed-continuation-224f.json) has SHA-256 `7da839ed378a26c9cd17898decb5d1f16c78ba64a6bd8c424a12a50c90178514`.
- [packed-eval-224f.json](/tmp/flow-v2-release-smoke-scaffolding/packed-eval-224f.json) has SHA-256 `cdb9385b81e7819f2bb2b67968f7686e1f73162f053dc1551896bbd589b6b99d`.
- [packed-picker-224f.json](/tmp/flow-v2-release-smoke-scaffolding/packed-picker-224f.json) has SHA-256 `af4c84066882c45e81a4d2448c7f4caab53b01dc4a6befb37e68a104685325af`.

These receipts describe older candidates. Final runtime proof is recorded in the implementation checkpoint and final verification notes. No receipt here authorizes qualification or publication.

## Terminal replay prototype

The parent built `/tmp/flow-v2-terminal-render/frames.cjs` to replay recorded native PTY cells through xterm/headless 6.0.0. It extracts role, model, and confirmation screens and emits self-contained HTML. The prototype reads only the old d3d46d92 capture and remains labeled rejected. The original ANSI source is unchanged.

`/tmp/flow-v2-terminal-render/prototype/replay.html` was rendered at 1200 pixels. All three captured dialogs are readable at the recorded 120-column, 36-row geometry. The viewer excludes raw terminal history and refuses obvious credential-bearing visible frames. It does not control Terminal or constitute accepted-candidate visual sign-off.

After the new exact archive passes picker verification, rerun the extractor against that archive's recorded ANSI file, with its full raw hash and `candidate` as the last arguments. Verify the capture belongs to that candidate's picker receipt. Review the refreshed frames before merging. Keep generated captures outside the commit.


## R8 recorded terminal inspection

The final replay uses the actual fc19ca4a archive and ANSI source
`1da34ba1eaa1c3af9a4f1ab5919a04ea9d40db6698e4ce5351d8b72f2bca5202`.
The picker receipt binds that capture to its eight native phases. The parent
inspected role, model, and save states at the recorded geometry, plus scaled
728- and 360-pixel replay layouts. The self-contained viewer was previewed with
zero console errors and shown in the task. Evidence remains local at
`/tmp/flow-v2-terminal-render/r8-fc19ca4a/responsive/visual-inspection.json`.
This verifies recorded terminal cells with browser font rendering. It does not
claim a live native terminal pixel capture or release qualification.
