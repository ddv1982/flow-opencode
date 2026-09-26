# Research and planning todo

- [x] Read the Principles section in full.

## investigation

1. Route through the **how** skill (Explain mode for narrow questions, Critique mode for "are we sure?"). For motivation questions, also route through the **why** skill.
2. Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only investigation`. The four-item version is for code-shaped work.
3. Produce the `how`-shaped output (Overview / Key Concepts / How It Works / Where Things Live / Gotchas), or a recommendation with a tradeoffs table if the request is a decision between alternatives.
4. Apply the **unslop** skill to the reply.

## multi-phase-plan

1. When the change is one or two files with an obvious approach, skip the plan. Say so and stop.
2. Settle open questions by prototype before you write. For a question about layout, timing, behavior, or whether an API works, run `playbooks/prototype.md`. Keep the branch, the SHA, and the screenshots for Appendix A. Ask the operator only about a product or preference call that no run can settle. Give options (the **never-block-on-the-human** principle skill).
3. Explore with the installed `pstack-poteto-agent` profile or a generic agent seeded with the portable Poteto prompt. Follow the runtime contract's isolation and fallback rules. Each returns file pointers, conventions, test commands, and entry points. No inlined dumps.
4. Copy the skeleton below into the plan file and fill every placeholder. Use the repository's documented plan directory or an operator-named path. Never infer a host-private store. Keep every heading and sub-block in order. One section per PR with its own evidence. Name the execution playbook in **How to read this**.
5. Apply `$technical-writing` in full, then `$unslop`. The body is one Diátaxis mode, how-to. Appendices hold explanation and reference. Two rules apply verbatim. "i dont want any abstract metaphors" and "write like hemingway". Each heading states the task or the finding. No long dashes. No mid-sentence colons.
6. Run `node pstack/skills/poteto-mode/scripts/check-plan.mjs <plan.md>` and fix every line it prints (the **encode-lessons-in-structure** principle skill). It enforces the skeleton's shape, the verification rule in every verification block, and the punctuation rules.
7. Hand back. Post the plan path and the script's output, then stop. Execution starts on the operator's explicit go, under the execution playbook the plan names.

## Task-specific work

- [x] Locate Exa and Ref and read official Jev documentation.
- [x] Trace Flow authority, blockers, retry selection, and the existing Jev evaluator.
- [x] Compare policy-only, Jev-only, and policy plus Jev designs.
- [x] Write cited research and a phased plan.
- [x] Check the plan and independently audit evidence.

## Execution notes

Investigation step 2. throughput checkpoint: n/a, read-only investigation.
Planning step 1. Not skipped. The proposed behavior crosses runtime, host coordination, and evaluations.
Planning step 2. Skip a live Jev prototype because TYPESAFE_API_KEY is absent. Existing offline tests can establish current behavior only. API reliability and calibration remain gates in phase 1.
Planning step 3. One generic read-only delegate explores repository code. The parent researches external documentation. The model pair is inherited and unverified. No shared writes.
No implementation, lifecycle goal, heartbeat, commit, push, or release is authorized by this research request.

The independent source and trail audit found six execution gaps. All were corrected and the focused recheck returned PASS. The reviewer used the inherited model, which was not independently identified.
