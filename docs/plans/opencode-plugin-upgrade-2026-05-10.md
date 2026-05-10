# OpenCode Plugin Upgrade: Plan

## Goal
Upgrade `opencode-plugin-flow` by improving the OpenCode-facing plugin architecture, reducing always-loaded prompt/config complexity, and selectively adopting skills-first workflow ideas inspired by Everything Claude Code / ECC without copying its content.

This is an OpenCode adapter and workflow-surface plan, not a runtime rewrite. Runtime transitions, completion/recovery gates, reviewer decisions, persistence, and `.flow/**` ownership stay in Flow’s existing runtime path.

## Decisions
- Keep the npm/global OpenCode plugin as the primary runtime distribution (`package.json:2`, `package.json:16`).
- Install generated project-local `.opencode/skills` as part of the default OpenCode lifecycle alongside the global plugin, with conflict preflights before any plugin mutation.
- Keep existing slash commands and agents stable, but make them thinner fallback surfaces after skills exist (`src/adapters/opencode/config.ts:59`, `src/adapters/opencode/config.ts:113`).
- Move detailed review/audit workflow guidance primarily into on-demand skills; keep runtime-enforced completion and review gates where they are.
- Do not add new Flow tools, runtime modes, `.flow/**` paths, or state semantics for this upgrade.

## Background
- Flow is an OpenCode plugin that injects commands, agents, and a bounded runtime tool surface; runtime/domain/transitions own behavior while prompts/docs describe it (`docs/maintainer-contract.md:3`, `docs/maintainer-contract.md:9`).
- The plugin entrypoint exposes the config hook, tool factory, and hooks for tool definition guidance, attachment capture, system context, and compaction (`src/adapters/opencode/plugin.ts:124`).
- Agent and command surfaces are injected programmatically today: `flow-planning-researcher`, `flow-planner`, `flow-worker`, `flow-auto`, `flow-reviewer`, `flow-control`, plus `/flow-plan`, `/flow-run`, `/flow-auto`, `/flow-status`, `/flow-doctor`, `/flow-history`, `/flow-session`, `/flow-reset` (`src/adapters/opencode/config.ts:59`, `src/adapters/opencode/config.ts:113`).
- Public tool metadata flows through `OPENCODE_TOOL_REGISTRY`, including names, runtime action bindings, mutation classes, allowed modes, descriptions, and guidance (`src/adapters/opencode/tool-surface/tool-registry.ts:44`).
- Prompt-mode contracts own allowed/forbidden tools, mutation boundaries, behavior requirements, and stop conditions (`src/prompts/mode-contracts.ts:1`).
- Prior simplification already completed Flow Core vNext, routed OpenCode tools through the runtime facade, collapsed adapter metadata, separated strict review governance, and removed unsupported replay/event/checkpoint/projection persistence (`docs/investigations/simplify-flow-opencode-2026-05-07.md:120`).
- Current fragile contracts are the OpenCode SDK boundary: `zod` / `@opencode-ai/plugin` alignment, raw `tool()` arg shapes, and lifecycle semantics around `flow_plan_start` / `flow_run_start` (`docs/investigations/newest-opencode-plugin-regression-2026-05-08.md:9`).
- OpenCode supports npm/local plugins, TypeScript plugin functions, `tool()` custom tools, plugin events, markdown/config commands, and on-demand skills under `.opencode/skills/<name>/SKILL.md`.
- OpenCode skills are discovered through the native `skill` tool and can be allowed, denied, hidden, or approval-gated by permission config; generated skill installation alone is not enough if permissions hide them.
- ECC’s useful inspiration is structural: skills as the canonical workflow surface, command fallback surfaces for continuity, selective install/profile thinking, generated project-conventions skills, harness health/security/verification workflows, and context-bloat avoidance.

## Approach
Use three ordered slices. Each slice must retire or replace existing complexity before it adds a new surface.

