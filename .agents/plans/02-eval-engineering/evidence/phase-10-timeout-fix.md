# Eval session request timeout fix

Two xAI Grok 4.6 runs showed the same boundary defect. OpenCode kept producing
reviewer work, but the detached session-driving POST inherited the generic
120-second request timeout and rejected before the harness's progress-aware wait
could decide the outcome. The pre-fix happy-path report stopped at 127 seconds
with one unsubmitted review. The pre-fix paired report completed its ordinary arm
and lost the Flow arm to the same host timeout. Their report file digests were
`e8227a3aa4b37ba553ac36c68489305165ab80a620a41fac382f002d0e21c912`
and `a75e458cf06eaedbc5499e422f4e37680a4b03466e2df9724898306658f371f5`.

Architect Arena compared three designs. The selected design gives only
session-driving command and message requests an owner-controlled abort signal.
`waitForQuiet` remains the sole owner of quiet completion, the three-minute
no-progress stop, suspend credit, and the twenty-minute scenario deadline. Each
driving caller cancels its local fetch after that wait returns or throws. Model
probes, session creation, aborts, and other setup requests retain the generic
120-second boundary timeout. An
independent judge selected this design because the two simpler unbounded-fetch
designs left request cleanup without an owner.

The regression was written first. It initially failed because
`startSessionRequest` was absent. After implementation, the focused file passes
58 tests. It proves owner cancellation aborts the supplied signal without
manufacturing an external rejection, and that a real external rejection remains
visible. TypeScript and the adjacent eval, reviewer, paired, and live-smoke tests
also pass.

The exact formerly failing Grok happy path then passed after 184 seconds. It
completed one feature, captured validation, received one submitted passing
review, closed without false completion, and cost $0.41158 for 3,232 output
tokens. The report file digest is
`77a282eeb3e5438c8c9e88a60d789cbc1d16414dd0386769a20e8cdfc0bb40ae`.

After Interrogate fixes tightened cancellation races and composed request
ownership, the final code repeated that happy path and passed after 194 seconds.
It again had one submitted passing review, no false completion, and no reported
intervention. It cost $0.392922 for 3,241 output tokens. Its decision cassette
replayed exactly, and the final report file digest is
`3710c6e2aa9fb128dc22f5f4863c870cc5c7b3529b1bcc1c7ba185c66b65f56c`.

The same blinded pair was repeated with model `xai/grok-4.6`, case
`farewell-export`, seed `grok-flow-pilot-2026-08-25`, no reserve, and a $0.50
campaign stop. Both ordinary OpenCode and Flow passed the hidden executable
grader with no false completion. The Flow arm ran for 225 seconds. The complete
pair cost $0.444816 for 5,072 output tokens. Transcript scanning passed and the
pair remained `INCONCLUSIVE` only because one planned pair is below the declared
265-pair power requirement. The report, masked analysis, and allocation file
digests are:

- `151696ae29efc906829cf1f1163b3d2ad478a531030db43050e5a2a07ed7c158`
- `117b281b067097973a4e0056095334bbd6a9d31fec8c602d7189fcbbb8d683b5`
- `e57b1bf0b249802edd178dca7fd467164e785f95e4d37e835d19a79517b02ea6`

The first local full gate reached 520 passes and failed only when the unchanged
paired bootstrap test exceeded Bun's five-second per-test limit. The same test
also took about ten seconds and failed on the untouched final-main worktree; it
passed with a twenty-second allowance. This PR does not change that unrelated
test. The clean CI runner remains the canonical default-timeout verdict.

The final local product gate kept every canonical step and raised only Bun's
per-test allowance to twenty seconds. It passed 522 tests with one intentional
live-smoke skip and no failures. Four-model Interrogate then reported no remaining
critical or warning finding. GitHub CI retains the repository's default timeout.
