# Flow 10.0.1 release

Ship the reviewed CI and plugin maintenance changes from PRs #205 and #206.
Session v5, tool inputs, prompts, validation, and review obligations stay intact.

The runtime bytes changed, so the narrow offline patch exception does not apply.
Qualify a new candidate; do not reuse the 10.0.0 matrix, canary, seal, or paid
budget as candidate evidence. Keep those records immutable.

Exact 10.0.1 uses the canonical direct `openai/gpt-6.1-sol` route for manager and
reviewer, following the operator's OpenAI-only instruction. It retains all 17
cases, their order, 72 primary cells, 17 declared environment reserves, original
pass thresholds, zero false completions, zero unsubmitted reviews, and recovery
off. Later versions keep the default two-provider requirement unless separately
reviewed. No cross-provider reliability claim follows.

Preparation: pass frozen install, the canonical gate, replay, audit, and packed
native smoke; independently review the change; land it through CI; freeze exact
Linux artifact and evaluator/source bindings. Use the existing native OpenCode 2
OpenAI subscription account without API-key fallback. Readiness may perform no
model generation and must pass before charging the first approved dispatch.

The dispatch draft derives 90 primary steps, 23 reserve steps, and one route
probe: 91 planned or 114 maximum top-level dispatches. This is a proposal, not
permission or a ledger. Before any model start, obtain fresh approval binding
purpose, artifact/source, canonical model, dispatch limit, and expiry. Old
expired or exhausted grants cannot fund this release. Only the maintained CLI
may activate declared environment reserves; product/evaluator failures never do.

After matrix success, prepare the exact-artifact native-auth canary offline and
present its separate bounded approval. Seal and regrade complete evidence, land
it without changing product bytes, verify main CI and Release verification,
then publish the approved tag through the project workflow. Check registry and
GitHub downloads against the measured artifact before declaring release success.
