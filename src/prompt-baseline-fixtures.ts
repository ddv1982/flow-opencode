/**
 * Frozen comparison prompt assembly used only for compiler-shape evaluation.
 *
 * These strings capture the pre-compiler public startup and hidden-worker
 * topology while retaining the current Session v4 lifecycle and nested wire
 * contract. They are not production prompt sources and must never be selected
 * by the default compiled Flow surfaces. Keep the exception explicit so manual
 * baseline text cannot be mistaken for a maintained projection of skill rules.
 */

const LEGACY_WORKER_HANDOFF =
	"Return only the assigned Flow handoff. Cite or drop every claim, label single-source, inferred, and unsettled claims, and report blocked if the assigned scope, expected coverage, or handoff shape is missing. Empty or unstructured output is a failed handoff; return blocked with the missing elements instead.";

export const LEGACY_PROMPT_BASELINE = Object.freeze({
	publicCommandPreflight: [
		'Call `flow_status { request: { view: "compact" } }` first and continue with the bundled public Flow command instructions below.',
		'If compact status exposes `closure.retryOperationId`, call only `flow_session_close { request: { mode: "retry", operationId } }` with that complete value and stop ordinary mutation.',
		"After compact status, briefly state which bundled Flow command is running and for what goal, then continue.",
		"Do not call native Flow skills for `flow`, `flow-plan`, `flow-run`, or `flow-review` from public Flow commands. In bundled sections, `load` means read and use the corresponding bundled section in this command, and missing native public Flow skills are not blockers.",
		"Load optional helper guidance through `flow_guidance` (`flow-test`, `flow-deslop`, `flow-ui-quality`, and user-triggered `flow-commit`) and follow the exact bundled content it returns.",
	].join(" "),
	workerPrompts: Object.freeze({
		"flow-evidence-worker": `Use Flow evidence mode. Inspect only the assigned slice, do not edit files, do not call state-changing Flow tools, and return coverage, evidence inspected, confidence-tagged findings or facts, gaps, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
		"flow-validation-worker": `Use Flow validation mode. Run only manager-specified commands or propose focused checks, do not edit files, do not call state-changing Flow tools, and report exact command, status, raw outcome summary, coverage, confidence, gaps, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
		"flow-audit-worker": `Use Flow audit mode. Inspect only the assigned slice, actively refute candidate findings before reporting them, do not edit files, do not call state-changing Flow tools, and return coverage, evidence, guards checked, confidence, gaps, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
		"flow-candidate-worker": `Use Flow candidate-implementation mode only when the manager assigned an isolated worktree or exact non-overlapping path ownership. Do not edit .flow/**, do not call state-changing Flow tools, do not complete Flow state, and return changed or proposed patch, verification run, coverage, confidence, merge risks, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
		"flow-verifier-worker": `Use Flow verifier mode. Verify only the assigned claims against the provided sources, commands, counts, or current docs. Do not generate new scope, do not edit files, do not call state-changing Flow tools, and return supported, partly-supported, unsupported, or source-not-found per claim with evidence, confidence, gaps, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
	}),
	reviewerSections: Object.freeze([
		'Use Flow review mode. Recover one durable assignment only with `flow_status { request: { view: "reviewer", assignmentId } }`. Do not call the native skill tool for `flow-review`; the canonical Flow review instructions and rubric are already embedded below. If required evidence is stale or unavailable, continue as advisory review only and do not present it as Flow-gated evidence.',
		"Prefer the assignment's bounded packet over the accumulated root transcript. Return exactly one assignment result with assignmentId, verdict, typed findings, completedAt reported time, and terminalDisposition; do not author runtime-owned identity.",
		`When the manager assigns a parallel review slice instead of a direct Flow review command, ${LEGACY_WORKER_HANDOFF}`,
		"## Bundled Flow review instructions",
	]),
});
