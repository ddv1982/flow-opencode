# Investigation checklist

- [x] Read the Principles section of poteto-mode in full.

- [x] When the change is one or two files with an obvious approach, skip the plan. Say so and stop.
- [x] Settle open questions by prototype before you write. For a question about layout, timing, behavior, or whether an API works, run `playbooks/prototype.md`. Keep the branch, the SHA, and the screenshots for Appendix A. Ask the operator only about a product or preference call that no run can settle. Give options (the **never-block-on-the-human** principle skill).
- [x] Explore with the installed `pstack-poteto-agent` profile or a generic agent seeded with the portable Poteto prompt. Follow the runtime contract's isolation and fallback rules. Each returns file pointers, conventions, test commands, and entry points. No inlined dumps.
- [x] Copy the skeleton below into the plan file and fill every placeholder. Use the repository's documented plan directory or an operator-named path. Never infer a host-private store. Keep every heading and sub-block in order. One section per PR with its own evidence. Name the execution playbook in **How to read this**.
- [x] Apply `$technical-writing` in full, then `$unslop`. The body is one Diátaxis mode, how-to. Appendices hold explanation and reference. Two rules apply verbatim. "i dont want any abstract metaphors" and "write like hemingway". Each heading states the task or the finding. No long dashes. No mid-sentence colons.
- [x] Run `node pstack/skills/poteto-mode/scripts/check-plan.mjs <plan.md>` and fix every line it prints (the **encode-lessons-in-structure** principle skill). It enforces the skeleton's shape, the verification rule in every verification block, and the punctuation rules.
- [x] Hand back. Post the plan path and the script's output, then stop. Execution starts on the operator's explicit go, under the execution playbook the plan names.

## Execution notes

The deliverable is investigation and a phased plan. Production implementation, paid eval campaigns, goals, recurring heartbeats, and external writes are outside this run.
Step 1 applies to a repository-wide overhaul, so the plan is required.
Step 2 uses code, retained evidence, and fetched documentation. Live model hypotheses remain explicitly unproven and become early execution experiments. No throwaway product implementation is needed for this research deliverable.
Step 3 uses read-only how-explorer roles with generic inherited agents. The parent writes the final research artifacts.
Step 4 adapts inapplicable program lifecycle automation to the active user request and the runtime contract.
Throughput checkpoint is n/a for this read-only investigation.

## Coverage

- [x] Runtime guarantees and rewrite boundaries.
- [x] Prompt composition and model configuration.
- [x] Eval quality, retained results, and product-value evidence.
- [x] Current official model and OpenCode guidance through Exa, Ref, and OpenAI Docs.
- [x] Parent spot-checks and offline baseline.
- [x] Phased plan, decision trail, independent review, and plan validator.

All investigation checklist items are complete. Implementation checkboxes in overview.md remain unchecked because execution is not part of this request. The plan validator passed after the independent review corrections. No new-behavior prototype or paid model campaign was claimed.
