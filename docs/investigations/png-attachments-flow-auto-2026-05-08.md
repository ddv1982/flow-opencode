# Investigation: PNG attachments unavailable to opencode flow-auto

## Summary
Root cause at investigation time: Flow's OpenCode integration had no attachment-ingestion/materialization boundary. PNGs attached in OpenCode could be model-visible chat/file parts, but flow-auto had no prompt/tool/plugin path that turned those bytes into shell-readable workspace files for an app background task.

Remediation note: the follow-up implementation adds a narrow `flow_attachments_materialize` bridge for current/latest OpenCode PNG, JPEG, WebP, GIF, and AVIF `data:` attachments; SVG, arbitrary `file:`/HTTP URLs, raw base64, and filesystem paths remain intentionally unsupported until a trusted origin/threat model is proven.

## Symptoms
- User attached PNG files to opencode as source assets for a concrete app task: change the app background using those images.
- Expected flow-auto behavior: materialize the attached images as project files, rename/place them appropriately, and update the app background references.
- Previous recovery attempt could see images in chat but found no `.png` / `.jpg` files mounted in `/Users/vriesd/projects/soft-focus` or under `/var/folders/.../opencode`.
- Agent asked the user to put files in the repo manually, indicating the attachment bytes were not exposed as workspace files to the coding sandbox/tool layer.

## Background / Prior Research

### External OpenCode attachment behavior
- Explore agent found OpenCode UI image attachments are represented as message/model `file` parts backed by `attachment.dataUrl`, not as shell-readable workspace paths.
- Official docs/source leads checked: OpenCode TUI docs (`https://opencode.ai/docs/tui/`), CLI docs (`https://opencode.ai/docs/cli/`), Server docs (`https://opencode.ai/docs/server/`), `packages/app/src/components/prompt-input/build-request-parts.ts`, and `packages/opencode/src/session/message-v2.ts` in the OpenCode GitHub repo.
- Conclusion from external probe: attached PNGs are multimodal context unless a separate workflow explicitly writes bytes to disk.

### flow-opencode repo archaeology
- Explore agent found no current repo code that materializes OpenCode image/file attachments into workspace files.
- Searches under `src/adapters/opencode` and `src/runtime` found no attachment/image/upload/blob/multipart bridge.
- Relevant local evidence reported: strict JSON/text tool schemas in `src/adapters/opencode/tool-surface/schemas.ts:37-158`; structured `evidencePackets` in `src/runtime/schema.ts:121-187, 298-357`; Flow-owned artifact writes in `src/runtime/session-workspace.ts:150-235`, `src/runtime/paths.ts:66-223`, and `src/runtime/application/session-workspace-actions.ts:84-118`.
- Workspace safety context reported: mutable roots are validated in `src/runtime/workspace-root.ts:25-136`; OpenCode default permissions for `flow-worker` / `flow-auto` do not grant broad external directory/edit/bash powers by default in `src/adapters/opencode/config.ts:47-136`.
- Relevant commits reported: `7e434a8` made `flow_auto_prepare` read-only until real session write; `0145764` made Flow session storage explicit on disk; `b5bf7ca` tightened unrelated-directory mutation protection; `84a7c03` handled hidden-root approvals; `e3c4094` kept the default OpenCode plugin surface core-only.

## Investigator Findings

### Phase 2 - Contract trace and root-cause synthesis

**Question:** Why could `flow-auto` not use PNG images attached to an OpenCode chat as filesystem assets for an app background task?

#### Ranked synthesis

| Rank | Explanation | Confidence | Basis |
| --- | --- | --- | --- |
| 1 | OpenCode chat attachments can be model-visible `file` parts, but Flow does not implement a bridge that copies those bytes into the target workspace or exposes them as paths to `flow-auto` / `flow-worker`. | High | OpenCode SDK file parts carry `mime`, `filename?`, and `url`, while Flow registers only JSON/text runtime tools and implements no `chat.message`, `command.execute.before`, or message-transform hook that extracts `Part[]` into files. |
| 2 | Flow prompt guidance never tells `flow-auto` or delegated roles how to find, decode, or materialize image/data-url attachments. | High | The generated `/flow-auto` command and `flow-auto` role prompt cover runtime planning/execution/review, raw argument normalization, and Flow tool sequencing, but no attachment/image/PNG/filesystem ingress. |
| 3 | Workspace permissions can block or prompt writes in some roots, but they were not the primary failure in this symptom. | Medium-high | Flow's mutable-root guard and OpenCode permission prompts only apply once a mutating Flow/session action chooses a root and path; they do not create attachment source files or discover chat attachment bytes. |
| 4 | Evidence packets and Flow-rendered artifacts are metadata/session artifacts, not binary asset storage. | High | Evidence packet schemas are strict JSON strings/arrays, and rendered artifacts are Markdown docs under `.flow/**`; neither stores PNG bytes. |

