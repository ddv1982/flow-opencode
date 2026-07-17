/**
 * Frozen historical prompt assembly used only for comparative evaluation.
 *
 * These strings capture the pre-compiler public startup and hidden-worker
 * prompts. They are not production prompt sources and must never be selected by
 * the default compiled Flow surfaces. Keep the exception explicit so manual
 * baseline text cannot be mistaken for a maintained projection of skill rules.
 */

const LEGACY_WORKER_HANDOFF =
	"Return only the assigned Flow handoff. Cite or drop every claim, label single-source, inferred, and unsettled claims, and report blocked if the assigned scope, expected coverage, or handoff shape is missing. Empty or unstructured output is a failed handoff; return blocked with the missing elements instead.";

export const LEGACY_PROMPT_BASELINE = Object.freeze({
	publicCommandPreflight: [
		"Call `flow_status` first. If the result includes `setup.skills`, report the setup status and continue with the bundled public Flow command instructions below.",
		"If `flow_status` includes `session.resumePacket` or `session.budget.phaseBoundary`, stop the current autonomous loop and report the resume instructions unless this is a fresh user invocation explicitly resuming the session; only then may `flow_run_start` use `phaseBoundaryAck: true`.",
		"After `flow_status`, briefly state which bundled Flow command is running and for what goal, then continue.",
		"Do not call native Flow skills for `flow`, `flow-plan`, `flow-run`, or `flow-review` from public Flow commands. In bundled sections, `load` means read and use the corresponding bundled section in this command, and missing native public Flow skills are not blockers.",
		"Optional helper skills (`flow-test`, `flow-deslop`, `flow-ui-quality`, and user-triggered `flow-commit`) are not bundled fallbacks. If one is unavailable, record the coverage gap exactly as the bundled instructions require.",
	].join(" "),
	workerPrompts: Object.freeze({
		"flow-evidence-worker": `Use Flow evidence mode. Inspect only the assigned slice, do not edit files, do not call state-changing Flow tools, and return coverage, evidence inspected, confidence-tagged findings or facts, gaps, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
		"flow-validation-worker": `Use Flow validation mode. Run only manager-specified commands or propose focused checks, do not edit files, do not call state-changing Flow tools, and report exact command, status, raw outcome summary, coverage, confidence, gaps, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
		"flow-audit-worker": `Use Flow audit mode. Inspect only the assigned slice, actively refute candidate findings before reporting them, do not edit files, do not call state-changing Flow tools, and return coverage, evidence, guards checked, confidence, gaps, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
		"flow-candidate-worker": `Use Flow candidate-implementation mode only when the manager assigned an isolated worktree or exact non-overlapping path ownership. Do not edit .flow/**, do not call state-changing Flow tools, do not complete Flow state, and return changed or proposed patch, verification run, coverage, confidence, merge risks, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
		"flow-verifier-worker": `Use Flow verifier mode. Verify only the assigned claims against the provided sources, commands, counts, or current docs. Do not generate new scope, do not edit files, do not call state-changing Flow tools, and return supported, partly-supported, unsupported, or source-not-found per claim with evidence, confidence, gaps, and manager follow-ups. ${LEGACY_WORKER_HANDOFF}`,
	}),
	reviewerSections: Object.freeze([
		"Use Flow review mode. Call `flow_status` first. Do not call the native skill tool for `flow-review`; the canonical Flow review instructions and rubric are already embedded below. If Flow setup reports stale/unavailable skills, continue as advisory review only and do not present advisory review as Flow-gated `featureReview` or `finalReview` evidence.",
		"Prefer the manager's bounded review packet over the accumulated root transcript. Return feature review packets with `featureReviewDepth` plus `featureReview`; final reviews still return `finalReview` with `reviewDepth`.",
		`When the manager assigns a parallel review slice instead of a direct Flow review command, ${LEGACY_WORKER_HANDOFF}`,
		"## Bundled Flow review instructions",
	]),
});