### Slice 1 — Stabilize the OpenCode boundary
Before prompt or skill work, make the current SDK boundary explicit and regression-resistant.

Keep:
- current commands, agents, tools, and hooks;
- raw SDK-aligned `tool(...)` arg shapes in `src/adapters/opencode/tool-surface/schemas.ts`;
- dependency alignment between `zod` and `@opencode-ai/plugin`;
- lifecycle/retry expectations for `flow_plan_start` and `flow_run_start`.

Do not combine this slice with prompt slimming or skill generation.

### Slice 2 — Generate a minimal Flow skills bundle
Add a Flow-owned skill catalog that renders installable `.opencode/skills/<name>/SKILL.md` files. Skills are instruction surfaces only; they must reference existing runtime tools and mode contracts instead of owning behavior.

Start with the smallest useful set:

| Skill | Replaces / reduces | Purpose |
| --- | --- | --- |
| `flow-plan` | planner command/agent guidance | Planning, context capture, plan apply/approve/select behavior |
| `flow-run` | worker/run guidance | Single-feature execution, validation, review persistence, completion |
| `flow-review` | reviewer + audit prompt bulk | Feature/final approval rules and read-only audit/report workflow |

Defer `flow-auto` and `flow-control` until installer behavior, permission visibility, and fallback prompts are verified. Do not create one skill per tool.

Skill specs should be generated from Flow-owned data, not copied from external projects. They may reference:
- `FLOW_MODE_CONTRACTS` for mode/tool boundaries;
- `CORE_ROLE_PROTOCOLS` for role objectives;
- `OPENCODE_TOOL_REGISTRY` for public tool names/descriptions.

Every generated skill must state that runtime tools are authoritative, `.flow/**` must not be edited directly, and completion/review/persistence remain runtime-owned.

### Slice 3 — Slim prompts into fallback surfaces
After skills exist and are tested, reduce command templates and role prompts. Keep current command/agent names stable, but move detailed workflow prose into skills.

Minimum fallback contract when skills are absent or denied:
- mode title and role boundary;
- allowed and forbidden Flow tools;
- current stop condition;
- “do not edit `.flow/**` directly”;
- one-sentence tool ordering for the mode;
- where to recover if a required skill is unavailable.

Retire or shrink:
- repeated workflow prose in generated role prompts;
- repeated command behavior blocks in generated command templates;
- long reusable fragments that become skill-owned;
- tool-definition guidance that restates full workflows instead of tool-call constraints.

Keep prompt capture/eval checks, recalibrated to the slimmer surface.

## Work Items
1. **Finish SDK-boundary investigation and policy.** Complete `docs/investigations/newest-opencode-plugin-regression-2026-05-08.md`; decide whether `@opencode-ai/plugin` changes are required; update dependency policy only with support evidence.
2. **Define skill specs and renderable bundle.** Add planned modules such as `src/prompts/skills.ts`, `src/prompts/generated/skill-docs.ts`, and `src/adapters/opencode/skill-bundle.ts` so skill content is generated from Flow-owned specs and install paths are derived, not hand-copied.
3. **Resolve packaging shape.** If skill files are rendered at install time from compiled code, no package allowlist change should be needed beyond `dist`; if static generated files are shipped, update `package.json` `files` intentionally.
4. **Extend installer/uninstaller safely.** Update `src/installer.ts`, `src/install-opencode.ts`, and `src/uninstall-opencode.ts` so the default lifecycle writes only Flow-owned generated skills, reinstall refuses silent overwrite of user-edited skills, and uninstall removes only generated Flow-owned files after skill-removal preflight.
5. **Handle skill discovery and permissions.** Document and test the expected OpenCode permission posture so generated skills are visible to the native `skill` tool without weakening user-controlled deny/ask behavior.
6. **Add new skill bundle tests.** Create `tests/config/skill-bundle.test.ts` for frontmatter validity, name/path validity, idempotency, generated markers, conflict detection, permission/config expectations, no writes under `.flow/**`, and uninstall cleanup.
7. **Convert prompts to fallback surfaces.** Slim `src/prompts/generated/role-prompts.ts`, `src/prompts/generated/command-templates.ts`, and supporting fragments after skill files exist. Commands/agents must remain usable without installed skills via the fallback contract above.
8. **Retire duplicated guidance.** Remove prompt/tool guidance that duplicates skill content. Keep only tool-specific call constraints and safety-critical fallback instructions.
9. **Update maintainer docs.** Update `docs/development.md`, `docs/contributor-map.md`, and, if skills become a supported artifact, `docs/maintainer-contract.md` with skill ownership and required checks.
10. **Recalibrate prompt/parity tests.** Update tests to assert mode contracts, known tool names, skill references, fallback guidance, and safety boundaries rather than exact old prose.

