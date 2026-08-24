# Research notes

## Sources and decisions

- [Anthropic on agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
  Separate capability from regression, grade outcomes before trajectories, run
  multiple trials, inspect transcripts, and calibrate model judges with humans.
  This drove separate evidence classes and reviewer calibration.
- [On Randomness in Agentic Evals](https://arxiv.org/html/2602.07150v2).
  Single-run pass rates moved by several percentage points across repeated
  agentic runs. This drove fixed sample plans, power metadata, and uncertainty.
- [OpenAI evaluation best practices](https://platform.openai.com/docs/guides/evaluation-best-practices).
  Define the objective, dataset, metric, comparison, and continuous loop. Prefer
  pairwise or classification judgments and keep human agreement. This drove the
  frozen analysis policy and evidence-card design.
- [OpenAI audit of SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/).
  Hidden tests can reject valid work and public tasks can be contaminated. This
  drove mutation-tested oracles, contamination notes, and versioned case policy.
- [Inspect AI](https://inspect.aisi.org.uk/).
  Tasks, scorers, logs, scanners, limits, and failure handling are useful patterns.
  Flow keeps its own harness but adopts explicit logs, scanners, and limits.
- [OpenCode plugin documentation](https://opencode.ai/docs/plugins).
  Plugin behavior depends on host hooks, load order, event data, and tool
  boundaries. This drove the Phase 0 capability probe and exact host config.
- [OpenCode embedded SDK documentation](https://opencode.ai/v2/docs/build/sdk).
  The in-process SDK may later support cheaper host checks, but the current plugin
  targets stable 1.x. The plan does not assume a v2 migration.

## Inferences

The current harness already has the expensive integration work. Replacing it with
Inspect or a hosted eval platform would add a bridge while leaving Flow-specific
artifact, Session, reviewer, and qualification semantics unresolved.

The appropriate comparative unit is the whole model, host, and Flow scaffold.
The paired experiment therefore holds task, model, host semantics, and analysis
constant while changing the artifact or Flow availability. It reports the harness
configuration alongside the result.

Model treatment blinding is impossible when one arm exposes Flow tools and the
other does not. The attainable blinding target is narrower. Hide evaluation
labels and ground truth from the model, randomize arm order, hide candidate labels
from the analyst and grader, and scan transcripts for awareness or leakage.
