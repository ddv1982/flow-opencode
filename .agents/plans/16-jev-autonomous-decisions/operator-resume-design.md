# Operator continuation in evaluation episodes

The evaluation operator needs to read the manager's actual question, provide a
response, and continue the same episode. OpenCode's evaluation host aborts a
pending question before returning `escalated`. Continuation therefore uses an
ordinary message in the same session through `runPrompt`.

## Design decision

Two independent designs were compared against six criteria. The criteria covered
actual question delivery, response binding, durable evidence, budget preservation,
interface size, and real-host verification.

| Design | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Per-driver response callback | Small programmatic interface | Each caller must provide human delivery and input handling | Retain its inline journal evidence |
| Runner-owned file inbox | An operator can read and answer from another terminal | Requires bounded file input and exclusive submission | Select as the base |

An independent judge preferred the file inbox. The parent agreed. The runner owns
one wait transaction, including event timing, response validation, and persistence.
The host adapter sends the accepted response in the existing session with the
registered manager. A response cannot replace the model or budget configuration.

Question and accepted-response content belong in the private journal. Separate
request and reply files deliver input. A separate ready pointer and accepted-source
file would duplicate evidence, so the design omits them. The runner persists the
wait before publishing the question. It persists the intervention and wait end
before continuing inference.

The operator policy belongs in the harness identity. Each wait has a fresh bound
identity. Replies must match the current wait. Historical timing-only receipts
remain readable. New bound waits require matching interventions and closure.
Cancellation during a wait remains a valid terminal outcome after confirmed
cleanup. Reading a journal never replays a request.

## Verification requirements

The verification must exercise a real OpenCode question and its subsequent abort.
The operator submission must continue the same session and reach a frozen exact
file result through `runEpisode`. The resulting journal must recover successfully.
Both selected managers use synthetic responses and credentials for this check.
Cancellation must prevent a continuation request. Malformed, stale, duplicate,
and oversized replies must not cause inference.

The shared request budget, production qualification registry, and live-origin
refusal retain their existing authority. Declared operator attribution does not
authenticate a person or replace independent review. Journal content may include
private input. A simulation does not establish model quality or billing bounds.

## Review provenance

The grounding, two design candidates, and independent judgment used separate
temporary artifacts. They shared read-only access to the repository. One owner
implements the coupled code and tests. The parent reviews the diff and runs final
checks. Models were inherited. Cross-model diversity was not verified.