## Acceptance Criteria
- Existing commands, agents, tools, and runtime state behavior still work without installed skills.
- The generated skills bundle installs only generated Flow-owned files under `.opencode/skills/**` and never writes under `.flow/**`.
- User-edited generated skills are not overwritten silently.
- Prompt fallback surfaces retain the fallback contract and point to skills only as on-demand guidance.
- No Flow skill defines new tools, state transitions, completion gates, persistence paths, or review semantics.

## Validation Plan
Run focused checks by slice, then the full gate.

### Slice 1
```bash
bun run check:dependency-contract
bun test tests/config/tool-schemas.test.ts tests/config/plugin-surface.test.ts
bun run typecheck
```

### Slice 2
```bash
bun test tests/config/plugin-surface.test.ts tests/install.test.ts tests/cross-area/install-lifecycle.test.ts
bun test tests/config/skill-bundle.test.ts
bun run check:dependency-contract
```

### Slice 3
```bash
bun test tests/config/prompt-contracts.test.ts tests/mode-contracts.test.ts tests/protocol-parity.test.ts
bun run eval:prompt-capture:check
bun run eval:review-capture:check
```

### Final readiness
```bash
bun run check
```

## Risks
- **Users without installed skills lose guidance.** Preserve fallback prompts and command/agent continuity.
- **Generated skills overwrite user edits.** Use generated markers and content hashes; refuse silent overwrite on mismatch.
- **Skills are installed but hidden.** Cover OpenCode skill permission/discovery expectations in docs and tests.
- **SDK upgrade gets mixed with surface refactor.** Land SDK-boundary stabilization first; keep dependency changes separate from skill/prompt work.
- **Skills become a second behavior authority.** Tests and docs must assert that skills reference existing mode/tool/runtime contracts and never define new state transitions.
- **Prompt evals become brittle after slimming.** Recalibrate around behavior boundaries and tool visibility, not old prose shape.

## Open Questions
- If the SDK regression investigation requires upgrading `@opencode-ai/plugin`, should that land before the skills work as a separate release? The plan recommends yes if a dependency change is needed.
- After the minimal `flow-plan` / `flow-run` / `flow-review` bundle is proven, should `flow-auto` and `flow-control` become skills or remain compact prompt-only surfaces?

## References
- `docs/maintainer-contract.md`
- `docs/investigations/simplify-flow-opencode-2026-05-07.md`
- `docs/investigations/newest-opencode-plugin-regression-2026-05-08.md`
- `docs/architecture/role-protocol-projections.md`
- `src/adapters/opencode/plugin.ts`
- `src/adapters/opencode/config.ts`
- `src/adapters/opencode/tool-surface/tool-registry.ts`
- `src/prompts/mode-contracts.ts`
- https://opencode.ai/docs/plugins
- https://opencode.ai/docs/custom-tools
- https://opencode.ai/docs/skills
- https://opencode.ai/docs/commands
- https://ecc.tools/
- https://github.com/affaan-m/everything-claude-code