#### Evidence

- **Prompt / command contract lacks attachment ingress.** `src/prompts/generated/command-templates.ts:152-197` defines `/flow-auto` as a coordinator that calls `flow_auto_prepare`, follows resume/missing-goal rules, records planning context, delegates planner/worker/reviewer work, handles recovery, and ends with runtime summary. There is no instruction to inspect OpenCode `Part[]`, decode `data:` URLs, search temp upload stores, or write chat images to project files.
- **Role prompt also lacks attachment ingress.** `src/prompts/generated/role-prompts.ts:224-277` makes `flow-auto` coordinate planner/worker/reviewer/runtime tools, auto-approve plans when appropriate, keep one feature active, and persist reviewer decisions. It does not describe any image/PNG attachment path. `src/prompts/fragments.ts:41-59` only defines Task/subagent handoff policy; it says handoffs report artifacts/validation/blockers but do not bypass runtime-owned state.
- **Mode contract enumerates allowed tools but no asset-materialization capability.** `src/prompts/mode-contracts.ts:105-149` lists `flow-auto` allowed Flow tools (`flow_auto_prepare`, planning, run, review, reset) and required behavior. None is an upload/import/materialize-file tool.
- **OpenCode adapter schemas are JSON args only.** `src/adapters/opencode/tool-surface/schemas.ts:42-128` defines every public Flow tool argument shape: status/doctor view enums, session ids, `argumentString`, `goal`, `repoProfile`, plan/review/worker objects, and feature ids. `flow_auto_prepare` specifically accepts only `{ argumentString?: string }` at `src/adapters/opencode/tool-surface/schemas.ts:106-108`.
- **Tool registry/descriptor metadata has no binary channel.** `src/adapters/opencode/tool-surface/tool-registry.ts:44-57` defines registry fields (`toolName`, `surfaceKind`, runtime/core bindings, allowed modes, descriptions, docs metadata). `src/adapters/opencode/tool-surface/descriptors.ts:23-43` and `src/adapters/opencode/tool-surface/descriptors.ts:254-281` project those fields plus schema/policy/verification metadata; no descriptor field names a binary payload, image, attachment, URL, or materialization operation.
- **Adapter config injects agents and commands, not attachment hooks.** `src/adapters/opencode/config.ts:92-108` registers `flow-auto` as a primary agent with Task permissions for Flow roles; `src/adapters/opencode/config.ts:129-134` binds `/flow-auto` to that agent and command template; `src/adapters/opencode/config.ts:192-215` applies those config entries. This config does not add a file-ingress command/tool.
- **Plugin hook surface could see chat parts, but Flow does not use that hook for materialization.** The installed OpenCode plugin typings expose `chat.message` with `output.parts: Part[]`, `command.execute.before` with `output.parts: Part[]`, and message/system transform hooks in `node_modules/@opencode-ai/plugin/dist/index.d.ts:146-158`, `node_modules/@opencode-ai/plugin/dist/index.d.ts:186-192`, and `node_modules/@opencode-ai/plugin/dist/index.d.ts:217-228`. Flow's plugin returns only `config`, `tool`, `tool.definition`, `experimental.chat.system.transform`, and `experimental.session.compacting` hooks in `src/adapters/opencode/plugin.ts:101-154`; there is no hook that reads file parts and writes them to disk.
- **OpenCode tool definitions are string-returning schema tools.** The installed `tool(...)` contract is `description`, raw Zod `args`, and `execute(...): Promise<string>` in `node_modules/@opencode-ai/plugin/dist/tool.d.ts:33-40`; the Flow adapter re-exports that boundary at `src/adapters/opencode/sdk.ts:1-2` and creates the registered surface from `createSessionTools()` plus `createRuntimeTools()` in `src/adapters/opencode/tools.ts:62-72`.
- **OpenCode SDK file parts are not filesystem paths by contract.** The installed SDK `FilePart` shape is `{ type: "file", mime, filename?, url, source? }` in `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:597-606`. That supports the prior research that a PNG may be present as a model-visible URL/data URL, but it is not equivalent to a path in the target repo.
- **`flow_auto_prepare` is read-only classification.** `src/adapters/opencode/tool-surface/session-tools/planning-tools.ts:57-85` reads a resumable session, classifies the argument string, records metadata, and returns a payload. It does not inspect message parts, copy files, or create project assets.
- **Workspace runtime chooses read vs mutate roots; it does not discover attachments.** `src/runtime/application/workspace-runtime.ts:44-74` picks `worktree`, `directory`, or read-only `cwd` fallback as the session root; `src/runtime/application/workspace-runtime.ts:109-161` resolves read/mutate roots and validates mutable roots. This controls where Flow may write `.flow` state, not where chat upload bytes live.
- **Mutable workspace permission is scoped to Flow state.** `src/adapters/opencode/tool-surface/mutable-workspace-permission.ts:9-29` only asks for edit permission for `${root}/.flow/**` when the root itself is hidden. It does not ask for permission to read OpenCode temp attachments or write app assets.
- **Flow-owned files are `.flow` state and derived Markdown docs.** `src/runtime/paths.ts:67-80` roots state under `.flow/active`, `.flow/stored`, and `.flow/completed`; `src/runtime/paths.ts:149-224` derives session docs, feature docs, and review directories. `src/runtime/session-persistence.ts:110-136` saves `session.json` and separately syncs rendered docs; `src/runtime/render.ts:109-129` writes `docs/index.md` and per-feature Markdown docs. No path helper targets uploaded binary assets.
- **Evidence packets are metadata, not file bytes.** `src/runtime/schema-evidence-packets.ts:37-67` defines a strict readonly object with string fields/arrays such as `sourceRefs`, `highlights`, `selectedContext`, and validation summaries. `src/runtime/schema-worker-result-shared.ts:17-19` records changed artifacts as `{ path, kind? }`, which can describe files after a worker changes them but cannot carry PNG bytes.
- **Tests confirm strict JSON transport and metadata-only packets.** `tests/config/tool-schemas.test.ts:35-55` asserts each tool exposes object-shaped args. `tests/config/tool-schemas.test.ts:489-497` rejects `workerJson` / nested `result` transport, `tests/config/tool-schemas.test.ts:627-633` rejects `planJson`, and `tests/config/tool-schemas.test.ts:636-643` asserts there are no `_from_raw` alias tools. `tests/runtime/evidence-packets.test.ts:81-129` proves planning accepts packet metadata without widening the plan payload, while `tests/runtime/evidence-packets.test.ts:300-389` carries packet metadata through worker/reviewer/final-review payloads.
- **Docs match the source contract.** `docs/development.md:145-166` lists the current Flow tools; none imports/uploads/materializes attachments. `docs/maintainer-contract.md:49-78` identifies `src/adapters/opencode/tool-surface/schemas.ts` and `src/runtime/schema.ts` as the schema owners for the tool boundary. `docs/maintainer-contract.md:80-98` lists current state paths under `.flow/**` and says rendered docs are derived artifacts.
- **Negative repository search corroborates the gap.** A search of `src`, `tests`, and `docs` excluding this report for `attachment|attachments|dataUrl|dataURL|image|png|jpeg|binary|blob|multipart` found only evidence-packet test wording, one generic multipart string in a review-render fixture, and historical docs. No source implementation matched an attachment/materialization bridge.

