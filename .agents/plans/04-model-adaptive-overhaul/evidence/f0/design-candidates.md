# Terminal capacity design candidates

## A. Bounded terminal allowance

Keep the original open-state count and byte bounds for hydration. Admit new open mutations below those bounds with one operation and enough serialized bytes reserved for a maximum close. Closed documents may contain one extra operation and a bounded byte allowance. Check closure consistency through the existing session invariants. Increase the file reader bound to the maximum closed size. Preserve exact replay before admission.

A shared domain capacity check covers commit, recordValidation, and anchorRequest. Persistence remains able to load and save previously valid documents. New writes cannot spend terminal headroom.

## B. Reconstructed legacy predecessor

Retain a private legacy validator. For overflow closed documents, remove the final matching closure operation and closure, decrement revision, and validate the reconstructed predecessor against the old count and byte limits. Restore a plausible prior active run if close superseded it. Validate the complete closed document separately.

This bounds the extension more narrowly, but requires reconstructing information that close intentionally discards. At least one alternative predecessor may need to be tried. Ordinary mutation admission still needs the same shared count and byte guard.

## Comparison criteria

Preserve accepted operations and legacy hydration. Permit maximum valid terminal payloads. Reject overflow open state. Keep archive reload and exact replay valid. Prefer fewer reconstructed states and a small shared boundary. Preserve existing invariant checks.

Candidate notes are grounded in read-only agent exploration and parent tracing. Final selection follows independent review.

## Selected design

Select A with the independent judge's terminal-identity and body-size checks.
Overflow requires the final operation to match the closure at the session
revision. The body after removing terminal material may exceed the legacy bound
by at most four bytes for active-run supersession. Existing invariants still
validate the complete document. No prior active run is guessed.

The reserve is 6 * 32,768 + 1,024 = 197,632 bytes. New mutations also reserve the
last safe integer revision. A legacy exhausted revision stays readable but
cannot close without a separate revision policy. File reads enforce both an
absolute allocation bound and the original open-document physical bound.

The parent wrote the initial implementation while the independent judge's
provisional recommendation arrived. The final judgment agreed with both grafts.
The public contract was then recorded in the maintained documentation. This
sequence does not claim that final documentation preceded the first code edit.
