# Current-head native-host recovery simulation

At Flow source `bf07e8f3b6e68e3bb177bd6bf1fdf95abe2562ed`, `FLOW_RECOVERY_TREATMENT_SMOKE=1 bun test tests/recovery-treatment-host.test.ts` passed 10/10 cases against real OpenCode 1.18.31 server processes. The suite covered accepted, control, subthreshold, and resolved-model-mismatch guarded recovery on both OpenAI GPT-5.6 Terra and xAI Grok-4.6 routes. It also covered a delayed Jev response followed by `/flow-auto stop` on both routes. `receipt.json` binds the exact source commit, test and host-harness bytes, dependency lock, and the retained `smoke.log`. The verifier also refuses any current-head change under `src/`, `skills/`, `evals/`, `scripts/`, or `tests/`, or in the package manifest or lockfile.

The host request gate used simulation origin, fake OAuth credentials, and simulated Jev replies. This run proves that the guarded host paths and delayed-stop behavior still pass at the measured head; it supplies no paid-model decision-quality evidence. The treatment was the experimental evaluation bundle, so it does not close JEV-4 lane 5's same-run packed-plugin delegated-authority gap, nor replace the screenshot/video interaction review or live holdout.

The opt-in suite is skipped by ordinary `bun run check`. To reproduce it, run the command above from an exact checkout at the receipt's source commit, with the frozen dependencies and OpenCode 1.18.31 available. It needs no real provider credentials or TypeSafe dispatch authorization.

A [pinned native-host zero-claim startup check](zero-claim-startup/README.md) at `343b203` also passed three opt-in no-inference tests and reported zero request claims across the four manager/arm combinations. It is admission safety evidence, not a recovery-quality or interaction pass.

A [current-head operator resume/cancel simulation](operator-resume/README.md) at `085fdb2` passed four real-host test cases. It exercises the evaluation operator interface without real provider inference or verified human attribution.