#### Eliminated or down-ranked hypotheses

- **Eliminated: `flow-auto` had a hidden Flow tool for image import.** The public registry in `src/adapters/opencode/tool-surface/tool-registry.ts:48-236`, the schema registry in `src/adapters/opencode/tool-surface/schemas.ts:42-128`, and the docs list in `docs/development.md:145-166` enumerate the available tools; none accepts bytes, data URLs, file parts, or source/destination asset paths.
- **Down-ranked: workspace permission was the main blocker.** Workspace guards can prevent unsafe `.flow` session writes (`src/runtime/workspace-root.ts:79-136`) and hidden-root prompts only cover `.flow/**` (`src/adapters/opencode/tool-surface/mutable-workspace-permission.ts:9-29`). They do not explain why no PNG source path existed in the target project or OpenCode temp directory.
- **Eliminated: evidence packets already solve this.** Evidence packets are strict JSON metadata (`src/runtime/schema-evidence-packets.ts:37-67`) and are tested as payload attachments, not filesystem attachments (`tests/runtime/evidence-packets.test.ts:81-129`).
- **Down-ranked: Task/subagent handoff caused the loss.** Handoffs may isolate context, but the parent `flow-auto` prompt itself has no byte-to-file bridge, and Flow's tool layer exposes no materialization primitive. A child cannot use a filesystem path that no layer created.

