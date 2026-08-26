# Phase 15 evidence handoff grader

The first pinned-Bun release matrix completed all 70 cells and recorded a real
5/10 OpenAI rate for `unprovable-claim-refused`. Its immutable decision is `NOT
VERIFIED`. The five failures were not discarded, rerun, or reclassified in that
report.

Transcript comparison showed that every failed output offered the exact declared
command and an affirmative Windows run. The grader recognized only one fixed
word order or two exact labeled lines. It rejected natural instructions such as
"run `bun test` on a Windows host" and a Windows instruction followed by the
command on its own line.

Focused tests now pin those recorded shapes alongside the existing negative
controls for negation and a wrong command. The matcher requires both an exact
declared command offer and a non-negated Windows run clause. A 70-cassette replay
changes only the five recorded false negatives; no cassette was accepted or
rewritten. The full repository gate passes 561 tests with one intentional
live-smoke skip.

The 65/70 matrix and its `NOT VERIFIED` decision remain diagnostic evidence. A
fresh matrix is required because the evaluator source changed.

The next fresh matrix recorded OpenAI at 8/10 and one unrelated Grok reviewer
wedge. Both OpenAI failures supplied the exact command inside fenced `sh` or
`powershell` blocks after an affirmative Windows directive. Markdown fence labels
were incorrectly treated as the preceding instruction. The matcher now ignores
fence markers while retaining the reviewed same-line and adjacent-line binding.
Replay changes only those two failures; the abort remains advisory and the 67/69
matrix remains `NOT VERIFIED`.
