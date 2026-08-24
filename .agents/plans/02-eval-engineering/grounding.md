# Eval engineering grounding

## Verified baseline

Flow 8.1.1 starts from a strong deterministic base. `bun run check` passes with
399 tests, one intentionally skipped live-host test, and no failures. The check
does emit two Biome warnings and one schema-version notice. The active branch was
created from clean `main` at `3e172eb`.

The assurance system currently has five distinct layers.

1. Deterministic source, architecture, package, and runtime tests.
2. A packed-plugin smoke against a real pinned OpenCode host.
3. Thirteen committed decision cassettes replayed through current Flow handlers.
4. Twelve real-model scenarios graded from durable state and observed tool calls.
5. Three paired Flow-versus-ordinary OpenCode tasks with hidden outcome graders.

Seven live scenarios have release thresholds. Five remain measured but ungated.
The common qualification floor is three scored attempts per scenario and model
pair. `failing-gate-blocks` is separately documented as requiring ten attempts
for a meaningful rate. The two checked-in paid reports measured Flow 8.0.0,
contain aborts, and do not cover a qualifying matrix for the current build.

## Runtime shape to preserve

The plugin is a skills-first OpenCode adapter around one durable Session v5
aggregate. TypeScript enforces lifecycle ordering, revisioned idempotency,
source-bound validation, reviewer identity, persistence, and closure. Markdown
guidance owns planning judgment, implementation judgment, evidence selection,
review substance, and recovery language.

The domain, application, filesystem, and OpenCode layers point inward. The paid
harness builds and packs the real plugin, installs it into an isolated OpenCode
host, drives real slash commands, reads parent and reviewer sessions, and grades
durable results. Decision replay deliberately re-executes Flow handlers without
re-running model decisions, edits, or Bash.

This architecture is an asset. The improvement program must not reintroduce the
orchestration and parallel-state systems removed by the v6 simplification.

## Measurement limits to solve

- The live suite mainly measures Flow conformance. The three-case paired suite is
  too small to establish product value over ordinary OpenCode.
- Reviewer substance is a core claim but has no release gate. One older scenario
  measured implementer behavior instead of reviewer behavior.
- The scheduled matrix separates providers but does not prove a different model
  family reviewed a given manager run.
- A three-attempt floor cannot resolve small changes and collapses 90 percent and
  100 percent thresholds to the same observed requirement.
- Reports have no confidence intervals, power target, paired effect estimate,
  preregistered stopping rule, or longitudinal baseline comparison.
- Prompt footprint excludes lazily loaded guidance, so it is not total instruction
  exposure.
- Some graders rely on wording or write-payload proxies where a hidden executable
  outcome would be stronger.
- The packed live smoke proves registration and permissions, not one complete
  installed-plugin lifecycle.
- The manual OpenCode canary checklist is stale and there is no current scripted
  handoff for a maintainer-run chat canary.
- Release policy and automation are not fully aligned. The release workflow can
  publish from a `main` push, while paid qualification is mechanically required
  only for major releases.

## External evidence

Current agent-eval guidance supports a layered design with deterministic outcome
graders, trajectory inspection, multiple trials, explicit regression and
capability suites, human calibration for model judges, and complete run logs.
Recent large-scale work on agentic randomness found that single-run pass rates can
move by several percentage points without an intervention and recommends repeated
trials plus power analysis. Current public-benchmark audits also show that hidden
test quality, task ambiguity, environment drift, and training contamination can
overstate or erase real differences.

Primary sources used for the architecture round:

- https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- https://arxiv.org/html/2602.07150v2
- https://platform.openai.com/docs/guides/evaluation-best-practices
- https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/
- https://inspect.aisi.org.uk/
- https://opencode.ai/docs/plugins
- https://opencode.ai/v2/docs/build/sdk

## Design boundary

The first design must improve the eval system before changing product behavior.
It must create reusable measurement tools, preserve the existing harness, keep
capability work separate from release regressions, blind comparative runs, and
make every promotion decision auditable. Product changes may follow only when the
new evidence identifies a measured weakness and a phase-specific predicate.