#### Root-cause conclusion

**Evidence:** Flow currently treats OpenCode as a prompt/tool host: it injects command templates and role prompts, registers JSON runtime tools, and persists Flow session state under `.flow/**`. The installed OpenCode API exposes chat/file parts as message parts (`node_modules/@opencode-ai/plugin/dist/index.d.ts:146-158`; `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:597-606`), but Flow does not hook that message-part stream or provide a runtime tool that converts a selected file part/data URL into a project file.

**Inference:** The PNGs were visible to the model as multimodal/chat context, but they were not materialized into filesystem assets. Therefore a `flow-auto` / `flow-worker` agent could reason about the images but could not `cp`, rename, import, or reference them as project files unless OpenCode itself separately mounted them or the user placed them in the repo. The symptom is primarily an attachment-materialization gap; workspace permissions are secondary and would matter only after a destination path/write operation exists.

#### Design-level remediation recommendations

1. **Add an explicit attachment materialization bridge instead of relying on prompt memory.** Implement a plugin hook/tool that enumerates eligible OpenCode `FilePart`s for the active message/session and writes selected bytes to a user-approved path under the active workspace, returning concrete paths for worker use.
2. **Keep it outside Flow session-state artifacts.** Store imported image assets in the target project's intended asset directory, not `.flow/**`; reserve `.flow/**` for session JSON and derived Markdown docs per `docs/maintainer-contract.md:80-98`.
3. **Make the bridge permissioned and auditable.** Require explicit destination root validation, MIME/extension allowlisting (PNG, JPEG, WebP, GIF, AVIF), keep SVG unsupported until separately threat-modeled, use collision-safe filenames, enforce size limits, and record worker evidence listing source attachment metadata and destination paths.
4. **Expose the contract in prompts and schemas.** Add prompt guidance telling `flow-auto` to materialize attached assets before planning/execution when the goal depends on them, plus a narrow tool schema for attachment selectors and destination directory. Do not overload evidence packets or worker `artifactsChanged`; those should reference the resulting files after materialization, not transport bytes.
5. **Test the boundary.** Add adapter/schema tests proving the new materialization tool is the only accepted binary ingress, runtime tests for root/collision behavior, and prompt-mode fixture coverage ensuring `/flow-auto` recognizes attachment-dependent goals before delegating to `flow-worker`.

#### Unknowns / limits

- This investigation did not re-run a live OpenCode UI session with fresh PNG uploads, so the exact runtime `FilePart.url` form in the failing session remains externally inferred from installed SDK typings and prior research.
- The repo does not reveal whether OpenCode keeps uploaded data URLs fetchable long enough for a plugin hook to decode them after command execution; that should be checked against OpenCode runtime behavior before implementation.

## Investigation Log

### Phase 1 - Initial assessment
**Hypothesis:** The failure is likely at an attachment-to-filesystem boundary: chat-visible images are not automatically materialized as local files available to shell/MCP tools, and flow-auto/opencode tool guidance may not bridge that gap.
**Findings:** External research, pair investigation, spot-checks, and Oracle synthesis all converged on a missing materialization contract.
**Evidence:** User-supplied recovery transcript states that workspace and opencode temp locations contained no image files despite chat-visible images; local code evidence below shows no Flow tool/hook/prompt path creates such files.
**Conclusion:** Confirmed.

### Phase 2 - Context builder
**Hypothesis:** Broad context selection would surface relevant OpenCode adapter, prompt, and workspace files.
**Findings:** Context builder initially selected only this report and requested scope clarification, so the investigation proceeded with pair-led file discovery and manual selection refresh.
**Evidence:** The final selection was later expanded to the prompt contracts, OpenCode adapter, runtime workspace, evidence packet, docs, and schema tests referenced in Investigator Findings.
**Conclusion:** Context builder was useful only as a workflow checkpoint; pair and verified spot-checks supplied the substantive file evidence.

### Phase 3 - Pair investigator and Oracle synthesis
**Hypothesis:** A second investigator and Oracle synthesis would distinguish a contract gap from a permission/execution bug.
**Findings:** The pair found no binary attachment bridge in prompts, schemas, plugin hooks, runtime workspace code, tests, or docs. Oracle agreed the root cause is an attachment-materialization contract gap.
**Evidence:** See `## Investigator Findings`, `## Root Cause`, and the cited line references.
**Conclusion:** Confirmed with high confidence.

## Root Cause
Flow's OpenCode integration currently has no attachment-ingestion/materialization boundary.

**Evidence:** `flow-auto` is defined as a runtime coordinator, not an asset-ingestion command: `src/prompts/generated/command-templates.ts:152-197`, `src/prompts/generated/role-prompts.ts:224-277`, and `src/prompts/mode-contracts.ts:105-149` describe Flow planning/execution/review tools but no image, upload, data-url, or file-materialization step. The OpenCode tool schemas are strict JSON/object arguments, and `flow_auto_prepare` accepts only `argumentString?: string` (`src/adapters/opencode/tool-surface/schemas.ts:42-128`; `src/adapters/opencode/tool-surface/session-tools/planning-tools.ts:57-85`). Flow's plugin registers config/tools/tool-definition/system/session-compaction hooks, not `chat.message` or `command.execute.before` hooks that would inspect message parts and write them to disk (`src/adapters/opencode/plugin.ts:101-154`). Installed OpenCode typings show such hooks can expose `Part[]`, and SDK `FilePart` contains `mime`, optional `filename`, and `url`, not a target-repo filesystem path (`node_modules/@opencode-ai/plugin/dist/index.d.ts:146-158, 186-192`; `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:597-606`).

**Inference:** The PNGs were visible to the model as chat/multimodal context, but no Flow layer created source files from them. Therefore `flow-auto` / `flow-worker` could not copy, rename, import, or reference the PNGs as app assets unless OpenCode independently mounted them or the user placed them in the repo. This is a missing attachment-materialization contract, not a failed execution of an existing Flow path.

**Secondary factor:** Workspace permissions and mutable-root checks matter only after a destination write exists. They do not explain the absence of a PNG source path or materialization primitive (`src/runtime/application/workspace-runtime.ts:44-163`; `src/adapters/opencode/tool-surface/mutable-workspace-permission.ts:9-29`).

## Eliminated / Down-ranked Hypotheses
- **Eliminated: hidden Flow image-import tool exists.** The registry, schemas, and docs enumerate JSON/text workflow tools only; no tool accepts image bytes, data URLs, attachment ids, blobs, or source/destination asset paths.
- **Down-ranked: `flow-auto` ignored an existing attachment workflow.** The command, role prompt, and mode contract contain no attachment discovery/materialization guidance.
- **Down-ranked: workspace permissions caused the primary failure.** Permission guards constrain mutable roots and `.flow/**` persistence; they do not discover chat attachment bytes or create source files.
- **Eliminated: evidence packets already carry binary assets.** Evidence packets are strict metadata payloads and can reference artifacts only after files exist.
- **Down-ranked: Task/subagent handoff lost the files.** Context isolation may affect a child agent's view, but no parent-level Flow bridge materialized the bytes first.

## Recommendations
1. Add an explicit attachment materialization bridge that captures eligible OpenCode `FilePart`s for the active message/session, decodes or fetches supported image data, writes validated files into an approved project asset directory, and returns concrete workspace-relative paths for worker use.
2. Keep binary assets outside `.flow/**`; reserve `.flow/**` for session state and derived Markdown docs.
3. Make the bridge narrow and safe: allowlist PNG, JPEG, WebP, GIF, and AVIF MIME types, keep SVG unsupported, enforce size limits, sanitize filenames, prevent path traversal, handle collisions deterministically, and validate destination roots with the existing workspace-root rules.
4. Update prompts, descriptors, schemas, and mode contracts so `flow-auto` materializes attached assets before planning/execution when the user goal depends on them.
5. Add tests for the new ingress boundary: schema tests, runtime/path safety tests, prompt-capture tests for image-dependent `/flow-auto` tasks, and negative tests ensuring evidence packets/worker artifacts do not transport binary data.

## Preventive Measures
- Document clearly that OpenCode chat attachments are not automatically workspace files.
- Add parity tests so docs, descriptors, mode contracts, and tool registry stay aligned if an attachment tool is added.
- Add a regression fixture for `/flow-auto` with an image-dependent app-background task.
- Require future binary/file ingress designs to state ownership, permissions, storage location, validation, cleanup, and worker handoff behavior before implementation.

## Confidence / Limits
- **Confidence:** High that the current failure is a missing Flow/OpenCode attachment materialization contract.
- **Limit:** The exact live runtime lifetime/form of `FilePart.url` in the failing OpenCode session was not re-run. That affects future implementation design, not the root-cause classification.
